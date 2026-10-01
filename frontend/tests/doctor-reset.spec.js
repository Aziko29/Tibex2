/* Admin -> Shifokorlar: 🔑 "Parolni tiklash" tugmasi va shifokor akkauntini topish mantiqi.
   Run: node --test frontend/tests/doctor-reset.spec.js  (jsdom kerak emas) */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const jsDir = path.join(__dirname, "../static/js");
const file = fs.readdirSync(jsDir).find((f) => /^admin\.[0-9a-f]{8}\.js$/.test(f));
assert.ok(file, "static/js/admin.<hash>.js topilmadi");
const src = fs.readFileSync(path.join(jsDir, file), "utf8");

test("v_doctors qatorida reset tugmasi bor, a_doctors uni ulaydi", () => {
  const v = src.slice(src.indexOf("v_doctors()"), src.indexOf("a_doctors(root)"));
  assert.match(v, /data-act=\\?"reset\\?"/, "Shifokorlar jadvalida 🔑 tugmasi yo'q");
  const a = src.slice(src.indexOf("a_doctors(root)"), src.indexOf("doctorAccounts(d)"));
  assert.match(a, /act === 'reset'\) this\.doctorResetPassword\(d\)/);
  assert.match(a, /this\.can\('users', 'edit'\)/, "tugma users.edit huquqiga bog'lanishi kerak (backend shuni talab qiladi)");
});

// doctorAccounts + doctorResetPassword ni ajratib olib, stublar bilan ishga tushiramiz
const from = src.indexOf("doctorAccounts(d) {");
const to = src.indexOf("  doctorForm(d) {");
assert.ok(from > 0 && to > from, "anchor bloklar topilmadi");

function make({ users = [], perms = { "users.edit": true } } = {}) {
  const calls = { toasts: [], reset: [], modal: [] };
  const ctx = vm.createContext({
    toast: (m, t) => calls.toasts.push([m, t]),
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";"),
    escAttr: (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";"),
    Modal: { open: (h) => calls.modal.push(h) },
    $$: () => [],
    byId: () => null,
    on: () => false,
  });
  const obj = vm.runInContext("({" + src.slice(from, to) + "})", ctx);
  obj.cache = { users };
  obj.can = (m, a) => !!perms[m + "." + a];
  obj.userResetPassword = (u) => calls.reset.push(u.id);
  return { obj, calls };
}

const doc = { id: 7, name: "  Aliyev   Vali " };

test("doctor_id bo'yicha bog'langan akkaunt ustun turadi", () => {
  const { obj } = make({ users: [
    { id: 1, role: "doctor", doctor_id: 7, fullname: "Boshqa nom" },
    { id: 2, role: "doctor", doctor_id: null, fullname: "aliyev vali" },
  ] });
  assert.deepEqual(obj.doctorAccounts(doc).map((u) => u.id), [1]);
});

test("bog'lanmagan bo'lsa — rol=doctor va F.I.Sh mosligi (bo'shliq/registr farqsiz)", () => {
  const { obj } = make({ users: [
    { id: 2, role: "doctor", doctor_id: null, fullname: "ALIYEV VALI" },
    { id: 3, role: "reception", doctor_id: null, fullname: "Aliyev Vali" },
    { id: 4, role: "doctor", doctor_id: 99, fullname: "Aliyev Vali" }, // boshqa shifokorga bog'langan
  ] });
  assert.deepEqual(obj.doctorAccounts(doc).map((u) => u.id), [2]);
});

test("bitta akkaunt -> to'g'ridan-to'g'ri userResetPassword", () => {
  const { obj, calls } = make({ users: [{ id: 2, role: "doctor", doctor_id: 7, fullname: "x" }] });
  obj.doctorResetPassword(doc);
  assert.deepEqual(calls.reset, [2]);
  assert.equal(calls.toasts.length, 0);
});

test("akkaunt yo'q -> xabar, hech narsa yiqilmaydi", () => {
  const { obj, calls } = make({ users: [] });
  assert.doesNotThrow(() => obj.doctorResetPassword(doc));
  assert.equal(calls.reset.length, 0);
  assert.equal(calls.toasts[0][1], "warn");
});

test("shifokor yozuvi topilmasa (eskirgan kesh) yoki users.edit yo'q bo'lsa — xabar", () => {
  const a = make({ users: [{ id: 2, role: "doctor", doctor_id: 7, fullname: "x" }] });
  a.obj.doctorResetPassword(undefined);
  assert.equal(a.calls.toasts.length, 1);
  const b = make({ users: [{ id: 2, role: "doctor", doctor_id: 7, fullname: "x" }], perms: {} });
  b.obj.doctorResetPassword(doc);
  assert.equal(b.calls.reset.length, 0);
  assert.equal(b.calls.toasts.length, 1);
});

test("bir nechta akkaunt -> tanlash oynasi, matn escape qilinadi", () => {
  const { obj, calls } = make({ users: [
    { id: 1, role: "doctor", doctor_id: 7, fullname: "<b>A</b>", login: "a1" },
    { id: 2, role: "doctor", doctor_id: 7, fullname: "B", login: "b\"2" },
  ] });
  obj.doctorResetPassword(doc);
  assert.equal(calls.reset.length, 0);
  assert.equal(calls.modal.length, 1);
  assert.ok(!calls.modal[0].includes("<b>A</b>"), "fullname escape qilinmagan");
  assert.match(calls.modal[0], /data-uid="1"/);
  assert.match(calls.modal[0], /data-uid="2"/);
});
