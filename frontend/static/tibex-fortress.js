/* ══════════════════════════════════════════════════════════════════
 * TIBEX Fortress — Admin panel uchun mustahkam qal'a
 * TIBEX_FORTRESS_v1
 *
 * Funksiyalar:
 *   • Floating fortress widget (o'ng pastki burchak)
 *   • Real-time health monitoring (10s)
 *   • Kritik alert — banner + ovoz + toast
 *   • Xato log panel (live)
 *   • WebSocket avto-tiklanish
 * ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const REFRESH_MS = 10000;         // 10 sekund
  const ALERT_DURATION_MS = 8000;   // Banner ko'rinish vaqti
  const SOUND_URL = "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

  let _bound = false;
  let _open = false;
  let _healthTimer = null;
  let _lastHealth = null;
  let _alertAudio = null;

  // ─── API ───
  async function _api(path, method, body) {
    const store = window.TIBEX_STORE;
    if (!store || typeof store._api !== "function") throw new Error("STORE yo'q");
    return await store._api(path, { method: method || "GET", body: body });
  }

  // ─── CSS ───
  function _injectCSS() {
    if (document.getElementById("tibex-fortress-css")) return;
    const s = document.createElement("style");
    s.id = "tibex-fortress-css";
    s.textContent = `
      .tibex-fortress-fab {
        position: fixed; bottom: 20px; right: 20px;
        width: 56px; height: 56px;
        background: linear-gradient(135deg, #1e40af, #1e3a8a);
        color: #fff; border: none; border-radius: 50%;
        cursor: pointer; box-shadow: 0 8px 24px rgba(30,64,175,.4);
        font-size: 24px; z-index: 9998;
        display: flex; align-items: center; justify-content: center;
        transition: all .2s;
      }
      .tibex-fortress-fab:hover { transform: scale(1.08); box-shadow: 0 12px 32px rgba(30,64,175,.55); }
      .tibex-fortress-fab.ok { background: linear-gradient(135deg, #15803d, #14532d); box-shadow: 0 8px 24px rgba(21,128,61,.4); }
      .tibex-fortress-fab.warn { background: linear-gradient(135deg, #b45309, #78350f); box-shadow: 0 8px 24px rgba(180,83,9,.4); }
      .tibex-fortress-fab.bad { background: linear-gradient(135deg, #dc2626, #991b1b); box-shadow: 0 8px 24px rgba(220,38,38,.5); animation: tibexFabPulse 1.5s infinite; }
      @keyframes tibexFabPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }

      .tibex-fortress-fab .badge-mini {
        position: absolute; top: -4px; right: -4px;
        min-width: 20px; height: 20px; padding: 0 6px;
        background: #fbbf24; color: #78350f;
        border-radius: 10px; font-size: 11px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
        border: 2px solid #fff;
      }

      .tibex-fortress-panel {
        position: fixed; bottom: 90px; right: 20px;
        width: 420px; max-width: calc(100vw - 40px);
        max-height: 70vh; background: #fff;
        border-radius: 14px; border: 1px solid #dde3e8;
        box-shadow: 0 20px 60px rgba(0,0,0,.2);
        z-index: 9999; display: none; flex-direction: column;
        overflow: hidden; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      .tibex-fortress-panel.open { display: flex; }
      html[data-tibex-theme="dark"] .tibex-fortress-panel { background: #161b22; border-color: #30363d; color: #e6edf3; }

      .tibex-fortress-head {
        padding: 14px 18px; background: linear-gradient(135deg, #1e40af, #1e3a8a);
        color: #fff; display: flex; justify-content: space-between; align-items: center;
      }
      .tibex-fortress-head h3 { font-size: 14px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 8px; }
      .tibex-fortress-head button { background: transparent; border: none; color: #fff; font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
      .tibex-fortress-head button:hover { background: rgba(255,255,255,.15); }

      .tibex-fortress-body { padding: 0; overflow-y: auto; flex: 1; }

      .tibex-fortress-section { padding: 12px 18px; border-bottom: 1px solid #f1f5f9; }
      html[data-tibex-theme="dark"] .tibex-fortress-section { border-color: #30363d; }
      .tibex-fortress-section:last-child { border-bottom: none; }
      .tibex-fortress-section h4 { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin: 0 0 10px; }

      .tibex-fortress-status {
        display: flex; align-items: center; gap: 10px; padding: 8px 10px;
        background: #f8fafc; border-radius: 8px; margin-bottom: 6px;
      }
      html[data-tibex-theme="dark"] .tibex-fortress-status { background: #0d1117; }
      .tibex-fortress-status .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
      .tibex-fortress-status .dot.ok { background: #15803d; box-shadow: 0 0 0 3px rgba(21,128,61,.2); }
      .tibex-fortress-status .dot.warn { background: #b45309; box-shadow: 0 0 0 3px rgba(180,83,9,.2); }
      .tibex-fortress-status .dot.bad { background: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,.2); }
      .tibex-fortress-status .dot.off { background: #cbd5e1; }
      .tibex-fortress-status .name { flex: 1; font-size: 12.5px; font-weight: 600; }
      .tibex-fortress-status .val { font-size: 11.5px; font-family: ui-monospace, monospace; color: #64748b; font-weight: 600; }
      html[data-tibex-theme="dark"] .tibex-fortress-status .val { color: #8b949e; }
      .tibex-fortress-status .val.ok { color: #15803d; }
      .tibex-fortress-status .val.bad { color: #dc2626; }

      .tibex-fortress-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12.5px; }
      .tibex-fortress-row .k { color: #64748b; }
      .tibex-fortress-row .v { font-family: ui-monospace, monospace; font-weight: 700; }

      .tibex-fortress-error {
        padding: 8px 10px; border-left: 3px solid #dc2626;
        background: #fef2f2; border-radius: 6px; margin-bottom: 6px;
        font-size: 11.5px; cursor: pointer;
      }
      html[data-tibex-theme="dark"] .tibex-fortress-error { background: #450a0a; color: #fca5a5; }
      .tibex-fortress-error:hover { background: #fee2e2; }
      .tibex-fortress-error .path { font-family: ui-monospace, monospace; font-weight: 700; color: #991b1b; }
      .tibex-fortress-error .meta { color: #64748b; font-size: 10.5px; margin-top: 2px; }

      .tibex-fortress-alert-banner {
        position: fixed; top: 70px; left: 50%; transform: translateX(-50%);
        background: #dc2626; color: #fff; padding: 12px 20px;
        border-radius: 10px; z-index: 99999;
        display: none; align-items: center; gap: 12px;
        box-shadow: 0 8px 32px rgba(220,38,38,.5);
        max-width: 90vw; animation: tibexAlertIn .3s;
      }
      @keyframes tibexAlertIn { from { opacity: 0; transform: translate(-50%,-20px); } to { opacity: 1; transform: translate(-50%,0); } }
      .tibex-fortress-alert-banner.show { display: flex; }
      .tibex-fortress-alert-banner.warn { background: #b45309; }
      .tibex-fortress-alert-banner.info { background: #0369a1; }
      .tibex-fortress-alert-banner .icon { font-size: 22px; }
      .tibex-fortress-alert-banner .body { flex: 1; min-width: 0; }
      .tibex-fortress-alert-banner .title { font-weight: 700; font-size: 13px; }
      .tibex-fortress-alert-banner .detail { font-size: 11.5px; opacity: .9; margin-top: 2px; }
      .tibex-fortress-alert-banner button { background: rgba(255,255,255,.2); border: none; color: #fff; padding: 5px 10px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 11.5px; }
      .tibex-fortress-alert-banner button:hover { background: rgba(255,255,255,.3); }
    `;
    document.head.appendChild(s);
  }

  // ─── Fab ───
  function buildFab() {
    if (document.getElementById("tibexFortressFab")) return;
    _injectCSS();
    const fab = document.createElement("button");
    fab.className = "tibex-fortress-fab";
    fab.id = "tibexFortressFab";
    fab.title = "Xavfsizlik markazi";
    fab.innerHTML = '🏰<span class="badge-mini" id="tibexFortressBadge" style="display:none;">0</span>';
    fab.addEventListener("click", togglePanel);
    document.body.appendChild(fab);

    const panel = document.createElement("div");
    panel.className = "tibex-fortress-panel";
    panel.id = "tibexFortressPanel";
    panel.innerHTML = `
      <div class="tibex-fortress-head">
        <h3>🏰 Xavfsizlik markazi</h3>
        <button id="tibexFortressClose">✕</button>
      </div>
      <div class="tibex-fortress-body" id="tibexFortressBody"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById("tibexFortressClose").addEventListener("click", () => {
      panel.classList.remove("open");
      _open = false;
    });

    const banner = document.createElement("div");
    banner.className = "tibex-fortress-alert-banner";
    banner.id = "tibexFortressBanner";
    banner.innerHTML = `
      <span class="icon" id="tibexFortressBannerIcon">⚠️</span>
      <div class="body">
        <div class="title" id="tibexFortressBannerTitle">—</div>
        <div class="detail" id="tibexFortressBannerDetail">—</div>
      </div>
      <button id="tibexFortressBannerClose">Yopish</button>
    `;
    document.body.appendChild(banner);
    document.getElementById("tibexFortressBannerClose").addEventListener("click", hideBanner);
  }

  function togglePanel() {
    const p = document.getElementById("tibexFortressPanel");
    if (!p) return;
    _open = !_open;
    p.classList.toggle("open", _open);
    if (_open) render();
  }

  // ─── Health check ───
  async function fetchHealth() {
    try {
      _lastHealth = await _api("/api/monitoring/health");
    } catch (e) {
      _lastHealth = { overall: "down", error: e.message };
    }
    return _lastHealth;
  }

  // ─── Errors ───
  async function fetchErrors() {
    try {
      const r = await _api("/api/monitoring/errors?limit=15");
      return r.items || [];
    } catch (_) { return []; }
  }

  // ─── Alerts ───
  async function fetchAlerts() {
    try {
      const r = await _api("/api/monitoring/alerts?limit=10");
      return r.items || [];
    } catch (_) { return []; }
  }

  // ─── Security Status ───
  async function fetchSecurityStatus() {
    try {
      return await _api("/api/monitoring/security-status");
    } catch (_) { return null; }
  }

  // ─── Threat Map ───
  async function fetchThreatMap() {
    try {
      return await _api("/api/monitoring/threat-map?limit=5");
    } catch (_) { return []; }
  }

  // ─── Render ───
  async function render() {
    const [h, errors, alerts] = await Promise.all([fetchHealth(), fetchErrors(), fetchAlerts()]);
    updateFab(h);
    if (!_open) return;
    const body = document.getElementById("tibexFortressBody");
    if (!body) return;

    // Umumiy holat
    let overallCls = "ok", overallText = "Tizim ishlaydi", overallIcon = "🟢";
    if (h.overall === "degraded") { overallCls = "warn"; overallText = "Cheklangan"; overallIcon = "🟡"; }
    if (h.overall === "down") { overallCls = "bad"; overallText = "Ishlamaydi"; overallIcon = "🔴"; }

    let html = `
      <div class="tibex-fortress-section" style="background:#f8fafc;padding:16px 18px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:28px;">${overallIcon}</span>
          <div>
            <div style="font-weight:700;font-size:14px;">${overallText}</div>
            <div style="font-size:11.5px;color:#64748b;">Uptime: ${Math.floor((h.uptime_seconds || 0)/60)} daq · ${new Date().toLocaleTimeString("uz")}</div>
          </div>
        </div>
      </div>

      <div class="tibex-fortress-section">
        <h4>🖥 Tizim salomatligi</h4>
        <div class="tibex-fortress-status">
          <span class="dot ${h.db?.status === 'up' ? 'ok' : 'bad'}"></span>
          <span class="name">Database</span>
          <span class="val ${h.db?.status === 'up' ? 'ok' : 'bad'}">${esc(h.db?.status || '?')} ${h.db?.latency_ms ? h.db.latency_ms + 'ms' : ''}</span>
        </div>
        <div class="tibex-fortress-status">
          <span class="dot ${h.redis?.status === 'up' ? 'ok' : (h.redis?.status === 'down' ? 'off' : 'warn')}"></span>
          <span class="name">Redis</span>
          <span class="val">${esc(h.redis?.status || '?')} ${h.redis?.latency_ms ? h.redis.latency_ms + 'ms' : ''}</span>
        </div>
        <div class="tibex-fortress-status">
          <span class="dot ${h.websocket?.clients > 0 ? 'ok' : 'off'}"></span>
          <span class="name">WebSocket</span>
          <span class="val">${h.websocket?.clients || 0} ulanish</span>
        </div>
        <div class="tibex-fortress-status">
          <span class="dot ok"></span>
          <span class="name">Sessiyalar</span>
          <span class="val">${h.sessions?.active || 0} aktiv</span>
        </div>
        <div class="tibex-fortress-status">
          <span class="dot ok"></span>
          <span class="name">Foydalanuvchilar</span>
          <span class="val">${h.users?.active || 0}/${h.users?.total || 0}</span>
        </div>
      </div>

      <div class="tibex-fortress-section">
        <h4>📊 So'rovlar</h4>
        <div class="tibex-fortress-row"><span class="k">Jami so'rovlar</span><span class="v">${h.requests?.total || 0}</span></div>
        <div class="tibex-fortress-row"><span class="k">Jami xatolar</span><span class="v" style="color:#dc2626;">${h.requests?.errors || 0}</span></div>
        <div class="tibex-fortress-row"><span class="k">Oxirgi 1 daqiqa</span><span class="v ${(h.requests?.errors_last_minute || 0) > 5 ? 'bad' : 'ok'}">${h.requests?.errors_last_minute || 0} xato</span></div>
      </div>
    `;

    // Alerts
    if (alerts.length > 0) {
      html += `<div class="tibex-fortress-section"><h4>🔔 Oxirgi alertlar</h4>`;
      html += alerts.slice(0, 5).map(a => {
        const cls = a.level === "critical" ? "bad" : a.level === "warn" ? "warn" : "info";
        const icon = a.level === "critical" ? "🔴" : a.level === "warn" ? "🟡" : "🔵";
        return `<div class="tibex-fortress-error" style="border-color:${cls === 'bad' ? '#dc2626' : cls === 'warn' ? '#b45309' : '#0369a1'};">
          <div style="display:flex;align-items:center;gap:6px;">
            <span>${icon}</span>
            <span style="font-weight:700;">${esc(a.title)}</span>
          </div>
          <div class="meta" style="margin-top:4px;">${esc(a.detail)} · ${timeAgo(a.ts)}</div>
        </div>`;
      }).join("");
      html += `</div>`;
    }

    // Errors
    if (errors.length > 0) {
      html += `<div class="tibex-fortress-section"><h4>⚠️ Oxirgi xatolar</h4>`;
      html += errors.slice(0, 8).map(e => `
        <div class="tibex-fortress-error">
          <div class="path">${esc(e.method)} ${esc(e.path)}</div>
          <div class="meta">${esc(e.status)} · ${esc(e.type || '')} · ${timeAgo(e.ts)}</div>
        </div>
      `).join("");
      html += `</div>`;
    }

    // Test button
    html += `
      <div class="tibex-fortress-section" style="text-align:center;">
        <button style="background:#1e40af;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:600;font-size:12px;" data-fortress-action="test">🔔 Test alert</button>
        <button style="background:#f1f5f9;color:#1a2332;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:600;font-size:12px;margin-left:6px;" data-fortress-action="clear">🗑 Xatolarni tozalash</button>
      </div>
    `;

    body.innerHTML = html;
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return s + "s oldin";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " daq oldin";
    const h = Math.floor(m / 60);
    return h + " soat oldin";
  }

  function updateFab(h) {
    const fab = document.getElementById("tibexFortressFab");
    if (!fab) return;
    fab.classList.remove("ok", "warn", "bad");
    if (h.overall === "healthy") fab.classList.add("ok");
    else if (h.overall === "degraded") fab.classList.add("warn");
    else fab.classList.add("bad");

    const badge = document.getElementById("tibexFortressBadge");
    const errCount = h.requests?.errors_last_minute || 0;
    if (errCount > 0) {
      badge.style.display = "flex";
      badge.textContent = errCount > 99 ? "99+" : errCount;
    } else {
      badge.style.display = "none";
    }
  }

  // ─── Banner ───
  function showBanner(level, title, detail) {
    const b = document.getElementById("tibexFortressBanner");
    if (!b) return;
    b.classList.remove("warn", "info");
    if (level === "warn") b.classList.add("warn");
    else if (level === "info") b.classList.add("info");
    document.getElementById("tibexFortressBannerIcon").textContent =
      level === "critical" ? "🚨" : level === "warn" ? "⚠️" : "ℹ️";
    document.getElementById("tibexFortressBannerTitle").textContent = title;
    document.getElementById("tibexFortressBannerDetail").textContent = detail;
    b.classList.add("show");
    playSound();
    setTimeout(hideBanner, ALERT_DURATION_MS);
  }
  function hideBanner() {
    document.getElementById("tibexFortressBanner")?.classList.remove("show");
  }

  function playSound() {
    try {
      if (!_alertAudio) _alertAudio = new Audio(SOUND_URL);
      _alertAudio.volume = 0.3;
      _alertAudio.play().catch(() => {});
    } catch (_) {}
  }

  // ─── Global API ───
  window.TIBEX_FORTRESS = {
    open: togglePanel,
    refresh: render,
    testAlert: async function () {
      try {
        await _api("/api/monitoring/alerts/test", "POST", {});
        showBanner("info", "Test alert", "Bu sinov xabari");
      } catch (e) { console.error(e); }
    },
    clearErrors: async function () {
      try {
        await _api("/api/monitoring/clear-errors", "POST", {});
        render();
      } catch (e) { console.error(e); }
    },
  };

  // CSP: inline onclick o'rniga event delegation
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-fortress-action]");
    if (!b) return;
    if (b.dataset.fortressAction === "test") window.TIBEX_FORTRESS.testAlert();
    else if (b.dataset.fortressAction === "clear") window.TIBEX_FORTRESS.clearErrors();
  });

  // ─── WebSocket orqali alertlar ───
  function watchRealtime() {
    if (!window.TIBEX_STORE?.subscribe) return;
    window.TIBEX_STORE.subscribe((data, source) => {
      if (source === "external") {
        // Yangi alert kelsa — banner ko'rsatish
        if (window.__TIBEX_LAST_ALERT__ !== undefined) {
          // handleWebSocketMessage orqali keladi
        }
      }
    });
  }

  // tibex-client.js `_applyEvent`ni patch qilish orqali
  function patchClientEvents() {
    const store = window.TIBEX_STORE;
    if (!store) return;
    // Alert eventlarini qo'shimcha qabul qilish
    // (client.js'da _applyEvent switch mavjud, lekin alert.* yo'q)
    // Global hook orqali:
    const origSubscribe = store.subscribe;
    if (!store.__fortress_patched) {
      store.__fortress_patched = true;
      window.addEventListener("tibex-alert", (e) => {
        const a = e.detail;
        showBanner(a.level || "info", a.title || "Alert", a.detail || "");
      });
    }
  }

  // ─── Init ───
  function init() {
    if (_bound) return;
    if (!window.TIBEX_STORE?.CURRENT_USER) return setTimeout(init, 300);
    _bound = true;
    buildFab();
    render();
    _healthTimer = setInterval(() => {
      render();
    }, REFRESH_MS);
    console.log("[TIBEX] Fortress tayyor 🏰");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
