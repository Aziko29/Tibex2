#!/usr/bin/env node
/* Content-hash asset nomlash (nginx: /static/*.<8hex>.(js|css) -> 7 kun immutable kesh).

   Har static/js/*.js va static/css/*.css uchun nomni  <nom>.<hash>.<kengaytma>  ko'rinishiga keltiradi,
   hash = sha256(tarkib, CRLF -> LF)[0:8]. Keyin frontend/*.html dagi havolalarni yangilaydi
   (eski ?v=... query ham olib tashlanadi: hash o'zi versiya).

   Ishlatish (frontend/ ichidan yoki ildizdan):
     node frontend/tools/hash_assets.js            # nomlarni va HTML havolalarni yangilaydi
     node frontend/tools/hash_assets.js --check    # o'zgartirmaydi; nomuvofiqlik bo'lsa 1 bilan chiqadi
   Deploy oldidan (rsync dan oldin) ishga tushiring. Qayta ishga tushirish xavfsiz (idempotent).

   CRLF -> LF normallash: Windows'da git autocrlf yoqilgan bo'lsa ham hash bir xil chiqadi. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ASSET_DIRS = { js: "static/js", css: "static/css" };
const NAME_RE = /^(.+?)(?:\.([0-9a-f]{8}))?\.(js|css)$/;
// <script src="static/js/x.js?v=1">, <link href="static/css/x.css"> ...
const REF_RE = /(static\/(js|css)\/)([^"'\s>?#]+)(\?[^"'\s>#]*)?/g;

function hashOf(buf) {
  const text = Buffer.from(buf).toString("utf8").replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

function parseName(file) {
  const m = NAME_RE.exec(file);
  return m ? { base: m[1], hash: m[2] || null, ext: m[3] } : null;
}

function run(frontendDir, { check = false, log = console.log } = {}) {
  const problems = [];
  const renames = []; // {from, to}
  const map = new Map(); // "js/base.js" -> yangi fayl nomi (papkasiz)
  const seen = new Map(); // "js/base.js" -> dastlabki nom (dublikat aniqlash)

  for (const ext of Object.keys(ASSET_DIRS)) {
    const dir = path.join(frontendDir, ASSET_DIRS[ext]);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith("." + ext)) continue;
      const p = parseName(file);
      if (!p) { problems.push(`${ext}/${file}: nom formati noto'g'ri`); continue; }
      const key = `${ext}/${p.base}.${ext}`;
      if (seen.has(key)) {
        problems.push(`${key}: bir nechta versiya bor (${seen.get(key)} va ${file}); bittasini o'chiring`);
        continue;
      }
      seen.set(key, file);
      const h = hashOf(fs.readFileSync(path.join(dir, file)));
      const want = `${p.base}.${h}.${ext}`;
      map.set(key, want);
      if (want !== file) renames.push({ dir, from: file, to: want });
    }
  }

  for (const r of renames) {
    const dst = path.join(r.dir, r.to);
    if (fs.existsSync(dst)) { problems.push(`${r.to}: nishon fayl allaqachon bor`); continue; }
    if (check) { problems.push(`${r.from}: nom tarkibga mos emas (kerak: ${r.to})`); continue; }
    fs.renameSync(path.join(r.dir, r.from), dst);
    log(`rename  ${r.from} -> ${r.to}`);
  }

  const referenced = new Set();
  for (const html of fs.readdirSync(frontendDir).filter((f) => f.endsWith(".html")).sort()) {
    const hp = path.join(frontendDir, html);
    const src = fs.readFileSync(hp, "utf8"); // CRLF/LF aynan saqlanadi
    const out = src.replace(REF_RE, (whole, prefix, ext, file, query) => {
      const p = parseName(file);
      const key = p && `${ext}/${p.base}.${ext}`;
      if (!key || !map.has(key)) {
        problems.push(`${html}: ${prefix}${file} — fayl topilmadi`);
        return whole;
      }
      referenced.add(key);
      return prefix + map.get(key); // ?v=... olib tashlanadi
    });
    if (out !== src) {
      if (check) problems.push(`${html}: havolalar eskirgan`);
      else { fs.writeFileSync(hp, out, "utf8"); log(`update  ${html}`); }
    }
  }
  for (const key of map.keys()) {
    if (!referenced.has(key)) log(`ogohlantirish: ${key} hech bir HTML da ulanmagan (yetim)`);
  }
  return { problems, renames, map };
}

module.exports = { hashOf, parseName, run, ASSET_DIRS };

if (require.main === module) {
  const check = process.argv.includes("--check");
  const { problems, renames } = run(path.resolve(__dirname, ".."), { check });
  if (problems.length) {
    console.error(problems.map((x) => "XATO: " + x).join("\n"));
    process.exit(1);
  }
  console.log(check ? "OK: barcha asset nomlari tarkibga mos." : `Tayyor: ${renames.length} ta fayl qayta nomlandi.`);
}
