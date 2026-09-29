# TIBEX - Deploy qollanma

## 1. Server tayyorlash (Ubuntu 22.04)
    sudo apt update && sudo apt install -y python3.12 python3.12-venv postgresql redis-server nginx

## 2. Loyihani joylash
    sudo useradd -m tibex
    sudo mkdir -p /opt/tibex
    sudo chown tibex:tibex /opt/tibex
    git clone <repo> /opt/tibex

## 3. Python environment
    cd /opt/tibex/backend
    python3.12 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt

## 4. .env
    cp .env.example .env
    # Parollarni ozgartiring

## 5. DB migratsiya + seed
    alembic upgrade head
    python -m scripts.init_db
    python -m scripts.create_admin --login admin --password '<kuchli-parol>' --name Administrator

## 6. systemd + nginx
    sudo cp deploy/tibex.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now tibex
    sudo cp deploy/nginx.conf /etc/nginx/sites-available/tibex
    sudo ln -s /etc/nginx/sites-available/tibex /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx

## 7. HTTPS
    sudo apt install certbot python3-certbot-nginx
    sudo certbot --nginx -d tibex.uz -d www.tibex.uz
