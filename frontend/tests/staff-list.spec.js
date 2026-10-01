/* Admin: Xodimlar ro'yxati/keshi bemor portal akkauntlarini (role=patient) o'z ichiga olmaydi.
   Run: node --test frontend/tests/staff-list.spec.js  (jsdom kerak emas) */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const jsDir = path.join(__dirname, "../static/js");
const file = fs.readdirSync(jsDir).find((f) => /^admin\.[0-9a-f]{8}\.js$/.test(f));
assert.ok(file, "static/js/admin.<hash>.js topilmadi");
const src = fs.readFileSync(path.join(jsDir, file), "utf8").replace(/\r\n/g, "\n");

const from = src.indexOf("  reloadCache() {");
const to = src.indexOf("  updateChrome() {");
assert.ok(from > 0 && to > from, "reloadCache anchor topilmadi");

function run(all) {
  const ctx = vm.createContext({});
  const obj = vm.runInContext("({" + src.slice(from, to) + "})", ctx);
  obj.store = { getAll: () => all };
  obj.updateChrome = () => {};
  obj.reloadCache();
  return obj.cache;
}

test("reloadCache: users ichidan role=patient chiqarib tashlanadi, xodimlar qoladi", () => {
  const c = run({ users: [
    { id: 1, role: "admin" }, { id: 2, role: "doctor" }, { id: 3, role: "patient", patient_id: 9 },
    { id: 4, role: "reception" }, null,
  ] });
  assert.deepEqual(c.users.map((u) => u.id), [1, 2, 4]);
});

test("reloadCache: users yo'q bo'lsa ham yiqilmaydi", () => {
  assert.deepEqual(run({}).users, []);
  assert.deepEqual(run(null).users, []);
});

test("Xodim formasida 'patient' roli tanlanmaydi", () => {
  assert.match(src, /cache\.roles\.filter\(r => r\.key !== 'patient' && \(r\.active \|\| r\.key === u\.role\)\)/);
});

test("Rollar kartasida bemor roli 'xodim' emas, 'bemor' deb sanaladi", () => {
  assert.match(src, /isPatientRole \? ' bemor' : ' xodim'/);
});
