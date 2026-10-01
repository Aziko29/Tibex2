# Local-only middleware (TIBEX_LOCAL_ONLY_v1)

Default-deny himoya qatlami: yoqilganda ilova faqat local tarmoq klientlariga
xizmat qiladi. Tashqi so'rovlar 404 (HTTP) yoki websocket.close(4404)
(WebSocket) oladi.

## Nima uchun kerak?

Backend ko'pincha nginx yoki Cloudflare Tunnel ortida turadi. Bu holatda
ilova "o'zini ochiq deb bilmaydi". Agar bir kunda:

- port noto'g'ri ochilsa (0.0.0.0:8000),
- Cloudflare Tunnel DNS yozuvi noto'g'ri yo'naltirilsa,
- nginx proxy_pass boshqa servisga ko'chirilsa,

butun API tashqi olamga ochilib qoladi. Bu middleware -- ikkinchi himoya
qatlami (defence in depth).

## Qanday ishlaydi?

1. Yo'l normalizatsiyasi: unquote (bir marta), backslash -> slash,
   ikki slashni birlashtirish, nuqta va ikki-nuqta RAD ETISH (drop emas),
   kichik harf.
2. Allowlist: /api/health va /api/telegram/webhook har doim ochiq.
3. Klient IP aniqlash: Cf-Connecting-Ip (cloudflared) yoki X-Forwarded-For
   ning oxirgi tokeni, FAQAT peer local bo'lsa ishonchli.
4. Qaror: klient local bo'lsa o'tkazish; aks holda 404/4404.

## Local tarmoqlar

| Tarmoq | Maqsad |
|---|---|
| 127.0.0.0/8, ::1/128 | Loopback |
| 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 | RFC1918 |
| 100.64.0.0/10 | CGNAT |
| 169.254.0.0/16 | Link-local |
| fc00::/7, fe80::/10 | IPv6 private |

Docker bridge (172.17.0.1) ham shu ro'yxatda -- shuning uchun konteyner
ichidagi backend cloudflared'ni "local" deb to'g'ri taniydi.

## Cloudflare Tunnel bilan muhim nuance

    Internet -> Cloudflare -> cloudflared (host) -> backend (docker)
                                  |
                                  +-- Cf-Connecting-Ip: <klient-haqiqiy-IP>

- Peer = cloudflared (host, 172.17.0.1 docker gateway) -> local
- Klient = Cf-Connecting-Ip headeridagi haqiqiy tashqi IP -> local emas

Demak: TIBEX_LOCAL_ONLY_ENABLED=true bo'lsa, tibex.uz ga internetdan
kiradigan BARCHA klientlar (shu jumladan administrator) 404 oladi.

Yechim -- variantlar:

| Variant | Qachon | Sozlama |
|---|---|---|
| A. O'chirish | Cloudflare orqali tashqi kirish kerak bo'lsa | TIBEX_LOCAL_ONLY_ENABLED=false |
| B. Ichki domen | Faqat LAN'dan ishlash, Cloudflare'ni faqat health uchun | =true, cloudflared'ni local.tibex.uz ga o'tkazish |
| C. IP allowlist | Klinika NAT IP'si ma'lum bo'lsa | =true va kod kengaytirish |

Production: TIBEX_LOCAL_ONLY_ENABLED=true + TIBEX_PATIENT_WEB_ACCESS=true
(bemor ochiq, qolgan barcha rollar faqat LAN).

## Cf-Connecting-Ip ishonchi va tunnel IP soxtalashtirish (TIBEX_TUNNEL_REALIP_v1)

Muammo: cloudflared nginx'ga 127.0.0.1 (yoki docker gateway) dan ulanadi. Agar
nginx `X-Forwarded-For` ga oddiy `$remote_addr` yozsa, XFF = 127.0.0.1 bo'ladi va
backend tunnel orqali kelgan TASHQI klientni LOKAL deb o'tkazib yuboradi
(xodim API'lari internetga ochilib qoladi; rate-limit ham hammaga bitta IP deb
hisoblanadi).

Yechim (uch qatlam):

1. nginx `realip` moduli: `set_real_ip_from` da faqat cloudflared manzili
   (127.0.0.1, ::1; docker'da uning aniq IP'si) bo'lsa, `Cf-Connecting-Ip`
   haqiqiy klient IP (`$remote_addr`) qilib olinadi. Boshqa manzillardan (LAN,
   internet) kelgan header e'tiborsiz — soxtalashtirib bo'lmaydi. Bu ro'yxatga
   LAN diapazonlarini QO'SHMANG.
2. nginx har location'da: `X-Forwarded-For $remote_addr` (qayta yoziladi, klient
   qiymati o'tmaydi), `Cf-Connecting-Ip` va `True-Client-IP` tozalanadi, hamda
   `X-Tibex-Tunnel: 1` qo'yiladi (asl so'rovda Cf-Connecting-Ip bo'lsa, ya'ni
   tunnel orqali kelgan bo'lsa; aks holda 0).
3. Backend fail-closed: `X-Tibex-Tunnel: 1` bo'lib, klient IP baribir lokal
   chiqsa (masalan, cloudflared docker manzili `set_real_ip_from` ga
   qo'shilmagan), so'rov rad etiladi. Header faqat rad etish tomonga ishlaydi,
   shuning uchun klient uni yuborsa ham foyda ko'rmaydi.

Boshqa qoidalar:

- default `TIBEX_TRUST_CF_CONNECTING_IP=false`; backend'ga kelgan `Cf-Connecting-Ip`
  fail-closed (lokal emas) deb hisoblanadi (nginx uni baribir tozalaydi);
- `true` faqat backend'ga FAQAT cloudflared ulanadigan (nginx yo'q) rejimda; bunda
  yaroqsiz qiymat ham fail-closed.

Cloudflared docker konteynerida bo'lsa, nginx ko'radigan manzilni aniqlang
(`docker network inspect`, yoki log: `local_only: denied ... peer=...`) va
nginx.conf'ga `set_real_ip_from <shu IP>;` qo'shing.

Tekshiruv (tashqi mashinadan, 404 kutiladi):

    curl -sk -o /dev/null -w '%{http_code}\n' -H 'Cf-Connecting-Ip: 192.168.1.10' \
         -X POST https://tibex.uz/api/auth/login -d '{}'

## Telegram webhook

Telegram serverlari tashqi IP'lardan (149.154.167.x, 91.108.4.x)
chaqiradi. Middleware ularni allowlist'dan o'tkazadi
(/api/telegram/webhook). Endpoint o'zining X-Telegram-Bot-Api-Secret-Token
tekshiruviga ega (app/security/telegram.py:verify_webhook_secret).

## O'chirish

.env.public ga qo'shing:

    TIBEX_LOCAL_ONLY_ENABLED=false

Serverni qayta ishga tushiring. Lifespan log'da:

    WARNING local_only middleware: DISABLED -- ilova har qanday tarmoqdan ochiq

Kod orqali to'liq rollback: app/main.py dan
app.add_middleware(LocalOnlyMiddleware) satrini olib tashlash.

## Log

Rate-limited: bir klient IP/daqiqa uchun ko'pi bilan 1 satr. Cookie,
token, query-string, body, header nomlari hech qachon yozilmaydi.

Format:

    local_only: denied http path=/api/patients peer=172.17.0.1 client=203.0.113.9

- path -- 200 belgigacha kesilgan, yangi qator belgilari almashtirilgan.
- peer -- to'g'ridan-to'g'ri ulanish manzili (cloudflared -> 172.17.0.1).
- client -- Cf-Connecting-Ip yoki X-Forwarded-For dan aniqlangan haqiqiy
  klient IP.

## Startup annonsi

Lifespan bir marta log qiladi:

    INFO  local_only middleware: ENABLED (default-deny -- faqat local klient
          IP'lari kira oladi; /api/health va /api/telegram/webhook har doim ochiq)

yoki

    WARNING local_only middleware: DISABLED -- ilova har qanday tarmoqdan ochiq

## Testlar

backend/tests/test_local_only.py -- 57 test:

- Yo'l normalizatsiyasi (12 holat, shu jumladan %252e%252e bir marta decode)
- Chegarali prefiks (6 holat)
- Local IP aniqlash (16 holat, IPv4-mapped va chegara diapazonlari)
- Klient IP resolution (6 holat, spoofing, cf/xff prioriteti)
- Middleware E2E (10 holat, Docker gateway, ikki-nuqta rad etish, allowlist)
- Log throttle (3 holat)
- announce_once idempotentligi (2 holat)

Ishga tushirish:

    cd backend
    pytest tests/test_local_only.py -v

## Kelajakdagi yaxshilanishlar (2-bosqich)

- _resolve_client_ip mantiqini app/security/netutil.py:client_ip bilan
  birlashtirish (umumiy _resolve_from_parts funksiyasi).
- IP allowlist (TIBEX_LOCAL_ONLY_ALLOW_IPS) qo'shish -- klinika NAT IP'sini
  qo'lda kiritish uchun.
- Cloudflare Access bilan integratsiya (JWT tekshiruvi).
