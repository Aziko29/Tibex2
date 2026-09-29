# Zaxira va tiklash

- **Zaxira:** `scripts/backup.sh` — `pg_dump -Fc` → `age` (alohida backup kaliti, pepper/master'dan hosil qilinmaydi) → SHA256 → `/var/backups/tibex` (700) + offsite (`TIBEX_OFFSITE`) → 30 kun saqlash. Parol `~/.pgpass` (0600).
- **Tiklash:** `scripts/restore.sh <fayl> <bo'sh_baza>` (ishlab turgan bazaga yozmaydi).
- **Mashq:** `scripts/restore_drill.sh` — oyiga 1 marta (`tibex-restore-drill.timer`): qatorlar soni, bitta shifrlangan qatorni deshifrlash, `verify_audit`.
- **Kalitlar (escrow):** (1) `age` maxfiy kaliti va (2) `master_keys.json` zaxira nusxadan **alohida**, kamida 2 ta joyda (masalan: yopiq seyf + ishonchli shaxs) saqlansin. Master kalitsiz zaxiradagi PHI o'qilmaydi; `age` kalitisiz zaxira ochilmaydi.
- **Maqsad:** RPO ≤ 24 soat (kunlik zaxira; kerak bo'lsa WAL arxivlash qo'shiladi), RTO ≤ 4 soat. Mashq natijasida haqiqiy vaqtni o'lchab shu qiymatlarni yangilang.
- Audit jadvallarini o'chirish/arxivlash: `scripts/audit_archive.py` (superuser).
