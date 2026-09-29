/* =====================================================================
 * TIBEX Client — API client (localStorage o'rniga)
 *
 * Barcha HTML konsollar uchun umumiy.
 * HTML'dagi eski `TIBEX_STORE = (function(){ ...localStorage... })()`
 * ni almashtiradi.
 *
 * Xususiyatlar:
 *   - init()           → serverdan snapshot oladi
 *   - getXxx()         → keshdan sinxron o'qish
 *   - addXxx(data)     → optimistic update + serverga POST
 *   - updateXxx(id, p) → optimistic update + serverga PATCH
 *   - deleteXxx(id)    → optimistic update + serverga DELETE
 *   - subscribe(cb)    → WebSocket orqali real-time xabarlar
 *   - logout()         → sessiyani yopadi
 * ===================================================================== */

window.TIBEX_STORE = (function () {
  // ─── Konfiguratsiya ───
  // TIBEX_API_BASE_v2: dinamik API manzili
  const API = (() => {
    if (typeof window.__API_BASE__ === "string") return window.__API_BASE__;
    const loc = window.location;
    if (loc.port === "8000" || loc.port === "" || loc.port === "443" || loc.port === "80") {
      return "";
    }
    return loc.protocol + "//" + loc.hostname + ":8000";
  })();
  // TIBEX_WS_BASE_CONSISTENCY_FIX_v1: avval faqat global window.__API_BASE__
  // tekshirilardi (u login.html'dan tashqari hech qayerda o'rnatilmagan),
  // aks holda location.host'ga (masalan Live Server'ning 5500-portiga)
  // tushib qolardi — backend u yerda yo'q, WS ulanmasdi. Endi yuqorida
  // ALLAQACHON to'g'ri hisoblangan `API` konstantasidan foydalanamiz —
  // u ham xuddi shu login.html mantig'i bilan (hostname:8000) hisoblanadi.
  const WS_BASE = (() => {
    if (API && API.length > 0) {
      const proto = API.startsWith("https") ? "wss:" : "ws:";
      const host = API.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return proto + "//" + host;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host;
  })();

  // ─── Ichki holat ───
  let _cache = null;               // to'liq snapshot
  let _csrf = null;                // CSRF token
  let _currentUser = null;         // joriy foydalanuvchi
  let _ws = null;                  // WebSocket
  let _wsRetries = 0;
  // Snapshot yangilanishlari eventlar oqimi zich bo'lsa ham 3 soniyada
  // ko'pi bilan bitta so'rovga birlashtiriladi.
  const SNAPSHOT_REFRESH_MIN_MS = 3000;
  let _snapshotRefreshTimer = null;
  let _snapshotRefreshInFlight = false;
  let _snapshotRefreshPending = false;
  let _lastSnapshotRefreshAt = 0;
  let _hasConnectedBefore = false;
  const _subs = new Set();         // obunachilar

  // ═══════════════════════════════════════════════════════════
  // YORDAMCHI
  // ═══════════════════════════════════════════════════════════

  function _dedupe() {
    if (!_cache) return;
    const entities = [
      "users", "patients", "appointments", "lab_orders",
      "payments", "refunds", "doctors", "services",
      "roles", "equipment", "reagents", "integrations",
    ];
    for (const entity of entities) {
      const list = _cache[entity];
      if (!Array.isArray(list)) continue;
      const seen = new Set();
      const cleaned = [];
      for (const item of list) {
        if (item == null) continue;
        const id = item.id;
        if (id === undefined || id === null || id < 0) {
          // temp (pending) — qoldiramiz, lekin takrorlanishini bloklaymiz
          if (id !== undefined && id !== null && seen.has(id)) continue;
          if (id !== undefined && id !== null) seen.add(id);
          cleaned.push(item);
          continue;
        }
        if (seen.has(id)) {
          // Dublikat topildi — birinchisini saqlab, qolganini o'chiramiz
          continue;
        }
        seen.add(id);
        cleaned.push(item);
      }
      _cache[entity] = cleaned;
    }
  }

  function _notify(source, meta) {
    if (!_cache) return;
    _dedupe();
    _subs.forEach((cb) => {
      try {
        cb(_cache, source, meta || null);
      } catch (e) {
        console.error("[TIBEX] subscriber xato:", e);
      }
    });
  }

  // 26-band: har to'lov so'rovi uchun noyob Idempotency-Key (qayta yuborish ikki marta yozmasin)
  function _idemKey() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  async function _api(path, opts = {}) {
    const method = (opts.method || "GET").toUpperCase();
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };

    if (!["GET", "HEAD", "OPTIONS"].includes(method) && _csrf) {
      headers["X-CSRF-Token"] = _csrf;
    }

    // TIBEX_FETCH_TIMEOUT_v1: 30s timeout
    const _ctrl = new AbortController();
    const _tid = setTimeout(() => _ctrl.abort(), 30000);
    let r;
    try {
      r = await fetch(API + path, {
        method,
        credentials: "include",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: _ctrl.signal,
      });
    } catch (e) {
      clearTimeout(_tid);
      if (e.name === "AbortError") throw new Error("So'rov vaqti tugadi (30s)");
      throw e;
    }
    clearTimeout(_tid);

    if (r.status === 401) {
      // Sessiya yo'q — login sahifasiga
      if (!location.pathname.endsWith("/login.html") && !location.pathname.endsWith("/")) {
        location.href = "/login.html";
      }
      throw new Error("UNAUTHORIZED");
    }

    if (r.status === 204) return null;

    if (!r.ok) {
      let msg = r.statusText;
      try {
        const err = await r.json();
        msg = err.detail || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    return r.json();
  }

  // ─── Optimistic update ───
  function _patchLocal(entity, id, patch) {
    if (!_cache) return;
    const list = _cache[entity];
    if (Array.isArray(list)) {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list[i] = { ...list[i], ...patch };
    } else if (list && typeof list === "object") {
      if (list[String(id)]) list[String(id)] = { ...list[String(id)], ...patch };
    }
  }

    function _addLocal(entity, item) {
    if (!_cache) return;
    const list = _cache[entity];
    if (Array.isArray(list)) {
      // Bir xil ID bilan allaqachon mavjud bo'lsa — almashtirish (dublikat oldini olish)
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) {
        list[i] = { ...list[i], ...item };
      } else {
        list.push(item);
      }
    } else if (list && typeof list === "object") {
      list[String(item.id)] = item;
    }
  }

  function _removeLocal(entity, id) {
    if (!_cache) return;
    const list = _cache[entity];
    if (Array.isArray(list)) {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
    } else if (list && typeof list === "object") {
      delete list[String(id)];
    }
  }

  // ─── Xato toast ───
  function _err(e, fallback = "Xatolik") {
    console.error("[TIBEX]", e);
    const msg = e?.message || fallback;
    if (window.toast) {
      try { window.toast(msg, "bad"); } catch (_) {}
    }
  }

  // ═══════════════════════════════════════════════════════════
  // WEBSOCKET
  // ═══════════════════════════════════════════════════════════

  const SNAPSHOT_ENTITIES = [
    "users", "patients", "appointments", "lab_orders", "payments", "refunds",
    "doctors", "services", "roles", "equipment", "reagents", "integrations",
    "audit", "system_info", "shift"
  ];

  // FNV-1a (32-bit) over the FULL serialized string (never truncated: a change past
  // any prefix must still be detected). Compared together with the string length.
  function _fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function _entitySig(value) {
    const str = JSON.stringify(value ?? null);
    return str.length + ":" + _fnv1a(str);
  }

  function _changedSnapshotEntities(previous, next) {
    if (!previous) return SNAPSHOT_ENTITIES.slice();
    return SNAPSHOT_ENTITIES.filter((key) => {
      // Bootstrap JSON has stable property ordering; comparing a cheap signature of
      // each entity avoids rendering consoles for unrelated/no-op invalidations.
      return _entitySig(previous[key]) !== _entitySig(next[key]);
    });
  }

  function _scheduleSnapshotRefresh() {
    _snapshotRefreshPending = true;
    if (_snapshotRefreshTimer || _snapshotRefreshInFlight) return;
    if (!navigator.onLine || document.visibilityState === "hidden") return;

    const elapsed = Date.now() - _lastSnapshotRefreshAt;
    const delay = Math.max(0, SNAPSHOT_REFRESH_MIN_MS - elapsed);
    _snapshotRefreshTimer = setTimeout(_refreshSnapshot, delay);
  }

  async function _refreshSnapshot() {
    _snapshotRefreshTimer = null;
    if (!_snapshotRefreshPending || !navigator.onLine || document.visibilityState === "hidden") return;

    _snapshotRefreshPending = false;
    _snapshotRefreshInFlight = true;
    _lastSnapshotRefreshAt = Date.now();
    try {
      const snap = await _api("/api/bootstrap");
      const previous = _cache;
      const previousRole = api.ROLE;
      const previousUser = JSON.stringify(_currentUser);
      _cache = snap.data || {};
      _currentUser = snap.current_user || _currentUser;
      api.CURRENT_USER = _currentUser;
      api.ROLE = snap.role || _currentUser?.role;
      api._ensureFallbacks();
      const changedEntities = _changedSnapshotEntities(previous, _cache);
      const roleChanged = Boolean(snap.role && snap.role !== previousRole);
      const currentUserChanged = previousUser !== JSON.stringify(_currentUser);
      if (currentUserChanged) changedEntities.push("current_user");
      if (changedEntities.length || roleChanged) {
        if (window.__TIBEX_ROLE_REFRESH__) window.__TIBEX_ROLE_REFRESH__();
        _notify("external", {
          type: "snapshot.invalidate",
          changedEntities,
          data: {}
        });
      }
    } catch (e) {
      if (e?.message === "UNAUTHORIZED") location.href = "/login.html";
    } finally {
      _snapshotRefreshInFlight = false;
      if (_snapshotRefreshPending) _scheduleSnapshotRefresh();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && _snapshotRefreshPending) {
      _scheduleSnapshotRefresh();
    }
  });
  window.addEventListener("online", () => {
    if (_snapshotRefreshPending) _scheduleSnapshotRefresh();
  });

  function _connectWS() {
    if (_ws && _ws.readyState <= 1) return; // allaqachon ochiq/ochilmoqda

    try {
      _ws = new WebSocket(`${WS_BASE}/api/ws`);
    } catch (e) {
      _scheduleReconnect();
      return;
    }

    _ws.onopen = () => {
      _wsRetries = 0;
      if (_hasConnectedBefore) _scheduleSnapshotRefresh();
      _hasConnectedBefore = true;
      console.log("[TIBEX WS] ulandi");
    };

    _ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }
      if (msg.type === "pong") return;
      if (msg.type !== "snapshot.invalidate") return;
      _scheduleSnapshotRefresh();
    };

    _ws.onclose = () => {
      _scheduleReconnect();
    };

    _ws.onerror = () => {
      try { _ws.close(); } catch (_) {}
    };
  }

  function _scheduleReconnect() {
    _wsRetries += 1;
    const delay = Math.min(1000 * _wsRetries, 15000);
    setTimeout(_connectWS, delay);
  }

  function _applyEvent(evt) {
    if (!_cache || !evt) return;
    const t = evt.type;
    const d = evt.data;

    switch (t) {
      case "patient.created":    _addLocal("patients", d); break;
      case "patient.updated":    _patchLocal("patients", d.id, d); break;
      case "patient.deleted":    _removeLocal("patients", d.id); break;

      case "appointment.created":_addLocal("appointments", d); break;
      case "appointment.updated":_patchLocal("appointments", d.id, d); break;
      case "appointment.deleted":_removeLocal("appointments", d.id); break;

      case "lab.created":        _addLocal("lab_orders", d); break;
      case "lab.updated":        _patchLocal("lab_orders", d.id, d); break;

      case "payment.created":    _addLocal("payments", d); break;
      case "refund.created":     _addLocal("refunds", d); break;

      case "user.created":       _addLocal("users", d); break;
      case "user.updated":       _patchLocal("users", d.id, d); break;
      case "user.deleted":       _removeLocal("users", d.id); break;

      case "doctor.created":     _addLocal("doctors", d); break;
      case "doctor.updated":     _patchLocal("doctors", d.id, d); break;
      case "doctor.deleted":     _removeLocal("doctors", d.id); break;

      case "service.created":    _addLocal("services", d); break;
      case "service.updated":    _patchLocal("services", d.id, d); break;
      case "service.deleted":    _removeLocal("services", d.id); break;

      case "equipment.created":  _addLocal("equipment", d); break;
      case "equipment.updated":  _patchLocal("equipment", d.id, d); break;
      case "equipment.deleted":  _removeLocal("equipment", d.id); break;

      case "reagent.created":    _addLocal("reagents", d); break;
      case "reagent.updated":    _patchLocal("reagents", d.id, d); break;
      case "reagent.deleted":    _removeLocal("reagents", d.id); break;

      case "role.created":       _addLocal("roles", d); break;
      case "role.updated":
        _patchLocal("roles", d.id, d);
        // TIBEX_ROLE_FORTRESS_v1: rol o'zgargan — joriy user shu rolda bo'lsa,
        // permissions yangilandi. Konsollar can() ni qayta chaqirishi kerak.
        if (_currentUser && _currentUser.role === d.key) {
          // Konsollarga signal
          setTimeout(() => {
            if (window.__TIBEX_ROLE_REFRESH__) {
              try { window.__TIBEX_ROLE_REFRESH__(); } catch (_) {}
            }
          }, 100);
        }
        break;
      case "role.deleted":       _removeLocal("roles", d.id); break;

      case "integration.created":_addLocal("integrations", d); break;
      case "integration.updated":_patchLocal("integrations", d.id, d); break;
      case "integration.deleted":_removeLocal("integrations", d.id); break;

      case "shift.closed":
        if (_cache.shift) _cache.shift = { open: false, ...d };
        break;

      case "audit.created":
        // TIBEX_AUDIT_LIVE_v1: audit ro'yxati backendda desc (eng yangisi
        // birinchi) tartibda keladi — shuning uchun yangi yozuvni
        // boshiga qo'yamiz (push emas, unshift), dublikatni oldini olamiz.
        if (Array.isArray(_cache.audit)) {
          const i = _cache.audit.findIndex((x) => x.id === d.id);
          if (i >= 0) _cache.audit[i] = { ..._cache.audit[i], ...d };
          else _cache.audit.unshift(d);
        } else {
          _cache.audit = [d];
        }
        break;

      case "audit.cleared":
        _cache.audit = [];
        break;

      case "settings.updated":
        // TIBEX_DISCOUNT_LIMIT_LIVE_SYNC_FIX_v1: admin Sozlamalar'dan
        // discount_limit/vat/klinika ma'lumotlarini o'zgartirsa, boshqa
        // ochiq konsollar (masalan kassa) buni sahifani qayta
        // yuklamasdan darhol olishi kerak. Bootstrap snapshotidagi
        // system_info.finance/clinic shu yerda yangilanadi.
        if (_cache.system_info) {
          if (!_cache.system_info.finance) _cache.system_info.finance = {};
          if (!_cache.system_info.clinic) _cache.system_info.clinic = {};
          if (d.discount_limit !== undefined) {
            _cache.system_info.finance.discount_limit = Number(d.discount_limit);
          }
          if (d.vat !== undefined) {
            _cache.system_info.finance.vat = Boolean(d.vat);
          }
          if (d.clinic_name !== undefined) {
            _cache.system_info.clinic.name = d.clinic_name;
          }
          if (d.clinic_phone !== undefined) {
            _cache.system_info.clinic.phone = d.clinic_phone;
          }
          if (d.clinic_address !== undefined) {
            _cache.system_info.clinic.address = d.clinic_address;
          }
        }
        // admin.html o'zining alohida _settingsCache'ini ham yangilaydi,
        // shunda Sozlamalar sahifasi boshqa admin sessiyasida ham
        // sinxron ko'rinadi.
        if (api._settingsCache) {
          api._settingsCache = { ...api._settingsCache, ...d };
        }
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STATIK KATALOGLAR (admin.html uchun)
  // ═══════════════════════════════════════════════════════════

  const PERMISSION_CATALOG = {
    patients:    { label: "Bemorlar", icon: "🧑", perms: ["view", "create", "edit", "delete"] },
    appointments:{ label: "Qabullar", icon: "📅", perms: ["view", "create", "edit", "delete"] },
    users:       { label: "Xodimlar", icon: "👥", perms: ["view", "create", "edit", "delete"] },
    roles:       { label: "Rollar", icon: "🛡", perms: ["view", "create", "edit", "delete"] },
    doctors:     { label: "Shifokorlar", icon: "👨‍⚕️", perms: ["view", "create", "edit", "delete"] },
    services:    { label: "Xizmatlar", icon: "🩺", perms: ["view", "create", "edit", "delete"] },
    equipment:   { label: "Uskunalar", icon: "🔬", perms: ["view", "create", "edit", "delete"] },
    reagents:    { label: "Reagentlar", icon: "🧪", perms: ["view", "create", "edit", "delete"] },
    integrations:{ label: "Integratsiyalar", icon: "🔌", perms: ["view", "create", "edit", "delete"] },
    lab:         { label: "Laboratoriya", icon: "🔬", perms: ["view", "create", "edit", "verify"] },
    payments:    { label: "To'lovlar", icon: "💰", perms: ["view", "create", "refund", "close_shift"] },
    medical:     { label: "Tibbiy yozuvlar", icon: "📋", perms: ["view", "edit_diagnosis", "edit_prescription"] },
    reports:     { label: "Hisobotlar", icon: "📈", perms: ["view", "export"] },
    audit:       { label: "Audit", icon: "📜", perms: ["view", "clear"] },
    settings:    { label: "Sozlamalar", icon: "⚙️", perms: ["view", "edit"] },
  };

  const INTEGRATION_TYPES = [
    { key: "website",     label: "🌐 Veb-sayt",          color: "#1e40af" },
    { key: "mobile_app",  label: "📱 Mobil ilova",       color: "#7c3aed" },
    { key: "ai_model",    label: "🤖 AI model",          color: "#7c3aed" },
    { key: "device",      label: "🔬 Tibbiy qurilma",    color: "#0369a1" },
    { key: "payment",     label: "💳 To'lov tizimi",     color: "#a16207" },
    { key: "sms",         label: "📨 SMS (o'chirilgan)",  color: "#64748b" },
    { key: "telegram",    label: "✈️ Telegram bot",      color: "#1e40af" },
    { key: "webhook",     label: "🔗 Webhook",           color: "#15803d" },
    { key: "database",    label: "🗄 Ma'lumotlar bazasi", color: "#7c3aed" },
    { key: "other",       label: "📦 Boshqa",            color: "#64748b" },
  ];

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════

  const api = {
    // ─── INIT ───
    async init() {
      const snap = await _api("/api/bootstrap");
      _cache = snap.data || {};
      _csrf = snap.csrf_token;
      _currentUser = snap.current_user;
      api.CURRENT_USER = _currentUser;
      api.ROLE = snap.role || _currentUser.role;
      // TIBEX_PWD_UI_v1: public csrf for password UI
      api._csrf_public = _csrf;
      _lastSnapshotRefreshAt = Date.now();

      // Bo'sh ro'yxatlarni ta'minlash
      if (!_cache.patients) _cache.patients = {};
      if (!_cache.appointments) _cache.appointments = [];
      if (!_cache.lab_orders) _cache.lab_orders = [];
      if (!_cache.payments) _cache.payments = [];
      if (!_cache.refunds) _cache.refunds = [];
      if (!_cache.users) _cache.users = [];
      if (!_cache.doctors) _cache.doctors = [];
      if (!_cache.services) _cache.services = [];
      if (!_cache.roles) _cache.roles = [];
      if (!_cache.equipment) _cache.equipment = [];
      if (!_cache.reagents) _cache.reagents = [];
      if (!_cache.integrations) _cache.integrations = [];
      if (!_cache.audit) _cache.audit = [];

      _connectWS();
      api._ensureFallbacks();
      return _cache;
    },

    // Tarmoq tiklanganda yoki WebSocket sokinlashganda snapshotni cheklangan tarzda yangilash.
    refresh() { _scheduleSnapshotRefresh(); },

    // ─── Sinxron snapshot ───
    getAll() { return _cache || {}; },
    save(d) { _cache = d; },        // eski interfeys uchun
    reset() { location.reload(); },

    subscribe(cb) { _subs.add(cb); return () => _subs.delete(cb); },
    unsubscribe(cb) { _subs.delete(cb); },

    // ─── Auth ───
    async logout() {
      // TIBEX_LOGOUT_RELIABILITY_FIX_v1: _api() 401'da o'zi login.html'ga
      // yo'naltiradi va xato tashlaydi — buni jim yutamiz. Boshqa xatolarda
      // (masalan tarmoq) ham baribir chiqib ketamiz, chunki bu yerda status
      // kodini tekshirish imkoni yo'q (_api faqat r.json() yoki throw qiladi).
      try {
        await _api("/api/auth/logout", { method: "POST" });
      } catch (e) {
        if (e.message !== "UNAUTHORIZED") {
          console.error("[TIBEX] Logout xatosi:", e);
        }
      }
      location.href = "/login.html";
    },

    // ─── Patients ───
    getPatient(id) { return ((_cache && _cache.patients) || {})[String(id)]; },
    getAllPatients() { return Object.values((_cache && _cache.patients) || {}); },

    addPatient(data) {
      const temp = { id: -Date.now(), ...data, _pending: true };
      _addLocal("patients", temp);
      _notify("local");

      _api("/api/patients", { method: "POST", body: data })
        .then((real) => {
          _removeLocal("patients", temp.id);
          _cache.patients[String(real.id)] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("patients", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    updatePatient(id, patch) {
      _patchLocal("patients", id, patch);
      _notify("local");
      _api(`/api/patients/${id}`, { method: "PATCH", body: patch }).catch(_err);
      return _cache.patients[String(id)];
    },

    deletePatient(id) {
      _removeLocal("patients", id);
      _notify("local");
      _api(`/api/patients/${id}`, { method: "DELETE" }).catch(_err);
      return true;
    },

    countPatientData(id) {
      const appts = (_cache.appointments || []).filter((a) => a.patient_id === id).length;
      const labs = (_cache.lab_orders || []).filter((o) => o.patient_id === id).length;
      const pays = (_cache.payments || []).filter((p) => p.patient_id === id).length;
      return { appointments: appts, labs, payments: pays };
    },

    async createPatientAccount(patientId, password) {
      return _api(`/api/patients/${patientId}/create-account`, {
        method: "POST",
        body: { password },
      });
    },

    async resetPatientPassword(patientId, password) {
      return _api(`/api/patients/${patientId}/reset-password`, {
        method: "POST",
        body: { password },
      });
    },

    // ─── Appointments ───
    getAppointments(filter = {}) {
      let a = (_cache && _cache.appointments) || [];
      if (filter.doctor_id) a = a.filter((x) => x.doctor_id === filter.doctor_id);
      if (filter.status) a = a.filter((x) => x.status === filter.status);
      if (filter.statuses) a = a.filter((x) => filter.statuses.includes(x.status));
      if (filter.date) a = a.filter((x) => x.date === filter.date);
      if (filter.patient_id) a = a.filter((x) => x.patient_id === filter.patient_id);
      if (filter.priority) a = a.filter((x) => x.priority === filter.priority);
      return a.slice().sort((x, y) => String(x.scheduled_time).localeCompare(String(y.scheduled_time)));
    },

    getAppointment(id) { return (_cache.appointments || []).find((a) => a.id === id); },

    addAppointment(data) {
      const temp = {
        id: -Date.now(),
        ...data,
        status: data.status || "waiting",
        priority: data.priority || "normal",
        paid: data.paid || 0,
        debt: data.debt || 0,
        created_at: Date.now(),
        _pending: true,
      };
      _addLocal("appointments", temp);
      _notify("local");

      _api("/api/appointments", { method: "POST", body: data })
        .then((real) => {
          const i = _cache.appointments.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.appointments[i] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("appointments", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    updateAppointment(id, patch) {
      _patchLocal("appointments", id, patch);
      _notify("local");
      _api(`/api/appointments/${id}`, { method: "PATCH", body: patch }).catch(_err);
      return _cache.appointments.find((a) => a.id === id);
    },

    // ─── Lab ───
    // TIBEX_CAMERA_FIX_v3: null-safe
    getLabOrders(filter = {}) {
      let o = (_cache && _cache.lab_orders) || [];
      if (filter.status) o = o.filter((x) => x.status === filter.status);
      if (filter.statuses) o = o.filter((x) => filter.statuses.includes(x.status));
      if (filter.patient_id) o = o.filter((x) => x.patient_id === filter.patient_id);
      if (filter.appointment_id) o = o.filter((x) => x.appointment_id === filter.appointment_id);
      return o.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },

    getLabOrder(id) { return (_cache.lab_orders || []).find((o) => o.id === id); },
    getLabOrdersByAppt(apptId) { return (_cache.lab_orders || []).filter((o) => o.appointment_id === apptId); },

    addLabOrder(data) {
      const temp = {
        id: `tmp-${Date.now()}`,
        ...data,
        status: data.status || "new",
        created_at: Date.now(),
        _pending: true,
      };
      _addLocal("lab_orders", temp);
      _notify("local");

      _api("/api/lab-orders", { method: "POST", body: data })
        .then((real) => {
          const i = _cache.lab_orders.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.lab_orders[i] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("lab_orders", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    updateLabOrder(id, patch) {
      _patchLocal("lab_orders", id, patch);
      _notify("local");
      _api(`/api/lab-orders/${id}`, { method: "PATCH", body: patch }).catch(_err);
      return _cache.lab_orders.find((o) => o.id === id);
    },

    // ─── Payments ───
    getPayments(filter = {}) {
      let p = (_cache && _cache.payments) || [];
      if (filter.status) p = p.filter((x) => x.status === filter.status);
      if (filter.patient_id) p = p.filter((x) => x.patient_id === filter.patient_id);
      if (filter.appointment_id) p = p.filter((x) => x.appointment_id === filter.appointment_id);
      if (filter.today) {
        const s = new Date(); s.setHours(0, 0, 0, 0);
        p = p.filter((x) => x.created_at >= s.getTime());
      }
      return p.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },

    addPayment(data) {
      const temp = {
        id: -Date.now(),
        ...data,
        status: "completed",
        created_at: Date.now(),
        cashier: _currentUser?.fullname || "—",
        _pending: true,
      };
      _addLocal("payments", temp);
      _notify("local");

      _api("/api/payments", { method: "POST", body: data, headers: { "Idempotency-Key": _idemKey() } })
        .then((real) => {
          const i = _cache.payments.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.payments[i] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("payments", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    // ─── Refunds ───
    getRefunds() { return (_cache.refunds || []).slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)); },

    addRefund(data) {
      const temp = { id: -Date.now(), ...data, created_at: Date.now(), _pending: true };
      _addLocal("refunds", temp);
      _notify("local");
      _api("/api/refunds", { method: "POST", body: data })
        .then((real) => {
          const i = _cache.refunds.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.refunds[i] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("refunds", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    // ─── Shift ───
    getShift() { return (_cache && _cache.shift) || { open: false, opening_balance: 0 }; },

    async closeShift(actualCash, note) {
      const rec = await _api("/api/shift/close", {
        method: "POST",
        body: { actual_cash: actualCash, note: note || "" },
      });
      _cache.shift = { open: false, ...rec };
      _notify("local");
      return rec;
    },

    // ─── Users ───
    getUsers() { return _cache.users || []; },

    /* TIBEX_USER_CRUD_v1: to'liqroq addUser (Promise qaytaradi) */
    addUser(data) {
      // Frontend validatsiya
      if (!data.fullname || !data.login || !data.password || !data.role) {
        return Promise.reject(new Error("Barcha majburiy maydonlarni to'ldiring"));
      }
      if (data.password.length < 8) {
        return Promise.reject(new Error("Parol kamida 8 belgi"));
      }
      // Login takrorlanishini oldindan tekshirish
      const exists = (_cache.users || []).some(
        (u) => u.login && u.login.toLowerCase() === data.login.toLowerCase()
      );
      if (exists) {
        return Promise.reject(new Error("Bu login band"));
      }

      const temp = { id: -Date.now(), ...data, active: true, _pending: true };
      delete temp.password;  // keshga parol yozmaslik
      _addLocal("users", temp);
      _notify("local");

      return _api("/api/users", { method: "POST", body: data })
        .then((real) => {
          _removeLocal("users", temp.id);
          _addLocal("users", real);
          _notify("local");
          return real;
        })
        .catch((e) => {
          _removeLocal("users", temp.id);
          _notify("local");
          throw e;
        });
    },

    /* TIBEX_USER_CRUD_v1: updateUser Promise qaytaradi */
    updateUser(id, patch) {
      const previous = (_cache?.users || []).find((x) => String(x.id) === String(id));
      const safe = { ...patch };
      delete safe.password;
      _patchLocal("users", id, safe);
      _notify("local");
      return _api(`/api/users/${id}`, { method: "PATCH", body: patch })
        .then((real) => {
          _patchLocal("users", id, real);
          _notify("local");
          return real;
        })
        .catch((e) => {
          if (previous) _patchLocal("users", id, previous);
          _notify("local");
          _err(e);
          throw e;
        });
    },

    deleteUser(id) {
      const previous = (_cache?.users || []).find((x) => String(x.id) === String(id));
      _removeLocal("users", id);
      _notify("local");
      return _api(`/api/users/${id}`, { method: "DELETE" }).catch((e) => {
        if (previous) _addLocal("users", previous);
        _notify("local");
        _err(e);
        throw e;
      });
    },

    /* TIBEX_SECURE_DELETE_v1: 2FA bilan o'chirish */
    async secureDeleteUser(id, password, confirmWord) {
      const res = await _api(`/api/users/${id}/secure-delete`, {
        method: "POST",
        body: { password: password, confirm_word: confirmWord },
      });
      _removeLocal("users", id);
      _notify("local");
      return res;
    },

    // ─── Admin Reset Password (TIBEX_SUPER_FIX_v2.1) ───
    // TIBEX_FIX_DEADCODE_v1: oldingi fallback /reset-password'ga bo'sh {} tana
    // yuborardi, lekin o'sha endpoint majburiy `new_password` maydonini talab
    // qiladi — demak fallback har doim 422 bilan yiqilardi. /admin-reset-password
    // va /reset-password mutlaqo boshqacha semantika: birinchisi tasodifiy parol
    // generatsiya qiladi (tanasiz), ikkinchisi esa aniq parol talab qiladi.
    // Shu sabab noto'g'ri "fallback" olib tashlandi — xatolik chaqiruvchiga
    // to'g'ridan-to'g'ri uzatiladi.
    // TIBEX_ADMIN_RESET_AUTH_FIX_v1: endi backend actorning o'z parolini
    // talab qiladi — shu sabab bu yerda ham majburiy parametr sifatida uzatiladi.
    async adminResetPassword(userId, actorPassword) {
      return await _api(`/api/users/${userId}/admin-reset-password`, {
        method: "POST",
        body: { password: actorPassword },
      });
    },

    // Aniq parol bilan reset qilish kerak bo'lsa, shu metoddan foydalaning:
    async resetPasswordWithValue(userId, newPassword, currentPassword) {
      return await _api(`/api/users/${userId}/reset-password`, {
        method: "POST",
        body: { new_password: newPassword, current_password: currentPassword },
      });
    },

    // ─── Doctors ───
    getDoctors() { return _cache.doctors || []; },

    addDoctor(data) {
      const temp = { id: -Date.now(), ...data, active: true, _pending: true };
      _addLocal("doctors", temp);
      _notify("local");
      _api("/api/doctors", { method: "POST", body: data })
        .then((real) => {
          const i = _cache.doctors.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.doctors[i] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("doctors", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    updateDoctor(id, patch) {
      _patchLocal("doctors", id, patch);
      _notify("local");
      _api(`/api/doctors/${id}`, { method: "PATCH", body: patch }).catch(_err);
    },

    deleteDoctor(id) {
      _removeLocal("doctors", id);
      _notify("local");
      _api(`/api/doctors/${id}`, { method: "DELETE" }).catch(_err);
    },

    // ─── Services ───
    getServices() { return _cache.services || []; },

    addService(data) {
      const temp = { id: -Date.now(), ...data, active: true, _pending: true };
      _addLocal("services", temp);
      _notify("local");
      _api("/api/services", { method: "POST", body: data })
        .then((real) => {
          const i = _cache.services.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.services[i] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("services", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    updateService(id, patch) {
      _patchLocal("services", id, patch);
      _notify("local");
      _api(`/api/services/${id}`, { method: "PATCH", body: patch }).catch(_err);
    },

    deleteService(id) {
      _removeLocal("services", id);
      _notify("local");
      _api(`/api/services/${id}`, { method: "DELETE" }).catch(_err);
    },

    // ─── Roles ───
    getRoles() { return _cache.roles || []; },
    getRoleByKey(k) { return (_cache.roles || []).find((r) => r.key === k); },

    addRole(data) {
      const temp = { id: -Date.now(), ...data, active: true, system: false, _pending: true };
      _addLocal("roles", temp);
      _notify("local");
      return _api("/api/roles", { method: "POST", body: data })
        .then((real) => {
          const i = _cache.roles.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.roles[i] = real;
          _notify("local");
          return real;
        })
        .catch((e) => {
          _removeLocal("roles", temp.id);
          _notify("local");
          _err(e);
          throw e;
        });
    },

    updateRole(id, patch) {
      const previous = (_cache?.roles || []).find((x) => String(x.id) === String(id));
      _patchLocal("roles", id, patch);
      _notify("local");
      return _api(`/api/roles/${id}`, { method: "PATCH", body: patch }).then((real) => {
        _patchLocal("roles", id, real); _notify("local"); return real;
      }).catch((e) => {
        if (previous) _patchLocal("roles", id, previous);
        _notify("local"); _err(e); throw e;
      });
    },

    async deleteRole(id) {
      try {
        await _api(`/api/roles/${id}`, { method: "DELETE" });
        _removeLocal("roles", id);
        _notify("local");
        return { success: true };
      } catch (e) {
        return { error: e.message };
      }
    },

    // ─── Equipment ───
    getEquipment() { return _cache.equipment || []; },

    addEquipment(data) {
      const temp = { id: -Date.now(), ...data, _pending: true };
      _addLocal("equipment", temp);
      _notify("local");
      _api("/api/equipment", { method: "POST", body: data })
        .then((real) => {
          const i = _cache.equipment.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.equipment[i] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("equipment", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    updateEquipment(id, patch) {
      _patchLocal("equipment", id, patch);
      _notify("local");
      _api(`/api/equipment/${id}`, { method: "PATCH", body: patch }).catch(_err);
    },

    deleteEquipment(id) {
      _removeLocal("equipment", id);
      _notify("local");
      _api(`/api/equipment/${id}`, { method: "DELETE" }).catch(_err);
    },

    // ─── Reagents ───
    getReagents() { return _cache.reagents || []; },

    addReagent(data) {
      const temp = { id: -Date.now(), ...data, _pending: true };
      _addLocal("reagents", temp);
      _notify("local");
      _api("/api/reagents", { method: "POST", body: data })
        .then((real) => {
          const i = _cache.reagents.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.reagents[i] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("reagents", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    updateReagent(id, patch) {
      _patchLocal("reagents", id, patch);
      _notify("local");
      _api(`/api/reagents/${id}`, { method: "PATCH", body: patch }).catch(_err);
    },

    deleteReagent(id) {
      _removeLocal("reagents", id);
      _notify("local");
      _api(`/api/reagents/${id}`, { method: "DELETE" }).catch(_err);
    },

    // ─── Integrations ───
    getIntegrations() { return _cache.integrations || []; },
    getIntegrationsByType(type) { return (_cache.integrations || []).filter((i) => i.type === type); },

    addIntegration(data) {
      const temp = { id: -Date.now(), ...data, last_sync: null, _pending: true };
      _addLocal("integrations", temp);
      _notify("local");
      _api("/api/integrations", { method: "POST", body: data })
        .then((real) => {
          const i = _cache.integrations.findIndex((x) => x.id === temp.id);
          if (i >= 0) _cache.integrations[i] = real;
          _notify("local");
        })
        .catch((e) => {
          _removeLocal("integrations", temp.id);
          _notify("local");
          _err(e);
        });
      return temp;
    },

    updateIntegration(id, patch) {
      _patchLocal("integrations", id, patch);
      _notify("local");
      _api(`/api/integrations/${id}`, { method: "PATCH", body: patch }).catch(_err);
    },

    deleteIntegration(id) {
      _removeLocal("integrations", id);
      _notify("local");
      _api(`/api/integrations/${id}`, { method: "DELETE" }).catch(_err);
    },

    syncIntegration(id) {
      _api(`/api/integrations/${id}/sync`, { method: "POST" })
        .then((r) => {
          _patchLocal("integrations", id, r);
          _notify("local");
        })
        .catch(_err);
    },

    // ─── Audit ───
    getAudit() { return _cache?.audit || []; },

    logAudit(action, detail) {
      _api("/api/audit", { method: "POST", body: { action, detail } }).catch(() => {});
    },

    // ─── Export ───
    exportData() { return _cache; },

    // ─── Kataloglar ───
    PERMISSION_CATALOG,
    INTEGRATION_TYPES,

    // ─── Joriy foydalanuvchi ───
    CURRENT_USER: null,
    ROLE: null,

    // ─── CSRF token boshqaruvi ───
    setCsrf(token) { _csrf = token; },
    getCsrf() { return _csrf; },

    // ─── Tizim sozlamalari ───
    _settingsCache: null,
    async getSettings(force = false) {
      if (this._settingsCache && !force) return this._settingsCache;
      try {
        const s = await _api("/api/settings");
        this._settingsCache = s;
        return s;
      } catch (e) { _err(e); return {}; }
    },
    async saveSettings(patch) {
      const s = await _api("/api/settings", { method: "PATCH", body: patch });
      this._settingsCache = s;
      // TIBEX_DISCOUNT_LIMIT_LIVE_SYNC_FIX_v1: o'zgartirgan sessiyaning
      // o'zida ham system_info.finance/clinic'ni WS xabarini kutmasdan
      // darhol yangilaymiz — WS event boshqa (masalan kassa) sessiyalarga
      // yetkazadi, bu yerda o'z-o'zidan yangilanishi kerak.
      if (_cache && _cache.system_info) {
        if (!_cache.system_info.finance) _cache.system_info.finance = {};
        if (!_cache.system_info.clinic) _cache.system_info.clinic = {};
        if (s.discount_limit !== undefined) {
          _cache.system_info.finance.discount_limit = Number(s.discount_limit);
        }
        if (s.vat !== undefined) {
          _cache.system_info.finance.vat = Boolean(s.vat);
        }
        if (s.clinic_name !== undefined) _cache.system_info.clinic.name = s.clinic_name;
        if (s.clinic_phone !== undefined) _cache.system_info.clinic.phone = s.clinic_phone;
        if (s.clinic_address !== undefined) _cache.system_info.clinic.address = s.clinic_address;
      }
      _notify("local");
      return s;
    },

    // ─── Eksport ───
    downloadFile(url, fallbackName) {
      const a = document.createElement("a");
      a.href = API + url;
      a.download = fallbackName || "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    exportXlsx(kind) {
      const map = {
        payments: "payments.xlsx", refunds: "refunds.xlsx",
        appointments: "appointments.xlsx", patients: "patients.xlsx",
        audit: "audit.xlsx", lab_orders: "lab_orders.xlsx",
        debtors: "debtors.xlsx",
      };
      const f = map[kind]; if (!f) return _err(new Error("Noma'lum: " + kind));
      this.downloadFile(`/api/export/${f}`, f);
    },
    openPdf(kind) {
      const map = { payments: "payments.pdf" };
      const f = map[kind]; if (!f) return _err(new Error("Noma'lum: " + kind));
      window.open(API + `/api/export/${f}`, "_blank");
    },
    exportAllJson() {
      this.downloadFile("/api/export/all.json", "tibex_backup.json");
    },

    // ─── SMS ───
    async sendBulkSms(phones, message) {
      throw new Error("SMS xizmati o'chirilgan. Bemorlar uchun Telegram botdan foydalaning.");
    },

    // ─── Monitoring ───
    async getHealth() { return _api("/api/monitoring/health"); },
    async getErrors(limit = 50) { return _api(`/api/monitoring/errors?limit=${limit}`); },
    async getAlerts(limit = 30) { return _api(`/api/monitoring/alerts?limit=${limit}`); },
    async clearErrors() { return _api("/api/monitoring/clear-errors", { method: "POST" }); },

    // ─── SUPER FIX: fallback wrapperlar ───
    _ensureFallbacks() {
      const self = this;
      if (typeof self.exportXlsx !== "function") {
        self.exportXlsx = function (kind) {
          try { self.downloadFile("/api/export/" + kind + ".xlsx", kind + ".xlsx"); } catch (e) { _err(e); }
        };
      }
      if (typeof self.openPdf !== "function") {
        self.openPdf = function (kind) {
          try { window.open(API + "/api/export/" + kind + ".pdf", "_blank"); } catch (e) { _err(e); }
        };
      }
      if (typeof self.exportAllJson !== "function") {
        self.exportAllJson = function () {
          try { self.downloadFile("/api/export/all.json", "tibex_backup.json"); } catch (e) { _err(e); }
        };
      }
      if (typeof self.getHealth !== "function") {
        self.getHealth = async function () { return _api("/api/monitoring/health"); };
      }
      // TIBEX_ROLE_FORTRESS_v1: universal can()
      if (typeof self.can !== "function") {
        self.can = function (module, action) {
          try {
            var user = _currentUser;
            if (!user) return false;
            var role = (_cache.roles || []).find(function (r) { return r.key === user.role; });
            if (!role) return false;
            if (!role.active) return false;
            if (role.permissions === "*") return true;
            return (role.permissions || []).indexOf(module + "." + action) >= 0;
          } catch (e) { return false; }
        };
      }
      return true;
    },

    // ─── Xom API (maxsus holatlar uchun) ───
    _api,
  };

  return api;
})();
