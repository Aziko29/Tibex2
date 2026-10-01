# TIBEX backend - production image (ko'p bosqichli)
# 1) builder: kompilyator faqat shu yerda; hash'li lock fayldan o'rnatadi.
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.lock .
RUN pip install --require-hashes -r requirements.lock

# 2) final: kompilyatorsiz, faqat runtime.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gosu \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

COPY . .
RUN chmod +x docker-entrypoint.sh

RUN useradd -m -u 1000 tibex && chown -R tibex:tibex /app
# Entrypoint runs briefly as root to copy mounted secrets into tmpfs, apply
# service-user ownership, run migrations, then drops privileges with gosu.

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["sh", "-c", "exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY:-1} -b 0.0.0.0:8000 --forwarded-allow-ips=127.0.0.1,172.16.0.0/12,192.168.0.0/16 --timeout 60 --graceful-timeout 30"]
