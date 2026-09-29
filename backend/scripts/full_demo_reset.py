"""Butun tizimni "0" / demo holatiga qaytaradi va testdan/seeddan qolib
ketgan ma'lumotlarni (sessiyalar, login urinishlar, OTP, telegram
tokenlar, audit yozuvlari) tozalaydi.

Standart holatda tegilmaydi: Role, User (xodimlar), Doctor, Service,
Equipment, Reagent, Integration, SystemSetting — bular demo ishlashi
uchun zarur bo'lgan katalog/sozlama, "seed axlati" emas.

Ishga tushirish (backend/ papkasidan):
    python -m scripts.full_demo_reset                 # tasdiqlash so'raydi
    python -m scripts.full_demo_reset --yes            # tasdiqsiz
    python -m scripts.full_demo_reset --dry-run         # hech narsa o'chirmaydi
    python -m scripts.full_demo_reset --wipe-staff --yes                       \\
        --keep-logins admin,superadmin                 # xodim akkauntlarini ham
                                                         # tozalaydi, faqat
                                                         # ko'rsatilganlarni qoldiradi
"""
import argparse
import asyncio

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.redis_client import close_redis, get_redis
from app.services.demo_reset import run_full_reset


async def main_async(args: argparse.Namespace) -> None:
    settings = get_settings()
    if settings.is_prod:
        raise SystemExit("[X] Demo reset production muhitida taqiqlangan; hech narsa o'zgartirilmadi.")
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    keep_logins = [x.strip() for x in (args.keep_logins or "").split(",") if x.strip()]

    async with SessionLocal() as db:
        if not args.yes and not args.dry_run:
            print("=" * 60)
            print("  ⚠️  DIQQAT — TO'LIQ DEMO RESET")
            print("=" * 60)
            print("  O'chiriladi: bemorlar, qabullar, lab buyurtmalari,")
            print("  to'lovlar, qaytarishlar, smenalar, sessiyalar,")
            print("  login urinishlar, OTP/telegram tokenlar, audit jurnali.")
            if args.wipe_staff:
                print("  ⚠️  --wipe-staff: admin/superadmin'dan boshqa BARCHA")
                print("      xodim akkauntlari ham o'chiriladi!")
                if keep_logins:
                    print(f"      Qoladigan login'lar: {', '.join(keep_logins)}")
            print("=" * 60)
            answer = input("  Davom etish uchun 'RESET' deb yozing: ").strip()
            if answer != "RESET":
                print("  Bekor qilindi.")
                return

        redis = get_redis()
        counts = await run_full_reset(
            db,
            performed_by="CLI (full_demo_reset.py)",
            wipe_staff=args.wipe_staff,
            keep_logins=keep_logins,
            redis=redis,
            dry_run=args.dry_run,
        )

    await close_redis()
    await engine.dispose()

    print()
    print("=" * 60)
    print("  DRY RUN — hech narsa o'chirilmadi" if args.dry_run else "  Natija — o'chirildi/tozalandi")
    print("=" * 60)
    for k, v in counts.items():
        if k.startswith("_"):
            continue
        print(f"  {k:<24} {v}")
    print("=" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--yes", action="store_true", help="Tasdiqlashsiz darhol bajarish")
    parser.add_argument("--dry-run", action="store_true", help="Hech narsa o'chirmay, faqat sonlarni ko'rsatish")
    parser.add_argument("--wipe-staff", action="store_true", help="Xodim akkauntlarini ham tozalash (admin/superadmin'dan tashqari)")
    parser.add_argument("--keep-logins", type=str, default="", help="wipe-staff bilan birga: vergul bilan ajratilgan, o'chirilmaydigan login'lar")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
