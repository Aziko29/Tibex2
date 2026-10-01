(function () {
'use strict';

/* ═══════════════════════════════════════════════════════════════
   TIBEX ADMIN v6 — null-safe, self-healing
   TIBEX_LIVE_DIFF_v1: ekran pirpirashini yo'q qilish uchun
   faqat o'zgargan DOM bo'laklari yangilanadi.
   ═══════════════════════════════════════════════════════════════ */

// ── DOM helpers (null-safe) ──
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); return !!el; };
const byId = id => document.getElementById(id);
const onId = (id, ev, fn) => on(byId(id), ev, fn);
const txt = (id, v) => { const el = byId(id); if (el) el.textContent = v; };

const esc = window.esc;
const escAttr = window.escAttr;

const fmtMoney = n => Number(n || 0).toLocaleString('ru-RU').replace(/,/g,' ') + " so'm";
const fmtShort = n => {
  n = Number(n) || 0;
  if (n >= 1e9) return (n/1e9).toFixed(1) + ' mlrd';
  if (n >= 1e6) return (n/1e6).toFixed(1) + ' mln';
  if (n >= 1e3) return (n/1e3).toFixed(0) + 'K';
  return n.toLocaleString('ru-RU');
};
const fmtDate = ts => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return String(d.getDate()).padStart(2,'0') + '.' +
         String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
};
const fmtTime = ts => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return String(d.getHours()).padStart(2,'0') + ':' +
         String(d.getMinutes()).padStart(2,'0');
};
const fmtDT = ts => {
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(ts);
  return fmtDate(ts) + ' ' + fmtTime(ts);
};
const initials = n => String(n || '?').trim().split(/\s+/).slice(0,2)
  .map(s => s[0] || '').join('').toUpperCase();
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const roleLabel = k => ({admin:'Admin', superadmin:'Superadmin', doctor:'Shifokor',
  reception:'Qabulxona', cashier:'Kassir', lab:'Laborant', patient:'Bemor'}[k] || k);

// ── Toast ──
function toast(msg, type, dur) {
  const root = byId('toastWrap'); if (!root) return;
  const ico = { ok:'✅', info:'ℹ️', warn:'⚠️', bad:'❌' };
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'info');
  el.innerHTML = '<span class="ico">' + (ico[type] || 'ℹ️') +
    '</span><span class="msg">' + esc(msg) + '</span>';
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out');
    setTimeout(() => el.remove(), 250); }, dur || 3200);
}
window.toast = toast;

// ── Modal ──
const Modal = {
  open(html, opts) {
    opts = opts || {};
    const box = byId('modalBox'), bg = byId('modalBg');
    if (!box || !bg) return;
    box.className = 'modal' + (opts.size ? ' ' + opts.size : '');
    box.innerHTML = html;
    bg.classList.add('open');
    document.body.classList.add('modal-open');
    $$('[data-close]', box).forEach(b => on(b, 'click', () => Modal.close()));
    setTimeout(() => {
      const f = box.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), textarea, select');
      if (f) f.focus();
    }, 80);
  },
  close() {
    const bg = byId('modalBg');
    if (bg) bg.classList.remove('open');
    document.body.classList.remove('modal-open');
    setTimeout(() => {
      const box = byId('modalBox'), bg2 = byId('modalBg');
      if (box && bg2 && !bg2.classList.contains('open')) box.innerHTML = '';
    }, 200);
  },
  confirm(title, message, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      Modal.open(
        '<div class="modal-head"><h3>' + esc(title) + '</h3>' +
        '<button class="close" data-close>✕</button></div>' +
        '<div class="modal-body"><p data-tibex-csp-style="s1be383a9">' + message + '</p></div>' +
        '<div class="modal-foot">' +
        '<button class="btn" data-close>Bekor qilish</button>' +
        '<button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" id="__ok">' +
        esc(opts.okText || 'Tasdiqlash') + '</button></div>',
        { size: 'narrow' });
      onId('__ok', 'click', () => { Modal.close(); resolve(true); });
      $$('[data-close]').forEach(b => on(b, 'click', () => resolve(false)));
    });
  }
};
window.Modal = Modal;

// ── Theme ──
const Theme = {
  KEY: 'tibex_settings_v1',
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || '{}').theme || 'light'; } catch(_) { return 'light'; } },
  set(t) {
    let s = {}; try { s = JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch(_) {}
    s.theme = t; s.lastModified = Date.now();
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch(_) {}
    const actual = t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', actual);
    document.documentElement.setAttribute('data-tibex-theme', actual);
  },
  toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
  init() { this.set(this.get()); }
};

// ══════════════════════════════════════════════════════════════
// APP
// ══════════════════════════════════════════════════════════════
const App = {
  state: { view:'overview', search:'', uRole:'all', dSpec:'all', pFilter:'all', eFilter:'all',
           rFilter:'all', mFilter:'all', aFilter:'all' },
  user: null, store: null, cache: {}, _sub: false,
  // TIBEX_LIVE_DIFF_v1: yangi ichki holatlar
  _renderPending: null,
  _settingsPreloaded: false,
  _lastHealthAt: 0,
  _unread: 0,   // o'qilmagan bildirishnomalar soni (🔔 badge)
  _feed: [],    // oxirgi hodisalar (modalda ko'rsatiladi)

  async init() {
    try {
      Theme.init();
      this.bindShell();
      if (!window.TIBEX_STORE) throw new Error('TIBEX_STORE yuklanmadi');
      this.store = window.TIBEX_STORE;
      await this.store.init();
      this.user = this.store.CURRENT_USER;
      if (!this.user) throw new Error('Foydalanuvchi topilmadi');
      this.applyUser();
      this.reloadCache();
      this.applyPermissionShell();
      this.render();
      // TIBEX_LIVE_DIFF_v1: settings'ni bir marta fon rejimida yuklab
      // qo'yamiz — keyin `a_settings` har renderda fetch qilmaydi.
      if (!this._settingsPreloaded) {
        this._settingsPreloaded = true;
        this.store.getSettings(true).then(() => {
          // Tumblerlar (equipService/reagentAlert) yuklangach hisoblagich va ko'rinish yangilanadi.
          this.updateChrome();
          if (['overview', 'equipment', 'reagents'].includes(this.state.view)) this.scheduleViewRender();
        }).catch(() => {});
      }
      if (!this._sub) {
        this._sub = true;
        this.store.subscribe((data, src, meta) => {
          if (src !== 'external') return;
          // 1) Eski belgilarni eslab qolamiz, so'ng cache yangilanadi + chrome raqamlari joyida yangilanadi.
          const before = this._marks();
          this.reloadCache();
          // 2) Toast/badge bildirishnomasi (serverdan faqat bo'sh "invalidate" keladi — farq keshdan olinadi).
          this.notify(before, meta);
          // 3) View FAQAT tegishli entity o'zgargan bo'lsa qayta chiziladi.
          const changed = (meta && meta.changedEntities) || [];
          const cur = this.state.view;
          const rel = this.viewEntity[cur];
          const rolesChanged = changed.includes('roles') ||
                               changed.includes('current_user');
          const relevant =
            (cur === 'overview') ||
            (rel && changed.includes(rel)) ||
            (cur === 'settings' && changed.includes('system_info')) ||
            (cur === 'system'   && changed.includes('system_info')) ||
            ((cur === 'equipment' || cur === 'reagents') && changed.includes('system_info')) ||
            rolesChanged;
          if (relevant) this.scheduleViewRender();
        });
      }
      this.pulseLive();
      const b = byId('boot');
      if (b) { b.classList.add('hide'); setTimeout(() => b.remove(), 400); }
      const app = byId('app'); if (app) app.hidden = false;
    } catch (e) {
      console.error('[ADMIN] init xato:', e);
      if (String(e.message) === 'UNAUTHORIZED') location.href = '/login.html';
      else {
        const b = byId('boot');
        if (b) { b.innerHTML = '<div class="boot-logo">TIBEX</div>' +
          '<div class="boot-sub" data-tibex-csp-style="s873120ed">' +
          'Yuklashda xatolik: ' + esc(e.message) + '<br>' +
          '<button class="btn primary" id="bootRetry" data-tibex-csp-style="s8a279c0e">Qayta urinish</button></div>';
          onId('bootRetry', 'click', () => location.reload());
        }
      }
    }
  },

  bindShell() {
    const sidebar = byId('sidebar');
    onId('btnMenu', 'click', () => this._setMenu(!(sidebar && sidebar.classList.contains('open'))));
    // Server bilan aloqa holati (haqiqiy WebSocket holati) — yuqoridagi "Live" belgisi.
    window.addEventListener('tibex:ws', e => this.setLive(!!(e.detail && e.detail.open)));

    $$('.tab').forEach(t => on(t, 'click', () => {
      const v = t.dataset.view; if (!v) return;
      if (!this.canView(v)) { toast('Bu bo‘limni ko‘rish ruxsatingiz yo‘q', 'warn'); return; }
      this.state.view = v; this.state.search = '';
      $$('.tab').forEach(x => x.classList.toggle('active', x === t));
      this._setMenu(false);
      this.render();
      const c = byId('content'); if (c) c.scrollTop = 0;
    }));

    onId('btnLogout', 'click', async () => {
      const ok = await Modal.confirm('Chiqish', 'Tizimdan chiqishni tasdiqlaysizmi?',
        { okText: 'Chiqish', danger: true });
      if (!ok) return;
      try { await this.store.logout(); } catch(_) { location.href = '/login.html'; }
    });
    onId('btnHelp', 'click', () => this.showShortcuts());
    onId('btnNotif', 'click', () => this.showNotifications());
    onId('qaNewPatient', 'click', () => this.patientForm());
    onId('qaNewUser',    'click', () => this.userForm());
    onId('qaNewRole',    'click', () => this.roleForm());
    onId('qaNewEquip',   'click', () => this.equipmentForm());
    onId('qaNewIntegr',  'click', () => this.integrationForm());

    onId('bbRefresh', 'click', () => this.doRefresh());
    onId('bbBackup',  'click', () => this.doBackup());
    onId('bbReports', 'click', () => {
      if (!this.canView('reports')) return toast('Hisobotlarni ko\'rish ruxsatingiz yo\'q','warn');
      $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.view === 'reports'));
      this.state.view = 'reports'; this.render();
    });

    onId('modalBg', 'click', e => { if (e.target.id === 'modalBg') Modal.close(); });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') Modal.close();
      if (e.key === 'F1') { e.preventDefault(); this.showShortcuts(); }
      if (e.key === 'F4') {
        e.preventDefault();
        if (this.can('users', 'create')) this.userForm();
        else toast('Xodim qo‘shish ruxsatingiz yo‘q', 'warn');
      }
      if (e.key === 'F5') { e.preventDefault(); this.doRefresh(); }
      if (e.key === 'F10') {
        e.preventDefault();
        this.doBackup();
      }
    });
  },

  canBackup() {
    const u = this.store.CURRENT_USER || this.user || {};
    return u.role === 'superadmin' && this.can('settings', 'edit');
  },

  // Snapshot faqat oxirgi bemorlarni beradi: Bemorlar/Umumiy uchun hammasini sahifalab olamiz.
  ensurePatients(force) {
    const v = this.state.view;
    if (!this.can('patients', 'view')) return;
    if (!force && v !== 'patients' && v !== 'overview') return;
    if (this._patLoading || (!force && Date.now() - (this._patLoadedAt || 0) < 60000)) return;
    this._patLoading = true; this._patLoadedAt = Date.now();
    Promise.resolve(this.store.loadAllPatients())
      .then(() => { this.reloadCache(); this.render(); })
      .catch(() => {})
      .then(() => { this._patLoading = false; });
  },

  async doRefresh() {
    if (this._refreshing) return;
    this._refreshing = true;
    this._patLoadedAt = 0;
    const btn = byId('bbRefresh'); if (btn) btn.disabled = true;
    try {
      await this.store.refreshNow();
      this.reloadCache(); this.render();
      toast("Yangilandi", 'ok');
    } catch (e) {
      toast("Yangilab bo'lmadi: " + ((e && e.message) || '?'), 'bad');
    } finally {
      this._refreshing = false;
      if (btn) btn.disabled = false;
    }
  },

  async doBackup() {
    if (!this.canBackup()) return toast("To'liq zaxira faqat superadmin uchun", 'warn');
    if (this._backingUp) return;
    this._backingUp = true;
    toast("Zaxira tayyorlanmoqda...", 'info');
    try {
      await this.store.exportAllJson();
      toast("Zaxira yuklandi", 'ok');
    } catch (e) { /* xato matni store tomonidan ko'rsatilgan */
    } finally { this._backingUp = false; }
  },

  applyUser() {
    const u = this.user || {};
    const nm = u.fullname || u.login || 'Admin';
    const rl = roleLabel(u.role || 'admin');
    txt('sbUserName', nm); txt('sbUserRole', rl);
    txt('sbAvatar', initials(nm));
  },

  viewPermission: { patients:'patients.view', users:'users.view', roles:'roles.view', doctors:'doctors.view', services:'services.view', equipment:'equipment.view', reagents:'reagents.view', integrations:'integrations.view', medical:'medical.view', audit:'audit.view', reports:'reports.view', settings:'settings.view', system:'settings.view' },

  // TIBEX_LIVE_DIFF_v1: har bir view qaysi entity'ga bog'liq — faqat
  // shu entity o'zgargan bo'lsa qayta chizamiz. `null` = ko'rsatilgan
  // view patch-chrome bilan yangilanadi (butun view qayta chizilmaydi).
  viewEntity: {
    patients:'patients', users:'users', roles:'roles',
    doctors:'doctors', services:'services',
    equipment:'equipment', reagents:'reagents',
    integrations:'integrations',
    medical:'appointments', audit:'audit',
    reports:'payments',
    overview:null, settings:null, system:null,
  },

  can(module, action) { return !!(this.store && this.store.can && this.store.can(module, action)); },
  canView(view) { const key = this.viewPermission[view]; return !key || this.can(...key.split('.')); },
  applyPermissionShell() {
    $$('.tab[data-view]').forEach(t => {
      if (t.dataset.view !== 'overview') t.hidden = !this.canView(t.dataset.view);
    });
    const actions = { qaNewPatient:['patients','create'], qaNewUser:['users','create'], qaNewRole:['roles','create'], qaNewEquip:['equipment','create'], qaNewIntegr:['integrations','create'] };
    Object.entries(actions).forEach(([id, p]) => { const e = byId(id); if (e) e.hidden = !this.can(...p); });
    { const e = byId('bbBackup'); if (e) e.hidden = !this.canBackup(); }
    { const e = byId('bbReports'); if (e) e.hidden = !this.can('reports', 'view'); }
  },

  reloadCache() {
    const a = this.store.getAll() || {};
    this.cache = {
      patients: a.patients || {},
      appointments: a.appointments || [],
      lab_orders: a.lab_orders || [],
      payments: a.payments || [],
      refunds: a.refunds || [],
      // Xodimlar faqat xodim rollari; bemor portal akkauntlari (role=patient) 'Bemorlar'ga tegishli
      users: (a.users || []).filter(u => u && u.role !== 'patient'),
      roles: a.roles || [],
      doctors: a.doctors || [],
      services: a.services || [],
      equipment: a.equipment || [],
      reagents: a.reagents || [],
      integrations: a.integrations || [],
      audit: a.audit || [],
      shift: a.shift || null,
      system_info: a.system_info || {}
    };
    this.updateChrome();
  },

  updateChrome() {
    const c = this.cache;
    const users = c.users, patients = Object.values(c.patients),
          eq = c.equipment, pays = c.payments;
    const today = new Date(); today.setHours(0,0,0,0);
    const rev = pays.filter(p => (p.created_at||0) >= today.getTime())
                    .reduce((s,p) => s + (p.amount||0), 0);
    // `txt()` faqat textContent farq bo'lsa yozadi — bu flickerni kamaytiradi.
    const staffN = users.filter(u => u.role !== 'doctor').length;
    txt('tbsUsers', staffN);
    txt('tbsPatients', patients.length);
    txt('tbsEquipment', eq.length);
    txt('tbsRevenue', fmtShort(rev));
    txt('tbsShift', c.shift && c.shift.open ? '1' : '0');
    txt('tcPatients', patients.length);
    txt('tcUsers', staffN);
    txt('tcRoles', c.roles.length);
    txt('tcDoctors', c.doctors.length);
    const svcOn = this._settingOn('equipService'), alertOn = this._settingOn('reagentAlert');
    txt('tcEquipment', eq.filter(e => e.status !== 'working' || (svcOn && this._isServiceDue(e))).length);
    txt('tcReagents', alertOn ? c.reagents.filter(r => this._isLowReagent(r)).length : 0);
    txt('tcIntegrations', c.integrations.length);
    txt('eqWorking', eq.filter(e => e.status === 'working').length);
    txt('eqCalib',   eq.filter(e => e.status === 'calibration').length);
    txt('eqMaint',   eq.filter(e => e.status === 'maintenance').length);
    txt('eqBroken',  eq.filter(e => e.status === 'broken').length);

    // TIBEX_LIVE_DIFF_v1: `sbConsoles` in-place yangilash. Ilgari
    // butun innerHTML qayta yozilardi, natijada sidebar har WS eventda
    // pirpirab ketardi.
    const box = byId('sbConsoles');
    if (!box) return;
    const visibleRoles = c.roles.filter(r => r.key !== 'patient');
    const wantedKeys = new Set(visibleRoles.map(r => r.key));
    Array.from(box.children).forEach(ch => {
      const k = ch.dataset && ch.dataset.roleKey;
      if (k && !wantedKeys.has(k)) ch.remove();
      if (!k && !ch.classList.contains('empty')) ch.remove();
    });
    if (visibleRoles.length === 0) {
      if (!box.querySelector('.empty')) box.innerHTML = '<div class="empty">Rollar yo\'q</div>';
      return;
    }
    const emptyEl = box.querySelector('.empty');
    if (emptyEl) emptyEl.remove();
    visibleRoles.forEach((r, idx) => {
      const cnt = users.filter(u => u.role === r.key && u.active).length;
      const cls = r.active ? 'ok' : 'err';
      const label = (r.icon || '👤') + ' ' + (r.name || r.key);
      const sel = `[data-role-key="${CSS.escape(r.key)}"]`;
      let el = box.querySelector(sel);
      if (!el) {
        el = document.createElement('div');
        el.className = 'eq-row';
        el.dataset.roleKey = r.key;
        el.innerHTML = '<span class="eq-dot"></span><span class="rn"></span><b></b>';
        const ref = box.children[idx];
        if (ref) box.insertBefore(el, ref);
        else box.appendChild(el);
      }
      const dot = el.querySelector('.eq-dot');
      const rnEl = el.querySelector('.rn');
      const bEl = el.querySelector('b');
      const dotCls = 'eq-dot ' + cls;
      if (dot.className !== dotCls) dot.className = dotCls;
      if (rnEl.textContent !== label) rnEl.textContent = label;
      const s = String(cnt);
      if (bEl.textContent !== s) bEl.textContent = s;
    });
  },

  pulseLive() {
    const el = byId('livePill'); if (!el) return;
    el.classList.add('stale'); txt('liveText', 'Sync…');
    setTimeout(() => this.setLive(this._wsOpen()), 700);
  },

  _wsOpen() {
    return !(this.store && typeof this.store.wsOpen === 'function') || !!this.store.wsOpen();
  },

  setLive(open) {
    const el = byId('livePill'); if (!el) return;
    el.classList.toggle('stale', !open);
    txt('liveText', open ? 'Live sync' : 'Aloqa uzildi…');
  },

  _setMenu(open) {
    const sb = byId('sidebar'), mb = byId('btnMenu');
    if (sb) sb.classList.toggle('open', !!open);
    if (mb) mb.setAttribute('aria-expanded', open ? 'true' : 'false');
  },

  // Server WebSocket orqali faqat bo'sh "snapshot.invalidate" yuboradi (ma'lumotlarni oshkor
  // qilmaslik uchun), shuning uchun yangi hodisalar eski/yangi kesh farqidan aniqlanadi.
  // Ro'yxatlar serverda 500 tagacha cheklangan, shu sabab uzunlik emas, eng katta id solishtiriladi.
  _marks() {
    const c = this.cache || {};
    const mx = list => (list || []).reduce((m, x) => Math.max(m, Number(x && x.id) || 0), 0);
    return {
      payments: mx(c.payments), appointments: mx(c.appointments), lab_orders: mx(c.lab_orders),
      users: mx(c.users), patients: mx(Object.values(c.patients || {})),
      lowReagents: (c.reagents || []).filter(r => this._isLowReagent(r)).map(r => r.id),
      dueEquip: (c.equipment || []).filter(e => this._isServiceDue(e)).map(e => e.id)
    };
  },

  notify(before, meta) {
    if (!before) return;
    const changed = (meta && meta.changedEntities) || [];
    // Rol/ruxsat o'zgarganda ro'yxatlar to'satdan paydo bo'ladi — bu "yangi hodisa" emas.
    if (changed.includes('roles') || changed.includes('current_user')) return;
    const c = this.cache || {};
    const rows = {
      payments: c.payments, appointments: c.appointments, lab_orders: c.lab_orders,
      users: c.users, patients: Object.values(c.patients || {})
    };
    const fresh = key => (rows[key] || []).filter(x => (Number(x && x.id) || 0) > (before[key] || 0));
    const newest = list => list.reduce((m, x) => (!m || (Number(x.id) || 0) > (Number(m.id) || 0) ? x : m), null);
    const evs = [];
    const add = (key, icon, text, type) => {
      const f = fresh(key);
      if (!f.length) return;
      if (!before[key] && f.length > 1) return; // bo'sh edi, birdan to'ldi — dastlabki yuklash
      evs.push({ n: f.length, icon, text: text(newest(f)), type });
    };
    add('payments', '💰', p => 'Yangi to\'lov: ' + fmtMoney(p.amount), 'ok');
    add('appointments', '📅', a => 'Yangi qabul #' + a.id, 'info');
    add('lab_orders', '🔬', () => 'Yangi lab so\'rov', 'info');
    add('users', '👤', () => 'Yangi xodim qo\'shildi', 'ok');
    add('patients', '🧑', () => 'Yangi bemor', 'info');
    if (before.lowReagents && this._settingOn('reagentAlert')) {
      const seen = new Set(before.lowReagents);
      const f = (c.reagents || []).filter(r => this._isLowReagent(r) && !seen.has(r.id));
      if (f.length) evs.push({ n: f.length, icon: '🧪', text: 'Kam qoldiq: ' + f[0].name, type: 'warn' });
    }
    if (before.dueEquip && this._settingOn('equipService')) {
      const seen = new Set(before.dueEquip);
      const f = (c.equipment || []).filter(e => this._isServiceDue(e) && !seen.has(e.id));
      if (f.length) evs.push({ n: f.length, icon: '🔬', text: 'Xizmat muddati yaqin: ' + f[0].name, type: 'warn' });
    }
    if (!evs.length) return;
    evs.forEach(ev => {
      toast(ev.icon + ' ' + ev.text + (ev.n > 1 ? ' (+' + (ev.n - 1) + ' yana)' : ''), ev.type);
      this._feed.unshift({ ts: Date.now(), icon: ev.icon, text: ev.text, n: ev.n });
      this._unread += ev.n;
    });
    if (this._feed.length > 30) this._feed.length = 30;
    this._renderBadge();
  },

  _renderBadge() {
    const nd = byId('notifDot'), btn = byId('btnNotif');
    const n = this._unread || 0;
    if (nd) { nd.hidden = n <= 0; nd.textContent = n > 99 ? '99+' : String(n); }
    if (btn) {
      const label = n > 0 ? 'Bildirishnomalar (' + n + ' yangi)' : 'Bildirishnomalar';
      btn.title = label; btn.setAttribute('aria-label', label);
    }
  },

  // ── Focus / scroll saqlash (TIBEX_LIVE_DIFF_v1) ──
  // render() innerHTML'ni almashtiradi; shu sabab inputdagi kursor va
  // sahifa scroll pozitsiyasi yo'qolib qolmasligi uchun oldin saqlab
  // keyin tiklaymiz. Foydalanuvchi hech qachon "sakrab" ketmaydi.
  _saveFocus() {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    if (!el.id && !el.name) return null;
    const st = { id: el.id || null, name: el.name || null, tag: el.tagName,
                 selStart: null, selEnd: null, value: undefined };
    try {
      if (typeof el.selectionStart === 'number') {
        st.selStart = el.selectionStart;
        st.selEnd = el.selectionEnd;
      }
    } catch (_) {}
    if (st.tag === 'INPUT' || st.tag === 'TEXTAREA') st.value = el.value;
    return st;
  },
  _restoreFocus(st) {
    if (!st) return;
    let el = null;
    if (st.id) el = document.getElementById(st.id);
    if (!el && st.name) el = document.querySelector(st.tag.toLowerCase() + '[name="' + st.name + '"]');
    if (!el) return;
    try {
      if ((st.tag === 'INPUT' || st.tag === 'TEXTAREA') &&
          el.value !== st.value && document.activeElement !== el) {
        el.value = st.value;
      }
      el.focus({ preventScroll: true });
      if (typeof st.selStart === 'number' && el.setSelectionRange) {
        el.setSelectionRange(st.selStart, st.selEnd);
      }
    } catch (_) {}
  },
  _saveScroll() {
    const main = byId('content');
    return main ? { top: main.scrollTop, left: main.scrollLeft } : null;
  },
  _restoreScroll(st) {
    if (!st) return;
    const main = byId('content');
    if (!main) return;
    try {
      if (Math.abs(main.scrollTop - st.top) > 2) main.scrollTop = st.top;
      if (Math.abs(main.scrollLeft - st.left) > 2) main.scrollLeft = st.left;
    } catch (_) {}
  },
  // Debounce: bir nechta WS event 120 ms ichida kelsa — bitta render.
  scheduleViewRender() {
    if (this._renderPending) return;
    this._renderPending = setTimeout(() => {
      this._renderPending = null;
      this.render();
    }, 120);
  },

  render() {
    this.updateChrome();
    const v = this.state.view;
    if (!this.canView(v)) {
      this.state.view = 'overview';
      $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.view === 'overview'));
    }
    const activeView = this.state.view;
    this.ensurePatients();
    const fn = this['v_' + activeView] || this.v_overview;
    const html = fn.call(this);
    const main = byId('content'); if (!main) return;
    const _focus = this._saveFocus();
    const _scroll = this._saveScroll();
    main.innerHTML = html;
    const view = main.querySelector('.view'); if (view) view.classList.add('active');
    const module = ({patients:'patients',users:'users',roles:'roles',doctors:'doctors',services:'services',equipment:'equipment',reagents:'reagents',integrations:'integrations'})[activeView];
    if (module) {
      const controls = { edit:'edit', toggle:'edit', reset:'edit', account:'edit', delete:'delete', refund:'refund', verify:'verify' };
      $$('[data-act]', main).forEach(b => { const action=controls[b.dataset.act]; if(action) b.hidden=!this.can(module,action); });
      const createIds={patients:'pNew',users:'uNew',roles:'rNew',doctors:'dNew',services:'sNew',equipment:'eNew',reagents:'rNew',integrations:'iNew'};
      const createButton=byId(createIds[module]); if(createButton) createButton.hidden=!this.can(module,'create');
    }
    const after = this['a_' + activeView]; if (after) after.call(this, main);
    this._restoreScroll(_scroll);
    this._restoreFocus(_focus);
  },

  // ══════════════════════════════════════════════════════════
  // OVERVIEW
  // ══════════════════════════════════════════════════════════
  v_overview() {
    const c = this.cache;
    const allowed = [
      ['patients','patients.view','🧑','Bemorlar',Object.keys(c.patients).length],
      ['appointments','appointments.view','📅','Qabullar',c.appointments.length],
      ['users','users.view','👥','Xodimlar',c.users.length],
      ['roles','roles.view','🛡','Rollar',c.roles.length],
      ['doctors','doctors.view','👨‍⚕️','Shifokorlar',c.doctors.length],
      ['services','services.view','🩺','Xizmatlar',c.services.length],
      ['equipment','equipment.view','🔬','Uskunalar',c.equipment.length],
      ['reagents','reagents.view','🧪','Reagentlar',c.reagents.length],
      ['integrations','integrations.view','🔌','Integratsiyalar',c.integrations.length],
      ['medical','medical.view','📋','Tibbiy yozuvlar',c.lab_orders.length],
      ['audit','audit.view','📜','Audit',c.audit.length],
      ['reports','reports.view','📈','Hisobotlar',null],
      ['settings','settings.view','⚙️','Sozlamalar',null],
    ].filter(x => this.can(...x[1].split('.')));
    const today = new Date(); today.setHours(0,0,0,0);
    return '' +
      '<section class="view">' +
        '<div class="page-head">' +
          '<div><h1 class="page-title">📊 Ish paneli</h1>' +
          '<div class="page-sub">Sizga ruxsat berilgan bo‘limlar · ' + fmtDate(Date.now()) + '</div></div>' +
        '</div>' +
        '<div class="stat-grid">' + allowed.map((x,i) => this._stat(['blue','green','purple','gold'][i%4],x[2],x[4] == null ? '→' : x[4],x[3],'' )).join('') + '</div>' +
      '</section>';
  },

  a_overview(root) {
    $$('[data-jump]', root).forEach(b => on(b, 'click', () => {
      const v = b.dataset.jump;
      $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.view === v));
      this.state.view = v; this.render();
    }));
  },

  _stat(color, icon, value, label, sub) {
    return '<div class="stat-card ' + color + '">' +
      '<div class="stat-icon">' + icon + '</div>' +
      '<div class="stat-value">' + esc(value) + '</div>' +
      '<div class="stat-label">' + esc(label) + '</div>' +
      (sub ? '<div class="stat-sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  },

  _auditRow(a) {
    return '<div class="audit-item">' +
      '<div class="time">' + esc(fmtDT(a.ts)) + '</div>' +
      '<span class="act ' + esc(a.action||'') + '">' +
        esc((a.action||'?').toUpperCase()) + '</span>' +
      '<div class="body"><div class="who">' + esc(a.user||'—') +
        ' <span data-tibex-csp-style="s83622f3b">' +
        esc(a.role||'') + '</span></div>' +
      '<div class="det">' + esc(a.detail||'') + '</div></div></div>';
  },

  // ══════════════════════════════════════════════════════════
  // PATIENTS
  // ══════════════════════════════════════════════════════════
  v_patients() {
    const all = Object.values(this.cache.patients);
    const s = this.state.search;
    let list = all.slice();
    if (s) list = list.filter(p =>
      (p.fullname||'').toLowerCase().includes(s) ||
      (p.phone||'').includes(s) || String(p.id).includes(s));
    if (this.state.pFilter === 'male') list = list.filter(p => p.gender === 'Erkak');
    if (this.state.pFilter === 'female') list = list.filter(p => p.gender === 'Ayol');
    if (this.state.pFilter === 'allergy') list = list.filter(p => (p.allergies||[]).length);
    if (this.state.pFilter === 'chronic') list = list.filter(p => (p.chronic||[]).length);
    list.sort((a,b) => (b.id||0) - (a.id||0));
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">🧑 Bemorlar <span class="cnt">' + all.length + '</span></h1>' +
        '<div class="page-sub">Bemorlar bazasi va tibbiy tarix</div></div>' +
        '<div class="page-actions">' +
          '<button class="btn" id="pExport">📄 Excel</button>' +
          '<button class="btn primary" id="pNew">➕ Yangi bemor</button></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="filters">' +
          '<div class="search-box"><input type="text" id="pSearch" ' +
            'placeholder="F.I.Sh, telefon yoki ID…" value="' + escAttr(this.state.search) + '"></div>' +
          '<button class="chip ' + (this.state.pFilter==='all'?'on':'') + '" data-pf="all">Barchasi <span class="n">' + all.length + '</span></button>' +
          '<button class="chip ' + (this.state.pFilter==='male'?'on':'') + '" data-pf="male">👨 Erkak</button>' +
          '<button class="chip ' + (this.state.pFilter==='female'?'on':'') + '" data-pf="female">👩 Ayol</button>' +
          '<button class="chip ' + (this.state.pFilter==='allergy'?'on':'') + '" data-pf="allergy">⚠ Allergiya</button>' +
          '<button class="chip ' + (this.state.pFilter==='chronic'?'on':'') + '" data-pf="chronic">💊 Surunkali</button>' +
        '</div>' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th data-tibex-csp-style="sc9acb4a0">ID</th><th>F.I.Sh</th><th data-tibex-csp-style="sf7784277">Telefon</th>' +
          '<th data-tibex-csp-style="sc9acb4a0">Yosh</th><th data-tibex-csp-style="sb6a594ef">Jins</th>' +
          '<th data-tibex-csp-style="sb6a594ef">Qon</th><th data-tibex-csp-style="sd5a4d170">Belgilar</th><th data-tibex-csp-style="sf7784277"></th>' +
        '</tr></thead><tbody>' +
        (list.length ? list.slice(0,300).map(p => {
          const tags = [];
          if ((p.allergies||[]).length) tags.push('<span class="status err">⚠ ' + p.allergies.length + '</span>');
          if ((p.chronic||[]).length) tags.push('<span class="status warn">💊 ' + p.chronic.length + '</span>');
          return '<tr data-id="' + p.id + '">' +
            '<td class="mono" data-tibex-csp-style="se7f1b30e">#' + p.id + '</td>' +
            '<td><div class="cell-flex"><div class="avatar-sm">' + esc(initials(p.fullname)) + '</div>' +
            '<div class="cell-stack"><div class="top">' + esc(p.fullname||'—') + '</div>' +
            (p.address ? '<div class="sub">' + esc(p.address).slice(0,40) + '</div>' : '') +
            '</div></div></td>' +
            '<td class="mono">' + esc(p.phone||'—') + '</td>' +
            '<td class="mono">' + (p.age||0) + '</td>' +
            '<td>' + (p.gender === 'Erkak' ? '👨' : p.gender === 'Ayol' ? '👩' : '—') + '</td>' +
            '<td class="mono">' + esc(p.blood||'—') + '</td>' +
            '<td>' + (tags.join(' ') || '<span data-tibex-csp-style="se7f1b30e">—</span>') + '</td>' +
            '<td><div class="row-actions">' +
              '<button data-act="history" title="Tarix">📋</button>' +
              '<button data-act="edit" title="Tahrirlash">✏️</button>' +
              '<button data-act="account" title="Akkaunt">🔑</button>' +
              '<button data-act="delete" class="danger" title="O\'chirish">🗑</button>' +
            '</div></td></tr>';
        }).join('') :
        '<tr><td colspan="8"><div class="empty"><div class="ico">🧑</div><div class="msg">Bemorlar topilmadi</div></div></td></tr>') +
        (list.length > 300 ? '<tr><td colspan="8"><div class="hint">Dastlabki 300 ta ko\'rsatildi (jami ' + list.length + '). Qidiruvdan foydalaning.</div></td></tr>' : '') +
        '</tbody></table></div></div></section>';
  },

  a_patients(root) {
    onId('pNew', 'click', () => this.patientForm());
    onId('pExport', 'click', () => this.store.exportXlsx('patients').catch(() => {}));
    onId('pSearch', 'input', debounce(e => { this.state.search = e.target.value.trim().toLowerCase(); this.render(); }, 200));
    $$('[data-pf]', root).forEach(b => on(b, 'click', () => { this.state.pFilter = b.dataset.pf; this.render(); }));
    $$('tbody tr[data-id]', root).forEach(tr => {
      const id = parseInt(tr.dataset.id, 10);
      on(tr, 'click', e => { if (e.target.closest('.row-actions')) return; this.patientHistory(id); });
      $$('button[data-act]', tr).forEach(btn => on(btn, 'click', async e => {
        e.stopPropagation();
        const a = btn.dataset.act;
        if (a === 'edit') this.patientForm(id);
        else if (a === 'delete') await this.patientDelete(id);
        else if (a === 'history') this.patientHistory(id);
        else if (a === 'account') this.patientAccount(id);
      }));
    });
  },

  patientForm(id) {
    const p = id ? (this.cache.patients[String(id)] || {}) : {};
    const isEdit = !!id;
    Modal.open(
      '<div class="modal-head"><h3>' + (isEdit ? '✏️ Bemor tahrirlash' : '🧑 Yangi bemor') + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        '<div class="field span-2"><label>F.I.Sh <span class="req">*</span></label>' +
          '<input class="input" id="pFn" value="' + escAttr(p.fullname||'') + '" autofocus></div>' +
        '<div class="field"><label>Telefon <span class="req">*</span></label>' +
          '<input class="input" id="pPh" value="' + escAttr(p.phone||'+998 ') + '"></div>' +
        '<div class="field"><label>Yosh <span class="req">*</span></label>' +
          '<input class="input" id="pAge" type="number" min="0" max="150" value="' + escAttr(p.age||'') + '"></div>' +
        '<div class="field"><label>Jins</label><select class="select" id="pGen">' +
          '<option value="Erkak" ' + (p.gender==='Erkak'?'selected':'') + '>Erkak</option>' +
          '<option value="Ayol" ' + (p.gender==='Ayol'?'selected':'') + '>Ayol</option></select></div>' +
        '<div class="field"><label>Qon guruhi</label><select class="select" id="pBl">' +
          ['O+','O-','A+','A-','B+','B-','AB+','AB-',"Noma'lum"].map(x =>
            '<option ' + ((p.blood||"Noma'lum")===x?'selected':'') + '>' + x + '</option>').join('') +
        '</select></div>' +
        '<div class="field span-2"><label>Manzil</label>' +
          '<input class="input" id="pAdr" value="' + escAttr(p.address||'') + '"></div>' +
        '<div class="field span-2"><label>⚠️ Allergiyalar</label>' +
          '<input class="input" id="pAll" value="' + escAttr((p.allergies||[]).join(', ')) + '" placeholder="Vergul bilan: Penitsillin, Lateks">' +
          '<div class="hint">Vergul bilan ajratib yozing</div></div>' +
        '<div class="field span-2"><label>💊 Surunkali kasalliklar</label>' +
          '<input class="input" id="pChr" value="' + escAttr((p.chronic||[]).join(', ')) + '" placeholder="Vergul bilan: Diabet, Gipertoniya">' +
          '<div class="hint">Vergul bilan ajratib yozing</div></div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn primary" id="__save">✓ Saqlash</button></div>',
      { size: 'wide' });
    onId('__save', 'click', async () => {
      const data = {
        fullname: ($('#pFn') || {}).value ? $('#pFn').value.trim() : '',
        phone:    ($('#pPh') || {}).value ? $('#pPh').value.trim() : '',
        age: parseInt(($('#pAge') || {}).value, 10),
        gender: ($('#pGen') || {}).value || 'Erkak',
        blood:  ($('#pBl') || {}).value || "Noma'lum",
        address: ($('#pAdr') || {}).value ? $('#pAdr').value.trim() : '',
        allergies: ($('#pAll') || {}).value ? $('#pAll').value.split(',').map(x=>x.trim()).filter(Boolean) : [],
        chronic:  ($('#pChr') || {}).value ? $('#pChr').value.split(',').map(x=>x.trim()).filter(Boolean) : []
      };
      if (!data.fullname || !data.phone || !Number.isInteger(data.age) || data.age < 0 || data.age > 150) return toast('F.I.Sh, telefon va yosh (0–150) majburiy','warn');
      if (data.phone.replace(/\D/g, '').length < 9) return toast('Telefon raqamni to\'liq kiriting','warn');
      try {
        if (isEdit) await this.store.updatePatient(id, data);
        else await this.store.addPatient(data).ready;
        toast(isEdit ? 'Bemor yangilandi' : 'Bemor qo\'shildi', 'ok');
        Modal.close();
        setTimeout(() => { this.reloadCache(); this.render(); }, 300);
      } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
    });
  },

  async patientDelete(id) {
    const p = this.cache.patients[String(id)] || {};
    const ok = await Modal.confirm('Bemorni o\'chirish',
      '<b>' + esc(p.fullname || '#'+id) + '</b> ni o\'chirishni tasdiqlaysizmi?',
      { okText: 'O\'chirish', danger: true });
    if (!ok) return;
    try {
      await this.store.deletePatient(id);
      toast('Bemor o\'chirildi','warn');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300);
    } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
  },

  patientHistory(id) {
    const p = this.cache.patients[String(id)]; if (!p) return;
    const appts = this.cache.appointments.filter(a => a.patient_id === id);
    const labs = this.cache.lab_orders.filter(l => l.patient_id === id);
    const pays = this.cache.payments.filter(x => x.patient_id === id);
    Modal.open(
      '<div class="modal-head"><h3>📋 ' + esc(p.fullname) + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="notice info"><span class="ico">🔒</span>' +
        '<div>Tibbiy yozuvlar <b>faqat ko\'rish uchun</b> — admin o\'zgartira olmaydi.</div></div>' +
        '<div class="stat-grid" data-tibex-csp-style="s801b40de">' +
          this._stat('blue','📅',appts.length,'Qabullar') +
          this._stat('purple','🔬',labs.length,'Lab') +
          this._stat('gold','💰',pays.length,'To\'lovlar') +
        '</div>' +
        '<h4 data-tibex-csp-style="s6b0223f4">📋 Qabullar tarixi</h4>' +
        (appts.length ? appts.map(a =>
          '<div data-tibex-csp-style="sc183636a">' +
          '<div data-tibex-csp-style="sa4f2cf8a">' +
            '<b>Qabul #' + a.id + '</b>' +
            '<span class="status ' + (a.status==='completed'?'ok':(a.status==='cancelled'?'muted':'info')) + '">' +
              esc(a.status||'—') + '</span></div>' +
          '<div data-tibex-csp-style="sdf2dc98f">' +
            esc(a.date||'') + ' ' + esc(a.scheduled_time||'') + ' · ' + esc(a.doctor_name||'—') + '</div>' +
          (a.complaint ? '<div data-tibex-csp-style="s34666eb2">💬 ' + esc(a.complaint) + '</div>' : '') +
          (a.final_dx || a.prelim_dx ? '<div data-tibex-csp-style="s34666eb2">🩺 ' + esc(a.final_dx || a.prelim_dx) + '</div>' : '') +
          '</div>').join('') :
          '<div class="empty"><div class="msg">Qabullar yo\'q</div></div>') +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>Yopish</button></div>',
      { size: 'wide' });
  },

  patientAccount(id) {
    const p = this.cache.patients[String(id)]; if (!p) return;
    Modal.open(
      '<div class="modal-head"><h3>🔑 Bemor kabineti akkaunti</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="notice info"><span class="ico">ℹ️</span>' +
        '<div><b>' + esc(p.fullname) + '</b> uchun bir martalik kod yarating. Kod 5 daqiqa amal qiladi va bir marta ishlatiladi. Bemor uni telefon raqami bilan birga bemor kirish sahifasida kiritadi.</div></div>' +
        '<div class="hint" data-tibex-csp-style="s355e4ccf">Telefon: <b>' + esc(p.phone||'—') + '</b>. Telegram botdan o\'zi ulangan bemorlar keyingi kodni bot orqali olishi mumkin.</div>' +
        '<div id="accLoginCode" class="notice warn" hidden data-tibex-csp-style="s67563604"></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>Yopish</button>' +
      '<button class="btn primary" id="accIssueCode">🔐 Bir martalik kirish kodi berish</button></div>');
    onId('accIssueCode', 'click', async () => {
      const btn = byId('accIssueCode'); if (btn) btn.disabled = true;
      try {
        const result = await this.store._api('/api/otp/admin-issue', {
          method: 'POST', body: { patient_id: id },
        });
        const issued = byId('accLoginCode');
        if (issued) {
          issued.hidden = false;
          issued.innerHTML = '<b>' + esc(result.code) + '</b><br>Bu kod 5 daqiqa ichida bir marta ishlaydi. Bemorning o\'ziga xavfsiz tarzda bering; modal yopilgach qayta ko\'rinmaydi.';
        }
      } catch (e) { toast('Kod berilmadi: ' + (e.message || '?'), 'bad'); }
      finally { if (btn) btn.disabled = false; }
    });
  },

  // ══════════════════════════════════════════════════════════
  // USERS
  // ══════════════════════════════════════════════════════════
  _subMenu(title, attr, items, cur) {
    return '<aside class="submenu"><div class="sm-title">' + esc(title) + '</div>' +
      items.map(it =>
        '<button type="button" class="sm-item' + (it.key === cur ? ' on' : '') + (it.dim ? ' dim' : '') + '" ' + attr + '="' + escAttr(it.key) + '">' +
          '<span class="sm-ico">' + esc(it.icon) + '</span><span class="sm-name">' + esc(it.name) + '</span>' +
          '<b class="sm-n">' + it.n + '</b></button>').join('') +
      (attr === 'data-ur' ? '<div class="sm-note">👨‍⚕️ Shifokorlar alohida — «Shifokorlar» bo\'limida.</div>' : '') +
      '</aside>';
  },

  v_users() {
    const staff = this.cache.users.filter(u => u.role !== 'doctor');
    const roles = this.cache.roles.filter(r => r.key !== 'patient' && r.key !== 'doctor');
    let cur = this.state.uRole || 'all';
    if (cur !== 'all' && !roles.some(r => r.key === cur)) cur = 'all';
    this.state.uRole = cur;
    const s = this.state.search;
    let list = cur === 'all' ? staff.slice() : staff.filter(u => u.role === cur);
    if (s) list = list.filter(u =>
      (u.fullname||'').toLowerCase().includes(s) ||
      (u.login||'').toLowerCase().includes(s) ||
      (u.phone||'').includes(s));
    const curRole = roles.find(r => r.key === cur);
    const items = [{ key:'all', icon:'👥', name:'Barcha xodimlar', n: staff.length }].concat(
      roles.map(r => ({ key:r.key, icon:r.icon||'👤', name:r.name||r.key,
        n: staff.filter(u => u.role === r.key).length, dim: !r.active })));
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">👥 Xodimlar <span class="cnt">' + staff.length + '</span></h1>' +
        '<div class="page-sub">' + (curRole ? esc((curRole.icon||'') + ' ' + (curRole.name||curRole.key)) + ' roli bo\'yicha' : 'Shifokorlardan tashqari tizim foydalanuvchilari') + '</div></div>' +
        '<div class="page-actions"><button class="btn primary" id="uNew">➕ Yangi xodim</button></div>' +
      '</div>' +
      '<div class="split">' + this._subMenu('Rollar', 'data-ur', items, cur) +
      '<div class="split-main"><div class="card">' +
        '<div class="card-head"><div class="card-title">' + (curRole ? esc((curRole.icon||'👤') + ' ' + (curRole.name||curRole.key)) : '👥 Barcha xodimlar') +
          ' <span class="cnt">' + list.length + '</span></div></div>' +
        '<div class="filters"><div class="search-box">' +
        '<input type="text" id="uSearch" placeholder="F.I.Sh, login yoki telefon…" value="' + escAttr(this.state.search) + '"></div></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th data-tibex-csp-style="sef2cc381">ID</th><th>F.I.Sh</th><th data-tibex-csp-style="sf7784277">Login</th>' +
          '<th data-tibex-csp-style="sc11bcb05">Rol</th><th data-tibex-csp-style="sf7784277">Telefon</th>' +
          '<th data-tibex-csp-style="s76727e3">Holat</th><th data-tibex-csp-style="sc11bcb05"></th>' +
        '</tr></thead><tbody>' +
        (list.length ? list.map(u => {
          const role = this.cache.roles.find(r => r.key === u.role) || {};
          return '<tr data-id="' + u.id + '">' +
            '<td class="mono" data-tibex-csp-style="se7f1b30e">#' + u.id + '</td>' +
            '<td><div class="cell-flex"><div class="avatar-sm">' + esc(initials(u.fullname)) + '</div>' +
            '<div class="cell-stack"><div class="top">' + esc(u.fullname||'—') + '</div></div></div></td>' +
            '<td class="mono">' + esc(u.login||'—') + '</td>' +
            '<td><span class="role-badge ' + esc(u.role||'') + '">' +
              esc(role.icon||'👤') + ' ' + esc(role.name||u.role||'—') + '</span></td>' +
            '<td class="mono">' + esc(u.phone||'—') + '</td>' +
            '<td>' + (u.active ? '<span class="status ok">Aktiv</span>' : '<span class="status muted">Bloklangan</span>') + '</td>' +
            '<td><div class="row-actions">' +
              '<button data-act="edit">✏️</button>' +
              '<button data-act="reset">🔑</button>' +
              '<button data-act="toggle">' + (u.active ? '🚫' : '✓') + '</button>' +
              '<button data-act="delete" class="danger">🗑</button>' +
            '</div></td></tr>';
        }).join('') :
        '<tr><td colspan="7"><div class="empty"><div class="ico">👥</div><div class="msg">' + (curRole ? 'Bu rolda xodimlar yo\'q' : 'Xodimlar yo\'q') + '</div></div></td></tr>') +
        '</tbody></table></div></div></div></div></section>';
  },

  a_users(root) {
    onId('uNew', 'click', () => this.userForm(this.state.uRole !== 'all' ? { role: this.state.uRole } : null));
    $$('[data-ur]', root).forEach(btn => on(btn, 'click', () => { this.state.uRole = btn.dataset.ur; this.render(); }));
    onId('uSearch', 'input', debounce(e => { this.state.search = e.target.value.trim().toLowerCase(); this.render(); }, 200));
    $$('tbody tr[data-id]', root).forEach(tr => {
      const id = parseInt(tr.dataset.id, 10);
      const u = this.cache.users.find(x => x.id === id);
      $$('button[data-act]', tr).forEach(btn => on(btn, 'click', async e => {
        e.stopPropagation();
        const a = btn.dataset.act;
        if (a === 'edit') this.userForm(u);
        else if (a === 'reset') this.userResetPassword(u);
        else if (a === 'toggle') await this.userToggle(u);
        else if (a === 'delete') await this.userDelete(u);
      }));
    });
  },

  userForm(user) {
    const isEdit = user && user.id;
    const u = user || {};
    Modal.open(
      '<div class="modal-head"><h3>' + (isEdit ? '✏️ Xodim tahrirlash' : '👤 Yangi xodim') + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        '<div class="field span-2"><label>Rol <span class="req">*</span></label>' +
          '<select class="select" id="uRl"' + (isEdit ? '' : ' autofocus') + '>' +
            (isEdit ? '' : '<option value="">— Rolni tanlang —</option>') +
            this.cache.roles.filter(r => r.key !== 'patient' && (r.active || r.key === u.role)).map(r => '<option value="' + escAttr(r.key) + '" ' +
              (u.role===r.key?'selected':'') + '>' + esc(r.icon||'') + ' ' + esc(r.name||r.key) + '</option>').join('') +
          '</select></div>' +
        '<div class="field span-2"><div class="notice" id="uRolePanel"></div></div>' +
        (isEdit ? '' : '<div class="field span-2 u-doc" id="uDocBox" hidden><div class="u-doc-card">' +
          '<div class="u-doc-title">👨‍⚕️ Shifokor ma\'lumotlari</div>' +
          '<div class="form-grid">' +
            '<div class="field span-2"><label>Mutaxassislik <span class="req">*</span></label>' +
              '<input class="input" id="uSpec" list="uSpecList" autocomplete="off" placeholder="Masalan: Terapevt">' +
              '<datalist id="uSpecList"><option value="Terapevt"><option value="Kardiolog"><option value="Nevrolog"><option value="LOR"><option value="Pediatr"><option value="Xirurg"><option value="Ginekolog"><option value="Oftalmolog"><option value="Urolog"><option value="Dermatolog"></datalist></div>' +
            '<div class="field"><label>Xona</label><input class="input" id="uRoom" maxlength="32" placeholder="Masalan: 12"></div>' +
            '<div class="field"><label>Qabul (ko\'rik) narxi, so\'m</label><input class="input" id="uPrice" type="number" inputmode="numeric" min="0" step="1000" placeholder="0"></div>' +
          '</div></div></div>') +
        '<div class="field span-2"><label>F.I.Sh <span class="req">*</span></label>' +
          '<input class="input" id="uFn" value="' + escAttr(u.fullname||'') + '"></div>' +
        '<div class="field"><label>Login <span class="req">*</span></label>' +
          '<input class="input" id="uLg" value="' + escAttr(u.login||'') + '"' + (isEdit ? ' readonly title="Login o\'zgartirilmaydi"' : '') + '></div>' +
        '<div class="field"><label>Parol ' + (isEdit ? '' : '<span class="req">*</span>') + '</label>' +
          '<div class="pwd-wrap"><input class="input" id="uPwd" type="password" placeholder="' +
            (isEdit ? 'Bo\'sh — o\'zgarmaydi' : 'Kamida 10 belgi') + '" autocomplete="new-password">' +
          '<button type="button" class="pwd-gen" id="uPwdGen" title="Kuchli parol generatsiya qilish" aria-label="Kuchli parol generatsiya qilish">🎲</button>' +
          '<button type="button" class="pwd-toggle">👁️</button></div>' +
          '<div class="hint">Kamida 10 belgi: katta va kichik harf, raqam, belgi. Oson parollar (12345, qwerty, login) qabul qilinmaydi. 🎲 — tasodifiy kuchli parol.</div></div>' +
        '<div class="field"><label>Telefon</label>' +
          '<input class="input" id="uPh" value="' + escAttr(u.phone||'+998 ') + '"></div>' +
        (isEdit ? '<div class="field"><label>Holati</label><select class="select" id="uActive"><option value="true" ' + (u.active?'selected':'') + '>Faol</option><option value="false" ' + (!u.active?'selected':'') + '>Bloklangan</option></select></div>' : '') +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn primary" id="__save">✓ Saqlash</button></div>',
      { size: 'wide' });
    const MOD = { patients:'Bemorlar', appointments:'Qabullar', medical:'Tibbiy yozuvlar', lab:'Laboratoriya', payments:'To\'lovlar', users:'Xodimlar', roles:'Rollar', doctors:'Shifokorlar', services:'Xizmatlar', equipment:'Uskunalar', reagents:'Reagentlar', integrations:'Integratsiyalar', settings:'Sozlamalar', audit:'Audit', reports:'Hisobotlar', camera:'Kamera' };
    const updateRolePreview = () => {
      const box = byId('uRolePanel'); if (!box) return;
      const key = (byId('uRl')||{}).value || '';
      const role = this.cache.roles.find(x => x.key === key);
      const doc = byId('uDocBox');
      const showDoc = !isEdit && key === 'doctor';
      if (doc) {
        const was = !doc.hidden;
        doc.hidden = !showDoc;
        if (showDoc && !was) { const sp = byId('uSpec'); if (sp) setTimeout(() => { try { sp.focus({ preventScroll: true }); doc.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {} }, 0); }
      }
      if (!role) { box.innerHTML = '<div class="notice-body">Avval rolni tanlang — shunga mos maydonlar shu yerda ochiladi.</div>'; return; }
      const perms = role.permissions === '*' ? null : (Array.isArray(role.permissions) ? role.permissions : []);
      const mods = perms ? Array.from(new Set(perms.map(x => String(x).split('.')[0]))).map(m => MOD[m] || m) : ['Barcha bo\'limlar'];
      const chips = mods.slice(0, 8).map(m => '<span class="chip on">' + esc(m) + '</span>').join(' ') + (mods.length > 8 ? ' <span class="chip">+' + (mods.length - 8) + '</span>' : '');
      let html = '<b>' + esc(role.icon||'') + ' ' + esc(role.name||role.key) + '</b>' + (role.description ? ' · ' + esc(role.description) : '') + '<div class="notice-chips">' + chips + '</div>';
      if (key === 'doctor' && isEdit) html += '<div>Mutaxassislik, xona va narx <b>Shifokorlar</b> bo\'limida tahrirlanadi.</div>';
      box.innerHTML = '<div class="notice-body">' + html + '</div>';
    };
    onId('uRl', 'change', updateRolePreview); updateRolePreview();
    $$('.pwd-toggle').forEach(b => on(b, 'click', e => {
      e.preventDefault();
      const i = b.parentElement.querySelector('input');
      i.type = i.type === 'text' ? 'password' : 'text';
      b.textContent = i.type === 'text' ? '🙈' : '👁️';
    }));
    // Kuchli parol generatori: brauzer CSPRNG (crypto.getRandomValues), rejection sampling; server siyosati bilan mos
    const genPwd = (len) => {
      const L = 'abcdefghijkmnopqrstuvwxyz', U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789', S = '!@#$%^&*-_+=?';
      const pick = (set) => {
        const lim = Math.floor(256 / set.length) * set.length, b = new Uint8Array(1);
        do { crypto.getRandomValues(b); } while (b[0] >= lim);
        return set[b[0] % set.length];
      };
      const weak = p => /(.)\1{3,}/.test(p) || /(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|wert|erty|asdf|sdfg|zxcv)/i.test(p);
      for (let t = 0; t < 50; t++) {
        const a = [pick(L), pick(U), pick(D), pick(S)], all = L + U + D + S;
        while (a.length < len) a.push(pick(all));
        for (let i = a.length - 1; i > 0; i--) {   // Fisher–Yates
          const b = new Uint32Array(1); crypto.getRandomValues(b);
          const j = b[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]];
        }
        const p = a.join('');
        if (!weak(p)) return p;
      }
      return '';
    };
    onId('uPwdGen', 'click', async e => {
      e.preventDefault();
      const inp = byId('uPwd'); if (!inp) return;
      const p = genPwd(16);
      if (!p) return toast('Parol generatsiya qilib bo\'lmadi — qayta urinib ko\'ring', 'warn');
      inp.value = p; inp.type = 'text';
      const t = inp.parentElement.querySelector('.pwd-toggle'); if (t) t.textContent = '🙈';
      let copied = false;
      try { await navigator.clipboard.writeText(p); copied = true; } catch (_) {}
      toast(copied ? 'Kuchli parol yaratildi va nusxalandi — xodimga yetkazing' : 'Kuchli parol yaratildi — nusxalab oling', 'ok');
    });
    onId('__save', 'click', async () => {
      const data = {
        fullname: ($('#uFn')||{}).value ? $('#uFn').value.trim() : '',
        login: ($('#uLg')||{}).value ? $('#uLg').value.trim().toLowerCase() : '',
        role: ($('#uRl')||{}).value || '',
        phone: (() => { const t = (($('#uPh')||{}).value || '').trim(); return t.replace(/\D/g, '').length > 3 ? t : ''; })()
      };
      if (isEdit) delete data.login;
      if (isEdit && byId('uActive')) data.active = byId('uActive').value === 'true';
      const pwd = ($('#uPwd')||{}).value || '';
      if (!data.role) return toast('Avval rolni tanlang','warn');
      if (!data.fullname || (!isEdit && !data.login)) return toast('F.I.Sh va login majburiy','warn');
      if (!isEdit && data.role === 'doctor') {
        data.specialty = ((byId('uSpec')||{}).value || '').trim();
        data.room = ((byId('uRoom')||{}).value || '').trim();
        data.price = parseInt((byId('uPrice')||{}).value, 10) || 0;
        if (!data.specialty) { const sp = byId('uSpec'); if (sp) sp.focus(); return toast('Shifokor uchun mutaxassislik majburiy','warn'); }
        if (data.price < 0) return toast('Qabul narxi manfiy bo\'lishi mumkin emas','warn');
      }
      if (!isEdit && (!pwd || pwd.length < 10)) return toast('Parol kamida 10 belgi bo\'lishi shart','warn');
      if (pwd && pwd.length < 10) return toast('Parol kamida 10 belgi bo\'lishi shart','warn');
      if (pwd) { const _miss = []; if (!/[a-z]/.test(pwd)) _miss.push('kichik harf'); if (!/[A-Z]/.test(pwd)) _miss.push('katta harf'); if (!/[0-9]/.test(pwd)) _miss.push('raqam'); if (!/[!-\/:-@\[-`{-~]/.test(pwd)) _miss.push('belgi (!@#$%...)'); if (_miss.length) return toast('Parolda bo\'lishi shart: ' + _miss.join(', '),'warn'); }
      try {
        if (isEdit) {
          const patch = Object.assign({}, data);
          if (pwd) patch.password = pwd;
          await this.store.updateUser(user.id, patch);
          toast('Xodim yangilandi','ok');
        } else {
          await this.store.addUser(Object.assign({}, data, { password: pwd }));
          toast('Xodim qo\'shildi','ok');
        }
        Modal.close();
        setTimeout(() => { this.reloadCache(); this.render(); }, 300);
      } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
    });
  },

  async userToggle(u) {
    try {
      await this.store.updateUser(u.id, { active: !u.active });
      toast(u.active ? 'Bloklandi' : 'Faollashtirildi', u.active ? 'warn' : 'ok');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300);
    } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
  },

  async userDelete(u) {
    const ok = await Modal.confirm('Xodimni o\'chirish',
      '<b>' + esc(u.fullname) + '</b> ni o\'chirishni tasdiqlaysizmi?',
      { okText: 'O\'chirish', danger: true });
    if (!ok) return;
    try {
      await this.store.deleteUser(u.id);
      toast('Xodim o\'chirildi','warn');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300);
    } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
  },

  userResetPassword(u) {
    Modal.open(
      '<div class="modal-head"><h3>🔑 Parolni tiklash</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="notice warn"><span class="ico">⚠️</span>' +
        '<div>Xodim <b>' + esc(u.fullname) + '</b> uchun yangi tasodifiy parol generatsiya qilinadi.</div></div>' +
        '<div class="field"><label>Admin parolingiz <span class="req">*</span></label>' +
        '<div class="pwd-wrap"><input class="input" id="rpPwd" type="password" autofocus>' +
        '<button type="button" class="pwd-toggle">👁️</button></div></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn danger" id="__reset">🔑 Reset</button></div>');
    $$('.pwd-toggle').forEach(b => on(b, 'click', () => {
      const i = b.parentElement.querySelector('input');
      i.type = i.type === 'text' ? 'password' : 'text';
    }));
    onId('__reset', 'click', async () => {
      const pwd = ($('#rpPwd')||{}).value || '';
      if (!pwd) return toast('Parolingizni kiriting','warn');
      const btn = byId('__reset');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
      try {
        const r = await this.store.adminResetPassword(u.id, pwd);
        Modal.close();
        Modal.open(
          '<div class="modal-head"><h3>✅ Yangi parol</h3>' +
          '<button class="close" data-close>✕</button></div>' +
          '<div class="modal-body">' +
            '<div class="notice success"><span class="ico">✅</span>' +
            '<div>Parol muvaffaqiyatli generatsiya qilindi.</div></div>' +
            '<div class="field"><label>Yangi parol</label>' +
            '<div data-tibex-csp-style="s517ff52f">' +
              '<input class="input mono" id="npOut" value="' + escAttr(r.new_password||'') + '" readonly>' +
              '<button class="btn" id="__copy">📋</button></div></div>' +
          '</div>' +
          '<div class="modal-foot"><button class="btn primary" data-close>Tushunarli</button></div>');
        onId('__copy', 'click', async () => {
          try { await navigator.clipboard.writeText(r.new_password); toast('Nusxa olindi','ok'); }
          catch (_) { toast('Nusxalab bo\'lmadi','warn'); }
        });
      } catch (e) {
        toast('Xatolik: ' + (e.message||'?'), 'bad');
        if (btn) { btn.disabled = false; btn.textContent = '🔑 Reset'; }
      }
    });
  },

  // ══════════════════════════════════════════════════════════
  // ROLES
  // ══════════════════════════════════════════════════════════
  PERMS: {
    patients:     { label:'Bemorlar', icon:'🧑', perms:['view','create','edit','delete'] },
    appointments: { label:'Qabullar', icon:'📅', perms:['view','create','edit','delete'] },
    users:        { label:'Xodimlar', icon:'👥', perms:['view','create','edit','delete'] },
    roles:        { label:'Rollar', icon:'🛡', perms:['view','create','edit','delete'] },
    doctors:      { label:'Shifokorlar', icon:'👨‍⚕️', perms:['view','create','edit','delete'] },
    services:     { label:'Xizmatlar', icon:'🩺', perms:['view','create','edit','delete'] },
    equipment:    { label:'Uskunalar', icon:'🔬', perms:['view','create','edit','delete'] },
    reagents:     { label:'Reagentlar', icon:'🧪', perms:['view','create','edit','delete'] },
    integrations: { label:'Integratsiyalar', icon:'🔌', perms:['view','create','edit','delete'] },
    lab:          { label:'Laboratoriya', icon:'🔬', perms:['view','create','edit','verify'] },
    payments:     { label:'To\'lovlar', icon:'💰', perms:['view','create','refund','close_shift'] },
    medical:      { label:'Tibbiy yozuvlar', icon:'📋', perms:['view','edit_diagnosis','edit_prescription'] },
    reports:      { label:'Hisobotlar', icon:'📈', perms:['view','export'] },
    audit:        { label:'Audit', icon:'📜', perms:['view','clear'] },
    settings:     { label:'Sozlamalar', icon:'⚙️', perms:['view','edit'] }
    ,camera:      { label:'Kamera ogohlantirishlari', icon:'📷', perms:['alert'] }
    ,portal:      { label:'Bemor portali', icon:'🌐', perms:['view','edit_profile','change_password','view_appointments','view_lab','view_payments'] }
  },

  v_roles() {
    const roles = this.cache.roles, users = this.cache.users;
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">🛡 Rollar <span class="cnt">' + roles.length + '</span></h1>' +
        '<div class="page-sub">Ruxsatlar matritsasi boshqaruvi</div></div>' +
        '<div class="page-actions"><button class="btn primary" id="rNew">➕ Yangi rol</button></div>' +
      '</div>' +
      '<div class="roles-grid">' +
      roles.map(r => {
        const isPatientRole = r.key === 'patient';
        const uc = isPatientRole ? Object.keys(this.cache.patients || {}).length : users.filter(u => u.role === r.key).length;
        const pc = r.permissions === '*' ? '∞' : (r.permissions||[]).length;
        const perms = Array.isArray(r.permissions) ? r.permissions : [];
        const prev = r.permissions === '*' ? ['to\'liq ruxsat'] : perms.slice(0,6);
        const more = r.permissions !== '*' && perms.length > 6;
        return '<div class="role-card" data-id="' + r.id + '">' +
          '<div class="head"><div class="ico">' + esc(r.icon||'👤') + '</div>' +
          '<div data-tibex-csp-style="sf2c279a7"><div class="name">' + esc(r.name) + '</div>' +
          '<div class="key">' + esc(r.key) + '</div></div>' +
          (r.system ? '<span class="status muted">TIZIM</span>' : '') + '</div>' +
          '<div class="desc">' + esc(r.description||'—') + '</div>' +
          '<div class="perms">' + prev.map(p => '<span class="perm-tag">' + esc(p) + '</span>').join('') +
          (more ? '<span class="perm-tag more">+' + (perms.length-6) + ' yana</span>' : '') + '</div>' +
          '<div class="foot"><span>👥 ' + uc + (isPatientRole ? ' bemor' : ' xodim') + ' · 🔑 ' + pc + ' ruxsat</span>' +
          '<div class="row-actions">' +
            '<button data-act="edit">✏️</button>' +
            (r.system ? '' : '<button data-act="delete" class="danger">🗑</button>') +
          '</div></div></div>';
      }).join('') +
      '</div></section>';
  },

  a_roles(root) {
    onId('rNew', 'click', () => this.roleForm());
    $$('.role-card', root).forEach(card => {
      const id = parseInt(card.dataset.id, 10);
      $$('button[data-act]', card).forEach(btn => on(btn, 'click', async e => {
        e.stopPropagation();
        if (btn.dataset.act === 'edit') this.roleForm(id);
        else if (btn.dataset.act === 'delete') await this.roleDelete(id);
      }));
    });
  },

  roleForm(id) {
    const r = id ? (this.cache.roles.find(x => x.id === id) || {}) : {};
    const isEdit = !!id;
    const perms = new Set();
    if (r.permissions === '*') {
      Object.keys(this.PERMS).forEach(m => this.PERMS[m].perms.forEach(p => perms.add(m + '.' + p)));
    } else (r.permissions||[]).forEach(p => perms.add(p));

    const grid = () => Object.keys(this.PERMS).map(m => {
      const d = this.PERMS[m];
      return '<div class="perm-group">' +
        '<div class="perm-group-head"><span>' + esc(d.icon) + ' ' + esc(d.label) +
        ' <span data-tibex-csp-style="sb2aea526">' + esc(m) + '</span></span>' +
        '<span class="mini"><button type="button" data-all="' + m + '">Hammasi</button>' +
        '<button type="button" data-none="' + m + '">Hech biri</button></span></div>' +
        '<div class="perm-group-body">' +
        d.perms.map(p => {
          const k = m + '.' + p; const on_ = perms.has(k);
          return '<label class="perm-check ' + (on_?'on':'') + '" data-perm="' + k + '">' +
            '<input type="checkbox" ' + (on_?'checked':'') + '><span>' + esc(p) + '</span></label>';
        }).join('') + '</div></div>';
    }).join('');

    Modal.open(
      '<div class="modal-head"><h3>' + (isEdit ? '✏️ Rol tahrirlash' : '🛡 Yangi rol') + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        '<div class="field"><label>Rol nomi <span class="req">*</span></label>' +
          '<input class="input" id="rName" value="' + escAttr(r.name||'') + '" autofocus></div>' +
        '<div class="field"><label>Kalit <span class="req">*</span></label>' +
          '<input class="input mono" id="rKey" value="' + escAttr(r.key||'') + '" ' +
            (isEdit && r.system ? 'disabled' : '') + '></div>' +
        '<div class="field"><label>Ikonka</label>' +
          '<input class="input" id="rIcon" value="' + escAttr(r.icon||'🔬') + '" maxlength="4"></div>' +
        '<div class="field"><label>Rang</label><select class="select" id="rColor">' +
          [['admin','🔴 Qizil'],['doctor','🔵 Ko\'k'],['reception','🟣 Binafsha'],
           ['cashier','🟡 Oltin'],['lab','💧 Moviy']].map(function(x){
            return '<option value="' + x[0] + '" ' + (r.color===x[0]?'selected':'') + '>' + x[1] + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field span-2"><label>Tavsif</label>' +
          '<textarea class="textarea" id="rDesc" rows="2">' + esc(r.description||'') + '</textarea></div>' +
      '</div>' +
      '<div data-tibex-csp-style="sd06785ec"><div data-tibex-csp-style="sdfcd93b5">🔑 Ruxsatlar matritsasi <span id="permCount" class="cnt">' + perms.size + ' tanlandi</span></div>' +
      '<input class="input" id="permSearch" placeholder="Bo‘lim yoki ruxsatni qidirish…" data-tibex-csp-style="s73915068">' +
      '<div class="notice" data-tibex-csp-style="s73915068">Har bir amal uchun tegishli <b>view</b> ruxsati ham kerak. Saqlashda tekshiriladi.</div>' +
      '<div id="permWrap">' + grid() + '</div></div></div>' +
      (isEdit ? '<label class="perm-check ' + (r.active?'on':'') + '" data-tibex-csp-style="s46af871a"><input id="rActive" type="checkbox" ' + (r.active?'checked':'') + '>Rol faol</label>' : '') +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn primary" id="__save">✓ Saqlash</button></div>',
      { size: 'xwide' });

    const bind = () => {
      $$('#permWrap .perm-check').forEach(l => on(l, 'click', e => {
        e.preventDefault();
        const k = l.dataset.perm;
        if (perms.has(k)) perms.delete(k); else perms.add(k);
        l.classList.toggle('on', perms.has(k));
        const cb = l.querySelector('input'); if (cb) cb.checked = perms.has(k);
        const n = byId('permCount'); if (n) n.textContent = perms.size + ' tanlandi';
      }));
      $$('#permWrap [data-all]').forEach(b => on(b, 'click', () => {
        const m = b.dataset.all;
        this.PERMS[m].perms.forEach(p => perms.add(m + '.' + p));
        const w = byId('permWrap'); if (w) { w.innerHTML = grid(); bind(); }
        const n = byId('permCount'); if (n) n.textContent = perms.size + ' tanlandi';
      }));
      $$('#permWrap [data-none]').forEach(b => on(b, 'click', () => {
        const m = b.dataset.none;
        this.PERMS[m].perms.forEach(p => perms.delete(m + '.' + p));
        const w = byId('permWrap'); if (w) { w.innerHTML = grid(); bind(); }
        const n = byId('permCount'); if (n) n.textContent = perms.size + ' tanlandi';
      }));
    };
    bind();
    onId('permSearch', 'input', e => {
      const q = e.target.value.trim().toLowerCase();
      $$('#permWrap .perm-group').forEach(g => { g.hidden = !g.textContent.toLowerCase().includes(q); });
    });

    onId('__save', 'click', async () => {
      const data = {
        name: ($('#rName')||{}).value ? $('#rName').value.trim() : '',
        key: ($('#rKey')||{}).value ? $('#rKey').value.trim().toLowerCase() : '',
        icon: ($('#rIcon')||{}).value ? $('#rIcon').value.trim() || '👤' : '👤',
        color: ($('#rColor')||{}).value || 'lab',
        description: ($('#rDesc')||{}).value ? $('#rDesc').value.trim() : '',
        permissions: Array.from(perms)
      };
      if (!data.name || !data.key) return toast('Nom va kalit majburiy','warn');
      if (data.key.length < 2) return toast('Kalit kamida 2 belgi','warn');
      if (!/^[a-z0-9_]+$/.test(data.key)) return toast('Kalit faqat kichik harf, raqam va _','warn');
      if (data.permissions.length === 0) return toast('Kamida 1 ruxsat tanlang','warn');
      for (const p of data.permissions) {
        const [module, action] = p.split('.');
        if (action !== 'view' && module !== 'camera' && !perms.has(module + '.view'))
          return toast(p + ' uchun ' + module + '.view ham tanlang', 'warn');
      }
      if (r.permissions === '*') {
        const full = []; Object.keys(this.PERMS).forEach(m => this.PERMS[m].perms.forEach(p => full.push(m + '.' + p)));
        if (full.every(k => perms.has(k))) data.permissions = '*';
      }
      if (isEdit) data.active = !!byId('rActive')?.checked;
      try {
        if (isEdit) await this.store.updateRole(id, data);
        else await this.store.addRole(data);
        toast(isEdit ? 'Rol yangilandi' : 'Rol qo\'shildi', 'ok');
        Modal.close();
        setTimeout(() => { this.reloadCache(); this.render(); }, 300);
      } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
    });
  },

  async roleDelete(id) {
    const r = this.cache.roles.find(x => x.id === id); if (!r) return;
    const ok = await Modal.confirm('Rolni o\'chirish',
      '<b>' + esc(r.name) + '</b> rolini o\'chirishni tasdiqlaysizmi?',
      { okText: 'O\'chirish', danger: true });
    if (!ok) return;
    try {
      const res = await this.store.deleteRole(id);
      if (res && res.error) return toast(res.error, 'bad');
      toast('Rol o\'chirildi','warn');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300);
    } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
  },

  // ══════════════════════════════════════════════════════════
  // DOCTORS
  // ══════════════════════════════════════════════════════════
  v_doctors() {
    const list = this.cache.doctors;
    const s = this.state.search;
    const specs = Array.from(new Set(list.map(d => (d.specialty||'').trim()).filter(Boolean))).sort((a, c) => a.localeCompare(c));
    let cur = this.state.dSpec || 'all';
    if (cur !== 'all' && !specs.includes(cur)) cur = 'all';
    this.state.dSpec = cur;
    let fl = cur === 'all' ? list : list.filter(d => (d.specialty||'').trim() === cur);
    if (s) fl = fl.filter(d =>
      (d.name||'').toLowerCase().includes(s) || (d.specialty||'').toLowerCase().includes(s));
    const items = [{ key:'all', icon:'👨‍⚕️', name:'Barcha shifokorlar', n: list.length }].concat(
      specs.map(sp => ({ key: sp, icon:'🩺', name: sp, n: list.filter(d => (d.specialty||'').trim() === sp).length })));
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">👨‍⚕️ Shifokorlar <span class="cnt">' + list.length + '</span></h1>' +
        '<div class="page-sub">' + (cur !== 'all' ? esc(cur) + ' mutaxassisligi bo\'yicha' : 'Faqat shifokorlar ro\'yxati') + '</div></div>' +
      '</div>' +
      '<div class="split">' + this._subMenu('Mutaxassislik', 'data-ds', items, cur) +
      '<div class="split-main"><div class="card">' +
        '<div class="card-head"><div class="card-title">' + (cur !== 'all' ? '🩺 ' + esc(cur) : '👨‍⚕️ Barcha shifokorlar') +
          ' <span class="cnt">' + fl.length + '</span></div></div>' +
        '<div class="filters"><div class="search-box">' +
        '<input type="text" id="dSearch" placeholder="Ism yoki mutaxassislik…" value="' + escAttr(this.state.search) + '"></div></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th>F.I.Sh</th><th data-tibex-csp-style="se6d71f7a">Mutaxassislik</th><th data-tibex-csp-style="sf7784277">Telefon</th>' +
          '<th data-tibex-csp-style="sf8aa7751">Narx</th><th data-tibex-csp-style="sb6a594ef">Xona</th>' +
          '<th data-tibex-csp-style="s76727e3">Holat</th><th data-tibex-csp-style="sf8aa7751"></th>' +
        '</tr></thead><tbody>' +
        (fl.length ? fl.map(d =>
          '<tr data-id="' + d.id + '">' +
          '<td><div class="cell-flex"><div class="avatar-sm">' + esc(initials(d.name)) + '</div>' +
          '<div class="cell-stack"><div class="top">' + esc(d.name||'—') + '</div></div></div></td>' +
          '<td>' + esc(d.specialty||'—') + '</td>' +
          '<td class="mono">' + esc(d.phone||'—') + '</td>' +
          '<td class="mono">' + esc(fmtMoney(d.price||0)) + '</td>' +
          '<td class="mono">' + esc(d.room||'—') + '</td>' +
          '<td>' + (d.active ? '<span class="status ok">Aktiv</span>' : '<span class="status muted">Nofaol</span>') + '</td>' +
          '<td><div class="row-actions">' +
            '<button data-act="edit">✏️</button>' +
            '<button data-act="reset" title="Parolni tiklash">🔑</button>' +
            '<button data-act="toggle">' + (d.active ? '🚫' : '✓') + '</button>' +
            '<button data-act="delete" class="danger">🗑</button>' +
          '</div></td></tr>').join('') :
        '<tr><td colspan="7"><div class="empty"><div class="ico">👨‍⚕️</div><div class="msg">Shifokorlar yo\'q</div></div></td></tr>') +
        '</tbody></table></div></div></div></div></section>';
  },

  a_doctors(root) {
    $$('[data-ds]', root).forEach(btn => on(btn, 'click', () => { this.state.dSpec = btn.dataset.ds; this.render(); }));
    onId('dSearch', 'input', debounce(e => { this.state.search = e.target.value.trim().toLowerCase(); this.render(); }, 200));
    // Parolni tiklash backendda 'users.edit' huquqini talab qiladi (POST /api/users/{id}/admin-reset-password),
    // shuning uchun tugma 'doctors.edit'ga emas, aynan 'users.edit'ga bog'lanadi.
    const canReset = this.can('users', 'edit');
    $$('button[data-act="reset"]', root).forEach(b => { b.hidden = !canReset; });
    $$('tbody tr[data-id]', root).forEach(tr => {
      const id = parseInt(tr.dataset.id, 10);
      const d = this.cache.doctors.find(x => x.id === id);
      $$('button[data-act]', tr).forEach(btn => on(btn, 'click', async e => {
        e.stopPropagation();
        if (btn.dataset.act === 'edit') this.doctorForm(d);
        else if (btn.dataset.act === 'reset') this.doctorResetPassword(d);
        else if (btn.dataset.act === 'toggle') await this.doctorToggle(d);
        else if (btn.dataset.act === 'delete') await this.doctorDelete(d);
      }));
    });
  },

  // Shifokorning login akkaunt(lar)i: avval users.doctor_id bo'yicha; bog'lanmagan bo'lsa —
  // rol=doctor va F.I.Sh mos kelgan, hech bir shifokorga bog'lanmagan akkauntlar.
  doctorAccounts(d) {
    const users = (this.cache && this.cache.users) || [];
    if (!d) return [];
    const linked = users.filter(u => u.doctor_id != null && Number(u.doctor_id) === Number(d.id));
    if (linked.length) return linked;
    const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
    const nm = norm(d.name);
    if (!nm) return [];
    return users.filter(u => u.role === 'doctor' && u.doctor_id == null && norm(u.fullname) === nm);
  },

  doctorResetPassword(d) {
    if (!d) return toast('Shifokor topilmadi — sahifani yangilang (F5)', 'warn');
    if (!this.can('users', 'edit')) return toast('Parolni tiklash uchun "Xodimlar → tahrirlash" huquqi kerak', 'warn');
    const accs = this.doctorAccounts(d);
    if (!accs.length) return toast('Bu shifokorga login akkaunt topilmadi. Avval "Xodimlar" bo\'limida rol=Shifokor bilan akkaunt yarating', 'warn');
    if (accs.length === 1) return this.userResetPassword(accs[0]);
    Modal.open(
      '<div class="modal-head"><h3>🔑 Akkauntni tanlang</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="notice warn"><span class="ico">⚠️</span>' +
      '<div><b>' + esc(d.name) + '</b> uchun bir nechta akkaunt topildi. Qaysi birining parolini tiklaymiz?</div></div>' +
      accs.map(u => '<div class="field"><button type="button" class="btn" data-uid="' + escAttr(String(u.id)) + '">' +
        esc(u.fullname || '—') + ' · ' + esc(u.login || '—') + '</button></div>').join('') +
      '</div><div class="modal-foot"><button class="btn" data-close>Bekor qilish</button></div>');
    $$('[data-uid]', byId('modalBox')).forEach(b => on(b, 'click', () => {
      const u = accs.find(x => String(x.id) === b.dataset.uid);
      if (u) this.userResetPassword(u);
    }));
  },

  doctorForm(d) {
    const isEdit = d && d.id;
    const x = d || {};
    Modal.open(
      '<div class="modal-head"><h3>' + (isEdit ? '✏️ Shifokor tahrirlash' : '👨‍⚕️ Yangi shifokor') + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        '<div class="field span-2"><label>F.I.Sh <span class="req">*</span></label>' +
          '<input class="input" id="dName" value="' + escAttr(x.name||'') + '" autofocus></div>' +
        '<div class="field"><label>Mutaxassislik <span class="req">*</span></label>' +
          '<input class="input" id="dSpec" value="' + escAttr(x.specialty||'') + '"></div>' +
        '<div class="field"><label>Telefon</label>' +
          '<input class="input" id="dPhone" value="' + escAttr(x.phone||'+998 ') + '"></div>' +
        '<div class="field"><label>Narx (so\'m)</label>' +
          '<input class="input" id="dPrice" type="number" min="0" value="' + (x.price||0) + '"></div>' +
        '<div class="field"><label>Xona</label>' +
          '<input class="input" id="dRoom" value="' + escAttr(x.room||'') + '"></div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn primary" id="__save">✓ Saqlash</button></div>');
    onId('__save', 'click', async () => {
      const data = {
        name: ($('#dName')||{}).value ? $('#dName').value.trim() : '',
        specialty: ($('#dSpec')||{}).value ? $('#dSpec').value.trim() : '',
        phone: (() => { const t = (($('#dPhone')||{}).value || '').trim(); return t.replace(/\D/g, '').length > 3 ? t : ''; })(),
        price: parseInt(($('#dPrice')||{}).value, 10) || 0,
        room: ($('#dRoom')||{}).value ? $('#dRoom').value.trim() : ''
      };
      if (!data.name || !data.specialty) return toast('Nom va mutaxassislik majburiy','warn');
      try {
        if (isEdit) await this.store.updateDoctor(x.id, data);
        else await this.store.addDoctor(data).ready;
        toast('Saqlandi','ok'); Modal.close();
        setTimeout(() => { this.reloadCache(); this.render(); }, 300);
      } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
    });
  },

  async doctorToggle(d) {
    try { await this.store.updateDoctor(d.id, { active: !d.active });
      toast('Saqlandi','ok');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300); }
    catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
  },

  async doctorDelete(d) {
    const ok = await Modal.confirm('Shifokorni o\'chirish',
      '<b>' + esc(d.name) + '</b> ni o\'chirishni tasdiqlaysizmi?',
      { okText: 'O\'chirish', danger: true });
    if (!ok) return;
    try { await this.store.deleteDoctor(d.id); toast('O\'chirildi','warn');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300); }
    catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); this.reloadCache(); this.render(); }
  },

  // ══════════════════════════════════════════════════════════
  // SERVICES
  // ══════════════════════════════════════════════════════════
  v_services() {
    const list = this.cache.services;
    const s = this.state.search;
    let fl = list;
    if (s) fl = fl.filter(x =>
      (x.name||'').toLowerCase().includes(s) || (x.code||'').toLowerCase().includes(s));
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">🩺 Xizmatlar <span class="cnt">' + list.length + '</span></h1>' +
        '<div class="page-sub">Klinika xizmatlari va narxlar</div></div>' +
        '<div class="page-actions"><button class="btn primary" id="sNew">➕ Yangi xizmat</button></div>' +
      '</div><div class="card">' +
        '<div class="filters"><div class="search-box">' +
        '<input type="text" id="sSearch" placeholder="Kod yoki nom…" value="' + escAttr(this.state.search) + '"></div></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th data-tibex-csp-style="sf8aa7751">Kod</th><th>Nomi</th><th data-tibex-csp-style="se6d71f7a">Kategoriya</th>' +
          '<th data-tibex-csp-style="s29ab0b27">Narx</th>' +
          '<th data-tibex-csp-style="s76727e3">Holat</th><th data-tibex-csp-style="sd5a4d170"></th>' +
        '</tr></thead><tbody>' +
        (fl.length ? fl.map(x =>
          '<tr data-id="' + x.id + '">' +
          '<td class="mono" data-tibex-csp-style="s6cba6726">' + esc(x.code||'—') + '</td>' +
          '<td><b>' + esc(x.name||'—') + '</b></td>' +
          '<td>' + esc(x.category||'—') + '</td>' +
          '<td data-tibex-csp-style="s826d32fa" class="mono">' + esc(fmtMoney(x.price||0)) + '</td>' +
          '<td>' + (x.active ? '<span class="status ok">Aktiv</span>' : '<span class="status muted">Nofaol</span>') + '</td>' +
          '<td><div class="row-actions">' +
            '<button data-act="edit">✏️</button>' +
            '<button data-act="delete" class="danger">🗑</button>' +
          '</div></td></tr>').join('') :
        '<tr><td colspan="6"><div class="empty"><div class="ico">🩺</div><div class="msg">Xizmatlar yo\'q</div></div></td></tr>') +
        '</tbody></table></div></div></section>';
  },

  a_services(root) {
    onId('sNew', 'click', () => this.serviceForm());
    onId('sSearch', 'input', debounce(e => { this.state.search = e.target.value.trim().toLowerCase(); this.render(); }, 200));
    $$('tbody tr[data-id]', root).forEach(tr => {
      const id = parseInt(tr.dataset.id, 10);
      const s = this.cache.services.find(x => x.id === id);
      $$('button[data-act]', tr).forEach(btn => on(btn, 'click', async e => {
        e.stopPropagation();
        if (btn.dataset.act === 'edit') this.serviceForm(s);
        else if (btn.dataset.act === 'delete') await this.serviceDelete(s);
      }));
    });
  },

  serviceForm(s) {
    const isEdit = s && s.id;
    const x = s || {};
    Modal.open(
      '<div class="modal-head"><h3>' + (isEdit ? '✏️ Xizmat tahrirlash' : '🩺 Yangi xizmat') + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        '<div class="field"><label>Kod <span class="req">*</span></label>' +
          '<input class="input mono" id="sCode" value="' + escAttr(x.code||'') + '" ' +
            (isEdit ? 'disabled' : '') + ' autofocus></div>' +
        '<div class="field"><label>Kategoriya <span class="req">*</span></label>' +
          '<input class="input" id="sCat" value="' + escAttr(x.category||'Konsultatsiya') + '"></div>' +
        '<div class="field span-2"><label>Nomi <span class="req">*</span></label>' +
          '<input class="input" id="sName" value="' + escAttr(x.name||'') + '"></div>' +
        '<div class="field span-2"><label>Narx (so\'m) <span class="req">*</span></label>' +
          '<input class="input" id="sPrice" type="number" min="0" value="' + (x.price||0) + '"></div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn primary" id="__save">✓ Saqlash</button></div>');
    onId('__save', 'click', async () => {
      const data = {
        code: ($('#sCode')||{}).value ? $('#sCode').value.trim() : '',
        category: ($('#sCat')||{}).value ? $('#sCat').value.trim() : '',
        name: ($('#sName')||{}).value ? $('#sName').value.trim() : '',
        price: parseInt(($('#sPrice')||{}).value, 10) || 0
      };
      if (!data.code || !data.name) return toast('Kod va nom majburiy','warn');
      try {
        if (isEdit) await this.store.updateService(x.id, data);
        else await this.store.addService(data).ready;
        toast('Saqlandi','ok'); Modal.close();
        setTimeout(() => { this.reloadCache(); this.render(); }, 300);
      } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
    });
  },

  async serviceDelete(s) {
    const ok = await Modal.confirm('Xizmatni o\'chirish',
      '<b>' + esc(s.name) + '</b> ni o\'chirishni tasdiqlaysizmi?',
      { okText: 'O\'chirish', danger: true });
    if (!ok) return;
    try { await this.store.deleteService(s.id); toast('O\'chirildi','warn');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300); }
    catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); this.reloadCache(); this.render(); }
  },

  // ══════════════════════════════════════════════════════════
  // EQUIPMENT
  // ══════════════════════════════════════════════════════════
  _eqInfo(s) {
    return {
      working:{icon:'🟢',label:'Ishlaydi',cls:'ok'},
      calibration:{icon:'🟡',label:'Kalibrovka',cls:'warn'},
      maintenance:{icon:'🟣',label:'Ta\'mirda',cls:'purple'},
      broken:{icon:'🔴',label:'Nosoz',cls:'err'},
      offline:{icon:'⚫',label:'O\'chirilgan',cls:'muted'}
    }[s] || {icon:'⚪',label:'—',cls:'muted'};
  },

  // Sozlamalar (admin): tumbler hali yuklanmagan bo'lsa — yoqilgan hisoblanadi.
  _settingOn(key) {
    const st = (this.store && this.store._settingsCache) || {};
    return st[key] !== false;
  },
  _serviceDays(e) {
    if (!e || !e.next_service || e.status === 'offline') return null;
    const t = new Date(e.next_service).getTime();
    return isNaN(t) ? null : Math.floor((t - Date.now()) / 86400000);
  },
  _isServiceDue(e) { const d = this._serviceDays(e); return d !== null && d < 30; },
  _isLowReagent(r) { return (r.stock||0) < (r.min_stock||0); },

  v_equipment() {
    const svcOn = this._settingOn('equipService');
    const list = this.cache.equipment;
    let fl = list;
    if (this.state.eFilter !== 'all') fl = fl.filter(e => e.status === this.state.eFilter);
    const s = this.state.search;
    if (s) fl = fl.filter(e =>
      (e.name||'').toLowerCase().includes(s) || (e.model||'').toLowerCase().includes(s));
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">🔬 Uskunalar <span class="cnt">' + list.length + '</span></h1>' +
        '<div class="page-sub">Tibbiy uskunalar holati</div></div>' +
        '<div class="page-actions"><button class="btn primary" id="eNew">➕ Yangi uskuna</button></div>' +
      '</div><div class="card">' +
        '<div class="filters"><div class="search-box">' +
          '<input type="text" id="eSearch" placeholder="Nomi, model…" value="' + escAttr(this.state.search) + '"></div>' +
          '<button class="chip ' + (this.state.eFilter==='all'?'on':'') + '" data-ef="all">Barchasi <span class="n">' + list.length + '</span></button>' +
          '<button class="chip ' + (this.state.eFilter==='working'?'on':'') + '" data-ef="working">🟢 Ishlaydi</button>' +
          '<button class="chip ' + (this.state.eFilter==='calibration'?'on':'') + '" data-ef="calibration">🟡 Kalibrovka</button>' +
          '<button class="chip ' + (this.state.eFilter==='maintenance'?'on':'') + '" data-ef="maintenance">🟣 Ta\'mirda</button>' +
          '<button class="chip ' + (this.state.eFilter==='broken'?'on':'') + '" data-ef="broken">🔴 Nosoz</button>' +
          '<button class="chip ' + (this.state.eFilter==='offline'?'on':'') + '" data-ef="offline">⚫ O\'chirilgan</button>' +
        '</div>' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th>Uskuna</th><th data-tibex-csp-style="sd4729c96">Kategoriya</th><th data-tibex-csp-style="sd5a4d170">Seriya</th>' +
          '<th data-tibex-csp-style="sf8aa7751">Keyingi xizmat</th><th data-tibex-csp-style="sf8aa7751">Holat</th><th data-tibex-csp-style="sd5a4d170"></th>' +
        '</tr></thead><tbody>' +
        (fl.length ? fl.map(e => {
          const info = this._eqInfo(e.status);
          const sd = svcOn ? this._serviceDays(e) : null;
          const svcTag = sd === null || sd >= 30 ? '' :
            (sd < 0 ? ' <span class="status err">⛔ ' + Math.abs(sd) + ' kun o\'tdi</span>'
                    : ' <span class="status warn">⏰ ' + sd + ' kun</span>');
          return '<tr data-id="' + e.id + '">' +
            '<td><div class="cell-stack"><div class="top">' + esc(e.name||'—') + '</div>' +
              '<div class="sub">' + esc(e.manufacturer||'') + ' ' + esc(e.model||'') + '</div></div></td>' +
            '<td>' + esc(e.category||'—') + '</td>' +
            '<td class="mono" data-tibex-csp-style="s60c6a7e3">' + esc(e.serial||'—') + '</td>' +
            '<td class="mono" data-tibex-csp-style="s60c6a7e3">' + esc(fmtDate(e.next_service)) + svcTag + '</td>' +
            '<td><span class="status ' + info.cls + '">' + info.icon + ' ' + info.label + '</span></td>' +
            '<td><div class="row-actions">' +
              '<button data-act="edit">✏️</button>' +
              '<button data-act="delete" class="danger">🗑</button>' +
            '</div></td></tr>';
        }).join('') :
        '<tr><td colspan="6"><div class="empty"><div class="ico">🔬</div><div class="msg">Uskunalar yo\'q</div></div></td></tr>') +
        '</tbody></table></div></div></section>';
  },

  a_equipment(root) {
    onId('eNew', 'click', () => this.equipmentForm());
    onId('eSearch', 'input', debounce(e => { this.state.search = e.target.value.trim().toLowerCase(); this.render(); }, 200));
    $$('[data-ef]', root).forEach(b => on(b, 'click', () => { this.state.eFilter = b.dataset.ef; this.render(); }));
    $$('tbody tr[data-id]', root).forEach(tr => {
      const id = parseInt(tr.dataset.id, 10);
      const e = this.cache.equipment.find(x => x.id === id);
      $$('button[data-act]', tr).forEach(btn => on(btn, 'click', async ev => {
        ev.stopPropagation();
        if (btn.dataset.act === 'edit') this.equipmentForm(e);
        else if (btn.dataset.act === 'delete') await this.equipmentDelete(e);
      }));
    });
  },

  equipmentForm(e) {
    const isEdit = e && e.id;
    const x = e || {};
    Modal.open(
      '<div class="modal-head"><h3>' + (isEdit ? '✏️ Uskuna tahrirlash' : '🔬 Yangi uskuna') + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        '<div class="field span-2"><label>Nomi <span class="req">*</span></label>' +
          '<input class="input" id="eqName" value="' + escAttr(x.name||'') + '" autofocus></div>' +
        '<div class="field"><label>Kategoriya</label>' +
          '<input class="input" id="eqCat" value="' + escAttr(x.category||'Analizator') + '"></div>' +
        '<div class="field"><label>Bo\'lim</label>' +
          '<input class="input" id="eqDept" value="' + escAttr(x.department||'Laboratoriya') + '"></div>' +
        '<div class="field"><label>Ishlab chiqaruvchi</label>' +
          '<input class="input" id="eqManuf" value="' + escAttr(x.manufacturer||'') + '"></div>' +
        '<div class="field"><label>Model</label>' +
          '<input class="input" id="eqModel" value="' + escAttr(x.model||'') + '"></div>' +
        '<div class="field"><label>Seriya</label>' +
          '<input class="input" id="eqSerial" value="' + escAttr(x.serial||'') + '"></div>' +
        '<div class="field"><label>Joylashuv</label>' +
          '<input class="input" id="eqLoc" value="' + escAttr(x.location||'') + '"></div>' +
        '<div class="field"><label>Holat</label><select class="select" id="eqStatus">' +
          [['working','🟢 Ishlaydi'],['calibration','🟡 Kalibrovka'],
           ['maintenance','🟣 Ta\'mirda'],['broken','🔴 Nosoz'],['offline','⚫ O\'chirilgan']]
          .map(function(o){ return '<option value="' + o[0] + '" ' + (x.status===o[0]?'selected':'') + '>' + o[1] + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>Sotib olingan sana</label>' +
          '<input class="input" id="eqPurchase" type="date" value="' + escAttr(x.purchase_date||'') + '"></div>' +
        '<div class="field"><label>Kafolat tugashi</label>' +
          '<input class="input" id="eqWarranty" type="date" value="' + escAttr(x.warranty||'') + '"></div>' +
        '<div class="field"><label>Oxirgi xizmat</label>' +
          '<input class="input" id="eqLast" type="date" value="' + escAttr(x.last_service||'') + '"></div>' +
        '<div class="field"><label>Keyingi xizmat</label>' +
          '<input class="input" id="eqNext" type="date" value="' + escAttr(x.next_service||'') + '"></div>' +
        '<div class="field span-2"><label>Izoh</label>' +
          '<textarea class="textarea" id="eqNotes" rows="2">' + esc(x.notes||'') + '</textarea></div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn primary" id="__save">✓ Saqlash</button></div>', { size:'wide' });
    onId('__save', 'click', async () => {
      const data = {
        name: ($('#eqName')||{}).value ? $('#eqName').value.trim() : '',
        category: ($('#eqCat')||{}).value ? $('#eqCat').value.trim() : '',
        department: ($('#eqDept')||{}).value ? $('#eqDept').value.trim() : '',
        manufacturer: ($('#eqManuf')||{}).value ? $('#eqManuf').value.trim() : '',
        model: ($('#eqModel')||{}).value ? $('#eqModel').value.trim() : '',
        serial: ($('#eqSerial')||{}).value ? $('#eqSerial').value.trim() : '',
        location: ($('#eqLoc')||{}).value ? $('#eqLoc').value.trim() : '',
        status: ($('#eqStatus')||{}).value || 'working',
        purchase_date: ($('#eqPurchase')||{}).value || '',
        warranty: ($('#eqWarranty')||{}).value || '',
        last_service: ($('#eqLast')||{}).value || '',
        next_service: ($('#eqNext')||{}).value || '',
        notes: ($('#eqNotes')||{}).value ? $('#eqNotes').value.trim() : ''
      };
      if (!data.name) return toast('Nom majburiy','warn');
      try {
        if (isEdit) await this.store.updateEquipment(x.id, data);
        else await this.store.addEquipment(data).ready;
        toast('Saqlandi','ok'); Modal.close();
        setTimeout(() => { this.reloadCache(); this.render(); }, 300);
      } catch (err) { toast('Xatolik: ' + (err.message||'?'), 'bad'); }
    });
  },

  async equipmentDelete(e) {
    const ok = await Modal.confirm('Uskunani o\'chirish',
      '<b>' + esc(e.name) + '</b> ni o\'chirishni tasdiqlaysizmi?',
      { okText: 'O\'chirish', danger: true });
    if (!ok) return;
    try { await this.store.deleteEquipment(e.id); toast('O\'chirildi','warn');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300); }
    catch (err) { this.reloadCache(); this.render(); }
  },

  // ══════════════════════════════════════════════════════════
  // REAGENTS
  // ══════════════════════════════════════════════════════════
  v_reagents() {
    const list = this.cache.reagents;
    const s = this.state.search;
    const today = Date.now();
    const isLow = r => (r.stock||0) < (r.min_stock||0);
    const isExpiring = r => r.expiry && new Date(r.expiry).getTime() < today + 30*86400000;
    const alertOn = this._settingOn('reagentAlert');
    const lowList = list.filter(isLow);
    let fl = list;
    if (this.state.rFilter === 'low') fl = fl.filter(isLow);
    if (this.state.rFilter === 'expiring') fl = fl.filter(isExpiring);
    if (s) fl = fl.filter(r =>
      (r.name||'').toLowerCase().includes(s) || (r.supplier||'').toLowerCase().includes(s) ||
      (r.lot||'').toLowerCase().includes(s));
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">🧪 Reagentlar <span class="cnt">' + list.length + '</span></h1>' +
        '<div class="page-sub">Reagentlar va sarf materiallari</div></div>' +
        '<div class="page-actions"><button class="btn primary" id="rNew">➕ Yangi reagent</button></div>' +
      '</div>' +
      (alertOn && lowList.length ?
        '<div class="notice warn"><span class="ico">⚠</span>' +
        '<div>Minimal zaxiradan kam reagentlar (' + lowList.length + '): ' +
        esc(lowList.slice(0, 5).map(r => r.name).join(', ')) + (lowList.length > 5 ? ' …' : '') + '</div></div>' : '') +
      '<div class="card">' +
        '<div class="filters"><div class="search-box">' +
          '<input type="text" id="rgSearch" placeholder="Reagent nomi, lot yoki yetkazib beruvchi…" value="' + escAttr(this.state.search) + '"></div>' +
          '<button class="chip ' + (this.state.rFilter==='all'?'on':'') + '" data-rf="all">Barchasi <span class="n">' + list.length + '</span></button>' +
          '<button class="chip ' + (this.state.rFilter==='low'?'on':'') + '" data-rf="low">⚠ Kam qolgan <span class="n">' + list.filter(isLow).length + '</span></button>' +
          '<button class="chip ' + (this.state.rFilter==='expiring'?'on':'') + '" data-rf="expiring">⏰ Muddati yaqin <span class="n">' + list.filter(isExpiring).length + '</span></button>' +
        '</div>' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th data-tibex-csp-style="sc9acb4a0">ID</th><th>Reagent</th><th data-tibex-csp-style="sd4729c96">Kategoriya</th>' +
          '<th data-tibex-csp-style="se6d71f7a">Qoldiq</th><th data-tibex-csp-style="s76727e3">Lot</th>' +
          '<th data-tibex-csp-style="sf8aa7751">Yaroqlilik</th><th data-tibex-csp-style="sf7784277">Yetkazib beruvchi</th>' +
          '<th data-tibex-csp-style="s76727e3"></th>' +
        '</tr></thead><tbody>' +
        (fl.length ? fl.map(r => {
          const low = isLow(r);
          const pct = r.min_stock ? Math.max(0, Math.min(100, Math.round(((r.stock||0)/(r.min_stock*2))*100))) : 100;
          const ed = r.expiry ? Math.floor((new Date(r.expiry).getTime() - today)/86400000) : null;
          let ec = '—';
          if (r.expiry) {
            if (ed < 0) ec = '<span class="status err">⛔ Muddati o\'tgan</span>';
            else if (ed < 30) ec = '<span class="status warn">⏰ ' + ed + ' kun</span>';
            else ec = esc(fmtDate(r.expiry));
          }
          return '<tr data-id="' + r.id + '">' +
            '<td class="mono" data-tibex-csp-style="se7f1b30e">#' + r.id + '</td>' +
            '<td><div class="cell-stack"><div class="top">' + esc(r.name||'—') + '</div>' +
              (r.supplier ? '<div class="sub">' + esc(r.supplier) + '</div>' : '') + '</div></td>' +
            '<td>' + esc(r.category||'—') + '</td>' +
            '<td><div data-tibex-csp-style="sa6166bd1">' +
              '<div data-tibex-csp-style="s337997a8">' +
                '<div data-tibex-meter="' + (low?'danger':'success') + '-' + pct + '"></div>' +
              '</div>' +
              '<span class="mono" data-tibex-csp-style="s25228415">' +
                (r.stock||0) + '/' + (r.min_stock||0) + ' ' + esc(r.unit||'') + '</span>' +
            '</div></td>' +
            '<td class="mono" data-tibex-csp-style="s60c6a7e3">' + esc(r.lot||'—') + '</td>' +
            '<td data-tibex-csp-style="s959ee20f">' + ec + '</td>' +
            '<td data-tibex-csp-style="s959ee20f">' + esc(r.supplier||'—') + '</td>' +
            '<td><div class="row-actions">' +
              '<button data-act="edit">✏️</button>' +
              '<button data-act="delete" class="danger">🗑</button>' +
            '</div></td></tr>';
        }).join('') :
        '<tr><td colspan="8"><div class="empty"><div class="ico">🧪</div><div class="msg">Reagentlar yo\'q</div></div></td></tr>') +
        '</tbody></table></div></div></section>';
  },

  a_reagents(root) {
    onId('rNew', 'click', () => this.reagentForm());
    onId('rgSearch', 'input', debounce(e => { this.state.search = e.target.value.trim().toLowerCase(); this.render(); }, 200));
    $$('[data-rf]', root).forEach(b => on(b, 'click', () => { this.state.rFilter = b.dataset.rf; this.render(); }));
    $$('tbody tr[data-id]', root).forEach(tr => {
      const id = parseInt(tr.dataset.id, 10);
      const r = this.cache.reagents.find(x => x.id === id);
      $$('button[data-act]', tr).forEach(btn => on(btn, 'click', async e => {
        e.stopPropagation();
        if (btn.dataset.act === 'edit') this.reagentForm(r);
        else if (btn.dataset.act === 'delete') await this.reagentDelete(r);
      }));
    });
  },

  reagentForm(r) {
    const isEdit = r && r.id;
    const x = r || {};
    Modal.open(
      '<div class="modal-head"><h3>' + (isEdit ? '✏️ Reagent tahrirlash' : '🧪 Yangi reagent') + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        '<div class="field span-2"><label>Nomi <span class="req">*</span></label>' +
          '<input class="input" id="rgName" value="' + escAttr(x.name||'') + '" autofocus></div>' +
        '<div class="field"><label>Kategoriya</label>' +
          '<input class="input" id="rgCat" value="' + escAttr(x.category||'Gematologiya') + '"></div>' +
        '<div class="field"><label>Birlik</label>' +
          '<input class="input" id="rgUnit" value="' + escAttr(x.unit||'ml') + '"></div>' +
        '<div class="field"><label>Qoldiq</label>' +
          '<input class="input" id="rgStock" type="number" step="0.1" value="' + (x.stock||0) + '"></div>' +
        '<div class="field"><label>Min. zaxira</label>' +
          '<input class="input" id="rgMin" type="number" step="0.1" value="' + (x.min_stock||0) + '"></div>' +
        '<div class="field"><label>Lot raqami</label>' +
          '<input class="input" id="rgLot" value="' + escAttr(x.lot||'') + '"></div>' +
        '<div class="field"><label>Yaroqlilik</label>' +
          '<input class="input" id="rgExp" type="date" value="' + escAttr(x.expiry||'') + '"></div>' +
        '<div class="field span-2"><label>Yetkazib beruvchi</label>' +
          '<input class="input" id="rgSup" value="' + escAttr(x.supplier||'') + '"></div>' +
        '<div class="field span-2"><label>Izoh</label>' +
          '<textarea class="textarea" id="rgNotes" rows="2">' + esc(x.notes||'') + '</textarea></div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn primary" id="__save">✓ Saqlash</button></div>');
    onId('__save', 'click', async () => {
      const data = {
        name: ($('#rgName')||{}).value ? $('#rgName').value.trim() : '',
        category: ($('#rgCat')||{}).value ? $('#rgCat').value.trim() : '',
        unit: ($('#rgUnit')||{}).value ? $('#rgUnit').value.trim() : '',
        stock: parseFloat(($('#rgStock')||{}).value) || 0,
        min_stock: parseFloat(($('#rgMin')||{}).value) || 0,
        lot: ($('#rgLot')||{}).value ? $('#rgLot').value.trim() : '',
        expiry: ($('#rgExp')||{}).value || '',
        supplier: ($('#rgSup')||{}).value ? $('#rgSup').value.trim() : '',
        notes: ($('#rgNotes')||{}).value ? $('#rgNotes').value.trim() : ''
      };
      if (!data.name) return toast('Nom majburiy','warn');
      try {
        if (isEdit) await this.store.updateReagent(x.id, data);
        else await this.store.addReagent(data).ready;
        toast('Saqlandi','ok'); Modal.close();
        setTimeout(() => { this.reloadCache(); this.render(); }, 300);
      } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
    });
  },

  async reagentDelete(r) {
    const ok = await Modal.confirm('Reagentni o\'chirish',
      '<b>' + esc(r.name) + '</b> ni o\'chirishni tasdiqlaysizmi?',
      { okText: 'O\'chirish', danger: true });
    if (!ok) return;
    try { await this.store.deleteReagent(r.id); toast('O\'chirildi','warn');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300); }
    catch (e) { this.reloadCache(); this.render(); }
  },

  // ══════════════════════════════════════════════════════════
  // INTEGRATIONS
  // ══════════════════════════════════════════════════════════
  INT_TYPES: [
    {key:'website',label:'🌐 Veb-sayt'},{key:'mobile_app',label:'📱 Mobil ilova'},
    {key:'ai_model',label:'🤖 AI model'},{key:'device',label:'🔬 Tibbiy qurilma'},
    {key:'payment',label:'💳 To\'lov tizimi'},
    {key:'telegram',label:'✈️ Telegram bot'},{key:'webhook',label:'🔗 Webhook'},
    {key:'database',label:'🗄 Ma\'lumotlar bazasi'},{key:'other',label:'📦 Boshqa'}
  ],

  v_integrations() {
    const list = this.cache.integrations;
    const s = this.state.search;
    let fl = list;
    if (s) fl = fl.filter(i =>
      (i.name||'').toLowerCase().includes(s) || (i.provider||'').toLowerCase().includes(s));
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">🔌 Integratsiyalar <span class="cnt">' + list.length + '</span></h1>' +
        '<div class="page-sub">Tashqi tizimlar va ulanishlar</div></div>' +
        '<div class="page-actions"><button class="btn primary" id="iNew">➕ Yangi integratsiya</button></div>' +
      '</div><div class="card">' +
        '<div class="filters"><div class="search-box">' +
          '<input type="text" id="iSearch" placeholder="Nomi yoki provayder…" value="' + escAttr(this.state.search) + '"></div></div>' +
        '<div class="card-body">' +
        (fl.length ? '<div class="integrations-grid">' + fl.map(it => {
          const t = this.INT_TYPES.find(x => x.key === it.type) || {label:'📦 ' + (it.type||'')};
          const icon = (t.label||'').split(' ')[0] || '🔌';
          const cls = it.status === 'connected' ? 'ok' :
                      it.status === 'error' ? 'err' :
                      it.status === 'pending' ? 'warn' : 'muted';
          const tx = {connected:'Ulangan',error:'Xatolik',
                       pending:'Kutilmoqda',disconnected:'Uzilgan'}[it.status] || it.status;
          const known = this.INT_TYPES.some(x => x.key === it.type);
          const canEdit = known && this.can('integrations', 'edit');
          const canDel = this.can('integrations', 'delete');
          return '<div class="int-card" data-id="' + it.id + '">' +
            '<div class="head"><div class="ico">' + icon + '</div>' +
              '<span class="status ' + cls + '">' + esc(tx) + '</span></div>' +
            '<div class="name">' + esc(it.name||'—') + '</div>' +
            '<div data-tibex-csp-style="s543fabb0">' + esc(t.label) + ' · ' + esc(it.provider||'—') + '</div>' +
            (it.endpoint ? '<div class="meta">' + esc(it.endpoint) + '</div>' : '') +
            '<div class="foot"><span data-tibex-csp-style="sca131d80">' +
              (it.last_sync ? '🔄 ' + esc(fmtDT(it.last_sync)) : '⏳ Sinxronlanmagan') + '</span>' +
            '<div class="row-actions">' +
              (canEdit ? '<button data-act="sync">🔄</button>' : '') +
              (canEdit ? '<button data-act="edit">✏️</button>' : '') +
              (canDel ? '<button data-act="delete" class="danger">🗑</button>' : '') +
            '</div></div></div>';
        }).join('') + '</div>' :
        '<div class="empty"><div class="ico">🔌</div><div class="msg">Integratsiyalar yo\'q</div></div>') +
        '</div></div></section>';
  },

  a_integrations(root) {
    onId('iNew', 'click', () => this.integrationForm());
    onId('iSearch', 'input', debounce(e => { this.state.search = e.target.value.trim().toLowerCase(); this.render(); }, 200));
    $$('.int-card', root).forEach(card => {
      const id = parseInt(card.dataset.id, 10);
      const it = this.cache.integrations.find(x => x.id === id);
      $$('button[data-act]', card).forEach(btn => on(btn, 'click', async e => {
        e.stopPropagation();
        const a = btn.dataset.act;
        if (a === 'edit') this.integrationForm(it);
        else if (a === 'delete') await this.integrationDelete(it);
        else if (a === 'sync') {
          if (!this.can('integrations', 'edit')) return;
          btn.disabled = true;
          // Xato xabarini store ko'rsatadi; muvaffaqiyatda faqat shu yerda "Sinxronlandi".
          try { await this.store.syncIntegration(id); toast('Sinxronlandi','ok'); }
          catch (err) { /* store toast chiqargan */ }
          setTimeout(() => { this.reloadCache(); this.render(); }, 300);
        }
      }));
    });
  },

  integrationForm(it) {
    const isEdit = it && it.id;
    const x = it || {};
    if (isEdit && !this.INT_TYPES.some(t => t.key === x.type)) {
      return toast('Bu turdagi integratsiyani tahrirlab bo\'lmaydi, faqat o\'chirish mumkin','warn');
    }
    const curType = x.type || 'website';
    const curStatus = x.status || 'pending';
    const statusOpts = [['connected','🟢 Ulangan'],['pending','🟡 Kutilmoqda'],
           ['disconnected','⚫ Uzilgan'],['error','🔴 Xatolik']];
    if (!statusOpts.some(o => o[0] === curStatus)) statusOpts.push([curStatus, curStatus]);
    Modal.open(
      '<div class="modal-head"><h3>' + (isEdit ? '✏️ Integratsiya tahrirlash' : '🔌 Yangi integratsiya') + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        '<div class="field span-2"><label>Nomi <span class="req">*</span></label>' +
          '<input class="input" id="iName" value="' + escAttr(x.name||'') + '" autofocus></div>' +
        '<div class="field"><label>Turi</label><select class="select" id="iType">' +
          this.INT_TYPES.map(t => '<option value="' + escAttr(t.key) + '" ' +
            (curType===t.key?'selected':'') + '>' + esc(t.label) + '</option>').join('') +
        '</select></div>' +
        '<div class="field"><label>Status</label><select class="select" id="iStatus">' +
          statusOpts
          .map(function(o){ return '<option value="' + escAttr(o[0]) + '" ' + (curStatus===o[0]?'selected':'') + '>' + esc(o[1]) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>Provayder</label>' +
          '<input class="input" id="iProvider" value="' + escAttr(x.provider||'') + '"></div>' +
        '<div class="field"><label>Versiya</label>' +
          '<input class="input" id="iVersion" value="' + escAttr(x.version||'') + '"></div>' +
        '<div class="field span-2"><label>Endpoint</label>' +
          '<input class="input mono" id="iEndpoint" value="' + escAttr(x.endpoint||'') + '" placeholder="https://...  yoki qurilma: tcp://192.168.1.20:2575"></div>' +
        '<div class="field span-2"><label>API kalit</label>' +
          '<input class="input mono" id="iApiKey" value="" placeholder="' + (isEdit && x.has_api_key ? 'Saqlangan — o\'zgartirish uchun yangisini kiriting' : '') + '"></div>' +
        (isEdit && x.has_api_key ?
          '<div class="field span-2"><label><input type="checkbox" id="iApiClear"> Saqlangan API kalitni o\'chirish</label></div>' : '') +
        '<div class="field span-2"><label>Izoh</label>' +
          '<textarea class="textarea" id="iNotes" rows="2">' + esc(x.notes||'') + '</textarea></div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn primary" id="__save">✓ Saqlash</button></div>', { size:'wide' });
    onId('__save', 'click', async () => {
      const data = {
        name: ($('#iName')||{}).value ? $('#iName').value.trim() : '',
        type: ($('#iType')||{}).value || 'website',
        status: ($('#iStatus')||{}).value || 'pending',
        provider: ($('#iProvider')||{}).value ? $('#iProvider').value.trim() : '',
        version: ($('#iVersion')||{}).value ? $('#iVersion').value.trim() : '',
        endpoint: ($('#iEndpoint')||{}).value ? $('#iEndpoint').value.trim() : '',
        api_key: ($('#iApiKey')||{}).value ? $('#iApiKey').value.trim() : '',
        notes: ($('#iNotes')||{}).value ? $('#iNotes').value.trim() : ''
      };
      if (!data.name) return toast('Nom majburiy','warn');
      if (isEdit && !data.api_key) {
        // Yangi kalit kiritilmasa: belgi qo'yilgan bo'lsa saqlangan kalit o'chadi, aks holda o'zgarmaydi.
        const clr = $('#iApiClear');
        if (clr && clr.checked) data.api_key = ''; else delete data.api_key;
      }
      try {
        if (isEdit) await this.store.updateIntegration(x.id, data);
        else await this.store.addIntegration(data).ready;
        toast('Saqlandi','ok'); Modal.close();
        setTimeout(() => { this.reloadCache(); this.render(); }, 300);
      } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
    });
  },

  async integrationDelete(it) {
    const ok = await Modal.confirm('Integratsiyani o\'chirish',
      '<b>' + esc(it.name) + '</b> ni o\'chirishni tasdiqlaysizmi?',
      { okText: 'O\'chirish', danger: true });
    if (!ok) return;
    try { await this.store.deleteIntegration(it.id); toast('O\'chirildi','warn');
      setTimeout(() => { this.reloadCache(); this.render(); }, 300); }
    catch (e) { this.reloadCache(); this.render(); }
  },

  // ══════════════════════════════════════════════════════════
  // MEDICAL
  // ══════════════════════════════════════════════════════════
  v_medical() {
    const list = this.cache.appointments.slice().sort((a,b) => (b.id||0) - (a.id||0));
    let fl = list;
    if (this.state.mFilter === 'completed') fl = fl.filter(a => a.status === 'completed');
    const s = this.state.search;
    if (s) fl = fl.filter(a => {
      const p = this.cache.patients[String(a.patient_id)];
      return (p && (p.fullname||'').toLowerCase().includes(s)) ||
        (a.doctor_name||'').toLowerCase().includes(s);
    });
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">📋 Tibbiy yozuvlar <span class="cnt">' + list.length + '</span></h1>' +
        '<div class="page-sub">Faqat ko\'rish uchun</div></div>' +
      '</div>' +
      '<div class="notice warn"><span class="ico">🔒</span>' +
      '<div><b>Faqat ko\'rish uchun.</b> Admin tibbiy ma\'lumotlarni o\'zgartira olmaydi.</div></div>' +
      '<div class="card">' +
        '<div class="filters"><div class="search-box">' +
          '<input type="text" id="mSearch" placeholder="Bemor yoki shifokor…" value="' + escAttr(this.state.search) + '"></div>' +
          '<button class="chip ' + (this.state.mFilter==='all'?'on':'') + '" data-mf="all">Barchasi</button>' +
          '<button class="chip ' + (this.state.mFilter==='completed'?'on':'') + '" data-mf="completed">✅ Yakunlangan</button>' +
        '</div>' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th data-tibex-csp-style="s8f5b0792">Sana</th><th data-tibex-csp-style="sb6a594ef">Vaqt</th><th>Bemor</th>' +
          '<th data-tibex-csp-style="sc11bcb05">Shifokor</th><th data-tibex-csp-style="sf8aa7751">Holat</th>' +
          '<th>Tashxis</th><th data-tibex-csp-style="s1ff697ae"></th>' +
        '</tr></thead><tbody>' +
        (fl.length ? fl.slice(0,200).map(a => {
          const p = this.cache.patients[String(a.patient_id)] || {};
          return '<tr data-id="' + a.id + '">' +
            '<td class="mono" data-tibex-csp-style="s60c6a7e3">' + esc(a.date||'—') + '</td>' +
            '<td class="mono" data-tibex-csp-style="s60c6a7e3">' + esc(a.scheduled_time||'—') + '</td>' +
            '<td>' + esc(p.fullname||'Bemor #' + a.patient_id) + '</td>' +
            '<td>' + esc(a.doctor_name||'—') + '</td>' +
            '<td><span class="status info">' + esc(a.status||'—') + '</span></td>' +
            '<td data-tibex-csp-style="s959ee20f">' + esc(a.final_dx || a.prelim_dx || '—') + '</td>' +
            '<td><div class="row-actions"><button data-act="view">👁</button></div></td></tr>';
        }).join('') :
        '<tr><td colspan="7"><div class="empty"><div class="ico">📋</div><div class="msg">Yozuvlar yo\'q</div></div></td></tr>') +
        '</tbody></table></div></div></section>';
  },

  a_medical(root) {
    onId('mSearch', 'input', debounce(e => { this.state.search = e.target.value.trim().toLowerCase(); this.render(); }, 200));
    $$('[data-mf]', root).forEach(b => on(b, 'click', () => { this.state.mFilter = b.dataset.mf; this.render(); }));
    $$('tbody tr[data-id]', root).forEach(tr => on(tr, 'click', () => {
      this.medicalView(parseInt(tr.dataset.id, 10));
    }));
  },

  medicalView(apptId) {
    const a = this.cache.appointments.find(x => x.id === apptId); if (!a) return;
    const p = this.cache.patients[String(a.patient_id)] || {};
    const labs = this.cache.lab_orders.filter(l => l.appointment_id === apptId);
    Modal.open(
      '<div class="modal-head"><h3>📋 Tibbiy yozuv — #' + a.id + '</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="notice warn"><span class="ico">🔒</span><div>Bu yozuv faqat ko\'rish uchun.</div></div>' +
        '<div class="form-grid">' +
          '<div class="field"><label>Bemor</label>' +
            '<div class="input" data-tibex-csp-style="s4c09beb8">' + esc(p.fullname||'—') + '</div></div>' +
          '<div class="field"><label>Sana / Vaqt</label>' +
            '<div class="input" data-tibex-csp-style="s4c09beb8">' + esc(a.date||'') + ' ' + esc(a.scheduled_time||'') + '</div></div>' +
          '<div class="field"><label>Shifokor</label>' +
            '<div class="input" data-tibex-csp-style="s4c09beb8">' + esc(a.doctor_name||'—') + '</div></div>' +
          '<div class="field"><label>Holat</label>' +
            '<div class="input" data-tibex-csp-style="s4c09beb8">' + esc(a.status||'—') + '</div></div>' +
          '<div class="field span-2"><label>Shikoyat</label>' +
            '<div class="input" data-tibex-csp-style="s8f684438">' + esc(a.complaint||'—') + '</div></div>' +
          '<div class="field span-2"><label>Yakuniy tashxis</label>' +
            '<div class="input" data-tibex-csp-style="s4c09beb8">' + esc(a.final_dx || a.prelim_dx || '—') + '</div></div>' +
        '</div>' +
        (labs.length ?
          '<h4 data-tibex-csp-style="s898de550">🔬 Lab natijalar</h4>' +
          labs.map(l => '<div data-tibex-csp-style="sc183636a">' +
            '<div data-tibex-csp-style="s3dedfff8"><b>' + esc(l.test_name||'—') + '</b>' +
              '<span class="status ' + (l.status === 'verified' ? 'ok' : 'info') + '">' + esc(l.status||'') + '</span></div>' +
            (l.result_summary ? '<div data-tibex-csp-style="sdf2dc98f">' + esc(l.result_summary) + '</div>' : '') +
          '</div>').join('') : '') +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>Yopish</button></div>',
      { size: 'wide' });
  },

  // ══════════════════════════════════════════════════════════
  // AUDIT
  // ══════════════════════════════════════════════════════════
  v_audit() {
    const list = this.cache.audit;
    let fl = list;
    if (this.state.aFilter !== 'all') fl = fl.filter(a => a.action === this.state.aFilter);
    const s = this.state.search;
    if (s) fl = fl.filter(a =>
      (a.user||'').toLowerCase().includes(s) || (a.detail||'').toLowerCase().includes(s));
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">📜 Audit jurnali <span class="cnt">' + list.length + '</span></h1>' +
        '<div class="page-sub">Tizimdagi barcha harakatlar</div></div>' +
        '<div class="page-actions">' +
          '<button class="btn" id="aExport">📄 Excel</button></div>' +
      '</div><div class="card">' +
        '<div class="filters"><div class="search-box">' +
          '<input type="text" id="aSearch" placeholder="Foydalanuvchi yoki tafsilot…" value="' + escAttr(this.state.search) + '"></div>' +
          '<button class="chip ' + (this.state.aFilter==='all'?'on':'') + '" data-af="all">Barchasi</button>' +
          '<button class="chip ' + (this.state.aFilter==='create'?'on':'') + '" data-af="create">➕ Yaratish</button>' +
          '<button class="chip ' + (this.state.aFilter==='update'?'on':'') + '" data-af="update">✏️ Tahrirlash</button>' +
          '<button class="chip ' + (this.state.aFilter==='delete'?'on':'') + '" data-af="delete">🗑 O\'chirish</button>' +
          '<button class="chip ' + (this.state.aFilter==='login'?'on':'') + '" data-af="login">🔐 Login</button>' +
          '<button class="chip ' + (this.state.aFilter==='payment'?'on':'') + '" data-af="payment">💰 To\'lov</button>' +
        '</div>' +
        '<div class="audit-list">' +
          (fl.length ? fl.slice(0,500).map(a => this._auditRow(a)).join('') :
            '<div class="empty"><div class="ico">📜</div><div class="msg">Yozuvlar yo\'q</div></div>') +
        '</div></div></section>';
  },

  a_audit(root) {
    onId('aSearch', 'input', debounce(e => { this.state.search = e.target.value.trim().toLowerCase(); this.render(); }, 200));
    $$('[data-af]', root).forEach(b => on(b, 'click', () => { this.state.aFilter = b.dataset.af; this.render(); }));
    onId('aExport', 'click', () => this.store.exportXlsx('audit').catch(() => {}));
  },

  // ══════════════════════════════════════════════════════════
  // REPORTS
  // ══════════════════════════════════════════════════════════
  v_reports() {
    const pays = this.cache.payments, appts = this.cache.appointments;
    const today = new Date(); today.setHours(0,0,0,0);
    const tPays = pays.filter(p => (p.created_at||0) >= today.getTime());
    const total = tPays.reduce((s,p) => s + (p.amount||0), 0);
    const avg = tPays.length ? Math.round(total / tPays.length) : 0;
    const refunds = this.cache.refunds.filter(r => (r.created_at||0) >= today.getTime());
    const rTotal = refunds.reduce((s,r) => s + (r.amount||0), 0);
    const byMethod = { cash: 0, card: 0, online: 0 };
    tPays.forEach(p => { byMethod[p.method] = (byMethod[p.method]||0) + (p.amount||0); });
    const byDoctor = {};
    tPays.forEach(p => {
      const a = appts.find(x => x.id === p.appointment_id);
      if (!a) return;
      if (!byDoctor[a.doctor_name]) byDoctor[a.doctor_name] = { count: 0, total: 0 };
      byDoctor[a.doctor_name].count++;
      byDoctor[a.doctor_name].total += p.amount || 0;
    });
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">📈 Hisobotlar</h1>' +
        '<div class="page-sub">Bugungi ko\'rsatkichlar · ' + fmtDate(Date.now()) + '</div></div>' +
        '<div class="page-actions">' +
          '<button class="btn" id="rExportP">📄 To\'lovlar</button>' +
          '<button class="btn" id="rExportD">📄 Qarzdorlar</button></div>' +
      '</div>' +
      '<div class="stat-grid">' +
        this._stat('green','💰',fmtMoney(total),'Jami tushum') +
        this._stat('blue','📊',tPays.length,'To\'lovlar soni') +
        this._stat('gold','📈',fmtMoney(avg),'O\'rtacha chek') +
        this._stat('red','↩️',fmtMoney(rTotal),'Qaytarish') +
      '</div>' +
      '<div class="card"><div class="card-head"><div class="card-title">💳 To\'lov usullari</div></div>' +
      '<div class="card-body">' +
        Object.keys(byMethod).map(function(m) {
          const v = byMethod[m];
          const lbl = m === 'cash' ? '💵 Naqd' : m === 'card' ? '💳 Karta' : '📱 Onlayn';
          const pct = total ? Math.round((v/total)*100) : 0;
          return '<div class="sys-row"><span class="k">' + lbl + '</span>' +
            '<div data-tibex-csp-style="s5bb24094">' +
              '<div data-tibex-csp-style="s4d1d26b2">' +
                '<div data-tibex-meter="primary-' + pct + '"></div></div>' +
              '<span class="v" data-tibex-csp-style="s24a03e76">' + esc(fmtMoney(v)) + ' · ' + pct + '%</span>' +
            '</div></div>';
        }).join('') +
      '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">👨‍⚕️ Shifokorlar bo\'yicha</div></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Shifokor</th><th data-tibex-csp-style="s388fade5">Qabullar</th>' +
        '<th data-tibex-csp-style="s8245c859">Tushum</th>' +
      '</tr></thead><tbody>' +
      (Object.keys(byDoctor).length ? Object.keys(byDoctor).map(function(n) {
        const d = byDoctor[n];
        return '<tr><td><b>' + esc(n) + '</b></td>' +
          '<td class="mono" data-tibex-csp-style="s826d32fa">' + d.count + '</td>' +
          '<td class="mono" data-tibex-csp-style="sd428b892">' + esc(fmtMoney(d.total)) + '</td></tr>';
      }).join('') : '<tr><td colspan="3"><div class="empty" data-tibex-csp-style="sbf8fc6a"><div class="msg">Ma\'lumot yo\'q</div></div></td></tr>') +
      '</tbody></table></div></div></section>';
  },

  a_reports(root) {
    ['rExportP', 'rExportD'].forEach(id => { const e = byId(id); if (e) e.hidden = !this.can('reports', 'export'); });
    onId('rExportP', 'click', () => this.store.exportXlsx('payments').then(() => toast('Yuklandi','ok'), () => {}));
    onId('rExportD', 'click', () => this.store.exportXlsx('debtors').then(() => toast('Yuklandi','ok'), () => {}));
  },

  // ══════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════
  v_settings() {
    const s = this.store._settingsCache || {};
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">⚙️ Sozlamalar</h1>' +
        '<div class="page-sub">Klinika, moliyaviy va xavfsizlik</div></div>' +
        '<div class="page-actions"><button class="btn" id="stReload">↻ Yangilash</button></div>' +
      '</div>' +
      '<div class="settings-grid">' +
        '<div class="settings-section"><h4>🏥 Klinika ma\'lumotlari</h4>' +
        '<div class="form-grid">' +
          '<div class="field span-2"><label>Klinika nomi</label>' +
            '<input class="input" value="' + escAttr(s.clinic_name||'TIBEX Klinika') + '" data-s-text="clinic_name"></div>' +
          '<div class="field span-2"><label>Telefon</label>' +
            '<input class="input" value="' + escAttr(s.clinic_phone||'+998 71 200 00 00') + '" data-s-text="clinic_phone"></div>' +
          '<div class="field span-2"><label>Manzil</label>' +
            '<input class="input" value="' + escAttr(s.clinic_address||'') + '" data-s-text="clinic_address"></div>' +
        '</div></div>' +
        '<div class="settings-section"><h4>💰 Moliyaviy sozlamalar</h4>' +
          '<div class="toggle-row"><div class="info"><div class="lbl">QQS (12%)</div>' +
            '<div class="sub">Chekda ko\'rsatilsinmi</div></div>' +
            '<div class="switch ' + (s.vat !== false ? 'on' : '') + '" data-s-bool="vat"></div></div>' +
          '<div class="field" data-tibex-csp-style="sacf76f18"><label>Chegirma limiti (%)</label>' +
            '<input class="input" type="number" min="0" max="100" value="' + (s.discount_limit != null ? s.discount_limit : 20) + '" data-s-num="discount_limit"></div>' +
        '</div>' +
        '<div class="settings-section"><h4>🔔 Bildirishnomalar</h4>' +
          '<div class="toggle-row"><div class="info"><div class="lbl">Uskuna xizmat eslatmalari</div></div>' +
            '<div class="switch ' + (s.equipService !== false ? 'on' : '') + '" data-s-bool="equipService"></div></div>' +
          '<div class="toggle-row"><div class="info"><div class="lbl">Reagent kam qoldiq alertlari</div></div>' +
            '<div class="switch ' + (s.reagentAlert !== false ? 'on' : '') + '" data-s-bool="reagentAlert"></div></div>' +
        '</div>' +
        '<div class="settings-section"><h4>🔒 Xavfsizlik</h4>' +
          '<div class="toggle-row"><div class="info">' +
            '<div class="lbl">🔒 Tibbiy yozuvlarni himoyalash</div>' +
            '<div class="sub">Admin tashxis va retseptlarni o\'zgartira olmaydi</div></div>' +
            '<div class="switch ' + (s.medicalLock !== false ? 'on' : '') + '" data-s-bool="medicalLock"></div></div>' +
        '</div>' +
      '</div></section>';
  },

  // TIBEX_LIVE_DIFF_v1: getSettings(true) ENDI bu yerda chaqirilmaydi.
  // Avval har render → fetch → .then(render) → render → fetch → ...
  // cheksiz loop edi (settings tabida ~10 Hz flicker). Settings bir
  // marta init() da fon rejimida yuklanadi; WS `settings.updated`
  // eventi kelganda tibex-client.js `_settingsCache` ni yangilaydi.
  a_settings(root) {
    $$('[data-s-bool]', root).forEach(sw => on(sw, 'click', async () => {
      const key = sw.dataset.sBool;
      const val = !sw.classList.contains('on');
      sw.classList.toggle('on', val);
      try { await this.store.saveSettings({ [key]: val }); toast('Sozlama yangilandi','ok'); this.updateChrome(); }
      catch (e) { sw.classList.toggle('on', !val); toast('Xatolik','bad'); }
    }));
    $$('[data-s-text]', root).forEach(inp => on(inp, 'blur', async () => {
      try { await this.store.saveSettings({ [inp.dataset.sText]: inp.value.trim() });
        toast('Saqlandi','ok'); }
      catch (e) { toast('Xatolik','bad'); }
    }));
    $$('[data-s-num]', root).forEach(inp => on(inp, 'blur', async () => {
      const v = Math.max(0, Math.min(100, parseInt(inp.value, 10) || 0));
      inp.value = v;
      try { await this.store.saveSettings({ [inp.dataset.sNum]: v }); toast('Saqlandi','ok'); }
      catch (e) { toast('Xatolik','bad'); }
    }));
    onId('stReload', 'click', async () => {
      await this.store.getSettings(true); this.render(); toast('Yangilandi','ok');
    });
  },

  // ══════════════════════════════════════════════════════════
  // SYSTEM
  // ══════════════════════════════════════════════════════════
  v_system() {
    const u = this.user || {};
    return '' +
      '<section class="view"><div class="page-head">' +
        '<div><h1 class="page-title">🔧 Tizim</h1>' +
        '<div class="page-sub">Server holati va monitoring</div></div>' +
        '<div class="page-actions"><button class="btn" id="sysReload">↻ Yangilash</button></div>' +
      '</div>' +
      '<div class="settings-grid">' +
        '<div class="settings-section"><h4>📊 Tizim holati</h4>' +
          '<div class="sys-row"><span class="k">Versiya</span><span class="v" id="sysVersion">—</span></div>' +
          '<div class="sys-row"><span class="k">Baza</span><span class="v" id="sysDb">—</span></div>' +
          '<div class="sys-row"><span class="k">Redis</span><span class="v" id="sysRedis">—</span></div>' +
          '<div class="sys-row"><span class="k">WebSocket</span><span class="v" id="sysWs">—</span></div>' +
          '<div class="sys-row"><span class="k">Sessiyalar</span><span class="v" id="sysSessions">—</span></div>' +
          '<div class="sys-row"><span class="k">Foydalanuvchilar</span><span class="v" id="sysUsers">—</span></div>' +
          '<div class="sys-row"><span class="k">Xatolar (1 daq)</span><span class="v" id="sysErrors">—</span></div>' +
          '<div class="sys-row"><span class="k">Hajm</span><span class="v" id="sysSize">—</span></div>' +
        '</div>' +
        '<div class="settings-section"><h4>💾 Zaxira nusxa</h4>' +
          '<div class="sys-row"><span class="k">Oxirgi zaxira</span><span class="v" id="sysBackup">—</span></div>' +
          '<div class="sys-row" data-tibex-csp-style="s3fec71a4">' +
            '<button class="btn sm primary" id="sysDownload">💾 Yuklab olish</button></div>' +
        '</div>' +
        '<div class="settings-section"><h4>⚠️ Xavfli amallar</h4>' +
          '<div class="toggle-row"><div class="info"><div class="lbl">Audit jurnali</div>' +
            '<div class="sub">O\'zgarmas (append-only). Eski yozuvlar serverda scripts/audit_archive.py bilan arxivlanadi</div></div></div>' +
          '<div class="toggle-row"><div class="info"><div class="lbl">Demo reset</div>' +
            '<div class="sub">Barcha biznes ma\'lumotlarni o\'chirish</div></div>' +
            '<button class="btn danger sm" id="sysDemoReset">⚠️ Ochish</button></div>' +
        '</div>' +
        '<div class="settings-section"><h4>🔐 Mening parolim</h4>' +
          '<div class="toggle-row"><div class="info"><div class="lbl">Parolni almashtirish</div>' +
            '<div class="sub">Almashtirish tarixi: ' + (u.password_change_count||0) + '</div></div>' +
            '<button class="btn sm" id="sysChangePwd">🔑 O\'zgartirish</button></div>' +
        '</div>' +
      '</div></section>';
  },

  // TIBEX_LIVE_DIFF_v1: loadHealth() endi har renderda chaqirilmaydi,
  // aks holda har WS eventda /api/monitoring/health so'rovi ketardi.
  // Faqat 15 sekunddan ko'p vaqt o'tgan bo'lsa yoki foydalanuvchi
  // "Yangilash" tugmasini bosganda.
  a_system(root) {
    const _now = Date.now();
    if (!this._lastHealthAt || _now - this._lastHealthAt > 15000) {
      this._lastHealthAt = _now;
      this.loadHealth();
    }
    onId('sysReload', 'click', () => { this._lastHealthAt = 0; this.loadHealth(); });
    onId('sysDownload', 'click', () => {
      this.doBackup();
    });
    onId('sysDemoReset', 'click', () => this.demoReset());
    onId('sysChangePwd', 'click', () => this.changePassword());
  },

  async loadHealth() {
    try {
      const h = await this.store.getHealth();
      const set = (id, val, ok) => {
        const el = byId(id); if (!el) return;
        el.textContent = val;
        el.classList.remove('password-change-success', 'password-change-error');
        if (ok === true) el.classList.add('password-change-success');
        if (ok === false) el.classList.add('password-change-error');
      };
      set('sysVersion', 'TIBEX v' + (h.version || '?'));
      (() => { const s = h.db?.status; set('sysDb', s === 'up' ? '🟢 Faol' : '🔴 ' + (s || 'down'), s === 'up'); })();
      const _rs = h.redis && h.redis.status; set('sysRedis', _rs === 'up' ? '🟢 Faol' : '⚪ Yo\'q', _rs === 'up');
      const _dr = byId('sysDemoReset'); if (_dr) { const _row = _dr.closest('.toggle-row'); if (_row) _row.hidden = h.env === 'prod'; }
      set('sysWs', (h.websocket?.clients || 0) + ' ulanish');
      set('sysSessions', (h.sessions?.active || 0) + ' aktiv');
      set('sysUsers', (h.users?.active || 0) + ' / ' + (h.users?.total || 0));
      set('sysErrors', String(h.requests?.errors_last_minute || 0),
        (h.requests?.errors_last_minute || 0) === 0);
      const si = this.cache.system_info || {};
      set('sysSize', si.db_size_human || '—');
      set('sysBackup', si.last_backup_at ? fmtDT(si.last_backup_at) : 'Hali yo\'q');
    } catch (e) { console.warn('health xato:', e); }
  },

  demoReset() {
    Modal.open(
      '<div class="modal-head"><h3>⚠️ Demo Reset</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="notice danger"><span class="ico">⚠️</span>' +
        '<div><b>DIQQAT!</b> Barcha biznes ma\'lumotlar o\'chiriladi. Qaytarib bo\'lmaydi.</div></div>' +
        '<div class="field"><label>1. Sizning parolingiz <span class="req">*</span></label>' +
        '<div class="pwd-wrap"><input class="input" id="drPwd" type="password" autofocus>' +
        '<button type="button" class="pwd-toggle">👁️</button></div></div>' +
        '<div class="field" data-tibex-csp-style="sacf76f18"><label>2. Reset kodi <span class="req">*</span></label>' +
        '<div class="pwd-wrap"><input class="input mono" id="drCode" type="password">' +
        '<button type="button" class="pwd-toggle">👁️</button></div></div>' +
        '<label data-tibex-csp-style="sbd78e939">' +
        '<input type="checkbox" id="drConf"> Barcha ma\'lumotlar o\'chirilishini tushunaman</label>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn danger" id="__doReset" disabled>🔓 Reset qilish</button></div>');
    $$('.pwd-toggle').forEach(b => on(b, 'click', () => {
      const i = b.parentElement.querySelector('input');
      i.type = i.type === 'text' ? 'password' : 'text';
    }));
    const upd = () => {
      const b = byId('__doReset');
      if (b) b.disabled = !((($('#drConf')||{}).checked) &&
        (($('#drPwd')||{}).value) && (($('#drCode')||{}).value));
    };
    ['drConf', 'drPwd', 'drCode'].forEach(id => {
      onId(id, 'input', upd); onId(id, 'change', upd);
    });
    onId('__doReset', 'click', async () => {
      try {
        await this.store._api('/api/admin/demo-reset', {
          method: 'POST',
          body: {
            password: ($('#drPwd')||{}).value || '',
            reset_code: ($('#drCode')||{}).value || '',
            wipe_staff: false, keep_logins: []
          }
        });
        toast('Demo reset bajarildi','ok', 5000);
        Modal.close();
        setTimeout(() => location.reload(), 1500);
      } catch (e) { toast('Xatolik: ' + (e.message||'?'), 'bad'); }
    });
  },

  changePassword() {
    Modal.open(
      '<div class="modal-head"><h3>🔑 Parolni almashtirish</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="field"><label>Eski parol <span class="req">*</span></label>' +
        '<div class="pwd-wrap"><input class="input" id="cpOld" type="password" autofocus>' +
        '<button type="button" class="pwd-toggle">👁️</button></div></div>' +
        '<div class="field" data-tibex-csp-style="s46af871a"><label>Yangi parol <span class="req">*</span></label>' +
        '<div class="pwd-wrap"><input class="input" id="cpNew" type="password" placeholder="Kamida 10 belgi">' +
        '<button type="button" class="pwd-toggle">👁️</button></div>' +
        '<div class="hint">Katta + kichik harf, raqam, belgi</div></div>' +
        '<div class="field" data-tibex-csp-style="s46af871a"><label>Tasdiqlash <span class="req">*</span></label>' +
        '<div class="pwd-wrap"><input class="input" id="cpConf" type="password">' +
        '<button type="button" class="pwd-toggle">👁️</button></div></div>' +
        '<div id="cpMsg" data-tibex-csp-style="s46af871a"></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>Bekor qilish</button>' +
      '<button class="btn primary" id="__changePwd">✓ Almashtirish</button></div>');
    $$('.pwd-toggle').forEach(b => on(b, 'click', () => {
      const i = b.parentElement.querySelector('input');
      i.type = i.type === 'text' ? 'password' : 'text';
    }));
    onId('__changePwd', 'click', async () => {
      const oldPwd = ($('#cpOld')||{}).value || '';
      const newPwd = ($('#cpNew')||{}).value || '';
      const conf = ($('#cpConf')||{}).value || '';
      const msg = byId('cpMsg');
      if (!oldPwd || !newPwd || !conf)
        return msg.innerHTML = '<div class="notice danger">Barcha maydonlarni to\'ldiring</div>';
      if (newPwd.length < 10)
        return msg.innerHTML = '<div class="notice danger">Parol kamida 10 belgi</div>';
      if (newPwd !== conf)
        return msg.innerHTML = '<div class="notice danger">Parollar mos emas</div>';
      try {
        const r = await this.store._api('/api/auth/change-password', {
          method: 'POST',
          body: { old_password: oldPwd, new_password: newPwd }
        });
        msg.innerHTML = '<div class="notice success">' + esc(r.message) + '</div>';
        toast('Parol almashtirildi','ok');
        setTimeout(() => Modal.close(), 1500);
      } catch (e) {
        msg.innerHTML = '<div class="notice danger">' + esc(e.message || 'Xatolik') + '</div>';
      }
    });
  },

  showShortcuts() {
    Modal.open(
      '<div class="modal-head"><h3>⌨️ Klaviatura yorliqlari</h3>' +
      '<button class="close" data-close>✕</button></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        '<div><h4 data-tibex-csp-style="sf9692d44">Global</h4>' +
          '<div class="sys-row"><span class="k">Yordam</span><span class="v"><kbd>F1</kbd></span></div>' +
          '<div class="sys-row"><span class="k">Yangi xodim</span><span class="v"><kbd>F4</kbd></span></div>' +
          '<div class="sys-row"><span class="k">Yangilash</span><span class="v"><kbd>F5</kbd></span></div>' +
          '<div class="sys-row"><span class="k">Zaxira</span><span class="v"><kbd>F10</kbd></span></div>' +
          '<div class="sys-row"><span class="k">Yopish</span><span class="v"><kbd>Esc</kbd></span></div>' +
        '</div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn primary" data-close>Tushunarli</button></div>');
  },

  showNotifications() {
    this._unread = 0; this._renderBadge();
    const feed = this._feed || [];
    const recent = (this.cache.audit || []).slice(0, 12);
    const feedHtml = feed.map(f =>
      '<div class="sys-row"><span class="k">' +
      esc(f.icon + ' ' + f.text + (f.n > 1 ? ' (+' + (f.n - 1) + ' yana)' : '')) +
      '</span><span class="v">' + esc(fmtDT(f.ts)) + '</span></div>').join('');
    const body = (!feed.length && !recent.length)
      ? '<div class="empty"><div class="ico">🔕</div><div class="msg">Bildirishnomalar yo\'q</div></div>'
      : (feed.length ? '<h4 data-tibex-csp-style="sf9692d44">Yangi hodisalar</h4>' + feedHtml : '') +
        (recent.length ? '<h4 data-tibex-csp-style="sf9692d44">Audit jurnali (oxirgi 12)</h4><div class="audit-list">' +
          recent.map(a => this._auditRow(a)).join('') + '</div>' : '');
    Modal.open(
      '<div class="modal-head"><h3>🔔 Bildirishnomalar</h3>' +
      '<button class="close" data-close aria-label="Yopish">✕</button></div>' +
      '<div class="modal-body" data-tibex-csp-style="s6b4203c">' + body + '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>Yopish</button></div>');
  }
};

// ── START ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}

})();