from functools import lru_cache
from ipaddress import ip_address
import os
import re
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


def _is_production_origin(origin: str) -> bool:
    """Accept only real HTTPS origins, never paths or example placeholders."""
    if not isinstance(origin, str) or not origin or origin != origin.strip():
        return False
    if any(marker in origin.lower() for marker in ("<", ">", "change_me", "placeholder", "example")):
        return False
    try:
        parsed = urlsplit(origin)
        host = parsed.hostname
        # Accessing .port also validates malformed port strings.
        _ = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme.lower() != "https"
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        return False
    host = host.lower().rstrip(".")
    if host == "localhost" or host.endswith((".localhost", ".local", ".test", ".invalid", ".example")):
        return False
    try:
        address = ip_address(host)
        if address.is_loopback or address.is_unspecified:
            return False
    except ValueError:
        try:
            ascii_host = host.encode("idna").decode("ascii")
        except UnicodeError:
            return False
        if len(ascii_host) > 253 or any(
            not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
            for label in ascii_host.split(".")
        ):
            return False
    return True


# TIBEX_FILE_SECRETS_v1: "Docker/Kubernetes secrets" andozasi.
#
# Muammo: oddiy .env / muhit o'zgaruvchisi (environment variable) sifatida
# saqlangan sir har doim quyidagilarga ochiq bo'ladi:
#   - `docker inspect <container>` yoki `docker compose config`
#   - konteyner ichida `/proc/<pid>/environ`
#   - shu jarayonni ishga tushiradigan har qanday CI/orkestrator logi
#   - xatolik yuz berganda ba'zi kutubxonalar butun os.environ'ni dump qiladi
#
# Yechim: eng nozik kalitlarni ENV QIYMATI sifatida emas, balki FAYL
# sifatida uzatish (masalan Docker Compose `secrets:` -> /run/secrets/<nom>,
# yoki Vault Agent / Kubernetes Secret volume mount). Bu holda konteyner
# muhitida faqat FAYL YO'LI ko'rinadi, qiymatning o'zi emas.
#
# Ishlatish: TIBEX_SECRET_KEY ni to'g'ridan-to'g'ri qo'yish o'rniga,
#   TIBEX_SECRET_KEY_FILE=/run/secrets/tibex_secret_key
# deb qo'ying — fayl mavjud bo'lsa, uning tarkibi (bo'sh joylarsiz)
# TIBEX_SECRET_KEY sifatida ishlatiladi. Ikkalasi ham berilsa, _FILE ustun
# turadi (aniq niyat bildirilgan deb hisoblanadi).
#
# TIBEX_FILE_SECRETS_CROSS_PLATFORM_v1:
#   Windows'da `/run/secrets/...` mavjud emas. Ilgari bu `RuntimeError`
#   bilan qulab tushardi — dev/test muhitida ishlash imkonsiz edi.
#   Endi: fayl MAVJUD BO'LMASA — bu env jim o'tkazib yuboriladi va
#   `TIBEX_<FIELD>` qiymati (yoki default) ishlatiladi. Fayl mavjud
#   bo'lib, o'qib bo'lmasa — xato (chunki bu aniq muammo).
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="TIBEX_",
        extra="ignore",
        case_sensitive=False,
    )

    def __init__(self, **values):
        # Read *_FILE secret sources into this Settings instance only. Never
        # copy secret material into process-wide os.environ (inherited by child processes).
        for env_name, path in os.environ.items():
            if not env_name.startswith("TIBEX_") or not env_name.endswith("_FILE"):
                continue
            path = (path or "").strip()
            if not path:
                continue

            # Cross-platform: fayl mavjud bo'lmasa — jim o'tkazib yuborish.
            # Prod'da docker secrets bilan fayl mavjud bo'ladi.
            # Dev/test/Windows'da fayl yo'q — TIBEX_<FIELD> env yoki default ishlaydi.
            if not os.path.isfile(path):
                continue

            if env_name == "TIBEX_MASTER_KEYS_FILE":
                values["master_keys_file"] = path
                continue
            field_name = env_name[len("TIBEX_"):-len("_FILE")].lower()
            if field_name not in type(self).model_fields:
                continue
            try:
                with open(path, "r", encoding="utf-8") as secret_file:
                    values[field_name] = secret_file.read().strip()
            except OSError as exc:
                # Fayl bor lekin o'qib bo'lmadi — bu haqiqiy xato.
                raise RuntimeError(
                    f"{env_name} uchun secret faylni o'qib bo'lmadi"
                ) from exc
        super().__init__(**values)

    env: str = "local"

    # Xavfsizlik kalitlari
    secret_key: str = Field(..., min_length=32)
    master_key_b64: str
    # Versioned key ring. Legacy single key remains supported during migration.
    master_key_b64_old: str = ""
    master_keys_file: str | None = None
    master_active_key_id: str = "1"
    # Demo reset uchun maxfiy kod (16+ belgi).
    # Bo'sh bo'lsa — demo reset butunlay o'chirilgan.
    # .env ga qo'shing: TIBEX_DEMO_RESET_CODE=<16+ belgi>
    demo_reset_code: str = ""
    blind_index_key_b64: str

    # Parol hashlash uchun maxfiy kalit (pepper)
    # DB'da EMAS, faqat .env'da saqlanadi
    password_pepper: str = Field(..., min_length=32)
    # Pepper almashtirish davrida ESKI pepper(lar) (vergul bilan ajratilgan). Eski pepper bilan
    # tasdiqlangan parollar kirishda yangi pepper bilan qayta hashlanadi. Hamma akkaunt
    # ko'chgach bo'sh qoldiring. Env: TIBEX_PASSWORD_PEPPER_OLD yoki TIBEX_PASSWORD_PEPPER_OLD_FILE
    password_pepper_old: str = ""

    # CORS va cookie
    # allowed_origins: frontend qaysi origin(lar)dan kelsa CORS ruxsat berilishi.
    # Frontend backenddan alohida serve qilinganda BU YERGA uning haqiqiy
    # originini (masalan https://admin.tibex.uz) qo'shish SHART, aks holda
    # browser cross-origin so'rovlarni bloklaydi.
    allowed_origins: list[str] = ["http://localhost:8000"]
    cookie_domain: str | None = None
    cookie_secure: bool | None = None
    # cookie_samesite: "strict" | "lax" | "none"
    #   - "lax"    : frontend backend bilan bir xil registrable domenda
    #                (masalan admin.tibex.uz + api.tibex.uz) bo'lsa YETARLI
    #                va tavsiya etiladi (CSRF himoyasi kuchli qoladi).
    #   - "none"   : frontend BUTUNLAY BOSHQA domenda bo'lsa shart
    #                (avtomatik ravishda secure=True talab qilinadi).
    #   - "strict" : faqat backend frontendni o'zi serve qilganda ishlaydi.
    cookie_samesite: str = "lax"

    # Frontend backend jarayoni ichida serve qilinsinmi?
    # Default: False — frontend ENDI ALOHIDA ilova, backend faqat /api/* beradi.
    # Faqat lokal bir martalik tekshiruv uchun True qilib yoqish mumkin.
    serve_frontend: bool = False

    # TIBEX_LOCAL_ONLY_v1: yoqilganda (default) ilova faqat local klient
    # IP'laridan (loopback, RFC1918, CGNAT, ULA, link-local) foydalanish
    # mumkin. Local bo'lmagan HTTP so'rovlar 404 oladi, WebSocket'lar
    # 4404 bilan yopiladi. `/api/health` har doim ochiq — tashqi
    # monitorlar uchun. O'chirish faqat ilova ataylab ommaviy tarmoqqa
    # chiqarilganda kerak.
    local_only_enabled: bool = True

    # TIBEX_PATIENT_PUBLIC_ACCESS_v1:
    # Yoqilganda bemor portali internetdan ham ochiq bo'ladi, xodim API'lari
    # esa baribir faqat lokal tarmoqdan ishlaydi. Bu `local_only_enabled`
    # bilan birga ishlaydi:
    #
    #   local_only_enabled=false                → hammasi ochiq (faqat dev uchun)
    #   local_only_enabled=true, patient=true   → bemor ochiq, xodim lokal
    #   local_only_enabled=true, patient=false  → hammasi lokal
    #
    # Ochiq yo'llar (patient=true bo'lganda):
    #   /api/health              (har doim)
    #   /api/telegram/webhook    (har doim — Telegram server o'zi chaqiradi)
    #   /api/otp/*               → bemor telefon+OTP
    #   /api/portal/*            → bemor kabineti (role=patient)
    #   /api/telegram/bot-info   → login sahifasi uchun bot username
    #   /api/auth/me             → bemor-login.html sessiya tekshiruvi
    #   /api/auth/logout         → xavfsiz chiqish
    #
    # Xodim login/API'lari (`/api/auth/login`, `/api/users`, `/api/patients`,
    # `/api/appointments`, `/api/lab-orders`, `/api/payments`, `/api/audit`,
    # `/api/settings`, `/api/roles`, `/api/monitoring/*`, `/api/ws` va h.k.)
    # bu ro'yxatda ATAYLAB YO'Q — ular faqat LAN'dan ishlaydi.
    patient_web_access: bool = True

    # TIBEX_CF_HEADER_TRUST_v1: `Cf-Connecting-Ip` FAQAT backend'ga to'g'ridan-to'g'ri
    # cloudflared (Cloudflare Tunnel) ulanadigan bo'lsa ishonchli. nginx orqasida
    # bu header klient tomonidan soxtalashtirilishi mumkin (peer=127.0.0.1) va
    # local-only himoyani butunlay chetlab o'tadi. Default: false.
    trust_cf_connecting_ip: bool = False

    # 29-band: kuzatuv
    log_json: bool = True
    sentry_dsn: str = ""
    metrics_token: str = ""

    # Ma'lumotlar bazasi
    database_url: str = "postgresql+asyncpg://tibex:tibex@localhost:5432/tibex"
    redis_url: str | None = None

    # Sessiya
    session_ttl_minutes: int = 480
    inactivity_minutes: int = 30
    login_lockout_minutes: int = 15
    max_login_attempts: int = 5

    # Bootstrap (frontend snapshot)
    bootstrap_patient_days: int = 30
    bootstrap_appointment_days: int = 7

    # Integratsiya (device turi): ruxsat etilgan LAN diapazonlari (vergul bilan).
    # Bo'sh qoldirilsa LAN manzillar yopiladi. Loopback/link-local doim bloklanadi.
    integration_lan_cidrs: str = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

    # TIBEX_CLINIC_TZ_v1
    clinic_timezone: str = "Asia/Tashkent"

    # TIBEX_PROXY_TRUST_v1: X-Forwarded-For faqat shu IP'lardan ishonchli
    trusted_proxy_ips: list[str] = ["127.0.0.1", "::1"]

    # TIBEX_THREAT_WHITELIST: threat detector bu IP'larni tahlil qilmaydi
    # (legit pentest, monitoring, health-check uchun)
    threat_whitelist: str = "127.0.0.1,::1,localhost"

    # TIBEX_SECRET_SAFE_LOGGING_v1: auth oqimidagi (login/session) qo'shimcha
    # debug loglarini yoqadi. HECH QACHON token/cookie qiymatini chiqarmaydi
    # (faqat sabab va jti'ning oxirgi 6 belgisi) va is_prod=True bo'lsa
    # deps.py darajasida MAJBURIY o'chirilgan bo'ladi — bu yerda true qilib
    # qo'yish production'da hech narsani o'zgartirmaydi.
    debug_auth_logging: bool = False

    # TIBEX_TELEGRAM_LOGIN_v1: bemor OTP kodini Telegram bot orqali olish.
    # Bo'sh bo'lsa — funksiya butunlay o'chirilgan holatda ishlaydi:
    # SMS asosiy kanal bo'lib qoladi va webhook so'rovlari rad etiladi.
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    # Telegramning webhook so'rovi haqiqiyligini tekshirish uchun
    # (setWebhook chaqirilganda secret_token=... shu qiymat bilan beriladi,
    # Telegram har bir so'rovda X-Telegram-Bot-Api-Secret-Token headerini
    # yuboradi). Bo'sh bo'lsa — webhook himoyasiz ishlaydi (faqat dev uchun).
    telegram_webhook_secret: str = ""
    eskiz_token: str = ""

    @model_validator(mode="after")
    def _production_security_guard(self):
        if self.is_prod:
            if not self.redis_url:
                raise ValueError("Production muhitida TIBEX_REDIS_URL majburiy")
            if not self.allowed_origins or any(not _is_production_origin(origin) for origin in self.allowed_origins):
                raise ValueError("Production allowed_origins faqat haqiqiy HTTPS originlardan iborat bo'lishi kerak")
            if not self.secure_cookie:
                raise ValueError("Production cookie Secure bo'lishi shart")
            if self.serve_frontend:
                raise ValueError("Production muhitida TIBEX_SERVE_FRONTEND=false bo'lishi shart")
            if self.cookie_domain:
                raise ValueError("__Host- cookie uchun TIBEX_COOKIE_DOMAIN bo'sh bo'lishi shart")
            if self.demo_reset_code:
                raise ValueError("Production muhitida demo reset kodi sozlanmasligi kerak")
            secret_values = (self.secret_key, self.master_key_b64, self.blind_index_key_b64, self.password_pepper)
            normalized = [value.strip() for value in secret_values]
            if len(set(normalized)) != len(normalized):
                raise ValueError("Production kalitlari bir-biridan alohida bo'lishi kerak")
            if any(not value or any(marker in value.upper() for marker in ("CHANGE_ME", "CHANGE-ME", "PLACEHOLDER", "EXAMPLE")) for value in normalized):
                raise ValueError("Production kalitlarida namunaviy yoki bo'sh qiymat bo'lmasligi kerak")
            try:
                db_url = make_url(self.database_url)
            except Exception as exc:
                raise ValueError("Production database URL yaroqsiz") from exc
            if db_url.get_backend_name() != "postgresql" or not db_url.password or len(db_url.password) < 24:
                raise ValueError("Production PostgreSQL paroli kamida 24 belgidan iborat bo'lishi kerak")
            if self.telegram_bot_token and not self.telegram_webhook_secret:
                raise ValueError("Telegram yoqilganda production webhook secret majburiy")
            # TIBEX_PATIENT_PUBLIC_ACCESS_v1:
            # Agar bemor portali ochiq bo'lmasa (patient_web_access=False),
            # u holda local_only_enabled=false bo'lishi MANTIQSIZ — bu
            # butun ilovani ochiq qilib qo'yadi. Ishlab chiqarishda ikkalasi
            # birgalikda to'g'ri sozlanishi shart:
            #   patient=true,  local_only=true   → tavsiya (bemor ochiq, xodim lokal)
            #   patient=false, local_only=true   → to'liq lokal (LAN-only klinika)
            #   patient=false, local_only=false  → BUTUN API ochiq — xavfli!
            if not self.local_only_enabled:
                raise ValueError(
                    "Production muhitida TIBEX_LOCAL_ONLY_ENABLED=true bo'lishi shart "
                    "(xodim API'lari faqat LAN'da). Bemor portali uchun "
                    "TIBEX_PATIENT_WEB_ACCESS=true ni yoqing."
                )
        return self

    @field_validator("env", mode="before")
    @classmethod
    def _normalize_env(cls, value):
        value = (value or "local").strip().lower()
        if value not in {"local", "test", "production"}:
            raise ValueError("TIBEX_ENV local, test yoki production bo'lishi kerak")
        return value

    @field_validator("cookie_secure", "redis_url", "cookie_domain", "master_keys_file", mode="before")
    @classmethod
    def _empty_to_none(cls, v):
        """Bo'sh satrni None'ga aylantiradi (.env faylida `KEY=` bo'lsa)."""
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

    @field_validator("cookie_samesite", mode="before")
    @classmethod
    def _normalize_samesite(cls, v):
        v = (v or "lax").strip().lower()
        if v not in ("strict", "lax", "none"):
            raise ValueError(
                "TIBEX_COOKIE_SAMESITE faqat 'strict', 'lax' yoki 'none' bo'lishi mumkin"
            )
        return v

    @field_validator("clinic_timezone", mode="before")
    @classmethod
    def _validate_clinic_timezone(cls, v):
        # TIBEX_TIMEZONE_VALIDATION_v1: noto'g'ri TZ keyinroq `ZoneInfo(...)` da
        # 500 xatosiga olib keladi (`payments.list_payments?today=true`,
        # `close_shift`). Boshidanoq ishga tushishda tekshiramiz.
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        value = (v or "Asia/Tashkent").strip() or "Asia/Tashkent"
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
            raise ValueError(f"TIBEX_CLINIC_TIMEZONE noto'g'ri: {value!r}") from exc
        return value

    @property
    def is_prod(self) -> bool:
        return self.env == "production"

    @property
    def secure_cookie(self) -> bool:
        # __Host- cookie talabi: Secure, Path=/ va Domain atributisiz.
        return True


@lru_cache
def get_settings() -> Settings:
    return Settings()