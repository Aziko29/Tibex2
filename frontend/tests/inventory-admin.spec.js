/* Admin "Resurslar" (uskuna / reagent / integratsiya) va klient store xatti-harakati.
   Run: node --test frontend/tests/inventory-admin.spec.js  (jsdom kerak emas) */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
const adminFile = /static\/js\/(admin\.[0-9a-f]{8}\.js)/.exec(html)[1];
const admin = fs.readFileSync(path.join(ROOT, "static/js", adminFile), "utf8").replace(/\r\n/g, "\n");
const client = fs.readFileSync(path.join(ROOT, "static/tibex-client.js"), "utf8");

function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `anchor topilmadi: ${from}`);
  return src.slice(a, b);
}

test("admin.html joriy admin faylga ishora qiladi va public nusxa klient bilan bir xil", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "static/js", adminFile)));
  assert.equal(fs.readFileSync(path.join(ROOT, "public/static/tibex-client.js"), "utf8"), client);
});

test("Reagentlar: 'muddati yaqin' 30 kun, qidiruv lot bo'yicha ham ishlaydi", () => {
  const v = slice(admin, "  v_reagents() {", "  a_reagents(root)");
  assert.match(v, /today \+ 30\*86400000/);
  assert.doesNotMatch(v, /90\*86400000/);
  assert.match(v, /\(r\.lot\|\|''\)\.toLowerCase\(\)\.includes\(s\)/);
});

test("Reagent/uskuna/integratsiya saqlash va o'chirish natijani kutadi", () => {
  assert.match(admin, /await this\.store\.addReagent\(data\)\.ready/);
  for (const m of ["deleteEquipment", "deleteReagent", "deleteIntegration"]) {
    assert.match(client, new RegExp(`${m}\\(id\\) \\{\\s*return _deleteWithRollback`));
  }
  assert.match(client, /syncIntegration\(id\) \{\s*return _api/);
  assert.match(client, /updateReagent\(id, patch\) \{[\s\S]*?const p = _api/);
});

test("Uskuna formasida oxirgi xizmat/sotib olingan sana/kafolat va 'O'chirilgan' chipi bor", () => {
  const f = slice(admin, "  equipmentForm(e) {", "  async equipmentDelete(e)");
  for (const id of ["eqPurchase", "eqWarranty", "eqLast"]) assert.ok(f.includes(`id="${id}"`), id);
  for (const k of ["purchase_date", "warranty", "last_service"]) assert.ok(f.includes(`${k}:`), k);
  assert.match(slice(admin, "  v_equipment() {", "  a_equipment(root)"), /data-ef="offline"/);
});

test("Integratsiya: yangi yozuv 'Kutilmoqda' bilan boshlanadi, noma'lum tur/holat jimgina almashmaydi", () => {
  const f = slice(admin, "  integrationForm(it) {", "  async integrationDelete(it)");
  assert.match(f, /const curStatus = x\.status \|\| 'pending'/);
  assert.match(f, /const curType = x\.type \|\| 'website'/);
  assert.match(f, /statusOpts\.push\(\[curStatus, curStatus\]\)/);
  assert.match(f, /Bu turdagi integratsiyani tahrirlab bo\\'lmaydi/);
});

test("Integratsiya kartasi: sinxronlash/tahrirlash faqat integrations.edit bilan, noma'lum turda faqat o'chirish", () => {
  const v = slice(admin, "  v_integrations() {", "  a_integrations(root)");
  assert.match(v, /const canEdit = known && this\.can\('integrations', 'edit'\)/);
  assert.match(v, /canEdit \? '<button data-act="sync">/);
  assert.match(v, /canDel \? '<button data-act="delete"/);
});

test("API kalitni o'chirish belgisi bo'sh qiymatni yuboradi, belgisiz bo'sh qoldirilsa o'zgarmaydi", () => {
  const f = slice(admin, "  integrationForm(it) {", "  async integrationDelete(it)");
  assert.match(f, /id="iApiClear"/);
  assert.match(f, /if \(clr && clr\.checked\) data\.api_key = ''; else delete data\.api_key;/);
});

test("Sozlamalar: equipService va reagentAlert admin panelda ishlatiladi", () => {
  assert.match(admin, /_settingOn\(key\)/);
  assert.match(admin, /const svcOn = this\._settingOn\('equipService'\)/);
  assert.match(admin, /alertOn \? c\.reagents\.filter/);
  assert.match(admin, /this\._settingOn\('reagentAlert'\)\) \{\s*const seen/);
  assert.match(admin, /this\._settingOn\('equipService'\)\) \{\s*const seen/);
});

// ───── store: mantiqni jonli ishga tushirish ─────
function loadHelpers() {
  const src = slice(client, "  function _deleteWithRollback(", "  // ─── Xato toast ───");
  const calls = [];
  const cache = { equipment: [{ id: 1, name: "A" }, { id: 2, name: "B" }] };
  const ctx = vm.createContext({
    _cache: cache, calls,
    _notify: () => {}, _err: () => {},
    _removeLocal: (en, id) => { const l = cache[en]; const i = l.findIndex((x) => x.id === id); if (i >= 0) l.splice(i, 1); },
    _addLocal: (en, it) => cache[en].push(it),
    _api: null,
  });
  vm.runInContext(src + "\nthis.fn = _deleteWithRollback;", ctx);
  return { ctx, cache };
}

test("_deleteWithRollback: muvaffaqiyatda true, xatoda qator qaytadi va xato uzatiladi", async () => {
  const { ctx, cache } = loadHelpers();
  ctx._api = async () => ({});
  assert.equal(await ctx.fn("equipment", "/api/equipment", 1), true);
  assert.deepEqual(cache.equipment.map((x) => x.id), [2]);

  ctx._api = async () => { throw new Error("403"); };
  await assert.rejects(() => ctx.fn("equipment", "/api/equipment", 2), /403/);
  assert.deepEqual(cache.equipment.map((x) => x.id), [2]);
});

test("syncIntegration: sync_ok=false bo'lsa xato beradi va sync maydonlari keshga yozilmaydi", async () => {
  const src = slice(client, "    syncIntegration(id) {", "    // ─── Audit ───");
  const patched = [];
  const ctx = vm.createContext({
    _notify: () => {}, _err: () => {},
    _patchLocal: (e, id, row) => patched.push(row),
    _api: async () => ({ id: 5, status: "error", sync_ok: false, sync_error: "Ulanib bo'lmadi" }),
  });
  const api = vm.runInContext("({" + src.replace(/\},\s*$/, "}") + "})", ctx);
  await assert.rejects(() => api.syncIntegration(5), /Ulanib bo'lmadi/);
  assert.deepEqual(patched[0], { id: 5, status: "error" });

  ctx._api = async () => ({ id: 5, status: "connected", sync_ok: true, sync_error: null });
  const ok = await api.syncIntegration(5);
  assert.equal(ok.status, "connected");
});
