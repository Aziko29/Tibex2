/* 22-band: saqlangan XSS regressiyasi. Ishga tushirish: node --test frontend/tests/xss.spec.js  (jsdom kerak: npm i -D jsdom) */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  "jav&#x09;ascript:alert(1)",
  "<a href=javascript:alert(1)>x</a>",
];

function load() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  dom.window.eval(fs.readFileSync(path.join(__dirname, "../static/tibex-safe.js"), "utf8"));
  return dom.window;
}

for (const payload of PAYLOADS) {
  test(`esc() neutralizes: ${payload}`, () => {
    const w = load();
    const host = w.document.body;
    host.innerHTML = `<td>${w.esc(payload)}</td><input value="${w.esc(payload)}">`;
    assert.equal(host.querySelectorAll("img,svg,a").length, 0);
    assert.equal(host.querySelector("input").getAttribute("onload"), null);
    assert.equal(host.querySelector("td").textContent, payload);
  });
}

test("source: no unescaped user fields in template literals", () => {
  const dir = path.join(__dirname, "../static");
  const files = [...fs.readdirSync(dir).filter(f => f.endsWith(".js")).map(f => path.join(dir, f)),
                 ...fs.readdirSync(path.join(dir, "js")).map(f => path.join(dir, "js", f))];
  const bad = [];
  for (const f of files) {
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/textContent|toast\(|console\./.test(line)) return;
      for (const m of line.matchAll(/\$\{([^{}`<>]*)\}/g)) {
        if (/fullname|doctor_name|service\??\.name|\.detail\b|\.complaint|\.address|\.(name|user|login|phone|title|note|message|reason|last_service|next_service|prelim_dx|final_dx|result_summary|result_note)\b/.test(m[1]) && !/^\s*(esc|escAttr)\(/.test(m[1]) && !/\.map\(|=>/.test(m[1])) {
          bad.push(`${path.basename(f)}:${i + 1}: ${m[0]}`);
        }
      }
    });
  }
  assert.deepEqual(bad, []);
});
