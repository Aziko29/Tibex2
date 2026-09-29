# TIBEX: Variant A → Variant B ko'chirish qo'llanmasi

Bu fayl serveringizda **ketma-ket, terminal orqali** bajariladi.
Har qadamdan keyin **VERIFY** ni tekshiring — muvaffaqiyatsiz bo'lsa keyingisiga o'tmang.
Fayl o'zgarishlari (`docker-compose.yml`, `.env.example`, `setup.py`,
`deploy/tibex-backup.cron`) allaqachon repo'da tayyor.

---

## QADAM 1 — Zaxira (o'tkazib bo'lmaydi)

```bash
cd /path/to/BIT/backend
mkdir -p /var/backups/tibex-pre-variant-b
docker compose exec -T db pg_dump -U tibex tibex | gzip > /var/backups/tibex-pre-variant-b/tibex_$(date +%F_%H%M).sql.gz
sudo tar czf /var/backups/tibex-pre-variant-b/secrets_$(date +%F).tar.gz -C /path/to/BIT/backend secrets/
ls -lh /var/backups/tibex-pre-variant-b/
```
**VERIFY:** ikkala fayl mavjud, hajmi > 0.

## QADAM 2 — PostgreSQL 16 ni host'ga o'rnatish

```bash
sudo apt update && sudo apt install -y postgresql-16 postgresql-contrib-16
sudo systemctl enable --now postgresql
```
**VERIFY:** `psql --version` → 16.x; `systemctl is-active postgresql` → `active`.

## QADAM 3 — Foydalanuvchi va baza

```bash
DB_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
echo "DB_PASSWORD=$DB_PASSWORD" | sudo tee /root/.tibex_db_password
sudo chmod 600 /root/.tibex_db_password

sudo -u postgres psql <<EOF
CREATE USER tibex WITH PASSWORD '$DB_PASSWORD';
CREATE DATABASE tibex OWNER tibex ENCODING 'UTF8' TEMPLATE=template0;
GRANT ALL PRIVILEGES ON DATABASE tibex TO tibex;
EOF

PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U tibex -d tibex -c "SELECT version();"
```
**VERIFY:** `SELECT version();` xatosiz ishlaydi.

## QADAM 4 — Ma'lumotni Docker DB'dan host'ga ko'chirish

```bash
cd /path/to/BIT/backend
docker compose ps   # db hali ishlab turishi kerak
gunzip -c /var/backups/tibex-pre-variant-b/tibex_*.sql.gz | \
  PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U tibex -d tibex
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U tibex -d tibex -c "\dt"
```
**VERIFY:** jadvallar mavjud; `users`/`patients` sonlari Docker'dagi bilan bir xil.

## QADAM 5 — `pg_hba.conf` / `postgresql.conf`

`/etc/postgresql/16/main/pg_hba.conf`ga qo'shing:
```
local   tibex     tibex                  md5
host    tibex     tibex  127.0.0.1/32    scram-sha-256
host    tibex     tibex  ::1/128         scram-sha-256
```

`/etc/postgresql/16/main/postgresql.conf`:
```conf
listen_addresses = 'localhost'      # tashqi port YO'Q
port = 5432
shared_buffers = 2GB                 # RAM'ga qarab (free -h)
effective_cache_size = 6GB
password_encryption = scram-sha-256
ssl = off                            # Nginx HTTPS bilan ishlaydi
log_min_duration_statement = 1000
```

```bash
sudo systemctl restart postgresql
ss -tlnp | grep 5432    # faqat 127.0.0.1:5432 ko'rinishi shart
```
**VERIFY:** tashqi serverdan `nc -zv <server-ip> 5432` → refused.

## QADAM 5a — Docker tarmog'i va haqiqiy klient IP

`docker-compose.yml`dagi `backend` servisi `network_mode: host` bilan ishlaydi,
`ports:`/`extra_hosts:` yo'q. Shuning uchun:

- Postgres `listen_addresses='localhost'` bo'lsa ham backend `127.0.0.1:5432` orqali ulanadi
  (`secrets/database_url.txt` da host `127.0.0.1` bo'lishi shart, `host.docker.internal` emas).
- Redis `127.0.0.1:6379` da ochilgan (`secrets/redis_url.txt` shu manzilga).
- gunicorn `127.0.0.1:8000` da tinglaydi; nginx → backend ulanishi `127.0.0.1` dan keladi va
  `TIBEX_TRUSTED_PROXY_IPS=["127.0.0.1","::1"]` to'g'ri ishlaydi.
- nginx `X-Forwarded-For $remote_addr` bilan sarlavhani **almashtiradi** (qo'shmaydi), backend esa
  faqat bitta valid IP'ni qabul qiladi.

**Muqobil (host-network taqiqlangan bo'lsa — QAROR KERAK):** `listen_addresses='localhost,<docker-gateway-ip>'`,
`pg_hba.conf` ga `172.16.0.0/12 scram-sha-256` va `TIBEX_TRUSTED_PROXY_IPS` ga gateway IP. Bu variant
avtomatik sozlanmagan; tanlasangiz `docker-compose.yml`ni shunga moslab o'zgartirish kerak.

**VERIFY (haqiqiy serverda):**
```bash
cd /path/to/BIT/backend
BASE_URL=https://tibex.uz ./scripts/check_real_ip.sh
```
Skript soxta `X-Forwarded-For: 1.2.3.4` yuboradi va `login_attempts.ip` nginx ko'rgan IP bilan
bir xil, `1.2.3.4` dan farqli ekanini tekshiradi. (Marker urinish audit jurnalida `login` yozuvi
qoldiradi; audit yozuvlari o'chirilmaydi.)

## QADAM 6-7 — Ochiq sozlamalar va secret fayllari

Compose maxfiy qiymatlarni muhit o'zgaruvchisiga qo'ymaydi. Sir bo'lmagan
sozlamalarni `.env.public`ga, secretlarni `secrets/` fayllariga kiriting:

```bash
cd /path/to/BIT/backend
cp .env.example .env.public
chmod 600 .env.public
install -d -m 700 secrets
```

Quyidagi fayllarni maxfiy qiymat bilan to'ldiring. Qiymatlarni buyruq
argumentiga, `echo`ga, logga yoki chatga yozmang:

```text
secrets/database_url.txt              postgresql+asyncpg://tibex:<parol>@127.0.0.1:5432/tibex
secrets/redis_url.txt                  redis://:<redis-parol>@127.0.0.1:6379/0
secrets/redis.conf                     appendonly yes; requirepass <xuddi shu redis-parol>
secrets/secret_key.txt                 alohida, 32 bayt yoki undan kuchli kalit
secrets/master_key_b64.txt             alohida 32 bayt base64 kalit (eski moslik, keyring ID "1")
secrets/master_keys.json               kalit halqasi: {"1":"<b64>"}; rotatsiyada {"1":..., "2":...}
secrets/blind_index_key_b64.txt        master kalitdan boshqa, alohida 32 bayt base64 kalit
secrets/password_pepper.txt            alohida 32 bayt yoki undan kuchli pepper
secrets/telegram_bot_token.txt         Telegram ishlatilmasa bo'sh; aks holda yangi token
secrets/telegram_webhook_secret.txt    Telegram ishlatilmasa bo'sh; aks holda yangi webhook siri
```

Kalitlarni yaratish va almashtirish tartibi: [`docs/ROTATION.md`](../docs/ROTATION.md).
Master kalitni almashtirishdan oldin qayta shifrlash skripti tayyor bo'lishi
shart. So'ng ruxsatlarni belgilang:

```bash
chmod 700 secrets
chmod 600 secrets/*
```

`database_url.txt`dagi parol PostgreSQL'dagi haqiqiy `tibex` paroliga mos
bo'lishi kerak. `python setup.py` kalit yaratmaydi yoki ko'rsatmaydi, `.env`
yozmaydi; to'liq sozlangandan keyingina Compose'ni tekshiradi va ishga
tushiradi.

**VERIFY:** o'nta fayl mavjud (`redis.conf` bilan); kalitlar takrorlanmaydi; DB paroli kamida
24 belgi; Telegram ishlatilsa token va webhook siri ikkalasi ham to'ldirilgan.
Tekshiruvda maxfiy qiymatlarni ekranga chiqarmang.

## QADAM 8-9 — Ishga tushirish

```bash
python setup.py
```
`setup.py` `.env.public` va secret fayllar mavjudligini tekshiradi; namuna
qiymat yoki majburiy bo'sh fayl bo'lsa to'xtaydi. So'ng `redis` va `backend`
servislarini ko'taradi. Kalitlarni o'zi yaratmaydi.

Agar qo'lda bajarmoqchi bo'lsangiz:
```bash
docker compose down          # "-v" YOZMANG — Redis volume saqlanadi
docker compose up -d --build
docker compose logs -f backend
```
**VERIFY:** `docker compose ps` → faqat `redis`(healthy) va `backend`(running);
loglarda xato yo'q; `docker compose exec backend alembic current` ishlaydi.

## QADAM 10 — Backend tekshiruvi

```bash
curl -sf http://127.0.0.1:8000/api/health
curl -i -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"admin","password":"<parol>"}'
```
**VERIFY:** health → `{"ok":true}` (DB yoki Redis ishlamasa 503 `{"ok":false}`); login → 200 + Set-Cookie.

## QADAM 11 — Nginx (host)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo mkdir -p /var/www/tibex
sudo rsync -a --exclude='*.deb' --exclude='*.md' --exclude='docs/' --exclude='README*' \
  /path/to/BIT/frontend/ /var/www/tibex/frontend/
sudo chown -R www-data:www-data /var/www/tibex/frontend

sudo cp /path/to/BIT/backend/deploy/nginx.conf /etc/nginx/sites-available/tibex
sudo ln -sf /etc/nginx/sites-available/tibex /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d tibex.uz -d www.tibex.uz
```
**VERIFY:** `curl -I https://tibex.uz/login.html` → 200; `curl -I https://tibex.uz/api/health` → 200.

## QADAM 12 — Shifrlangan zaxira va tiklash mashqi

```bash
sudo apt install age rclone            # yoki rsync
age-keygen -o /root/tibex-backup-key.txt   # MAXFIY kalit: serverdan tashqarida saqlang (docs/BACKUP.md)
sudo install -d -m 700 /etc/tibex
echo 'TIBEX_BACKUP_PUBKEY=age1...' | sudo tee /etc/tibex/backup.env; sudo chmod 600 /etc/tibex/backup.env
# ~/.pgpass (0600): 127.0.0.1:5432:tibex:tibex:<parol>
sudo cp backend/deploy/tibex-backup.cron /etc/cron.daily/tibex-backup && sudo chmod +x /etc/cron.daily/tibex-backup
sudo /etc/cron.daily/tibex-backup
sudo cp backend/deploy/tibex-restore-drill.* /etc/systemd/system/ && sudo systemctl enable --now tibex-restore-drill.timer
TIBEX_BACKUP_IDENTITY=/root/tibex-backup-key.txt backend/scripts/restore_drill.sh   # qo'lda mashq
```
**VERIFY:** `RESTORE DRILL: MUVAFFAQIYATLI`.

## QADAM 13 — Eski Docker volume'ni tozalash

**Faqat kamida 1 hafta kuzatgandan va restore mashqidan keyin:**
```bash
docker volume ls | grep tibex
docker volume rm backend_tibex_pg   # loyiha nomiga qarab nom farq qilishi mumkin
```

---

## YAKUNIY TEKSHIRUV

- [ ] `docker ps` → faqat `redis`, `backend`
- [ ] `systemctl status postgresql` → active
- [ ] `ss -tlnp` → 5432 va 8000 faqat `127.0.0.1`da, 443 esa `0.0.0.0`da
- [ ] `users`/`patients`/`audit_logs` sonlari eski bilan bir xil
- [ ] `https://tibex.uz` orqali login, CRUD, WebSocket ishlaydi
- [ ] `scripts/check_real_ip.sh` → `[OK]`
- [ ] `curl -I https://tibex.uz/x.deb` → 404 (frontend'da `.deb`/`.md` yo'q)
- [ ] `.env`, `/root/.tibex_db_password`, `secrets/*` → `chmod 600`/`700`
- [ ] Cron backup ishlagan va restore sinovdan o'tgan

## ROLLBACK (Variant B muvaffaqiyatsiz bo'lsa)

```bash
cd /path/to/BIT/backend
cp docker-compose.yml.bak docker-compose.yml   # eski db-bilan versiya
cp .env.example.bak .env.example
# .env da TIBEX_DATABASE_URL ni qayting:
#   postgresql+asyncpg://tibex:tibex@db:5432/tibex
docker compose up -d --build
```
Eski Docker volume (`tibex_pg`) QADAM 13 bajarilmaguncha saqlanadi — undan
oldin muammo chiqsa, hech narsa yo'qolmaydi.

Agar host DB buzilsa — QADAM 1dagi zaxiradan tiklang:
```bash
sudo -u postgres psql -c "DROP DATABASE tibex; CREATE DATABASE tibex OWNER tibex;"
gunzip -c /var/backups/tibex-pre-variant-b/tibex_*.sql.gz | \
  PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U tibex -d tibex
```

---

## GO-LIVE CHECKLIST
- [ ] `python -m pyflakes app scripts` → 0 `undefined name`; `bandit -r app -ll`, `pip-audit` toza
- [ ] `pytest` yashil; Alembic `upgrade head` → `downgrade base` → `upgrade head` xatosiz
- [ ] Repoda/arxivda `.env`, `secrets/*`, `snapshot.md`, `*.deb`, `demo.py`, `__pycache__` yo'q; `detect-secrets scan` → 0
- [ ] `TIBEX_ENV=production`: `/api/admin/demo-reset` → 404; `SERVE_FRONTEND=true` yoki `demo_reset_code` bilan ilova ishga tushmaydi
- [ ] `curl https://tibex.uz/api/health` → 200; DB to'xtatilsa → 503
- [ ] Kassir: `GET /api/payments?today=true` va `POST /api/payments/shift/close` → 200
- [ ] Login vaqt farqi < 30 ms; 8 parallel login paytida health < 200 ms
- [ ] `scripts/check_real_ip.sh` — haqiqiy klient IP ko'rinadi
- [ ] `"WBC = 12 and RBC = 4.5"`, `"onset = 3 kun"` → 200, ban yo'q
- [ ] XSS testi o'tadi; brauzer konsolida CSP xatosi yo'q; nginx enforcing CSP yuboradi
- [ ] Kalit rotatsiyasi testi; `reencrypt.py --dry-run` ishlaydi
- [ ] `GET /api/audit/verify` → ok; `UPDATE/DELETE audit_logs` → xato; `/audit/clear` → 410
- [ ] Bemor kartasini o'qish audit'da `view`
- [ ] `restore_drill.sh` muvaffaqiyatli
- [ ] Bekor qilingan sessiyadagi WebSocket ≤ 60 s ichida uziladi
- [ ] `tibex-cleanup.timer`, `tibex-restore-drill.timer`, `uptime_check.sh` yoqilgan; `TIBEX_METRICS_TOKEN` o'rnatilgan
- [ ] `docs/` to'liq, `CHANGES.md` yangilangan
