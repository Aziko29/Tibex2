/* A2 guard: static/js va static/css dagi har fayl nomi  <nom>.<8hex>.<ext>  bo'lsin, hash tarkibga mos kelsin
   (nginx bu nomlarni 7 kun immutable keshlaydi), va HTML dagi har havola mavjud faylga ko'rsatsin.
   Xato bo'lsa:  node frontend/tools/hash_assets.js   (so'ng qayta commit).
   Run: node --test frontend/tests/asset-hash.spec.js  (jsdom kerak emas) */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { hashOf, parseName, run, ASSET_DIRS } = require("../tools/hash_assets.js");

const ROOT = path.join(__dirname, "..");

function assets() {
  const out = [];
  for (const ext of Object.keys(ASSET_DIRS)) {
    const dir = path.join(ROOT, ASSET_DIRS[ext]);
    for (const f of fs.readdirSync(dir)) if (f.endsWith("." + ext)) out.push({ dir, f });
  }
  return out;
}

test("hashOf: CRLF va LF bir xil hash beradi, 8 ta hex", () => {
  assert.equal(hashOf("a\r\nb\r\n"), hashOf("a\nb\n"));
  assert.match(hashOf("x"), /^[0-9a-f]{8}$/);
  assert.notEqual(hashOf("x"), hashOf("y"));
});

test("har js/css fayl nomidagi hash tarkibga mos", () => {
  const list = assets();
  assert.ok(list.length > 0, "static/js yoki static/css bo'sh");
  const bad = [];
  for (const { dir, f } of list) {
    const p = parseName(f);
    if (!p || !p.hash) { bad.push(`${f}: nomida 8 belgili hash yo'q`); continue; }
    const h = hashOf(fs.readFileSync(path.join(dir, f)));
    if (h !== p.hash) bad.push(`${f}: nomdagi hash ${p.hash}, tarkib hash'i ${h}`);
  }
  assert.deepEqual(bad, [], "node frontend/tools/hash_assets.js ni ishga tushiring:\n" + bad.join("\n"));
});

test("HTML havolalari mavjud faylga ko'rsatadi (query'siz)", () => {
  const bad = [];
  for (const html of fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"))) {
    const src = fs.readFileSync(path.join(ROOT, html), "utf8");
    for (const m of src.matchAll(/static\/(js|css)\/([^"'\s>?#]+)(\?[^"'\s>#]*)?/g)) {
      if (!fs.existsSync(path.join(ROOT, "static", m[1], m[2]))) bad.push(`${html}: ${m[0]} — fayl yo'q`);
      if (m[3]) bad.push(`${html}: ${m[0]} — hash'li faylga ?v= kerak emas`);
    }
  }
  assert.deepEqual(bad, []);
});

test("hash_assets --check: toza daraxtda muammo yo'q, o'zgartirilgan faylni topadi", () => {
  assert.deepEqual(run(ROOT, { check: true, log() {} }).problems, []);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tibex-assets-"));
  try {
    for (const ext of Object.keys(ASSET_DIRS)) {
      fs.mkdirSync(path.join(tmp, ASSET_DIRS[ext]), { recursive: true });
      for (const f of fs.readdirSync(path.join(ROOT, ASSET_DIRS[ext])))
        fs.copyFileSync(path.join(ROOT, ASSET_DIRS[ext], f), path.join(tmp, ASSET_DIRS[ext], f));
    }
    for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".html")))
      fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));

    const victim = fs.readdirSync(path.join(tmp, "static/js")).find((f) => f.startsWith("cashier."));
    fs.appendFileSync(path.join(tmp, "static/js", victim), "\n// o'zgardi\n");
    const r = run(tmp, { check: true, log() {} });
    assert.ok(r.problems.some((p) => p.startsWith(victim)), "o'zgargan fayl aniqlanmadi");

    run(tmp, { log() {} }); // tuzatish rejimi
    assert.deepEqual(run(tmp, { check: true, log() {} }).problems, [], "tuzatishdan keyin ham muammo bor");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
