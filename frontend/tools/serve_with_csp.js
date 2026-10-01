#!/usr/bin/env node
/* Dev server: frontend/ ni PROD nginx bilan bir xil CSP sarlavhasi bilan beradi (lokalda CSP xatolari yashirin qolmasin).
   CSP matni backend/deploy/nginx.conf dan o'qiladi (nusxa emas, shuning uchun drift bo'lmaydi).
   Ishlatish:  node frontend/tools/serve_with_csp.js [--port 5500] [--api http://127.0.0.1:8000]
   --api berilsa /api/* shu backendga proksi qilinadi (WebSocket yo'q). Tekshirish: brauzer konsolida
   "Refused to apply inline style" / "violates the following Content Security Policy" bo'lmasligi kerak. */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("--port", 5500));
const API = arg("--api", "");
const ROOT = path.resolve(__dirname, "..");
const NGINX = path.resolve(ROOT, "../backend/deploy/nginx.conf");

const m = /add_header\s+Content-Security-Policy\s+"([^"]+)"/.exec(fs.readFileSync(NGINX, "utf8"));
if (!m) { console.error("nginx.conf da Content-Security-Policy topilmadi"); process.exit(1); }
const CSP = m[1];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };

function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "text/plain", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache" });
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    if (!API) return send(res, 502, JSON.stringify({ detail: "backend ulanmagan (--api)" }), "application/json");
    const t = new URL(API);
    const p = http.request({ host: t.hostname, port: t.port, path: req.url, method: req.method, headers: { ...req.headers, host: t.host } },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on("error", () => send(res, 502, "backend javob bermadi"));
    return req.pipe(p);
  }
  if (/\.(deb|md|py|env|bak|sql|zip|log)$/.test(url.pathname) || /\/\./.test(url.pathname)) return send(res, 404, "not found");
  let f = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!f.startsWith(ROOT)) return send(res, 403, "forbidden");
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) f = path.join(ROOT, "login.html"); // nginx: try_files ... /login.html
  send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || "application/octet-stream");
}).listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}  (CSP: ${CSP.slice(0, 70)}...)`));
