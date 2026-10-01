/* ═══════════════════════════════════════════════════════════════
   TIBEX — Bemor kabineti (bemor.html) logikasi
   Ruxsatlarga moslashuvchi aqlli tizim.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ─── API base ─────────────────────────────────────────────────
  const API_BASE = (() => {
    if (typeof window.__API_BASE__ === "string") return window.__API_BASE__;
    const loc = window.location;
    if (["8000", "", "443", "80"].includes(loc.port)) return "";
    return loc.protocol + "//" + loc.hostname + ":8000";
  })();

  // ─── State ────────────────────────────────────────────────────
  const state = {
    view: "summary",
    patient: null,
    permissions: {
      view: true,
      edit_profile: true,
      change_password: false,
      view_appointments: true,
      view_lab: true,
      view_payments: true,
    },
    data: {
      summary: null,
      appointments: [],
      labs: [],
      payments: [],
    },
    csrf: null,
    tgPolling: null,
    theme: "light",
    fontSize: "md",
  };

  // ─── Helpers ──────────────────────────────────────────────────
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = window.esc || (s => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;"));

  function initials(name) {
    const s = String(name || "?").trim();
    if (!s) return "?";
    return s.split(/\s+/).slice(0, 2).map(x => x[0] || "").join("").toUpperCase() || "?";
  }
  function fmtDate(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    if (isNaN(d)) return "—";
    return String(d.getDate()).padStart(2, "0") + "." +
           String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
  }
  function fmtTime(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    if (isNaN(d)) return "—";
    return String(d.getHours()).padStart(2, "0") + ":" +
           String(d.getMinutes()).padStart(2, "0");
  }
  function fmtDT(ms) {
    if (!ms) return "—";
    return fmtDate(ms) + " " + fmtTime(ms);
  }
  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("ru-RU").replace(/,/g, " ") + " so'm";
  }
  function can(perm) {
    return state.permissions && state.permissions[perm] === true;
  }

  // ─── Toast ────────────────────────────────────────────────────
  let _toastTimer = null;
  function toast(msg, type, dur) {
    const el = $("#bpToast");
    if (!el) return;
    el.textContent = msg;
    el.className = "bp-toast show " + (type || "");
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove("show"), dur || 3200);
  }

  // ─── API ──────────────────────────────────────────────────────
  async function api(path, opts) {
    opts = opts || {};
    const method = (opts.method || "GET").toUpperCase();
    const headers = { "Content-Type": "application/json" };
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrf) {
      headers["X-CSRF-Token"] = state.csrf;
    }
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 30000);
    let r;
    try {
      r = await fetch(API_BASE + path, {
        method: method,
        credentials: "include",
        headers: headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e.name === "AbortError") throw new Error("So'rov vaqti tugadi");
      throw e;
    } finally {
      clearTimeout(tid);
    }
    if (r.status === 401) {
      let why = "";
      try { why = (await r.json()).detail || ""; } catch (_) {}
      toast(why || "Sessiya tugadi, qayta kiring", "bad");
      setTimeout(() => { location.href = "bemor-login.html"; }, 1800);
      throw new Error("UNAUTHORIZED");
    }
    if (r.status === 204) return null;
    if (!r.ok) {
      let msg = r.statusText;
      try { const e = await r.json(); msg = e.detail || msg; } catch (_) {}
      throw new Error(msg);
    }
    return r.json();
  }

  async function loadCsrf() {
    try {
      const r = await api("/api/portal/csrf");
      state.csrf = r && r.csrf_token ? r.csrf_token : null;
    } catch (e) {
      if (e.message === "UNAUTHORIZED") throw e;
      console.warn("[bemor] CSRF olinmadi:", e.message);
    }
  }

  // ─── Permissions ──────────────────────────────────────────────
  async function loadPermissions() {
    try {
      const r = await api("/api/portal/permissions");
      if (r && r.permissions && typeof r.permissions === "object") {
        state.permissions = Object.assign(state.permissions, r.permissions);
        return;
      }
    } catch (e) {
      if (e.message === "UNAUTHORIZED") throw e;
    }
    state.permissions = {
      view: true,
      edit_profile: true,
      change_password: false,
      view_appointments: true,
      view_lab: true,
      view_payments: true,
    };
  }

  // ─── Menus ────────────────────────────────────────────────────
  const MENUS = [
    { key: "summary",      label: "Bosh sahifa", ico: "🏠", perm: "view" },
    { key: "appointments", label: "Tashriflar",  ico: "📅", perm: "view_appointments" },
    { key: "labs",         label: "Tahlillar",   ico: "🔬", perm: "view_lab" },
    { key: "payments",     label: "To'lovlar",   ico: "💰", perm: "view_payments" },
    { key: "profile",      label: "Profil",      ico: "👤", perm: "view" },
  ];

  function visibleMenus() {
    return MENUS.filter(m => can(m.perm));
  }

  function renderTabs() {
    const tabs = $("#bpTabs");
    const bnav = $("#bpBottomNav");
    const menus = visibleMenus();

    if (tabs) {
      tabs.innerHTML = menus.map(m =>
        '<button class="bp-tab' + (state.view === m.key ? " active" : "") + '" data-view="' + m.key + '" role="tab">' +
          '<span class="bp-tab-ico">' + m.ico + '</span>' +
          '<span>' + esc(m.label) + '</span>' +
        '</button>'
      ).join("");
      $$(".bp-tab", tabs).forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
    }

    if (bnav) {
      bnav.innerHTML = menus.map(m =>
        '<button class="bp-bnav-item' + (state.view === m.key ? " active" : "") + '" data-view="' + m.key + '" aria-label="' + esc(m.label) + '">' +
          '<span class="bp-bnav-ico">' + m.ico + '</span>' +
          '<span class="bp-bnav-label">' + esc(m.label) + '</span>' +
        '</button>'
      ).join("");
      $$(".bp-bnav-item", bnav).forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
    }
  }

  function setView(view) {
    const menus = visibleMenus();
    if (!menus.some(m => m.key === view)) view = menus[0] ? menus[0].key : "summary";
    state.view = view;
    renderTabs();
    renderView();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Drawer ───────────────────────────────────────────────────
  function openDrawer() {
    renderDrawer();
    const dr = $("#bpDrawer");
    if (dr) {
      dr.classList.add("open");
      dr.setAttribute("aria-hidden", "false");
    }
    const bd = $("#bpBackdrop");
    if (bd) bd.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    const dr = $("#bpDrawer");
    if (dr) {
      dr.classList.remove("open");
      dr.setAttribute("aria-hidden", "true");
    }
    const bd = $("#bpBackdrop");
    if (bd) bd.classList.remove("open");
    document.body.style.overflow = "";
  }

  function renderDrawer() {
    const body = $("#bpDrawerBody");
    if (!body) return;

    const theme = state.theme;
    const font  = state.fontSize;
    const sections = [];

    // Ko'rinish
    sections.push(
      '<div class="bp-sec">' +
        '<div class="bp-sec-title">🎨 Ko\'rinish</div>' +
        '<div class="bp-row">' +
          '<div class="bp-row-info">' +
            '<div class="bp-row-label">Mavzu</div>' +
            '<div class="bp-row-sub">Kun / Tun / Avto</div>' +
          '</div>' +
        '</div>' +
        '<div class="bp-chips-row" data-set="theme">' +
          '<button class="bp-toggle-chip' + (theme === "light" ? " on" : "") + '" data-v="light">☀️ Kun</button>' +
          '<button class="bp-toggle-chip' + (theme === "dark" ? " on" : "") + '" data-v="dark">🌙 Tun</button>' +
          '<button class="bp-toggle-chip' + (theme === "auto" ? " on" : "") + '" data-v="auto">🖥 Avto</button>' +
        '</div>' +
        '<div class="bp-row">' +
          '<div class="bp-row-info">' +
            '<div class="bp-row-label">Shrift o\'lchami</div>' +
            '<div class="bp-row-sub">Matn kattaligi</div>' +
          '</div>' +
        '</div>' +
        '<div class="bp-chips-row" data-set="fontSize">' +
          '<button class="bp-toggle-chip' + (font === "sm" ? " on" : "") + '" data-v="sm">Kichik</button>' +
          '<button class="bp-toggle-chip' + (font === "md" ? " on" : "") + '" data-v="md">O\'rta</button>' +
          '<button class="bp-toggle-chip' + (font === "lg" ? " on" : "") + '" data-v="lg">Katta</button>' +
          '<button class="bp-toggle-chip' + (font === "xl" ? " on" : "") + '" data-v="xl">J. katta</button>' +
        '</div>' +
      '</div>'
    );

    // Profil
    if (can("edit_profile")) {
      sections.push(
        '<div class="bp-sec">' +
          '<div class="bp-sec-title">👤 Profil</div>' +
          '<button class="bp-row-btn" data-action="edit-profile">' +
            '<span class="bp-row-icon">✏️</span>' +
            '<span class="bp-row-info">' +
              '<span class="bp-row-label">Profilni tahrirlash</span>' +
              '<span class="bp-row-sub">Telefon va manzilni o\'zgartirish</span>' +
            '</span>' +
            '<span class="bp-row-chevron">›</span>' +
          '</button>' +
        '</div>'
      );
    }

    // Xavfsizlik
    if (can("change_password")) {
      sections.push(
        '<div class="bp-sec">' +
          '<div class="bp-sec-title">🔒 Xavfsizlik</div>' +
          '<button class="bp-row-btn" data-action="change-password">' +
            '<span class="bp-row-icon">🔑</span>' +
            '<span class="bp-row-info">' +
              '<span class="bp-row-label">Parolni almashtirish</span>' +
              '<span class="bp-row-sub">Zaxira kirish yo\'li</span>' +
            '</span>' +
            '<span class="bp-row-chevron">›</span>' +
          '</button>' +
        '</div>'
      );
    }

    // Telegram
    const linked = !!(state.patient && state.patient.telegram_linked);
    let tgHtml = '<div class="bp-sec"><div class="bp-sec-title">✈️ Telegram</div>';
    if (linked) {
      tgHtml +=
        '<div class="bp-row">' +
          '<div class="bp-row-info">' +
            '<div class="bp-row-label">Ulangan</div>' +
            '<div class="bp-row-sub">Kodlar botga keladi</div>' +
          '</div>' +
          '<span class="bp-badge ok">Faol</span>' +
        '</div>' +
        '<button class="bp-row-btn" data-action="tg-unlink">' +
          '<span class="bp-row-icon">🔌</span>' +
          '<span class="bp-row-info"><span class="bp-row-label">Ulanishni uzish</span></span>' +
          '<span class="bp-row-chevron">›</span>' +
        '</button>';
    } else {
      tgHtml +=
        '<div class="bp-row">' +
          '<div class="bp-row-info">' +
            '<div class="bp-row-label">Ulanmagan</div>' +
            '<div class="bp-row-sub">Botni ulash orqali kod oling</div>' +
          '</div>' +
          '<span class="bp-badge muted">Yo\'q</span>' +
        '</div>' +
        '<button class="bp-row-btn" data-action="tg-link">' +
          '<span class="bp-row-icon">🔗</span>' +
          '<span class="bp-row-info"><span class="bp-row-label">Telegram botni ulash</span></span>' +
          '<span class="bp-row-chevron">›</span>' +
        '</button>';
    }
    tgHtml += '</div>';
    sections.push(tgHtml);

    body.innerHTML = sections.join("");
    bindDrawerEvents();
  }

  function bindDrawerEvents() {
    $$("#bpDrawerBody .bp-chips-row").forEach(function (group) {
      const key = group.dataset.set;
      $$(".bp-toggle-chip", group).forEach(function (chip) {
        chip.addEventListener("click", function () {
          const v = chip.dataset.v;
          if (key === "theme") {
            state.theme = v;
            applyTheme();
          } else if (key === "fontSize") {
            state.fontSize = v;
            applyFontSize();
          }
          savePrefs();
          renderDrawer();
        });
      });
    });
    $$("#bpDrawerBody [data-action]").forEach(function (b) {
      b.addEventListener("click", function () {
        const a = b.dataset.action;
        if (a === "edit-profile") { closeDrawer(); openProfileEdit(); }
        else if (a === "change-password") { closeDrawer(); openModal("changePwdModal"); }
        else if (a === "tg-link") { closeDrawer(); startTelegramLink(); }
        else if (a === "tg-unlink") { tgUnlink(); }
      });
    });
  }

  // ─── Prefs ────────────────────────────────────────────────────
  const PREFS_KEY = "tibex_bemor_prefs_v1";
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.theme) state.theme = p.theme;
      if (p.fontSize) state.fontSize = p.fontSize;
    } catch (_) {}
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        theme: state.theme, fontSize: state.fontSize,
      }));
    } catch (_) {}
  }
  function applyTheme() {
    const t = state.theme === "auto"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : state.theme;
    document.documentElement.setAttribute("data-theme", t);
  }
  function applyFontSize() {
    const sizes = { sm: "13.5px", md: "15px", lg: "16.5px", xl: "18px" };
    document.body.style.fontSize = sizes[state.fontSize] || sizes.md;
  }

  // ─── Status labels ────────────────────────────────────────────
  function statusLabel(s) {
    return ({
      waiting: "Kutmoqda", arrived: "Keldi", in_progress: "Qabulda",
      lab_waiting: "Lab kutish", lab_ready: "Lab tayyor",
      completed: "Yakunlangan", cancelled: "Bekor",
    })[s] || s || "—";
  }
  function statusBadgeClass(s) {
    return ({
      waiting: "warn", arrived: "info", in_progress: "warn",
      lab_waiting: "warn", lab_ready: "ok",
      completed: "ok", cancelled: "muted",
    })[s] || "muted";
  }
  function labStatusLabel(s) {
    return ({
      new: "Yangi", received: "Qabul qilindi", processing: "Jarayonda",
      ready: "Tayyor", verified: "Tasdiqlangan",
    })[s] || s || "—";
  }
  function labBadgeClass(s) {
    return ({
      new: "warn", received: "info", processing: "warn",
      ready: "warn", verified: "ok",
    })[s] || "muted";
  }
  function methodLabel(m) {
    return ({ cash: "💵 Naqd", card: "💳 Karta", online: "📱 Onlayn" })[m] || m || "—";
  }

  // ─── Views ────────────────────────────────────────────────────
  const VIEWS = {};

  VIEWS.summary = function () {
    const s = state.data.summary || {};
    const appts = state.data.appointments.slice(0, 5);
    const name = (state.patient && state.patient.fullname) || "bemor";
    let tableHtml;
    if (appts.length) {
      tableHtml =
        '<div class="bp-table-wrap"><table class="bp-table">' +
          '<thead><tr><th>Sana</th><th>Shifokor</th><th>Xizmat</th><th>Holat</th></tr></thead>' +
          '<tbody>' +
          appts.map(function (a) {
            return '<tr>' +
              '<td class="mono">' + esc(a.date || "—") + '</td>' +
              '<td>' + esc(a.doctor_name || "—") + '</td>' +
              '<td>' + esc((a.service && a.service.name) || "—") + '</td>' +
              '<td><span class="bp-badge ' + statusBadgeClass(a.status) + '">' + esc(statusLabel(a.status)) + '</span></td>' +
            '</tr>';
          }).join("") +
          '</tbody></table></div>';
    } else {
      tableHtml = '<div class="bp-empty"><div class="bp-empty-ico">📭</div><div>Hozircha tashriflar yo\'q</div></div>';
    }
    return '' +
      '<div class="bp-view active">' +
        '<div class="bp-view-head">' +
          '<h1 class="bp-view-title">Salom, ' + esc(name) + '!</h1>' +
          '<p class="bp-view-sub">Sizning shaxsiy kabinetingiz</p>' +
        '</div>' +
        '<div class="bp-stats">' +
          '<div class="bp-stat blue">' +
            '<div class="bp-stat-icon">📅</div>' +
            '<div class="bp-stat-value">' + (s.appointments_count || 0) + '</div>' +
            '<div class="bp-stat-label">Jami tashriflar</div>' +
          '</div>' +
          '<div class="bp-stat">' +
            '<div class="bp-stat-icon">🔬</div>' +
            '<div class="bp-stat-value">' + (s.lab_orders_count || 0) + '</div>' +
            '<div class="bp-stat-label">Lab tahlillar</div>' +
          '</div>' +
          '<div class="bp-stat green">' +
            '<div class="bp-stat-icon">💰</div>' +
            '<div class="bp-stat-value">' + fmtMoney(s.total_paid) + '</div>' +
            '<div class="bp-stat-label">To\'langan</div>' +
          '</div>' +
          '<div class="bp-stat red">' +
            '<div class="bp-stat-icon">⚠️</div>' +
            '<div class="bp-stat-value">' + fmtMoney(s.total_debt) + '</div>' +
            '<div class="bp-stat-label">Joriy qarz</div>' +
          '</div>' +
        '</div>' +
        '<div class="bp-card">' +
          '<div class="bp-card-head"><div class="bp-card-title">🕒 Oxirgi tashriflar</div></div>' +
          tableHtml +
        '</div>' +
      '</div>';
  };

  VIEWS.appointments = function () {
    const rows = state.data.appointments;
    let body;
    if (rows.length) {
      body =
        '<div class="bp-table-wrap"><table class="bp-table">' +
          '<thead><tr><th>Sana</th><th>Vaqt</th><th>Shifokor</th><th>Xizmat</th><th>Holat</th><th>Tashxis</th></tr></thead>' +
          '<tbody>' +
          rows.map(function (a) {
            return '<tr>' +
              '<td class="mono">' + esc(a.date || "—") + '</td>' +
              '<td class="mono">' + esc(a.scheduled_time || "—") + '</td>' +
              '<td>' + esc(a.doctor_name || "—") + '</td>' +
              '<td>' + esc((a.service && a.service.name) || "—") + '</td>' +
              '<td><span class="bp-badge ' + statusBadgeClass(a.status) + '">' + esc(statusLabel(a.status)) + '</span></td>' +
              '<td>' + esc(a.final_dx || a.prelim_dx || "—") + '</td>' +
            '</tr>';
          }).join("") +
          '</tbody></table></div>';
    } else {
      body = '<div class="bp-empty"><div class="bp-empty-ico">📭</div><div>Tashriflar yo\'q</div></div>';
    }
    return '' +
      '<div class="bp-view active">' +
        '<div class="bp-view-head">' +
          '<h1 class="bp-view-title">Tashriflar</h1>' +
          '<p class="bp-view-sub">Sizning barcha qabullaringiz</p>' +
        '</div>' +
        '<div class="bp-card">' +
          '<div class="bp-card-head"><div class="bp-card-title">📅 Qabullar <span class="bp-count">' + rows.length + '</span></div></div>' +
          body +
        '</div>' +
      '</div>';
  };

  VIEWS.labs = function () {
    const rows = state.data.labs;
    let body;
    if (rows.length) {
      body =
        '<div class="bp-table-wrap"><table class="bp-table">' +
          '<thead><tr><th>Tahlil</th><th>Holat</th><th>Natija</th><th>Tasdiqlangan</th></tr></thead>' +
          '<tbody>' +
          rows.map(function (o) {
            return '<tr>' +
              '<td><b>' + esc(o.test_name || "—") + '</b></td>' +
              '<td><span class="bp-badge ' + labBadgeClass(o.status) + '">' + esc(labStatusLabel(o.status)) + '</span></td>' +
              '<td>' + esc(o.result_summary || "—") + '</td>' +
              '<td class="mono">' + fmtDate(o.verified_at) + '</td>' +
            '</tr>';
          }).join("") +
          '</tbody></table></div>';
    } else {
      body = '<div class="bp-empty"><div class="bp-empty-ico">🧪</div><div>Tahlillar yo\'q</div></div>';
    }
    return '' +
      '<div class="bp-view active">' +
        '<div class="bp-view-head">' +
          '<h1 class="bp-view-title">Tahlillar</h1>' +
          '<p class="bp-view-sub">Laboratoriya natijalaringiz</p>' +
        '</div>' +
        '<div class="bp-card">' +
          '<div class="bp-card-head"><div class="bp-card-title">🔬 Lab natijalar <span class="bp-count">' + rows.length + '</span></div></div>' +
          body +
        '</div>' +
      '</div>';
  };

  VIEWS.payments = function () {
    const rows = state.data.payments;
    let body;
    if (rows.length) {
      body =
        '<div class="bp-table-wrap"><table class="bp-table">' +
          '<thead><tr><th>Sana</th><th>Summa</th><th>Usul</th><th>Holat</th></tr></thead>' +
          '<tbody>' +
          rows.map(function (p) {
            const ok = p.status === "completed" || p.status === "paid";
            return '<tr>' +
              '<td class="mono">' + fmtDT(p.created_at) + '</td>' +
              '<td class="mono"><b>' + fmtMoney(p.amount) + '</b></td>' +
              '<td>' + esc(methodLabel(p.method)) + '</td>' +
              '<td><span class="bp-badge ' + (ok ? "ok" : "warn") + '">' + esc(p.status || "—") + '</span></td>' +
            '</tr>';
          }).join("") +
          '</tbody></table></div>';
    } else {
      body = '<div class="bp-empty"><div class="bp-empty-ico">💳</div><div>To\'lovlar yo\'q</div></div>';
    }
    return '' +
      '<div class="bp-view active">' +
        '<div class="bp-view-head">' +
          '<h1 class="bp-view-title">To\'lovlar</h1>' +
          '<p class="bp-view-sub">Sizning to\'lovlar tarixi</p>' +
        '</div>' +
        '<div class="bp-card">' +
          '<div class="bp-card-head"><div class="bp-card-title">💰 To\'lovlar <span class="bp-count">' + rows.length + '</span></div></div>' +
          body +
        '</div>' +
      '</div>';
  };

  VIEWS.profile = function () {
    const p = state.patient || {};
    const allergies = (p.allergies && p.allergies.length)
      ? '<div class="bp-chips">' + p.allergies.map(function (a) {
          return '<span class="bp-chip warn">⚠ ' + esc(a) + '</span>';
        }).join("") + '</div>'
      : '<div class="bp-profile-value">Yo\'q</div>';
    const chronic = (p.chronic && p.chronic.length)
      ? '<div class="bp-chips">' + p.chronic.map(function (c) {
          return '<span class="bp-chip">💊 ' + esc(c) + '</span>';
        }).join("") + '</div>'
      : '<div class="bp-profile-value">Yo\'q</div>';
    const editBtn = can("edit_profile")
      ? '<button class="bp-btn sm" data-action="edit-profile" style="margin-left:auto">✏️ Tahrirlash</button>'
      : '';

    return '' +
      '<div class="bp-view active">' +
        '<div class="bp-view-head">' +
          '<h1 class="bp-view-title">Profil</h1>' +
          '<p class="bp-view-sub">Shaxsiy ma\'lumotlaringiz</p>' +
        '</div>' +
        '<div class="bp-card">' +
          '<div class="bp-card-head">' +
            '<div class="bp-card-title">👤 Shaxsiy ma\'lumotlar</div>' +
            editBtn +
          '</div>' +
          '<div class="bp-card-body">' +
            '<div class="bp-profile-grid">' +
              '<div class="bp-profile-item full">' +
                '<div class="bp-profile-label">F.I.Sh</div>' +
                '<div class="bp-profile-value">' + esc(p.fullname || "—") + '</div>' +
              '</div>' +
              '<div class="bp-profile-item">' +
                '<div class="bp-profile-label">Telefon</div>' +
                '<div class="bp-profile-value mono">' + esc(p.phone || "—") + '</div>' +
              '</div>' +
              '<div class="bp-profile-item">' +
                '<div class="bp-profile-label">Yosh</div>' +
                '<div class="bp-profile-value mono">' + esc(p.age != null ? p.age : "—") + '</div>' +
              '</div>' +
              '<div class="bp-profile-item">' +
                '<div class="bp-profile-label">Jins</div>' +
                '<div class="bp-profile-value">' + esc(p.gender || "—") + '</div>' +
              '</div>' +
              '<div class="bp-profile-item">' +
                '<div class="bp-profile-label">Qon guruhi</div>' +
                '<div class="bp-profile-value mono">' + esc(p.blood || "—") + '</div>' +
              '</div>' +
              '<div class="bp-profile-item full">' +
                '<div class="bp-profile-label">Manzil</div>' +
                '<div class="bp-profile-value">' + esc(p.address || "—") + '</div>' +
              '</div>' +
              '<div class="bp-profile-item full">' +
                '<div class="bp-profile-label">Allergiyalar</div>' + allergies +
              '</div>' +
              '<div class="bp-profile-item full">' +
                '<div class="bp-profile-label">Surunkali kasalliklar</div>' + chronic +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bp-card">' +
          '<div class="bp-card-head"><div class="bp-card-title">✈️ Telegram ulanishi</div></div>' +
          '<div class="bp-card-body">' +
            '<div class="bp-notice info"><span>Bot orqali kirish kodlari keladi. Sozlamalardan ulashingiz mumkin.</span></div>' +
            '<button class="bp-btn primary block" data-action="open-settings">⚙️ Sozlamalarni ochish</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  };

  function renderView() {
    const main = $("#bpMain");
    if (!main) return;
    const fn = VIEWS[state.view] || VIEWS.summary;
    main.innerHTML = fn();
    bindViewEvents();
  }

  function bindViewEvents() {
    $$("[data-action]").forEach(function (b) {
      b.addEventListener("click", function () {
        const a = b.dataset.action;
        if (a === "edit-profile") openProfileEdit();
        else if (a === "open-settings") openDrawer();
      });
    });
  }

  // ─── Modal helpers ────────────────────────────────────────────
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) { el.hidden = false; document.body.style.overflow = "hidden"; }
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) { el.hidden = true; document.body.style.overflow = ""; }
  }

  // ─── Profile edit ─────────────────────────────────────────────
  function openProfileEdit() {
    if (!can("edit_profile")) {
      toast("Profilni tahrirlash ruxsati yo'q", "warn");
      return;
    }
    const p = state.patient || {};
    const ph = $("#editPhone");
    const ad = $("#editAddress");
    if (ph) ph.value = p.phone || "+998 ";
    if (ad) ad.value = p.address || "";
    openModal("profileEditModal");
    setTimeout(function () { if (ph) ph.focus(); }, 80);
  }

  async function saveProfile() {
    const phone = ($("#editPhone") || {}).value ? $("#editPhone").value.trim() : "";
    const address = ($("#editAddress") || {}).value ? $("#editAddress").value.trim() : "";
    const body = {};
    if (phone && phone !== (state.patient && state.patient.phone)) body.phone = phone;
    if (address !== ((state.patient && state.patient.address) || "")) body.address = address;
    if (Object.keys(body).length === 0) {
      closeModal("profileEditModal");
      return;
    }
    const btn = $("#btnSaveProfile");
    if (btn) btn.disabled = true;
    try {
      await api("/api/portal/me", { method: "PATCH", body: body });
      toast("Profil yangilandi", "ok");
      closeModal("profileEditModal");
      await loadPatient();
      renderView();
      renderDrawer();
    } catch (e) {
      toast(e.message || "Xatolik", "bad");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ─── Password change ──────────────────────────────────────────
  async function savePassword() {
    const oldP = ($("#pwdOld") || {}).value || "";
    const newP = ($("#pwdNew") || {}).value || "";
    const conf = ($("#pwdConfirm") || {}).value || "";
    if (!oldP || !newP || !conf) return toast("Barcha maydonlarni to'ldiring", "warn");
    if (newP.length < 10) return toast("Parol kamida 10 belgi", "warn");
    if (newP !== conf) return toast("Parollar mos emas", "warn");
    if (oldP === newP) return toast("Yangi parol eskisidan farq qilsin", "warn");
    const btn = $("#btnSavePassword");
    if (btn) btn.disabled = true;
    try {
      await api("/api/portal/change-password", {
        method: "POST",
        body: { old_password: oldP, new_password: newP },
      });
      toast("Parol almashtirildi", "ok");
      closeModal("changePwdModal");
      if ($("#pwdOld")) $("#pwdOld").value = "";
      if ($("#pwdNew")) $("#pwdNew").value = "";
      if ($("#pwdConfirm")) $("#pwdConfirm").value = "";
    } catch (e) {
      toast(e.message || "Xatolik", "bad");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ─── Telegram link ────────────────────────────────────────────
  async function startTelegramLink() {
    try {
      if (!state.csrf) await loadCsrf();
      const r = await api("/api/portal/telegram/link-token", { method: "POST" });
      if (!r || !r.link) throw new Error("Havola olinmadi");
      const w = window.open(r.link, "_blank", "noopener");
      if (!w) location.href = r.link;
      toast("Botni ochib, raqamni yuboring", "info", 5000);
      if (state.tgPolling) clearInterval(state.tgPolling);
      state.tgPolling = setInterval(async function () {
        try {
          const s = await api("/api/portal/telegram/status");
          if (s && s.linked) {
            clearInterval(state.tgPolling);
            state.tgPolling = null;
            toast("Telegram ulandi!", "ok");
            await loadPatient();
            renderDrawer();
          }
        } catch (_) {}
      }, 3000);
      setTimeout(function () {
        if (state.tgPolling) { clearInterval(state.tgPolling); state.tgPolling = null; }
      }, (r.ttl_seconds || 600) * 1000);
    } catch (e) {
      toast(e.message || "Xatolik", "bad");
    }
  }

  async function tgUnlink() {
    if (!confirm("Telegram ulanishini uzishni tasdiqlaysizmi?")) return;
    try {
      await api("/api/portal/telegram/unlink", { method: "POST" });
      toast("Telegram uzildi", "ok");
      await loadPatient();
      renderDrawer();
    } catch (e) {
      toast(e.message || "Xatolik", "bad");
    }
  }

  // ─── Data loaders ─────────────────────────────────────────────
  async function loadPatient() {
    const p = await api("/api/portal/me");
    state.patient = p;
    try {
      const s = await api("/api/portal/telegram/status");
      state.patient.telegram_linked = !!(s && s.linked);
      state.patient.telegram_available = !!(s && s.available);
    } catch (_) {}
    const nm = p.fullname || "Bemor";
    if ($("#userName")) $("#userName").textContent = nm;
    if ($("#userAvatar")) $("#userAvatar").textContent = initials(nm);
  }

  async function loadSummary()      { state.data.summary = await api("/api/portal/summary"); }
  async function loadAppointments() { state.data.appointments = (await api("/api/portal/appointments")) || []; }
  async function loadLabs()         { state.data.labs = (await api("/api/portal/lab-orders")) || []; }
  async function loadPayments()     { state.data.payments = (await api("/api/portal/payments")) || []; }

  async function loadAll() {
    await Promise.allSettled([
      loadPatient(), loadSummary(), loadAppointments(), loadLabs(), loadPayments(),
    ]);
  }

  // ─── Logout ───────────────────────────────────────────────────
  async function doLogout() {
    if (!confirm("Tizimdan chiqishni tasdiqlaysizmi?")) return;
    try { await api("/api/portal/logout", { method: "POST" }); } catch (_) {}
    location.href = "bemor-login.html";
  }

  // ─── Global bind ──────────────────────────────────────────────
  function bindGlobal() {
    const elSettings = $("#btnSettings");
    if (elSettings) elSettings.addEventListener("click", openDrawer);
    const elClose = $("#btnDrawerClose");
    if (elClose) elClose.addEventListener("click", closeDrawer);
    const elBackdrop = $("#bpBackdrop");
    if (elBackdrop) elBackdrop.addEventListener("click", closeDrawer);
    const elUser = $("#btnUserMenu");
    if (elUser) elUser.addEventListener("click", openDrawer);
    const elLogout = $("#btnDrawerLogout");
    if (elLogout) elLogout.addEventListener("click", doLogout);

    $$("[data-close-modal]").forEach(function (b) {
      b.addEventListener("click", function () {
        const m = b.closest(".bp-modal-bg");
        if (m) closeModal(m.id);
      });
    });
    $$(".bp-modal-bg").forEach(function (m) {
      m.addEventListener("click", function (e) {
        if (e.target === m) closeModal(m.id);
      });
    });

    const sp = $("#btnSaveProfile");
    if (sp) sp.addEventListener("click", saveProfile);
    const spw = $("#btnSavePassword");
    if (spw) spw.addEventListener("click", savePassword);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        const openM = $$(".bp-modal-bg:not([hidden])")[0];
        if (openM) { closeModal(openM.id); return; }
        const dr = $("#bpDrawer");
        if (dr && dr.classList.contains("open")) closeDrawer();
      }
    });

    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        if (state.theme === "auto") applyTheme();
      });
    }
  }

  // ─── Init ─────────────────────────────────────────────────────
  async function init() {
    loadPrefs();
    applyTheme();
    applyFontSize();
    bindGlobal();

    try {
      await loadCsrf();
      await loadPermissions();
      await loadAll();
    } catch (e) {
      if (e.message !== "UNAUTHORIZED") {
        toast("Ma'lumotlarni yuklab bo'lmadi: " + (e.message || ""), "bad");
      }
    }

    const menus = visibleMenus();
    if (!menus.some(m => m.key === state.view)) state.view = menus[0] ? menus[0].key : "summary";

    renderTabs();
    renderView();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();