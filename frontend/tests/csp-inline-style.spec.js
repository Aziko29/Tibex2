/* B bosqich guard: nginx CSP `style-src 'self'` (nonce ham, 'unsafe-inline' ham yo'q) JS da yaratilgan <style> ni
   bloklaydi (style="" atributlari va element.style.* ga `style-src-attr` ruxsat beradi, ularga tegilmaydi).
   1) frontend/static/** (vendor tashqari), frontend/*.js va *.html da createElement("style") va <style> bo'lmasin;
   2) sahifa qaysi tibex-*.js ni yuklasa, uning ko'chirilgan CSS fayli ham ulangan bo'lsin;
   3) static/** (vendor tashqari) dagi HAR BIR fayl kamida bitta HTML sahifada ulangan bo'lsin (yetim fayl qolmasin; E bosqich).
   Run: node --test frontend/tests/csp-inline-style.spec.js  (jsdom kerak emas) */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const STYLE_RE = /createElement\(\s*["'`]style["'`]\s*\)|<style[\s>]/i;

// JS fayl -> ko'chirilgan CSS (hash'siz nom)
const JS_TO_CSS = {
  "tibex-password": "tibex-password",
  "tibex-notifications": "tibex-notifications",
  "tibex-settings": "tibex-settings",
  "tibex-session": "tibex-session",
  "tibex-realtime-pro": "tibex-realtime-pro",
  "tibex-smart-camera": "tibex-smart-camera",
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "vendor" && e.name !== "node_modules") walk(p, out); }
    else out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const pages = () => fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));

test("JS/HTML da <style> yaratilmaydi", () => {
  const files = [...walk(path.join(ROOT, "static")), ...fs.readdirSync(ROOT).map((f) => path.join(ROOT, f))]
    .filter((p) => /\.(js|html)$/.test(p) && fs.statSync(p).isFile());
  assert.ok(files.length > 20, "fayllar topilmadi");
  const bad = files.filter((p) => STYLE_RE.test(fs.readFileSync(p, "utf8"))).map(rel);
  assert.deepEqual(bad, [], "CSP style-src 'self' bunday <style> ni bloklaydi; CSS ni static/css/ ga chiqaring va HTML da <link> qiling");
});

test("static/** dagi har bir fayl kamida bitta HTML da ulangan (yetim fayl yo'q)", () => {
  const html = pages().map((h) => fs.readFileSync(path.join(ROOT, h), "utf8")).join("\n");
  const orphans = walk(path.join(ROOT, "static")).map(rel).filter((r) => !html.includes(r));
  assert.deepEqual(orphans, [], "hech bir HTML ulamaydi: o'chiring yoki sahifaga ulang (ulasangiz, ichida <style> bo'lmasin)");
});

test("sahifa tibex-*.js ni yuklasa, uning CSS fayli ham ulangan", () => {
  const bad = [];
  for (const h of pages()) {
    const src = fs.readFileSync(path.join(ROOT, h), "utf8");
    for (const [js, css] of Object.entries(JS_TO_CSS)) {
      if (!new RegExp(`static/${js}\\.js["?]`).test(src)) continue;
      if (!new RegExp(`<link[^>]+href="static/css/${css}\\.[0-9a-f]{8}\\.css"`).test(src))
        bad.push(`${h}: ${js}.js bor, lekin static/css/${css}.<hash>.css ulanmagan`);
    }
  }
  assert.deepEqual(bad, []);
});

test("ko'chirilgan CSS fayllari mavjud va bo'sh emas", () => {
  for (const css of Object.values(JS_TO_CSS)) {
    const f = fs.readdirSync(path.join(ROOT, "static/css")).find((n) => new RegExp(`^${css}\\.[0-9a-f]{8}\\.css$`).test(n));
    assert.ok(f, `${css}.<hash>.css yo'q`);
    assert.ok(fs.statSync(path.join(ROOT, "static/css", f)).size > 100, `${f} bo'sh`);
  }
});
