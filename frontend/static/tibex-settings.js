/* ══════════════════════════════════════════════════════════════════
 * TIBEX Settings — universal sozlamalar (ko'rinish, xavfsizlik, bildirishnoma)
 * TIBEX_SETTINGS_v1
 *
 * • localStorage'da saqlanadi (tibex_* prefiksi)
 * • CSS variables orqali qo'llanadi
 * • ⚙️ tugma topbar'ga avtomatik qo'shiladi
 * • 4 guruh: Ko'rinish, Xavfsizlik, Bildirishnoma, Tizim
 * ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const KEY = "tibex_settings_v1";
  const DEFAULTS = {
    theme: "light",           // light | dark | auto
    fontSize: "md",           // sm | md | lg | xl
    sidebarCollapsed: false,
    accentColor: "blue",      // blue | green | purple
    density: "comfortable",   // comfortable | compact
    // Bildirishnoma
    toastDuration: 3000,      // ms
    soundEnabled: true,
    desktopNotify: false,
    realtimeEnabled: true,
    // Xavfsizlik
    autoLockMinutes: 15,      // 5 | 15 | 30 | 60 | 0
    // Shifokor ish oynasi (faqat shifokor sahifasida ko'rinadi)
    doctorStartView: "queue", // queue | today | patients | labs | history
    // TIBEX_QABULXONA_FULL_v1: Qabulxona ish oynasi (faqat qabulxona sahifasida ko'rinadi)
    receptionStartView: "dashboard", // dashboard | live | schedule | patients | appointments | payments
    receptionWaitLimit: 15,          // daqiqa: 10 | 15 | 30 | 60
    receptionNewApptSound: true,
    receptionSlotStep: 30,           // daqiqa: 15 | 20 | 30
    // Tizim
    lastModified: Date.now(),
  };

  const ACCENTS = {
    blue:   { primary: "#1e40af", dark: "#1e3a8a", tint: "#dbeafe" },
    green:  { primary: "#15803d", dark: "#14532d", tint: "#dcfce7" },
    purple: { primary: "#7c3aed", dark: "#5b21b6", tint: "#f5f3ff" },
  };

  const FONTS = {
    sm: "12.5px", md: "14px", lg: "16px", xl: "18px",
  };

  /* TIBEX_FONT_SETTINGS_v1 */
let _modalEl = null;
  let _bound = false;

  // ─── Load/Save ───
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function save(s) {
    s.lastModified = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (_) {}
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (_) {}
  }

  // ─── Apply settings to DOM ───
  function apply(s) {
    const html = document.documentElement;
    const isDark =
      s.theme === "dark" ||
      (s.theme === "auto" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    html.setAttribute("data-tibex-theme", isDark ? "dark" : "light");
    html.style.setProperty("--tibex-font-base", FONTS[s.fontSize] || FONTS.md);

    const a = ACCENTS[s.accentColor] || ACCENTS.blue;
    html.style.setProperty("--tibex-primary", a.primary);
    html.style.setProperty("--tibex-primary-dark", a.dark);
    html.style.setProperty("--tibex-primary-tint", a.tint);

    // Sidebar collapsed
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) sidebar.classList.toggle("tibex-collapsed", !!s.sidebarCollapsed);

    // Density
    document.body.classList.toggle("tibex-compact", s.density === "compact");

    // TIBEX_FONT_SETTINGS_v1: universal shrift.
    // ESKI YONDASHUV alohida-alohida CSS klasslarni (~25 ta) sanab, har
    // biriga qo'lda font-size !important yozar edi — lekin loyihada
    // yuzlab boshqa klass (admin/doctor/lab/cashier/reception CSS
    // fayllari, tibex-base.css'dagi .fs-*, .field-label, .kv-row va h.k.)
    // bu ro'yxatga kirmagani uchun "Katta" tanlansa ham ko'p joyda matn
    // o'zgarmay qolar edi.
    // YANGI YONDASHUV: butun sahifani `zoom` orqali miqyoslaymiz — bu
    // qaysi CSS faylda, qanday klassda yozilganidan qat'i nazar, HAR
    // QANDAY matn/element o'lchamiga ta'sir qiladi.
    const baseSize = FONTS[s.fontSize] || FONTS.md;
    const basePx = parseFloat(baseSize) || 14;
    const scale = basePx / 14;

    document.documentElement.style.setProperty("--tibex-font-base", baseSize);
    document.documentElement.setAttribute("data-tibex-font", s.fontSize);
    document.documentElement.style.setProperty("--tibex-font-scale", scale);

    if ("zoom" in document.body.style) {
      // Chrome/Edge (va yangi Firefox, 126+) — to'g'ridan-to'g'ri qo'llab-quvvatlaydi.
      document.body.style.zoom = String(scale);
    } else {
      // Zaxira usul (eski Firefox): CSS transform bilan miqyoslash.
      document.body.style.transformOrigin = "top left";
      if (scale === 1) {
        document.body.style.transform = "";
        document.body.style.width = "";
      } else {
        document.body.style.transform = `scale(${scale})`;
        document.body.style.width = `${100 / scale}%`;
      }
    }

    // Eski dinamik style elementini endi kerak emas — bo'lsa tozalab tashlaymiz
    // (aks holda zoom ustiga yana qo'shimcha katta bo'lib, ikki marta
    // kattalashib ketadi).
    const oldDynStyle = document.getElementById("tibex-font-dynamic");
    if (oldDynStyle) oldDynStyle.remove();

    // Toast duration — yangilash
    window.__TIBEX_TOAST_DURATION__ = s.toastDuration;
  }

  // CSS: static/css/tibex-settings.css (HTML da <link> orqali; CSP style-src 'self' — JS da style elementi yaratilmaydi)


  // ═══════════════════════════════════════════════════════════
  // SIDEBAR TOGGLE — ochish/yopish tugmasi
  // ═══════════════════════════════════════════════════════════
  function _injectSidebarToggle() {
    if (document.querySelector(".tibex-sidebar-toggle")) return;
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;

    const btn = document.createElement("button");
    btn.className = "tibex-sidebar-toggle";
    btn.type = "button";
    btn.title = "Yon panelni ochish/yopish";
    btn.innerHTML = '<span id="tibexSidebarIcon">◀</span>';
    document.body.appendChild(btn);

    function updateIcon() {
      const collapsed = sidebar.classList.contains("tibex-collapsed");
      const icon = document.getElementById("tibexSidebarIcon");
      if (icon) icon.textContent = collapsed ? "▶" : "◀";
      // Tugmani sidebar holatiga qarab joylash
      if (collapsed) {
        btn.style.left = "12px";
      } else {
        const sidebarWidth = sidebar.offsetWidth || 260;
        btn.style.left = (sidebarWidth - 24) + "px";
      }
    }

    btn.addEventListener("click", () => {
      sidebar.classList.toggle("tibex-collapsed");
      // Sozlamalarni saqlash
      const s = load();
      s.sidebarCollapsed = sidebar.classList.contains("tibex-collapsed");
      save(s);
      updateIcon();
      // Oyna o'lchamlari o'zgarsa
      setTimeout(updateIcon, 300);
    });

    // Boshlang'ich holat
    updateIcon();

    // Oyna resize
    window.addEventListener("resize", () => {
      setTimeout(updateIcon, 100);
    });
  }

  // ─── Modal ───
  function buildModal() {
    if (_modalEl) return;
    _modalEl = document.createElement("div");
    _modalEl.className = "tibex-set-backdrop";
    _modalEl.id = "tibexSetModal";
    _modalEl.innerHTML = `
      <div class="tibex-set-modal">
        <div class="tibex-set-head">
          <h3>⚙️ Sozlamalar</h3>
          <button class="x" data-set-close>✕</button>
        </div>
        <div class="tibex-set-body" id="tibexSetBody"></div>
        <div class="tibex-set-foot">
          <button class="tibex-set-btn danger" id="tibexSetReset">↺ Standart holat</button>
          <div style="flex:1"></div>
          <button class="tibex-set-btn" data-set-close>Bekor qilish</button>
          <button class="tibex-set-btn primary" id="tibexSetSave">✓ Saqlash</button>
        </div>
      </div>
    `;
    document.body.appendChild(_modalEl);
    _modalEl.addEventListener("click", (e) => { if (e.target === _modalEl) closeModal(); });
    _modalEl.querySelectorAll("[data-set-close]").forEach(b => b.addEventListener("click", closeModal));
    document.getElementById("tibexSetReset").addEventListener("click", doReset);
    document.getElementById("tibexSetSave").addEventListener("click", doSave);
  }

  function openModal() {
    buildModal();
    renderForm(load());
    _modalEl.classList.add("show");
  }
  function closeModal() { _modalEl?.classList.remove("show"); }

  // ─── Render form ───
  function renderForm(s) {
    const body = document.getElementById("tibexSetBody");

    // Ko'rinish
    let ko = `
      <div class="tibex-set-section">
        <h4>🎨 Ko'rinish</h4>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Mavzu</div><div class="sub">Kun / Tun / Avtomatik</div></div>
          <div class="tibex-set-chips" data-set="theme">
            <button class="tibex-set-chip ${s.theme==='light'?'on':''}" data-v="light">☀️ Kun</button>
            <button class="tibex-set-chip ${s.theme==='dark'?'on':''}" data-v="dark">🌙 Tun</button>
            <button class="tibex-set-chip ${s.theme==='auto'?'on':''}" data-v="auto">🖥 Avto</button>
          </div>
        </div>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Shrift o'lchami</div><div class="sub">Matn kattaligi</div></div>
          <div class="tibex-set-chips" data-set="fontSize">
            <button class="tibex-set-chip ${s.fontSize==='sm'?'on':''}" data-v="sm">Kichik</button>
            <button class="tibex-set-chip ${s.fontSize==='md'?'on':''}" data-v="md">O'rta</button>
            <button class="tibex-set-chip ${s.fontSize==='lg'?'on':''}" data-v="lg">Katta</button>
            <button class="tibex-set-chip ${s.fontSize==='xl'?'on':''}" data-v="xl">J. katta</button>
          </div>
        </div>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Rang aksenti</div><div class="sub">Asosiy rang</div></div>
          <div class="tibex-set-chips" data-set="accentColor">
            <button class="tibex-set-chip ${s.accentColor==='blue'?'on':''}" data-v="blue">🔵 Moviy</button>
            <button class="tibex-set-chip ${s.accentColor==='green'?'on':''}" data-v="green">🟢 Yashil</button>
            <button class="tibex-set-chip ${s.accentColor==='purple'?'on':''}" data-v="purple">🟣 Binafsha</button>
          </div>
        </div>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Yon panel</div><div class="sub">Sidebar holati</div></div>
          <div class="tibex-set-chips" data-set="sidebarCollapsed">
            <button class="tibex-set-chip ${!s.sidebarCollapsed?'on':''}" data-v="false">Ochiq</button>
            <button class="tibex-set-chip ${s.sidebarCollapsed?'on':''}" data-v="true">Yopiq</button>
          </div>
        </div>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Zichlik</div><div class="sub">Elementlar orasi</div></div>
          <div class="tibex-set-chips" data-set="density">
            <button class="tibex-set-chip ${s.density==='comfortable'?'on':''}" data-v="comfortable">Qulay</button>
            <button class="tibex-set-chip ${s.density==='compact'?'on':''}" data-v="compact">Ixcham</button>
          </div>
        </div>
      </div>
    `;

    // Xavfsizlik
    let sec = `
      <div class="tibex-set-section">
        <h4>🔒 Xavfsizlik</h4>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">🔑 Parolni almashtirish</div><div class="sub">Limit: 5 marta</div></div>
          <button class="tibex-set-btn" id="tibexSetPwdBtn">Ochish</button>
        </div>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Auto-lock</div><div class="sub">Harakatsizlikda blok</div></div>
          <div class="tibex-set-chips" data-set="autoLockMinutes">
            <button class="tibex-set-chip ${s.autoLockMinutes===5?'on':''}" data-v="5">5 daq</button>
            <button class="tibex-set-chip ${s.autoLockMinutes===15?'on':''}" data-v="15">15 daq</button>
            <button class="tibex-set-chip ${s.autoLockMinutes===30?'on':''}" data-v="30">30 daq</button>
            <button class="tibex-set-chip ${s.autoLockMinutes===60?'on':''}" data-v="60">1 soat</button>
            <button class="tibex-set-chip ${s.autoLockMinutes===0?'on':''}" data-v="0">Yo'q</button>
          </div>
        </div>
      </div>
    `;

    // Bildirishnoma
    let notif = `
      <div class="tibex-set-section">
        <h4>🔔 Bildirishnoma</h4>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Ovozli signal</div><div class="sub">Yangi navbat/to'lov</div></div>
          <div class="tibex-set-toggle ${s.soundEnabled?'on':''}" data-toggle="soundEnabled"></div>
        </div>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Desktop bildirishnoma</div><div class="sub">Brauzer orqali</div></div>
          <div class="tibex-set-toggle ${s.desktopNotify?'on':''}" data-toggle="desktopNotify"></div>
        </div>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Real-time yangilanish</div><div class="sub">WebSocket orqali</div></div>
          <div class="tibex-set-toggle ${s.realtimeEnabled?'on':''}" data-toggle="realtimeEnabled"></div>
        </div>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Toast davomiyligi</div><div class="sub">Xabar ko'rinish vaqti</div></div>
          <div class="tibex-set-chips" data-set="toastDuration">
            <button class="tibex-set-chip ${s.toastDuration===2000?'on':''}" data-v="2000">2s</button>
            <button class="tibex-set-chip ${s.toastDuration===3000?'on':''}" data-v="3000">3s</button>
            <button class="tibex-set-chip ${s.toastDuration===5000?'on':''}" data-v="5000">5s</button>
            <button class="tibex-set-chip ${s.toastDuration===10000?'on':''}" data-v="10000">10s</button>
          </div>
        </div>
      </div>
    `;

    // Tizim
    const u = window.TIBEX_STORE?.CURRENT_USER || {};
    const wsState = window.TIBEX_STORE?._ws?.readyState;
    const wsOk = wsState === 1;
    let sys = `
      <div class="tibex-set-section">
        <h4>ℹ️ Tizim ma'lumotlari</h4>
        <div class="tibex-set-info-row"><span class="k">Versiya</span><span class="v">TIBEX v3.3.0</span></div>
        <div class="tibex-set-info-row"><span class="k">Foydalanuvchi</span><span class="v">${esc(u.fullname || '—')}</span></div>
        <div class="tibex-set-info-row"><span class="k">Rol</span><span class="v">${esc(u.role || '—')}</span></div>
        <div class="tibex-set-info-row"><span class="k">Login</span><span class="v">${esc(u.login || '—')}</span></div>
        <div class="tibex-set-info-row"><span class="k">Parol almashtirilgan (tarix)</span><span class="v">${u.password_change_count || 0}</span></div>
        <div class="tibex-set-info-row"><span class="k">WebSocket</span><span class="v ${wsOk ? 'ok' : 'err'}">${wsOk ? '🟢 Ulangan' : '🔴 Uzilgan'}</span></div>
        <div class="tibex-set-info-row"><span class="k">Backend</span><span class="v ok">🟢 Online</span></div>
      </div>
      <div class="tibex-set-section">
        <h4>💾 Ma'lumotlar</h4>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Keshni tozalash</div><div class="sub">Sessiya va vaqtinchalik ma'lumotlar</div></div>
          <button class="tibex-set-btn danger" id="tibexSetClearCache">Tozalash</button>
        </div>
      </div>
    `;

    // Xavfli zona (faqat admin uchun)
    const userRole = window.TIBEX_STORE?.CURRENT_USER?.role;
    let danger = "";
    if (userRole === "admin" || userRole === "superadmin") {
      danger = `
        <div class="tibex-set-section" style="border-top:2px solid #fca5a5;margin-top:8px;">
          <h4 style="color:#dc2626;">⚠️ Xavfli zona</h4>
          <div class="tibex-set-row">
            <div class="info">
              <div class="lbl" style="color:#dc2626;">Demo Reset</div>
              <div class="sub">Barcha biznes ma'lumotlarni o'chirish. 2-bosqichli himoya.</div>
            </div>
            <button class="tibex-set-btn danger" id="tibexSetDangerReset">🔓 Ochish</button>
          </div>
        </div>
      `;
    }

    // Shifokor ish oynasi — faqat shifokor sahifasida (doctor.js window.__TIBEX_CLIENT_ROLE__ = "doctor")
    let doc = "";
    if (window.__TIBEX_CLIENT_ROLE__ === "doctor") {
      const V = [["queue", "📋 Navbat"], ["today", "📊 Bugun"], ["patients", "🧑 Bemorlar"], ["labs", "🔬 Lab"], ["history", "📚 Tarix"]];
      doc = `
      <div class="tibex-set-section">
        <h4>🩺 Shifokor ish oynasi</h4>
        <div class="tibex-set-row">
          <div class="info"><div class="lbl">Boshlang'ich bo'lim</div><div class="sub">Sahifa ochilganda shu bo'lim ko'rsatiladi</div></div>
          <div class="tibex-set-chips" data-set="doctorStartView">
            ${V.map(([v, t]) => `<button class="tibex-set-chip ${s.doctorStartView===v?'on':''}" data-v="${v}">${t}</button>`).join("")}
          </div>
        </div>
      </div>
    `;
    }

    // TIBEX_QABULXONA_FULL_v1
    let rec = "";
    if (window.__TIBEX_CLIENT_ROLE__ === "reception") {
      const RV = [["dashboard", "📊 Bugun"], ["live", "🛎 Jonli navbat"], ["schedule", "🗓 Jadval"], ["patients", "🧑 Bemorlar"], ["appointments", "📅 Navbatlar"], ["payments", "💰 To'lovlar"]];
      const chips = (key, list) => list.map(([v, t]) => `<button type="button" class="tibex-set-chip ${String(s[key])===String(v)?'on':''}" data-v="${v}">${t}</button>`).join("");
      rec = `
      <div class="tibex-set-section">
        <h4>🗂️ Qabulxona ish oynasi</h4>
        <div class="tibex-set-row"><div class="info"><div class="lbl">Boshlang'ich bo'lim</div><div class="sub">Sahifa ochilganda shu bo'lim ko'rsatiladi</div></div>
          <div class="tibex-set-chips" data-set="receptionStartView">${chips("receptionStartView", RV)}</div></div>
        <div class="tibex-set-row"><div class="info"><div class="lbl">Kutish ogohlantirishi</div><div class="sub">Necha daqiqadan keyin "kechikdi" deb belgilansin</div></div>
          <div class="tibex-set-chips" data-set="receptionWaitLimit">${chips("receptionWaitLimit", [[10,"10 daq"],[15,"15 daq"],[30,"30 daq"],[60,"60 daq"]])}</div></div>
        <div class="tibex-set-row"><div class="info"><div class="lbl">Yangi navbatda ovozli signal</div></div>
          <div class="tibex-set-toggle ${s.receptionNewApptSound?'on':''}" data-toggle="receptionNewApptSound" role="switch" tabindex="0" aria-label="Yangi navbatda ovozli signal"></div></div>
        <div class="tibex-set-row"><div class="info"><div class="lbl">Jadval qadami</div><div class="sub">Vaqt jadvalidagi slot uzunligi</div></div>
          <div class="tibex-set-chips" data-set="receptionSlotStep">${chips("receptionSlotStep", [[15,"15 daq"],[20,"20 daq"],[30,"30 daq"]])}</div></div>
      </div>`;
    }

    body.innerHTML = ko + sec + notif + doc + rec + sys + danger;
    bindFormEvents(s);

    // Xavfli zona tugmasi
    const dangerBtn = document.getElementById("tibexSetDangerReset");
    if (dangerBtn) {
      dangerBtn.addEventListener("click", () => {
        closeModal();
        setTimeout(() => openDangerModal(), 200);
      });
    }
  }

  function bindFormEvents(current) {
    // Chips
    document.querySelectorAll(".tibex-set-chips").forEach(group => {
      const key = group.dataset.set;
      group.querySelectorAll(".tibex-set-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          group.querySelectorAll(".tibex-set-chip").forEach(c => c.classList.remove("on"));
          chip.classList.add("on");
          const v = chip.dataset.v;
          let parsed = v;
          if (v === "true") parsed = true;
          else if (v === "false") parsed = false;
          else if (/^\d+$/.test(v)) parsed = parseInt(v);
          current[key] = parsed;
          // Darhol qo'llash (live preview)
          apply(current);
        });
      });
    });

    // Toggles
    document.querySelectorAll(".tibex-set-toggle").forEach(t => {
      t.addEventListener("click", () => {
        t.classList.toggle("on");
        const key = t.dataset.toggle;
        current[key] = t.classList.contains("on");
        apply(current);
      });
    });

    // Parol tugmasi — tibex-password.js ochadi
    document.getElementById("tibexSetPwdBtn").addEventListener("click", () => {
      if (window.TIBEX_PWD?.open) {
        closeModal();
        setTimeout(() => window.TIBEX_PWD.open(), 200);
      } else {
        alert("Parol moduli yuklanmagan. Sahifani yangilang.");
      }
    });

    // Keshni tozalash
    document.getElementById("tibexSetClearCache").addEventListener("click", () => {
      if (!confirm("Keshni tozalash? Sahifa qayta yuklanadi.")) return;
      try {
        sessionStorage.clear();
        // localStorage dan tibex_ prefiksli kalitlar (settings saqlanadi)
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith("tibex_") && k !== KEY) localStorage.removeItem(k);
        });
      } catch (_) {}
      location.reload();
    });
  }

  function doSave() {
    const s = load();
    // Form'dan hozirgi qiymatlarni olish
    const body = document.getElementById("tibexSetBody");
    body.querySelectorAll(".tibex-set-chips").forEach(group => {
      const key = group.dataset.set;
      const onChip = group.querySelector(".tibex-set-chip.on");
      if (onChip) {
        const v = onChip.dataset.v;
        if (v === "true") s[key] = true;
        else if (v === "false") s[key] = false;
        else if (/^\d+$/.test(v)) s[key] = parseInt(v);
        else s[key] = v;
      }
    });
    body.querySelectorAll(".tibex-set-toggle").forEach(t => {
      s[t.dataset.toggle] = t.classList.contains("on");
    });
    save(s);
    apply(s);
    // Auto-lock vaqtini tibex-session.js ga xabar berish
    window.__TIBEX_IDLE_MINUTES__ = s.autoLockMinutes;
    if (window.TIBEX_SESSION) window.TIBEX_SESSION.idleMinutes = s.autoLockMinutes;
    if (window.toast) { try { window.toast("✓ Sozlamalar saqlandi", "ok"); } catch (_) {} }
    closeModal();
  }

  function doReset() {
    if (!confirm("Barcha sozlamalar standart holatga qaytarilsinmi?")) return;
    reset();
    const s = load();
    apply(s);
    renderForm(s);
    if (window.toast) { try { window.toast("↺ Sozlamalar tiklandi", "warn"); } catch (_) {} }
  }

  // ─── Topbar'ga ⚙️ tugma qo'shish ───
  function injectButton() {
    const topbar = document.querySelector(".topbar");
    if (!topbar || topbar.querySelector("[data-tibex-set-btn]")) return;
    const btn = document.createElement("button");
    btn.setAttribute("data-tibex-set-btn", "1");
    btn.className = "icon-btn";
    btn.title = "Sozlamalar (Ctrl+,)";
    btn.textContent = "⚙️";
    btn.addEventListener("click", openModal);
    btn.id = btn.id || "btnSettings";
    btn.type = "button";
    btn.setAttribute("aria-label", "Sozlamalar");
    // Standart tartib: ⚙️ Sozlamalar → 🔑 Parol → 🚪 Chiqish (o'ngda)
    const pwd = topbar.querySelector("[data-tibex-pwd-btn]");
    const out = topbar.querySelector("#btnLogout, button[title='Chiqish']");
    const spacer = topbar.querySelector(".spacer");
    if (pwd) topbar.insertBefore(btn, pwd);
    else if (out) topbar.insertBefore(btn, out);
    else if (spacer) spacer.parentNode.insertBefore(btn, spacer.nextSibling);
    else topbar.appendChild(btn);
  }

  // ─── Keyboard shortcut: Ctrl+, ───
  function bindShortcut() {
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        openModal();
      }
    });
  }

  // ─── Init ───
  function init() {
    if (_bound) return;
    _bound = true;
    const s = load();
    apply(s);
    injectButton();
    bindShortcut();
    _injectSidebarToggle();
    // Auto-lock
    if (s.autoLockMinutes > 0) {
      window.__TIBEX_IDLE_MINUTES__ = s.autoLockMinutes;
    }
    // Auto theme o'zgarganda
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        const cur = load();
        if (cur.theme === "auto") apply(cur);
      });
    }
    console.log("[TIBEX] Settings tayyor");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Global API
  window.TIBEX_SETTINGS = {
    open: openModal,
    load: load,
    save: save,
    reset: reset,
    apply: apply,
    openDanger: openDangerModal,
    toggleSidebar: function () {
      const sidebar = document.querySelector(".sidebar");
      if (sidebar) sidebar.classList.toggle("tibex-collapsed");
      const s = load();
      s.sidebarCollapsed = sidebar?.classList.contains("tibex-collapsed") || false;
      save(s);
    },
  };

  // ═══════════════════════════════════════════════════════════
  // Xavfli zona — Demo Reset (2-bosqichli himoya)
  // TIBEX_DANGER_ZONE_v1
  // ═══════════════════════════════════════════════════════════
  let _dangerEl = null;
  let _dangerStep = 1;
  let _dangerPassword = "";
  let _dangerCountdownTimer = null;

  function _buildDangerModal() {
    if (_dangerEl) return;
  // CSS: static/css/tibex-settings.css (HTML da <link> orqali; CSP style-src 'self' — JS da style elementi yaratilmaydi)

    _dangerEl = document.createElement("div");
    _dangerEl.className = "tibex-danger-backdrop";
    _dangerEl.id = "tibexDangerModal";
    _dangerEl.innerHTML = `
      <div class="tibex-danger-modal">
        <div class="tibex-danger-head">
          <h3>⚠️ Xavfli amal — Demo Reset</h3>
          <button class="x" data-danger-close>✕</button>
        </div>
        <div class="tibex-danger-body" id="tibexDangerBody"></div>
        <div class="tibex-danger-foot" id="tibexDangerFoot"></div>
      </div>
    `;
    document.body.appendChild(_dangerEl);
    _dangerEl.addEventListener("click", (e) => { if (e.target === _dangerEl) _closeDanger(); });
    _dangerEl.querySelector("[data-danger-close]").addEventListener("click", _closeDanger);
  }

  function _closeDanger() {
    if (_dangerCountdownTimer) { clearInterval(_dangerCountdownTimer); _dangerCountdownTimer = null; }
    _dangerEl?.classList.remove("show");
    _dangerStep = 1;
    _dangerPassword = "";
  }

  function openDangerModal() {
    _buildDangerModal();
    _dangerStep = 1;
    _dangerPassword = "";
    _renderDangerStep1();
    _dangerEl.classList.add("show");
  }

  function _renderSteps() {
    return `
      <div class="tibex-danger-steps">
        <div class="tibex-danger-step ${_dangerStep===1?'active':_dangerStep>1?'done':''}">1 · Parol</div>
        <div class="tibex-danger-step ${_dangerStep===2?'active':_dangerStep>2?'done':''}">2 · Kod</div>
        <div class="tibex-danger-step ${_dangerStep===3?'active':_dangerStep>3?'done':''}">3 · Tasdiq</div>
        <div class="tibex-danger-step ${_dangerStep===4?'active':''}">4 · Ijro</div>
      </div>
    `;
  }

  // ─── Step 1: Parol ───
  function _renderDangerStep1() {
    document.getElementById("tibexDangerBody").innerHTML = _renderSteps() + `
      <div class="tibex-danger-warn">
        <b>⚠️ Diqqat!</b> Bu amal <b>butun biznes ma'lumotlarni</b> o'chiradi:
        bemorlar, qabullar, to'lovlar, lab natijalar. <b>Qaytarib bo'lmaydi.</b>
      </div>
      <div class="tibex-danger-field">
        <label>1-bosqich · O'z parolingiz <span style="color:#dc2626;">*</span></label>
        <input type="password" id="tibexDangerPwd" placeholder="Akkaunt parolingiz" autofocus autocomplete="current-password">
      </div>
      <div id="tibexDangerMsg1"></div>
    `;
    document.getElementById("tibexDangerFoot").innerHTML = `
      <button class="tibex-danger-btn" data-danger-close-foot>Bekor qilish</button>
      <button class="tibex-danger-btn primary" id="tibexDangerNext1">Davom etish →</button>
    `;
    document.querySelector("[data-danger-close-foot]").addEventListener("click", _closeDanger);
    const btn = document.getElementById("tibexDangerNext1");
    const input = document.getElementById("tibexDangerPwd");
    const doNext = () => {
      const pwd = input.value;
      if (!pwd) {
        document.getElementById("tibexDangerMsg1").innerHTML =
          '<div class="tibex-danger-msg err">Parolni kiriting</div>';
        return;
      }
      _dangerPassword = pwd;
      _dangerStep = 2;
      _renderDangerStep2();
    };
    btn.addEventListener("click", doNext);
    input.addEventListener("keydown", e => { if (e.key === "Enter") doNext(); });
    setTimeout(() => input.focus(), 100);
  }

  // ─── Step 2: Reset kodi ───
  function _renderDangerStep2() {
    document.getElementById("tibexDangerBody").innerHTML = _renderSteps() + `
      <div class="tibex-danger-warn">
        <b>2-bosqich:</b> Superadmin maxsus kodini kiriting. Bu kod faqat
        <b>TIBEX_DEMO_RESET_CODE</b> .env da saqlanadi va hech qaysi UI'da ko'rinmaydi.
      </div>
      <div class="tibex-danger-field">
        <label>2-bosqich · Reset kodi <span style="color:#dc2626;">*</span></label>
        <input type="password" id="tibexDangerCode" placeholder="16+ belgili maxsus kod" autofocus autocomplete="off" style="font-family:ui-monospace;letter-spacing:2px;">
      </div>
      <div id="tibexDangerMsg2"></div>
    `;
    document.getElementById("tibexDangerFoot").innerHTML = `
      <button class="tibex-danger-btn" id="tibexDangerBack2">← Orqaga</button>
      <button class="tibex-danger-btn primary" id="tibexDangerNext2">Davom etish →</button>
    `;
    document.getElementById("tibexDangerBack2").addEventListener("click", () => {
      _dangerStep = 1;
      _renderDangerStep1();
    });
    const btn = document.getElementById("tibexDangerNext2");
    const input = document.getElementById("tibexDangerCode");
    const doNext = () => {
      const code = input.value;
      if (!code || code.length < 16) {
        document.getElementById("tibexDangerMsg2").innerHTML =
          '<div class="tibex-danger-msg err">Kod kamida 16 belgi bo\'lishi kerak</div>';
        return;
      }
      _dangerResetCode = code;
      _dangerStep = 3;
      _renderDangerStep3();
    };
    btn.addEventListener("click", doNext);
    input.addEventListener("keydown", e => { if (e.key === "Enter") doNext(); });
    setTimeout(() => input.focus(), 100);
  }

  // ─── Step 3: Tasdiqlash ───
  let _dangerResetCode = "";
  function _renderDangerStep3() {
    document.getElementById("tibexDangerBody").innerHTML = _renderSteps() + `
      <div class="tibex-danger-warn">
        <b>3-bosqich:</b> Amalni tasdiqlang. Barcha ma'lumotlar o'chiriladi.
      </div>
      <div class="tibex-danger-checklist">
        <label><input type="checkbox" id="tibexDangerChk1"> Barcha <b>bemorlar</b> o'chirilishini tushunaman</label>
        <label><input type="checkbox" id="tibexDangerChk2"> Barcha <b>qabullar</b> o'chirilishini tushunaman</label>
        <label><input type="checkbox" id="tibexDangerChk3"> Barcha <b>to'lovlar</b> o'chirilishini tushunaman</label>
        <label><input type="checkbox" id="tibexDangerChk4"> Bu amal <b>qaytarilmasligini</b> tushunaman</label>
      </div>
      <div id="tibexDangerMsg3"></div>
    `;
    document.getElementById("tibexDangerFoot").innerHTML = `
      <button class="tibex-danger-btn" id="tibexDangerBack3">← Orqaga</button>
      <button class="tibex-danger-btn primary" id="tibexDangerExec" disabled>Ijro etish (10s)</button>
    `;
    document.getElementById("tibexDangerBack3").addEventListener("click", () => {
      _dangerStep = 2;
      _renderDangerStep2();
    });
    const execBtn = document.getElementById("tibexDangerExec");
    const updateBtn = () => {
      const all = ["1","2","3","4"].every(i => document.getElementById("tibexDangerChk" + i).checked);
      execBtn.disabled = !all;
    };
    ["1","2","3","4"].forEach(i => {
      document.getElementById("tibexDangerChk" + i).addEventListener("change", updateBtn);
    });
    execBtn.addEventListener("click", () => {
      _dangerStep = 4;
      _renderDangerStep4();
    });
  }

  // ─── Step 4: Countdown + ijro ───
  function _renderDangerStep4() {
    document.getElementById("tibexDangerBody").innerHTML = _renderSteps() + `
      <div class="tibex-danger-warn" style="text-align:center;font-size:14px;">
        <b>⚠️ OXIRGI OGOHLANTIRISH</b><br>
        Ijro <b>10 sekunddan</b> keyin boshlanadi. Bekor qilish mumkin.
      </div>
      <div class="tibex-danger-countdown" id="tibexDangerCountdown">10</div>
    `;
    document.getElementById("tibexDangerFoot").innerHTML = `
      <button class="tibex-danger-btn primary" id="tibexDangerCancel">🛑 BEKOR QILISH</button>
    `;
    document.getElementById("tibexDangerCancel").addEventListener("click", _closeDanger);

    let n = 10;
    const el = document.getElementById("tibexDangerCountdown");
    _dangerCountdownTimer = setInterval(() => {
      n--;
      if (el) el.textContent = n;
      if (n <= 0) {
        clearInterval(_dangerCountdownTimer);
        _dangerCountdownTimer = null;
        _executeDangerReset();
      }
    }, 1000);
  }

  async function _executeDangerReset() {
    document.getElementById("tibexDangerBody").innerHTML = _renderSteps() + `
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:64px;animation:tibexPulse 1s infinite;">⏳</div>
        <div style="margin-top:16px;font-size:15px;font-weight:700;">Ijro etilmoqda...</div>
        <div style="font-size:12.5px;color:#64748b;margin-top:8px;">Bu bir necha sekund olishi mumkin.</div>
      </div>
    `;
    document.getElementById("tibexDangerFoot").innerHTML = "";

    try {
      const r = await window.TIBEX_STORE._api("/api/admin/demo-reset", {
        method: "POST",
        body: { password: _dangerPassword, reset_code: _dangerResetCode },
      });
      _renderDangerResult(r);
    } catch (e) {
      document.getElementById("tibexDangerBody").innerHTML = _renderSteps() + `
        <div class="tibex-danger-msg err"><b>✗ Xatolik:</b> ${esc(e.message || "unknown")}</div>
      `;
      document.getElementById("tibexDangerFoot").innerHTML = `
        <button class="tibex-danger-btn" data-danger-close-foot>Yopish</button>
      `;
      document.querySelector("[data-danger-close-foot]").addEventListener("click", _closeDanger);
    }
  }

  function _renderDangerResult(r) {
    const deleted = r.deleted || {};
    document.getElementById("tibexDangerBody").innerHTML = _renderSteps() + `
      <div class="tibex-danger-msg ok">
        <b>✓ Demo reset bajarildi</b>
      </div>
      <div class="tibex-danger-checklist">
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Bemorlar:</span><b>${deleted.patients || 0}</b></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Qabullar:</span><b>${deleted.appointments || 0}</b></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>To'lovlar:</span><b>${deleted.payments || 0}</b></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Lab so'rovlar:</span><b>${deleted.lab_orders || 0}</b></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Qaytarishlar:</span><b>${deleted.refunds || 0}</b></div>
      </div>
      <div style="font-size:12px;color:#94a3b8;text-align:center;margin-top:10px;">
        Audit jurnalga yozildi. Sahifa 5 sekunddan keyin yangilanadi.
      </div>
    `;
    document.getElementById("tibexDangerFoot").innerHTML = `
      <button class="tibex-danger-btn primary" id="tibexDangerReload">↻ Hozir yangilash</button>
    `;
    document.getElementById("tibexDangerReload").addEventListener("click", () => location.reload());
    setTimeout(() => location.reload(), 5000);
  }

})();
