#!/usr/bin/env python3
"""TIBEX: `public/` papkani xavfsiz serve qiladi (python -m http.server O'RNIGA).

- Papka ro'yxati (Directory listing) YO'Q: har qanday papka so'rovi 404.
- Nuqta bilan boshlanadigan fayllar (.env, .git ...) va .py/.md/.json/.map/.bak -> 404.
- Faqat GET/HEAD. Xavfsizlik sarlavhalari (nginx CSP bilan bir xil) qo'shiladi.
- Faqat 127.0.0.1 ga bog'lanadi: internetga faqat Cloudflare Tunnel orqali chiqadi.

Ishlatish:  python tools/serve_public.py [port=5600]
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5600
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
BLOCK_EXT = (".py", ".md", ".json", ".map", ".bak", ".sql", ".env", ".log", ".zip", ".txt", ".bat")
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; "
       "img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; "
       "base-uri 'self'; form-action 'self'; object-src 'none'")

class H(SimpleHTTPRequestHandler):
    server_version = "TIBEX"
    sys_version = ""
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".svg": "image/svg+xml"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _deny(self):
        p = self.path.split("?", 1)[0].lower()
        return (any(seg.startswith(".") for seg in p.split("/") if seg)
                or p.endswith(BLOCK_EXT) or ".." in p)

    def list_directory(self, path):            # papka ro'yxati o'chirilgan
        self.send_error(404); return None

    def send_head(self):
        if self._deny():
            self.send_error(404); return None
        p = self.translate_path(self.path)
        if os.path.isdir(p) and not os.path.isfile(os.path.join(p, "index.html")):
            self.send_error(404); return None   # index.html yo'q papka -> ro'yxat emas, 404
        return super().send_head()

    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        import re
        if re.search(r"\.[0-9a-f]{8}\.(js|css)$", self.path.split("?", 1)[0]):
            self.send_header("Cache-Control", "public, max-age=604800, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_POST(self): self.send_error(405)
    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_POST

    def log_message(self, fmt, *a):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % a))

if __name__ == "__main__":
    if not os.path.isfile(os.path.join(ROOT, "index.html")):
        sys.exit("public/ topilmadi. Avval:  python tools/build_public.py")
    print(f"TIBEX public: http://127.0.0.1:{PORT}  (faqat lokal; internetga tunnel orqali)")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
