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

    // Eski dinamik <style>ni endi kerak emas — bo'lsa tozalab tashlaymiz
    // (aks holda zoom ustiga yana qo'shimcha katta bo'lib, ikki marta
    // kattalashib ketadi).
    const oldDynStyle = document.getElementById("tibex-font-dynamic");
    if (oldDynStyle) oldDynStyle.remove();

    // Toast duration — yangilash
    window.__TIBEX_TOAST_DURATION__ = s.toastDuration;
  }

  // ─── CSS injection ───
  function injectCSS() {
    if (document.getElementById("tibex-settings-css")) return;
    const s = document.createElement("style");
    s.id = "tibex-settings-css";
    s.textContent = `
      /* Dark mode — barcha elementlar uchun */
      /* ═══════════════════════════════════════════════════════════
   TUN REJIMI v2 — Professional ranglar (GitHub Dark)
   ═══════════════════════════════════════════════════════════ */
html[data-tibex-theme="dark"] {
  /* Asosiy CSS o'zgaruvchilar */
  --bg: #0d1117;
  --panel: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --dim: #6e7681;
  --dark: #010409;
  --info: #58a6ff;
  --info-tint: #0d419d40;
  --ok: #3fb950;
  --ok-tint: #1a4d2e80;
  --danger: #f85149;
  --danger-tint: #67060c40;
  --warn: #d29922;
  --warn-tint: #762c0040;
  --gold: #d29922;
  --gold-tint: #762c0040;
  --purple: #a371f7;
  --purple-tint: #3a1d6e40;
  color-scheme: dark;
}

/* Body */
html[data-tibex-theme="dark"] body {
  background: #0d1117 !important;
  color: #e6edf3 !important;
}

/* Topbar */
html[data-tibex-theme="dark"] .topbar {
  background: #010409 !important;
  border-bottom: 1px solid #21262d;
}

html[data-tibex-theme="dark"] .topbar .logo {
  color: #58a6ff !important;
  border-right-color: #21262d !important;
}

html[data-tibex-theme="dark"] .stat-chip {
  background: #161b22 !important;
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .stat-chip b {
  color: #3fb950 !important;
}

html[data-tibex-theme="dark"] .stat-chip.gold b { color: #d29922 !important; }
html[data-tibex-theme="dark"] .stat-chip.red b { color: #f85149 !important; }
html[data-tibex-theme="dark"] .stat-chip.blue b { color: #58a6ff !important; }
html[data-tibex-theme="dark"] .stat-chip.purple b { color: #a371f7 !important; }

html[data-tibex-theme="dark"] .topbar button {
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .topbar button:hover {
  background: #21262d !important;
  color: #e6edf3 !important;
}

/* Sidebar */
html[data-tibex-theme="dark"] .sidebar {
  background: #161b22 !important;
  border-right-color: #21262d !important;
}

html[data-tibex-theme="dark"] .sidebar-section {
  border-bottom-color: #21262d !important;
}

html[data-tibex-theme="dark"] .sidebar-title {
  color: #6e7681 !important;
}

html[data-tibex-theme="dark"] .quick-action {
  background: #21262d !important;
  border-color: #30363d !important;
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .quick-action:hover {
  background: #30363d !important;
  border-color: #58a6ff !important;
  color: #58a6ff !important;
}

html[data-tibex-theme="dark"] .quick-action.primary {
  background: #1f6feb !important;
  border-color: #1f6feb !important;
  color: #fff !important;
}

html[data-tibex-theme="dark"] .quick-action.primary:hover {
  background: #388bfd !important;
}

html[data-tibex-theme="dark"] .quick-action.green {
  background: #238636 !important;
  border-color: #238636 !important;
  color: #fff !important;
}

html[data-tibex-theme="dark"] .quick-action.purple {
  background: #6e40c9 !important;
  border-color: #6e40c9 !important;
  color: #fff !important;
}

html[data-tibex-theme="dark"] .quick-action.danger {
  background: #da3633 !important;
  border-color: #da3633 !important;
  color: #fff !important;
}

/* Tabbar */
html[data-tibex-theme="dark"] .tabs-bar {
  background: #161b22 !important;
  border-bottom-color: #21262d !important;
}

html[data-tibex-theme="dark"] .tab {
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .tab:hover {
  background: #21262d !important;
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .tab.active {
  background: #1f6feb26 !important;
  color: #58a6ff !important;
}

html[data-tibex-theme="dark"] .tab.active::after {
  background: #58a6ff !important;
}

/* Content */
html[data-tibex-theme="dark"] .content {
  background: #0d1117 !important;
}

/* Blocks */
html[data-tibex-theme="dark"] .block {
  background: #161b22 !important;
  border-color: #21262d !important;
}

html[data-tibex-theme="dark"] .page-header {
  background: #0d1117 !important;
  border-bottom-color: #21262d !important;
}

html[data-tibex-theme="dark"] .page-header .title {
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .page-header .title .count {
  background: #1f6feb26 !important;
  color: #58a6ff !important;
}

/* Data table */
html[data-tibex-theme="dark"] .data-table th {
  background: #0d1117 !important;
  border-bottom-color: #21262d !important;
  color: #6e7681 !important;
}

html[data-tibex-theme="dark"] .data-table td {
  border-bottom-color: #21262d !important;
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .data-table tbody tr:hover {
  background: #161b22 !important;
}

html[data-tibex-theme="dark"] .data-table tbody tr.selected {
  background: #1f6feb26 !important;
  box-shadow: inset 3px 0 0 #58a6ff !important;
}

/* Search */
html[data-tibex-theme="dark"] .search-bar {
  background: #161b22 !important;
  border-bottom-color: #21262d !important;
}

html[data-tibex-theme="dark"] .search-input-wrap input {
  background: #0d1117 !important;
  border-color: #30363d !important;
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .search-input-wrap input:focus {
  border-color: #58a6ff !important;
  box-shadow: 0 0 0 4px rgba(88,166,255,.15) !important;
}

html[data-tibex-theme="dark"] .search-input-wrap input::placeholder {
  color: #6e7681 !important;
}

html[data-tibex-theme="dark"] .search-icon {
  color: #6e7681 !important;
}

/* Filters */
html[data-tibex-theme="dark"] .filters {
  background: #0d1117 !important;
  border-bottom-color: #21262d !important;
}

html[data-tibex-theme="dark"] .filter-chip {
  background: #21262d !important;
  color: #8b949e !important;
  border-color: #30363d !important;
}

html[data-tibex-theme="dark"] .filter-chip:hover {
  border-color: #58a6ff !important;
  color: #58a6ff !important;
}

html[data-tibex-theme="dark"] .filter-chip.on {
  background: #1f6feb !important;
  color: #fff !important;
  border-color: #1f6feb !important;
}

html[data-tibex-theme="dark"] .filter-chip .n {
  background: rgba(255,255,255,.1) !important;
  color: #e6edf3 !important;
}

/* Overview cards */
html[data-tibex-theme="dark"] .overview-card {
  background: #161b22 !important;
  border-color: #21262d !important;
}

html[data-tibex-theme="dark"] .overview-card .v {
  color: #58a6ff !important;
}

html[data-tibex-theme="dark"] .overview-card.green .v { color: #3fb950 !important; }
html[data-tibex-theme="dark"] .overview-card.gold .v { color: #d29922 !important; }
html[data-tibex-theme="dark"] .overview-card.red .v { color: #f85149 !important; }
html[data-tibex-theme="dark"] .overview-card.purple .v { color: #a371f7 !important; }

html[data-tibex-theme="dark"] .overview-card .l {
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .overview-card .sub {
  color: #6e7681 !important;
}

/* Stat boxes (sidebar) */
html[data-tibex-theme="dark"] .stat-box {
  background: #21262d !important;
}

html[data-tibex-theme="dark"] .stat-box .l {
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .stat-box.blue .v { color: #58a6ff !important; }
html[data-tibex-theme="dark"] .stat-box.green .v { color: #3fb950 !important; }
html[data-tibex-theme="dark"] .stat-box.gold .v { color: #d29922 !important; }
html[data-tibex-theme="dark"] .stat-box.red .v { color: #f85149 !important; }

/* Buttons */
html[data-tibex-theme="dark"] .btn {
  background: #21262d !important;
  border-color: #30363d !important;
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .btn:hover {
  border-color: #58a6ff !important;
  color: #58a6ff !important;
}

html[data-tibex-theme="dark"] .btn.primary {
  background: #1f6feb !important;
  border-color: #1f6feb !important;
  color: #fff !important;
}

html[data-tibex-theme="dark"] .btn.primary:hover {
  background: #388bfd !important;
}

html[data-tibex-theme="dark"] .btn.success {
  background: #238636 !important;
  border-color: #238636 !important;
  color: #fff !important;
}

html[data-tibex-theme="dark"] .btn.danger {
  background: #da3633 !important;
  border-color: #da3633 !important;
  color: #fff !important;
}

html[data-tibex-theme="dark"] .btn.purple {
  background: #6e40c9 !important;
  border-color: #6e40c9 !important;
  color: #fff !important;
}

/* Row actions */
html[data-tibex-theme="dark"] .row-actions button {
  background: transparent !important;
  border-color: #30363d !important;
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .row-actions button:hover {
  border-color: #58a6ff !important;
  color: #58a6ff !important;
  background: #1f6feb26 !important;
}

/* Status badges */
html[data-tibex-theme="dark"] .status {
  background: rgba(255,255,255,.05) !important;
}

html[data-tibex-theme="dark"] .status.active,
html[data-tibex-theme="dark"] .status.online {
  background: #1a4d2e !important;
  color: #3fb950 !important;
}

html[data-tibex-theme="dark"] .status.blocked,
html[data-tibex-theme="dark"] .status.broken {
  background: #67060c !important;
  color: #f85149 !important;
}

html[data-tibex-theme="dark"] .status.locked {
  background: #21262d !important;
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .status.pending {
  background: #762c00 !important;
  color: #d29922 !important;
}

/* Role badges */
html[data-tibex-theme="dark"] .role-badge {
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .role-badge.admin {
  background: #67060c !important;
  color: #f85149 !important;
}

html[data-tibex-theme="dark"] .role-badge.doctor {
  background: #1f6feb26 !important;
  color: #58a6ff !important;
}

html[data-tibex-theme="dark"] .role-badge.cashier {
  background: #762c00 !important;
  color: #d29922 !important;
}

html[data-tibex-theme="dark"] .role-badge.lab {
  background: #0d419d !important;
  color: #79c0ff !important;
}

html[data-tibex-theme="dark"] .role-badge.reception {
  background: #3a1d6e !important;
  color: #a371f7 !important;
}

/* Inputs */
html[data-tibex-theme="dark"] .input,
html[data-tibex-theme="dark"] .textarea,
html[data-tibex-theme="dark"] .select {
  background: #0d1117 !important;
  color: #e6edf3 !important;
  border-color: #30363d !important;
}

html[data-tibex-theme="dark"] .input:focus,
html[data-tibex-theme="dark"] .textarea:focus,
html[data-tibex-theme="dark"] .select:focus {
  border-color: #58a6ff !important;
  box-shadow: 0 0 0 3px rgba(88,166,255,.15) !important;
}

html[data-tibex-theme="dark"] .input::placeholder,
html[data-tibex-theme="dark"] .textarea::placeholder {
  color: #6e7681 !important;
}

html[data-tibex-theme="dark"] .form-field label {
  color: #8b949e !important;
}

/* Modal */
html[data-tibex-theme="dark"] .modal {
  background: #161b22 !important;
  border: 1px solid #30363d !important;
}

html[data-tibex-theme="dark"] .modal-head {
  border-bottom-color: #21262d !important;
}

html[data-tibex-theme="dark"] .modal-head h3 {
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .modal-head .close {
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .modal-head .close:hover {
  background: #21262d !important;
  color: #f85149 !important;
}

html[data-tibex-theme="dark"] .modal-foot {
  background: #0d1117 !important;
  border-top-color: #21262d !important;
}

/* Sidebar danger-zone */
html[data-tibex-theme="dark"] .sidebar-section.danger-zone {
  background: linear-gradient(180deg,#2d1618,#161b22) !important;
  border-top-color: #67060c !important;
}

html[data-tibex-theme="dark"] .sidebar-section.danger-zone .sidebar-title {
  color: #f85149 !important;
}

/* Audit rows */
html[data-tibex-theme="dark"] .audit-row {
  border-bottom-color: #21262d !important;
}

html[data-tibex-theme="dark"] .audit-row:hover {
  background: #161b22 !important;
}

html[data-tibex-theme="dark"] .audit-row .content .detail {
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .badge-act.create {
  background: #1a4d2e !important;
  color: #3fb950 !important;
}

html[data-tibex-theme="dark"] .badge-act.update {
  background: #762c00 !important;
  color: #d29922 !important;
}

html[data-tibex-theme="dark"] .badge-act.delete {
  background: #67060c !important;
  color: #f85149 !important;
}

html[data-tibex-theme="dark"] .badge-act.login {
  background: #0d419d !important;
  color: #79c0ff !important;
}

html[data-tibex-theme="dark"] .badge-act.payment {
  background: #762c00 !important;
  color: #d29922 !important;
}

/* Locked sections */
html[data-tibex-theme="dark"] .locked-section {
  background: #0d1117 !important;
  border-color: #21262d !important;
}

html[data-tibex-theme="dark"] .locked-section .head .t {
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .locked-section .row {
  border-bottom-color: #21262d !important;
}

/* Settings */
html[data-tibex-theme="dark"] .settings-section {
  background: #161b22 !important;
  border-color: #21262d !important;
}

html[data-tibex-theme="dark"] .settings-row {
  border-bottom-color: #21262d !important;
}

/* Console cards */
html[data-tibex-theme="dark"] .console-card {
  background: #161b22 !important;
  border-color: #21262d !important;
}

/* Role cards */
html[data-tibex-theme="dark"] .role-card {
  background: #161b22 !important;
  border-color: #21262d !important;
}

html[data-tibex-theme="dark"] .role-card .ico {
  background: linear-gradient(135deg,#21262d,#161b22) !important;
}

html[data-tibex-theme="dark"] .role-card .perm-tag {
  background: #21262d !important;
  color: #8b949e !important;
}

html[data-tibex-theme="dark"] .role-card .foot {
  border-top-color: #21262d !important;
}

/* Integration cards */
html[data-tibex-theme="dark"] .integration-card {
  background: #161b22 !important;
  border-color: #21262d !important;
}

html[data-tibex-theme="dark"] .integration-card .meta {
  background: #0d1117 !important;
  color: #8b949e !important;
}

/* Permissions */
html[data-tibex-theme="dark"] .perm-group {
  border-color: #21262d !important;
}

html[data-tibex-theme="dark"] .perm-group-head {
  background: #0d1117 !important;
  border-bottom-color: #21262d !important;
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .perm-group-head:hover {
  background: #161b22 !important;
}

html[data-tibex-theme="dark"] .perm-group-body {
  background: #161b22 !important;
}

html[data-tibex-theme="dark"] .perm-check {
  background: #21262d !important;
  border-color: #30363d !important;
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .perm-check:hover {
  border-color: #58a6ff !important;
}

html[data-tibex-theme="dark"] .perm-check.on {
  background: #1f6feb26 !important;
  border-color: #58a6ff !important;
  color: #58a6ff !important;
}

/* Tags input */
html[data-tibex-theme="dark"] .tags-input-wrap {
  background: #0d1117 !important;
  border-color: #30363d !important;
}

html[data-tibex-theme="dark"] .tags-input-wrap input {
  background: transparent !important;
  color: #e6edf3 !important;
}

html[data-tibex-theme="dark"] .tag-item {
  background: #1f6feb26 !important;
  color: #58a6ff !important;
}

html[data-tibex-theme="dark"] .tag-item.warn {
  background: #762c00 !important;
  color: #d29922 !important;
}

/* Toast */
html[data-tibex-theme="dark"] .toast {
  background: #010409 !important;
  border: 1px solid #30363d !important;
  color: #e6edf3 !important;
}

/* Actions bar */
html[data-tibex-theme="dark"] .actions {
  background: #161b22 !important;
  border-top-color: #21262d !important;
}

/* Readonly notice */
html[data-tibex-theme="dark"] .readonly-notice {
  background: #762c00 !important;
  border-color: #d29922 !important;
  color: #d29922 !important;
}

/* Scrollbar */
html[data-tibex-theme="dark"] ::-webkit-scrollbar-track {
  background: #0d1117;
}

html[data-tibex-theme="dark"] ::-webkit-scrollbar-thumb {
  background: #30363d;
  border-color: #0d1117;
}

html[data-tibex-theme="dark"] ::-webkit-scrollbar-thumb:hover {
  background: #484f58;
}

/* Sidebar toggle button (dark) */
html[data-tibex-theme="dark"] .tibex-sidebar-toggle {
  background: #21262d;
  border-color: #30363d;
  color: #8b949e;
}

html[data-tibex-theme="dark"] .tibex-sidebar-toggle:hover {
  background: #1f6feb;
  border-color: #1f6feb;
  color: #fff;
}

      /* Compact density */
      body.tibex-compact .data-table td { padding: 6px 10px !important; }
      body.tibex-compact .data-table th { padding: 7px 10px !important; }
      body.tibex-compact .page-header { padding: 8px 12px !important; }
      body.tibex-compact .sidebar-section { padding: 10px !important; }

      /* Sidebar collapsed */
      .sidebar.tibex-collapsed { width: 0 !important; overflow: hidden !important; border-right: 0 !important; }
      .sidebar.tibex-collapsed + .content { padding-left: 20px; }

      /* Settings modal */
      .tibex-set-backdrop { position: fixed; inset: 0; background: rgba(12,23,41,.6); display: none; align-items: center; justify-content: center; z-index: 99999; padding: 20px; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
      .tibex-set-backdrop.show { display: flex; }
      .tibex-set-modal { background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.35); width: 100%; max-width: 620px; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; animation: tibexSetIn .22s ease-out; }
      html[data-tibex-theme="dark"] .tibex-set-modal { background: #1e293b; color: #e2e8f0; }
      @keyframes tibexSetIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
      .tibex-set-head { padding: 18px 22px; border-bottom: 1px solid #dde3e8; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
      html[data-tibex-theme="dark"] .tibex-set-head { border-color: #334155; }
      .tibex-set-head h3 { font-size: 16px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 10px; }
      .tibex-set-head .x { background: transparent; border: none; font-size: 20px; color: #64748b; cursor: pointer; padding: 4px 10px; border-radius: 6px; }
      .tibex-set-head .x:hover { background: #f1f5f9; color: #dc2626; }
      html[data-tibex-theme="dark"] .tibex-set-head .x:hover { background: #0f172a; }
      .tibex-set-body { padding: 8px 0; overflow-y: auto; flex: 1; }
      .tibex-set-section { padding: 14px 22px; border-bottom: 1px solid #f1f5f9; }
      html[data-tibex-theme="dark"] .tibex-set-section { border-color: #334155; }
      .tibex-set-section:last-child { border-bottom: none; }
      .tibex-set-section h4 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
      .tibex-set-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; gap: 14px; }
      .tibex-set-row .info { flex: 1; min-width: 0; }
      .tibex-set-row .lbl { font-size: 13px; font-weight: 600; }
      .tibex-set-row .sub { font-size: 11.5px; color: #94a3b8; margin-top: 2px; }
      .tibex-set-toggle { position: relative; width: 42px; height: 24px; background: #cbd5e1; border-radius: 12px; cursor: pointer; transition: background .2s; flex-shrink: 0; }
      .tibex-set-toggle.on { background: #15803d; }
      .tibex-set-toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: #fff; border-radius: 50%; transition: left .2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
      .tibex-set-toggle.on::after { left: 20px; }
      .tibex-set-chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .tibex-set-chip { padding: 6px 12px; border: 1.5px solid #dde3e8; background: #fff; border-radius: 8px; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; color: #64748b; display: flex; align-items: center; gap: 5px; transition: all .12s; }
      .tibex-set-chip:hover { border-color: var(--tibex-primary); color: var(--tibex-primary); }
      .tibex-set-chip.on { background: var(--tibex-primary); color: #fff; border-color: var(--tibex-primary); }
      html[data-tibex-theme="dark"] .tibex-set-chip { background: #0f172a; border-color: #334155; color: #94a3b8; }
      html[data-tibex-theme="dark"] .tibex-set-chip:hover { border-color: var(--tibex-primary); color: var(--tibex-primary); }
      html[data-tibex-theme="dark"] .tibex-set-chip.on { background: var(--tibex-primary); color: #fff; }
      .tibex-set-btn { padding: 10px 18px; border-radius: 8px; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; border: 1px solid #dde3e8; background: #fff; color: #1a2332; display: inline-flex; align-items: center; gap: 6px; transition: all .12s; }
      .tibex-set-btn:hover { border-color: var(--tibex-primary); color: var(--tibex-primary); }
      .tibex-set-btn.primary { background: var(--tibex-primary); color: #fff; border-color: var(--tibex-primary); }
      .tibex-set-btn.primary:hover { background: var(--tibex-primary-dark); color: #fff; }
      .tibex-set-btn.danger { color: #dc2626; border-color: #fca5a5; }
      .tibex-set-btn.danger:hover { background: #fef2f2; }
      html[data-tibex-theme="dark"] .tibex-set-btn { background: #0f172a; color: #e2e8f0; border-color: #334155; }
      .tibex-set-foot { padding: 14px 22px; border-top: 1px solid #dde3e8; display: flex; justify-content: flex-end; gap: 8px; background: #f8fafc; flex-shrink: 0; }
      html[data-tibex-theme="dark"] .tibex-set-foot { background: #0f172a; border-color: #334155; }
      .tibex-set-info-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12.5px; border-bottom: 1px dashed #f1f5f9; }
      html[data-tibex-theme="dark"] .tibex-set-info-row { border-color: #334155; }
      .tibex-set-info-row:last-child { border: none; }
      .tibex-set-info-row .k { color: #94a3b8; }
      .tibex-set-info-row .v { font-weight: 700; font-family: ui-monospace, monospace; }
      .tibex-set-info-row .v.ok { color: #15803d; }
      .tibex-set-info-row .v.err { color: #dc2626; }
    `;
    document.head.appendChild(s);
  }


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
    injectCSS();
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
        <div class="tibex-set-info-row"><span class="k">Rol</span><span class="v">${u.role || '—'}</span></div>
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

    body.innerHTML = ko + sec + notif + sys + danger;
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
    const spacer = topbar.querySelector(".spacer");
    if (spacer) spacer.parentNode.insertBefore(btn, spacer.nextSibling);
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
    injectCSS();
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
    injectCSS();
    const style = document.createElement("style");
    style.textContent = `
      .tibex-danger-backdrop { position: fixed; inset: 0; background: rgba(12,23,41,.75); display: none; align-items: center; justify-content: center; z-index: 100000; padding: 20px; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
      .tibex-danger-backdrop.show { display: flex; }
      .tibex-danger-modal { background: #fff; border-radius: 14px; box-shadow: 0 24px 80px rgba(220,38,38,.35); width: 100%; max-width: 560px; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; animation: tibexSetIn .22s ease-out; border: 2px solid #dc2626; }
      html[data-tibex-theme="dark"] .tibex-danger-modal { background: #1e293b; color: #e2e8f0; }
      .tibex-danger-head { padding: 18px 22px; background: linear-gradient(90deg,#fef2f2,#fff); border-bottom: 2px solid #fecaca; display: flex; justify-content: space-between; align-items: center; }
      html[data-tibex-theme="dark"] .tibex-danger-head { background: #450a0a; border-color: #991b1b; }
      .tibex-danger-head h3 { font-size: 16px; font-weight: 700; margin: 0; color: #991b1b; display: flex; align-items: center; gap: 10px; }
      .tibex-danger-head .x { background: transparent; border: none; font-size: 20px; color: #dc2626; cursor: pointer; padding: 4px 10px; border-radius: 6px; }
      .tibex-danger-head .x:hover { background: #fef2f2; }
      .tibex-danger-body { padding: 20px; overflow-y: auto; flex: 1; }
      .tibex-danger-steps { display: flex; gap: 6px; margin-bottom: 20px; }
      .tibex-danger-step { flex: 1; padding: 8px; border-radius: 8px; background: #f1f5f9; text-align: center; font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: .3px; text-transform: uppercase; }
      .tibex-danger-step.active { background: #dc2626; color: #fff; }
      .tibex-danger-step.done { background: #15803d; color: #fff; }
      .tibex-danger-warn { background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 14px; border-radius: 6px; font-size: 12.5px; color: #991b1b; line-height: 1.5; margin-bottom: 16px; }
      html[data-tibex-theme="dark"] .tibex-danger-warn { background: #450a0a; color: #fca5a5; }
      .tibex-danger-field { margin-bottom: 14px; }
      .tibex-danger-field label { display: block; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 5px; }
      .tibex-danger-field input { width: 100%; border: 2px solid #dde3e8; border-radius: 8px; padding: 11px 14px; font-family: inherit; font-size: 14px; background: #fff; box-sizing: border-box; }
      .tibex-danger-field input:focus { outline: none; border-color: #dc2626; box-shadow: 0 0 0 4px rgba(220,38,38,.15); }
      html[data-tibex-theme="dark"] .tibex-danger-field input { background: #0f172a; color: #e2e8f0; border-color: #334155; }
      .tibex-danger-msg { padding: 10px 12px; border-radius: 6px; font-size: 12.5px; margin-bottom: 14px; }
      .tibex-danger-msg.err { background: #fef2f2; color: #991b1b; border-left: 3px solid #dc2626; }
      .tibex-danger-msg.ok { background: #dcfce7; color: #166534; border-left: 3px solid #15803d; }
      .tibex-danger-foot { padding: 14px 22px; border-top: 1px solid #dde3e8; display: flex; justify-content: flex-end; gap: 8px; background: #f8fafc; }
      html[data-tibex-theme="dark"] .tibex-danger-foot { background: #0f172a; border-color: #334155; }
      .tibex-danger-btn { padding: 11px 20px; border-radius: 8px; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; border: 1px solid #dde3e8; background: #fff; color: #1a2332; }
      .tibex-danger-btn:hover { border-color: #64748b; }
      .tibex-danger-btn.primary { background: #dc2626; color: #fff; border-color: #dc2626; }
      .tibex-danger-btn.primary:hover { background: #991b1b; }
      .tibex-danger-btn:disabled { opacity: .5; cursor: not-allowed; }
      .tibex-danger-countdown { font-size: 64px; font-weight: 700; font-family: ui-monospace, monospace; color: #dc2626; text-align: center; padding: 20px 0; animation: tibexPulse 1s infinite; }
      @keyframes tibexPulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
      .tibex-danger-checklist { background: #f8fafc; padding: 12px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 12.5px; }
      html[data-tibex-theme="dark"] .tibex-danger-checklist { background: #0f172a; }
      .tibex-danger-checklist label { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; }
      .tibex-danger-checklist input[type="checkbox"] { width: 16px; height: 16px; accent-color: #dc2626; cursor: pointer; }
    `;
    document.head.appendChild(style);

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
