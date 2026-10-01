"""TIBEX Desktop — brauzersiz dastur oynasi (pywebview).

Ishga tushirish:  python main.py [--kiosk] [--debug]
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path

import httpx
import uvicorn
import webview

from gateway import create_app

APP_TITLE = "TIBEX — Klinika tizimi"
LOCK_PORT = 47651  # bitta kompyuterda dasturni ikki marta ochib bo'lmasin
DEFAULTS = {"server_url": "http://127.0.0.1:8000", "fullscreen": False}


def config_path() -> Path:
    base = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
    return Path(base) / "TIBEX" / "config.json"


def load_config() -> dict:
    cfg = dict(DEFAULTS)
    try:
        cfg.update(json.loads(config_path().read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    if os.environ.get("TIBEX_SERVER_URL"):
        cfg["server_url"] = os.environ["TIBEX_SERVER_URL"]
    return cfg


def save_server_url(url: str) -> None:
    cfg = load_config()
    cfg["server_url"] = url
    p = config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def frontend_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "frontend"  # type: ignore[attr-defined]
    return Path(os.environ.get("TIBEX_FRONTEND_DIR") or Path(__file__).resolve().parent.parent / "frontend")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def server_reachable(url: str) -> bool:
    try:
        return httpx.get(url.rstrip("/") + "/api/health", timeout=3).status_code < 500
    except httpx.HTTPError:
        return False


class Api:
    """JavaScript'dan chaqiriladi (window.pywebview.api).

    Diqqat: bu klassga oyna obyektini atribut qilib saqlamang. pywebview atributlarni
    aylanib chiqadi va oynaning ichki obyektlarida cheksiz takrorlanishga tushadi.
    """

    def toggle_fullscreen(self) -> None:
        if webview.windows:
            webview.windows[0].toggle_fullscreen()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kiosk", action="store_true", help="to'liq ekran rejimi")
    ap.add_argument("--debug", action="store_true", help="dasturchi asboblari (F12)")
    args = ap.parse_args()

    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", LOCK_PORT))
    except OSError:
        print("TIBEX allaqachon ochiq.")
        return 0

    fdir = frontend_dir()
    if not (fdir / "login.html").is_file():
        print(f"Frontend topilmadi: {fdir}")
        return 1

    cfg = load_config()
    app = create_app(cfg["server_url"], fdir, save_server_url)
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, ws="auto"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)

    start = "/login.html" if server_reachable(cfg["server_url"]) else "/__desktop/offline"
    api = Api()
    window = webview.create_window(
        APP_TITLE, f"http://127.0.0.1:{port}{start}", js_api=api, width=1440, height=900,
        min_size=(1100, 700), fullscreen=args.kiosk or bool(cfg["fullscreen"]), confirm_close=True,
    )
    try:
        webview.start(debug=args.debug, private_mode=True)  # yopilganda sessiya ham yopiladi
    finally:
        server.should_exit = True
        lock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
