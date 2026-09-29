"""Kuzatuv (29-band): request_id, JSON log, ixtiyoriy Sentry, /metrics."""
import contextvars
import hmac
import json
import logging
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from .config import get_settings

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
_STARTED = time.time()


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info)
        return json.dumps(data, ensure_ascii=False)


def setup_logging() -> None:
    s = get_settings()
    handler = logging.StreamHandler()
    if s.log_json:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)


def setup_sentry() -> None:
    dsn = get_settings().sentry_dsn
    if not dsn:
        return
    try:
        import sentry_sdk  # ixtiyoriy qaramlik

        sentry_sdk.init(dsn=dsn, send_default_pii=False, traces_sample_rate=0.0)
    except ImportError:
        logging.getLogger("tibex").warning("TIBEX_SENTRY_DSN berilgan, lekin sentry-sdk o'rnatilmagan")


async def request_id_middleware(request: Request, call_next):
    rid = uuid.uuid4().hex[:16]  # klient sarlavhasiga ishonilmaydi (log injection)
    token = request_id_var.set(rid)
    request.state.request_id = rid
    try:
        resp = await call_next(request)
    finally:
        request_id_var.reset(token)
    resp.headers["X-Request-ID"] = rid
    return resp


router = APIRouter()


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request):
    """Prometheus matni. TIBEX_METRICS_TOKEN bo'sh bo'lsa — 404; aks holda Bearer talab qilinadi."""
    token = get_settings().metrics_token
    auth = request.headers.get("authorization", "")
    if not token:
        raise HTTPException(404)
    if not hmac.compare_digest(auth.encode(), f"Bearer {token}".encode()):
        raise HTTPException(404)
    from .routers.monitoring import _REQUEST_STATS

    lines = [
        "# TYPE tibex_requests_total counter",
        f"tibex_requests_total {_REQUEST_STATS['total']}",
        "# TYPE tibex_errors_total counter",
        f"tibex_errors_total {_REQUEST_STATS['errors']}",
        "# TYPE tibex_uptime_seconds gauge",
        f"tibex_uptime_seconds {int(time.time() - _STARTED)}",
    ]
    return PlainTextResponse("\n".join(lines) + "\n")
