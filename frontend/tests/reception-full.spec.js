'use strict';
/* TIBEX_QABULXONA_FULL_v1: holat tugmalari backend state_machine.py ga mos; ruxsat; chegirma limiti (manba matndan) */
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const jsDir = path.join(__dirname, '..', 'static', 'js');
const file = fs.readdirSync(jsDir).find((f) => /^reception-full\.[0-9a-f]{8}\.js$/.test(f));
const src = fs.readFileSync(path.join(jsDir, file), 'utf8');
const py = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'app', 'state_machine.py'), 'utf8').replace(/\r/g, '');

function parseSM() {
  const blk = /APPOINTMENT_TRANSITIONS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(py)[1], out = {};
  blk.split('\n').forEach((l) => { const m = /"(\w+)":\s*\{([^}]*)\}|"(\w+)":\s*set\(\)/.exec(l); if (m && m[1]) out[m[1]] = [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1]); else if (m) out[m[3]] = []; });
  return out;
}
function loadFront() {
  const sm = /const SM = (\{[\s\S]*?\});/.exec(src)[1];
  const recep = /const RECEP = (\[.*?\]);/.exec(src)[1];
  return new Function(`const SM=${sm};const RECEP=${recep};return {SM,RECEP,allowed:(a,to)=>to!==a.status&&(SM[a.status]||[]).includes(to)&&RECEP.includes(to)}`)();
}
test('frontend SM jadvali backend APPOINTMENT_TRANSITIONS bilan bir xil', () => {
  const b = parseSM(), f = loadFront().SM;
  Object.keys(b).forEach((k) => assert.deepStrictEqual([...f[k]].sort(), [...b[k]].sort(), k));
});
test('qabulxona roli faqat arrived/delayed/cancelled/no_show; yakuniy holatda tugma yo\'q', () => {
  const F = loadFront();
  assert.deepStrictEqual(F.RECEP.sort(), ['arrived', 'cancelled', 'delayed', 'no_show']);
  ['completed', 'cancelled', 'no_show'].forEach((st) => F.RECEP.forEach((t) => assert.ok(!F.allowed({ status: st }, t))));
  assert.ok(F.allowed({ status: 'waiting' }, 'arrived'));
  assert.ok(!F.allowed({ status: 'waiting' }, 'in_progress'));
  assert.ok(!F.allowed({ status: 'delayed' }, 'waiting'));
});
test('yozuvchi amallar can() bilan himoyalangan, localStorage ma\'lumot manbai emas', () => {
  ['patients\', \'create', 'patients\', \'edit', 'patients\', \'delete', 'appointments\', \'create', 'payments\', \'create', 'reports\', \'export'].forEach((k) => assert.ok(src.includes(`can('${k}')`) || src.includes(`can('${k}'`), k));
  assert.ok(!/localStorage|sessionStorage/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
});
test('chegirma limiti sozlamadan olinadi va yuborishdan oldin tekshiriladi', () => {
  assert.ok(/discount_limit/.test(src) && /c\.dp > payCfg\.discount_limit/.test(src));
});
test('409/403/404/422/429 xaritalanadi', () => {
  [403, 404, 409, 422, 429].forEach((c) => assert.ok(src.includes('st === ' + c), String(c)));
});
