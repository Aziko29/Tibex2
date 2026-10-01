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

  // ─── Menus ────────────────────────────────────────────────────
  const MENUS = [
    { key: "summary",      label: "Bosh sahifa", ico: "🏠" },
    { key: "appointments", label: "Tashriflar",  ico: "📅" },
    { key: "labs",         label: "Tahlillar",   ico: "🔬" },
    { key: "payments",     label: "To'lovlar",   ico: "💰" },
    { key: "profile",      label: "Profil",      ico: "👤" },
  ];

  function renderTabs() {
    const tabs = $("#bpTabs");
    const bnav = $("#bpBottomNav");
    const menus = MENUS;

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
    if (!MENUS.some(m => m.key === view)) view = MENUS[0].key;
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
        if (a === "tg-link") { closeDrawer(); startTelegramLink(); }
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

  function viewShell(title, sub, inner) {
    return '<div class="bp-view active">' +
      '<div class="bp-view-head">' +
        '<h1 class="bp-view-title">' + title + '</h1>' +
        '<p class="bp-view-sub">' + sub + '</p>' +
      '</div>' + inner +
    '</div>';
  }
  function emptyBox(ico, text) {
    return '<div class="bp-empty"><div class="bp-empty-ico">' + ico + '</div><div>' + text + '</div></div>';
  }
  function dataTable(headers, rows, rowFn, empty) {
    if (!rows.length) return emptyBox(empty[0], empty[1]);
    return '<div class="bp-table-wrap"><table class="bp-table">' +
      '<thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join("") + '</tr></thead>' +
      '<tbody>' + rows.map(rowFn).join("") + '</tbody></table></div>';
  }
  function card(title, body, count) {
    return '<div class="bp-card"><div class="bp-card-head"><div class="bp-card-title">' + title +
      (count == null ? "" : ' <span class="bp-count">' + count + '</span>') +
      '</div></div>' + body + '</div>';
  }
  function badge(cls, text) {
    return '<span class="bp-badge ' + cls + '">' + esc(text) + '</span>';
  }
  function apptStatusBadge(s) { return badge(statusBadgeClass(s), statusLabel(s)); }
  function serviceName(a) { return esc((a.service && a.service.name) || "—"); }

  VIEWS.summary = function () {
    const s = state.data.summary || {};
    const name = (state.patient && state.patient.fullname) || "bemor";
    const table = dataTable(
      ["Sana", "Shifokor", "Xizmat", "Holat"],
      state.data.appointments.slice(0, 5),
      function (a) {
        return '<tr>' +
          '<td class="mono">' + esc(a.date || "—") + '</td>' +
          '<td>' + esc(a.doctor_name || "—") + '</td>' +
          '<td>' + serviceName(a) + '</td>' +
          '<td>' + apptStatusBadge(a.status) + '</td>' +
        '</tr>';
      },
      ["📭", "Hozircha tashriflar yo'q"]
    );
    const stat = function (cls, ico, value, label) {
      return '<div class="bp-stat' + (cls ? " " + cls : "") + '">' +
        '<div class="bp-stat-icon">' + ico + '</div>' +
        '<div class="bp-stat-value">' + value + '</div>' +
        '<div class="bp-stat-label">' + label + '</div>' +
      '</div>';
    };
    return viewShell(
      "Salom, " + esc(name) + "!", "Sizning shaxsiy kabinetingiz",
      '<div class="bp-stats">' +
        stat("blue", "📅", s.appointments_count || 0, "Jami tashriflar") +
        stat("", "🔬", s.lab_orders_count || 0, "Lab tahlillar") +
        stat("green", "💰", fmtMoney(s.total_paid), "To'langan") +
        stat("red", "⚠️", fmtMoney(s.total_debt), "Joriy qarz") +
      '</div>' +
      card("🕒 Oxirgi tashriflar", table)
    );
  };

  VIEWS.appointments = function () {
    const rows = state.data.appointments;
    const table = dataTable(
      ["Sana", "Vaqt", "Shifokor", "Xizmat", "Holat", "Tashxis"], rows,
      function (a) {
        return '<tr>' +
          '<td class="mono">' + esc(a.date || "—") + '</td>' +
          '<td class="mono">' + esc(a.scheduled_time || "—") + '</td>' +
          '<td>' + esc(a.doctor_name || "—") + '</td>' +
          '<td>' + serviceName(a) + '</td>' +
          '<td>' + apptStatusBadge(a.status) + '</td>' +
          '<td>' + esc(a.final_dx || a.prelim_dx || "—") + '</td>' +
        '</tr>';
      },
      ["📭", "Tashriflar yo'q"]
    );
    return viewShell("Tashriflar", "Sizning barcha qabullaringiz", card("📅 Qabullar", table, rows.length));
  };

  VIEWS.labs = function () {
    const rows = state.data.labs;
    const table = dataTable(
      ["Tahlil", "Holat", "Natija", "Tasdiqlangan"], rows,
      function (o) {
        return '<tr>' +
          '<td><b>' + esc(o.test_name || "—") + '</b></td>' +
          '<td>' + badge(labBadgeClass(o.status), labStatusLabel(o.status)) + '</td>' +
          '<td>' + esc(o.result_summary || "—") + '</td>' +
          '<td class="mono">' + fmtDate(o.verified_at) + '</td>' +
        '</tr>';
      },
      ["🧪", "Tahlillar yo'q"]
    );
    return viewShell("Tahlillar", "Laboratoriya natijalaringiz", card("🔬 Lab natijalar", table, rows.length));
  };

  VIEWS.payments = function () {
    const rows = state.data.payments;
    const table = dataTable(
      ["Sana", "Summa", "Usul", "Holat"], rows,
      function (p) {
        const ok = p.status === "completed" || p.status === "paid";
        return '<tr>' +
          '<td class="mono">' + fmtDT(p.created_at) + '</td>' +
          '<td class="mono"><b>' + fmtMoney(p.amount) + '</b></td>' +
          '<td>' + esc(methodLabel(p.method)) + '</td>' +
          '<td>' + badge(ok ? "ok" : "warn", p.status || "—") + '</td>' +
        '</tr>';
      },
      ["💳", "To'lovlar yo'q"]
    );
    return viewShell("To'lovlar", "Sizning to'lovlar tarixi", card("💰 To'lovlar", table, rows.length));
  };

  VIEWS.profile = function () {
    const p = state.patient || {};
    const chips = function (list, cls, prefix) {
      return (list && list.length)
        ? '<div class="bp-chips">' + list.map(function (x) {
            return '<span class="bp-chip' + cls + '">' + prefix + esc(x) + '</span>';
          }).join("") + '</div>'
        : '<div class="bp-profile-value">Yo\'q</div>';
    };
    const item = function (label, valueHtml, extra) {
      return '<div class="bp-profile-item' + (extra || "") + '">' +
        '<div class="bp-profile-label">' + label + '</div>' + valueHtml + '</div>';
    };
    const val = function (v, mono) {
      return '<div class="bp-profile-value' + (mono ? " mono" : "") + '">' + esc(v) + '</div>';
    };
    const tg = p.telegram_linked
      ? badge("ok", "Ulangan")
      : badge("muted", "Ulanmagan");
    const editBtn = '<button class="bp-btn sm" data-action="edit-profile" style="margin-left:auto">✏️ Tahrirlash</button>';

    return viewShell(
      "Profil", "Shaxsiy ma'lumotlaringiz",
      '<div class="bp-card">' +
        '<div class="bp-card-head">' +
          '<div class="bp-card-title">👤 Shaxsiy ma\'lumotlar</div>' + editBtn +
        '</div>' +
        '<div class="bp-card-body"><div class="bp-profile-grid">' +
          item("F.I.Sh", val(p.fullname || "—"), " full") +
          item("Telefon", val(p.phone || "—", true)) +
          item("Yosh", val(p.age != null ? p.age : "—", true)) +
          item("Jins", val(p.gender || "—")) +
          item("Qon guruhi", val(p.blood || "—", true)) +
          item("Manzil", val(p.address || "—"), " full") +
          item("Allergiyalar", chips(p.allergies, " warn", "⚠ "), " full") +
          item("Surunkali kasalliklar", chips(p.chronic, "", "💊 "), " full") +
          item("Telegram (kirish kodlari)", tg +
            ' <button class="bp-btn sm" data-action="open-settings">Boshqarish</button>', " full") +
        '</div></div>' +
      '</div>'
    );
  };

  function renderView() {
    const main = $("#bpMain");
    if (!main) return;
    const fn = VIEWS[state.view] || VIEWS.summary;
    main.innerHTML = fn();
    bindViewEvents();
  }

  function bindViewEvents() {
    $$("#bpMain [data-action]").forEach(function (b) {
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
            if (state.view === "profile") renderView();
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
      if (state.view === "profile") renderView();
    } catch (e) {
      toast(e.message || "Xatolik", "bad");
    }
  }

  // ─── Data loaders ─────────────────────────────────────────────
  async function loadPatient() {
    const p = await api("/api/portal/me");
    state.patient = p;
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
      await loadAll();
    } catch (e) {
      if (e.message !== "UNAUTHORIZED") {
        toast("Ma'lumotlarni yuklab bo'lmadi: " + (e.message || ""), "bad");
      }
    }

    renderTabs();
    renderView();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();