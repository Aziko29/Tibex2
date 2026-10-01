"""TIBEX Desktop — mahalliy shlyuz (gateway).

Vazifasi: frontend fayllarini ham, /api va WebSocket so'rovlarini ham bitta
mahalliy manzildan (http://127.0.0.1:PORT) beradi. Shunda brauzer nuqtai
nazaridan hammasi bir origin bo'ladi: cookie, CSRF va CORS muammosi chiqmaydi,
backend'ni o'zgartirish shart emas.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Callable, Optional

import httpx
import websockets
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket

# Proksi orqali o'tmaydigan sarlavhalar (hop-by-hop + o'zimiz hisoblaydiganlar)
_SKIP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
         "trailers", "transfer-encoding", "upgrade", "host", "content-length", "content-encoding"}
_DOMAIN = re.compile(r";\s*Domain=[^;]*", re.I)

# Har bir HTML sahifaga <head> ichiga qo'shiladi (sahifa skriptlaridan OLDIN ishlaydi)
INJECT_JS = (
    'window.__API_BASE__="";'  # API manzili nisbiy: shlyuzning o'zi
    'window.open=function(u){if(u){location.href=u}return null};'  # yangi oyna/tab ochilmaydi
    'document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[target=_blank]");'
    'if(a&&a.href){e.preventDefault();location.href=a.href}},true);'
    'document.addEventListener("keydown",function(e){if(e.key==="F11"){e.preventDefault();'
    'if(window.pywebview&&pywebview.api){pywebview.api.toggle_fullscreen()}}});'
    '(function(){var b;function s(t){if(!b){b=document.createElement("div");'
    'b.style.cssText="position:fixed;left:0;right:0;top:0;padding:8px 16px;background:#b45309;color:#fff;'
    'font:600 14px Arial;text-align:center;z-index:2147483647";document.documentElement.appendChild(b)}'
    'b.textContent=t;b.style.display="block"}'
    'addEventListener("offline",function(){s("Internet aloqasi uzildi. Ulanish tiklanishini kuting...")});'
    'addEventListener("online",function(){if(b){b.style.display="none"}})})();'
)

OFFLINE_HTML = """<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>TIBEX</title>
<style>body{margin:0;background:#0d2b33;color:#f5f7f6;font:18px Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.c{background:#143a44;border:1px solid #1f5561;border-radius:16px;padding:40px;width:520px}
h1{margin:0 0 8px;font-size:28px}p{color:#cfe3e1;line-height:1.5}
input{width:100%;box-sizing:border-box;padding:12px;font-size:17px;border-radius:8px;border:1px solid #1f5561;background:#0d2b33;color:#f5f7f6}
button{margin-top:14px;padding:12px 22px;font-size:17px;font-weight:700;border:0;border-radius:8px;background:#0f8a84;color:#fff;cursor:pointer}
button.s{background:#1f5561;margin-left:8px}#m{margin-top:14px;color:#f2c9a0;min-height:24px}</style></head><body><div class="c">
<h1>Server bilan aloqa yo'q</h1><p>TIBEX serveriga ulanib bo'lmadi. Tarmoqni tekshiring yoki server manzilini kiriting.</p>
<input id="u" placeholder="http://192.168.1.10:8000"><br>
<button onclick="go()">Saqlash va ulanish</button><button class="s" onclick="retry()">Qayta urinish</button><div id="m"></div></div>
<script>
async function retry(){document.getElementById('m').textContent='Tekshirilmoqda...';
try{var r=await fetch('/__desktop/health');var j=await r.json();if(j.ok){location.href='/login.html';return}}catch(e){}
document.getElementById('m').textContent='Server hali javob bermayapti.'}
async function go(){var v=document.getElementById('u').value.trim();if(v){var r=await fetch('/__desktop/config',{method:'POST',
headers:{'Content-Type':'application/json'},body:JSON.stringify({server_url:v})});if(!r.ok){document.getElementById('m').textContent="Manzil noto'g'ri";return}}retry()}
</script></body></html>"""


def _inject(html: str) -> str:
    tag = f"<script>{INJECT_JS}</script>"
    m = re.search(r"<head[^>]*>", html, re.I)
    return html[: m.end()] + tag + html[m.end():] if m else tag + html


def _local_origin(request: Request) -> str:
    return f"http://{request.headers.get('host', '')}"


async def offline_page(request: Request) -> Response:
    return HTMLResponse(OFFLINE_HTML, headers={"Cache-Control": "no-store"})


async def health(request: Request) -> Response:
    st = request.app.state
    try:
        r = await st.client.get(st.upstream + "/api/health", timeout=3)
        return JSONResponse({"ok": r.status_code < 500})
    except httpx.HTTPError:
        return JSONResponse({"ok": False})


async def set_config(request: Request) -> Response:
    # Faqat o'zimizning oynadan kelgan so'rov (boshqa sayt orqali soxta so'rovdan himoya)
    if request.headers.get("origin") != _local_origin(request):
        return JSONResponse({"detail": "Ruxsat yo'q"}, status_code=403)
    try:
        url = str((await request.json()).get("server_url", "")).strip().rstrip("/")
    except Exception:
        url = ""
    if not re.fullmatch(r"https?://[^\s/]+(:\d+)?", url):
        return JSONResponse({"detail": "Manzil noto'g'ri"}, status_code=400)
    request.app.state.upstream = url
    if request.app.state.save:
        request.app.state.save(url)
    return JSONResponse({"ok": True})


async def proxy(request: Request) -> Response:
    st = request.app.state
    local = _local_origin(request)
    headers = {k: v for k, v in request.headers.items() if k.lower() not in _SKIP}
    for h in ("origin", "referer"):  # backend o'z origin'ini ko'rsin
        if h in headers:
            headers[h] = headers[h].replace(local, st.upstream)
    url = st.upstream + request.url.path + (f"?{request.url.query}" if request.url.query else "")
    try:
        r = await st.client.request(request.method, url, headers=headers, content=await request.body())
    except httpx.TimeoutException:
        return JSONResponse({"detail": "Server javob bermadi (vaqt tugadi)"}, status_code=504)
    except httpx.HTTPError:
        return JSONResponse({"detail": "Server bilan aloqa yo'q"}, status_code=503)
    resp = Response(r.content, status_code=r.status_code)
    for k, v in r.headers.multi_items():
        kl = k.lower()
        if kl in _SKIP or kl == "set-cookie":
            continue
        resp.headers.append(k, v.replace(st.upstream, "") if kl == "location" else v)
    for c in r.headers.get_list("set-cookie"):
        resp.headers.append("set-cookie", _DOMAIN.sub("", c))  # Domain=... mahalliy manzilga to'g'ri kelmaydi
    return resp


async def ws_proxy(ws: WebSocket) -> None:
    st = ws.app.state
    target = st.upstream.replace("http", "ws", 1) + ws.url.path + (f"?{ws.url.query}" if ws.url.query else "")
    hdrs = {"Origin": st.upstream}
    if ws.headers.get("cookie"):
        hdrs["Cookie"] = ws.headers["cookie"]
    await ws.accept()
    try:
        async with websockets.connect(target, additional_headers=hdrs, open_timeout=10) as up:
            async def to_up() -> None:
                while True:
                    m = await ws.receive()
                    if m["type"] == "websocket.disconnect":
                        return
                    if m.get("text") is not None:
                        await up.send(m["text"])
                    elif m.get("bytes") is not None:
                        await up.send(m["bytes"])

            async def to_client() -> None:
                async for m in up:
                    await (ws.send_bytes(m) if isinstance(m, bytes) else ws.send_text(m))

            tasks = [asyncio.create_task(to_up()), asyncio.create_task(to_client())]
            _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
    except Exception:
        pass  # server uzildi: frontend o'zi qayta ulanadi
    finally:
        try:
            await ws.close()
        except Exception:
            pass


async def page(request: Request) -> Response:
    root: Path = request.app.state.frontend
    rel = request.url.path.lstrip("/")
    if rel == "" or rel.endswith("/"):
        rel += "login.html"
    target = (root / rel).resolve()
    if root not in target.parents or not target.is_file():  # papkadan chiqib ketishga yo'l yo'q
        return PlainTextResponse("Topilmadi", status_code=404)
    if target.suffix.lower() == ".html":
        return HTMLResponse(_inject(target.read_text(encoding="utf-8")), headers={"Cache-Control": "no-store"})
    return FileResponse(target)


def create_app(upstream: str, frontend_dir: Path, save_server_url: Optional[Callable[[str], None]] = None,
               client: Optional[httpx.AsyncClient] = None) -> Starlette:
    app = Starlette(routes=[
        Route("/__desktop/offline", offline_page),
        Route("/__desktop/health", health),
        Route("/__desktop/config", set_config, methods=["POST"]),
        Route("/api/{path:path}", proxy, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]),
        WebSocketRoute("/api/{path:path}", ws_proxy),
        Route("/{path:path}", page),
    ])
    app.state.upstream = upstream.rstrip("/")
    app.state.frontend = Path(frontend_dir).resolve()
    app.state.save = save_server_url
    app.state.client = client or httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5), follow_redirects=False)
    return app
