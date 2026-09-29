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

// P1-2: user-controlled fields. Any `${...}` that reaches HTML with one of these must go through
// esc() (text position) or escAttr() (attribute position).
const USER_FIELDS = new RegExp([
  'fullname','doctor_name','service\\??\\.name','\\.detail\\b','\\.complaint',
  '\\.address',
  '\\.(name|user|login|phone|title|note|message|reason|status|blood|gender|code|test_key|test_name|role)\\b',
  '\\.(prelim_dx|final_dx|result_summary|result_note|last_service|next_service)\\b',
  // beyond the mandatory list: free-text fields the API stores as plain str (found in the P1-2 sweep)
  '\\.(priority|scheduled_time|date|provider|manufacturer|model|location|serial|category|supplier|lot|method|path|action|ordered_by|specialty|unit)\\b',
  'allergies','chronic',
].join('|'));

// Balanced removal of `fn( ... )` calls (handles nesting and string literals).
function stripCalls(expr, names) {
  const re = new RegExp("\\b(?:" + names.join("|") + ")\\(", "g");
  let out = "", last = 0, m;
  while ((m = re.exec(expr))) {
    let i = re.lastIndex, depth = 1, q = null;
    for (; i < expr.length && depth > 0; i++) {
      const c = expr[i];
      if (q) { if (c === "\\") i++; else if (c === q) q = null; }
      else if (c === "'" || c === '"') q = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    out += expr.slice(last, m.index);
    last = i; re.lastIndex = i;
  }
  return out + expr.slice(last);
}

// An interpolation is safe when, after removing (a) sanitizer calls, (b) comparisons against a
// string literal (they yield a boolean, never output) and (c) lookups of user fields in constant
// maps / constant-returning helpers, no user field remains.
const LIT = "(?:'[^']*'|\"[^\"]*\")";
const SAFE_HELPERS = ["esc", "escAttr", "escUrl", "escJson", "statusClass", "escapeHtml"];
function isUnsafeInterpolation(expr) {
  let e = stripCalls(expr, SAFE_HELPERS);
  e = e.replace(new RegExp("[\\w.?]+\\s*(?:===|!==)\\s*" + LIT, "g"), "COND");
  e = e.replace(/\bstatusMap\[[^\]]*\]/g, "CONSTMAP");
  e = e.replace(/(^|[(:?]\s*)[\w.]+\s*\?(?![.?])/g, "$1COND ?"); // truthiness test, never output
  return USER_FIELDS.test(e);
}

function sourceFiles() {
  const root = path.join(__dirname, "..");
  const dir = path.join(root, "static");
  return [
    ...fs.readdirSync(dir).filter(f => f.endsWith(".js")).map(f => path.join(dir, f)),
    ...fs.readdirSync(path.join(dir, "js")).filter(f => f.endsWith(".js")).map(f => path.join(dir, "js", f)),
    ...fs.readdirSync(root).filter(f => f.endsWith(".js")).map(f => path.join(root, f)), // bemor.js
  ];
}

test("source: no unescaped user fields in template literals", () => {
  const bad = [];
  for (const f of sourceFiles()) {
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/textContent|toast\(|console\./.test(line)) return;
      for (const m of line.matchAll(/\$\{([^{}`<>]*)\}/g)) {
        if (/\.map\(|=>/.test(m[1])) continue;
        if (isUnsafeInterpolation(m[1])) bad.push(`${path.basename(f)}:${i + 1}: ${m[0]}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test("isUnsafeInterpolation: detector self-check", () => {
  for (const e of ["p.gender", "a.priority", "x.date || ''", "u.role || '-'", "e.status", "n.name",
                   "'x' + p.blood", "c.status ? p.gender : 'z'", "p.lot ? p.lot : ''",
                   "isUrgent ? ' · ' + priorityLabel(a.priority) : ''"]) {
    assert.ok(isUnsafeInterpolation(e), `must flag: ${e}`);
  }
  for (const e of ["esc(p.gender)", "escAttr(a.status)", "a.status === 'x' ? 'A' : 'B'",
                   "statusClass(o.status)", "statusMap[l.status] || esc(l.status)",
                   "x ? (p.status === 'k' ? '1' : '2' + esc(p.status)) : '-'",
                   "r.lot ? ' · ' + esc(r.lot) : ''"]) {
    assert.ok(!isUnsafeInterpolation(e), `must allow: ${e}`);
  }
});
