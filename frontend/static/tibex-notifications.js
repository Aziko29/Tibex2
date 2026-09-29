/* ══════════════════════════════════════════════════════════════════
 * TIBEX Notifications — universal bildirishnoma menyusi
 * TIBEX_NOTIF_v1
 * ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const MAX_ITEMS = 8;
  const KEY_SEEN = "tibex_notif_seen_ts";

  let _bound = false;
  let _dropdown = null;
  let _bellBtn = null;
  let _unreadCount = 0;

  // ─── Helpers ───
  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const sec = Math.floor(diff / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    if (sec < 60) return "hozir";
    if (min < 60) return min + " daqiqa oldin";
    if (hr < 24) return hr + " soat oldin";
    if (day < 7) return day + " kun oldin";
    const d = new Date(ts);
    return d.getDate() + "." + String(d.getMonth()+1).padStart(2,"0") + "." + d.getFullYear();
  }

  function actionIcon(action) {
    return {
      create: "➕", update: "✏️", delete: "🗑️",
      login: "🔐", logout: "🚪", payment: "💰",
      refund: "🔄", backup: "💾", shift: "🕐",
    }[action] || "•";
  }

  function actionColor(action) {
    return {
      create: "#15803d", update: "#b45309", delete: "#dc2626",
      login: "#0369a1", payment: "#a16207", refund: "#7c3aed",
      backup: "#7c3aed", shift: "#0369a1",
    }[action] || "#64748b";
  }

  function getSeenTs() {
    try { return parseInt(localStorage.getItem(KEY_SEEN) || "0"); } catch (_) { return 0; }
  }

  function setSeenTs(ts) {
    try { localStorage.setItem(KEY_SEEN, String(ts)); } catch (_) {}
  }

  // ─── CSS ───
  function injectCSS() {
    if (document.getElementById("tibex-notif-css")) return;
    const s = document.createElement("style");
    s.id = "tibex-notif-css";
    s.textContent = `
      .tibex-notif-wrap { position: relative; }
      .tibex-notif-bell { position: relative; }
      .tibex-notif-bell .badge {
        position: absolute; top: 2px; right: 2px;
        min-width: 16px; height: 16px; padding: 0 4px;
        background: #dc2626; color: #fff;
        border-radius: 8px; font-size: 10px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
        border: 2px solid var(--dark, #0c1729);
        font-family: ui-monospace, monospace;
        line-height: 1;
      }
      .tibex-notif-bell .badge.hidden { display: none; }
      .tibex-notif-drop {
        position: absolute; top: calc(100% + 8px); right: 0;
        width: 380px; max-width: calc(100vw - 20px);
        background: #fff; border: 1px solid #dde3e8; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,.18);
        z-index: 1000; overflow: hidden;
        animation: tibexNotifIn .15s ease-out;
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      @keyframes tibexNotifIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
      html[data-tibex-theme="dark"] .tibex-notif-drop { background: #1e293b; border-color: #334155; }
      .tibex-notif-drop.hidden { display: none; }
      .tibex-notif-head {
        padding: 12px 16px; border-bottom: 1px solid #f1f5f9;
        display: flex; justify-content: space-between; align-items: center;
      }
      html[data-tibex-theme="dark"] .tibex-notif-head { border-color: #334155; }
      .tibex-notif-head h4 { font-size: 13px; font-weight: 700; margin: 0; color: #1a2332; display: flex; align-items: center; gap: 6px; }
      html[data-tibex-theme="dark"] .tibex-notif-head h4 { color: #e2e8f0; }
      .tibex-notif-head button { background: transparent; border: none; font-size: 11px; color: #1e40af; cursor: pointer; font-weight: 600; padding: 2px 6px; border-radius: 4px; }
      .tibex-notif-head button:hover { background: #dbeafe; }
      .tibex-notif-list { max-height: 380px; overflow-y: auto; }
      .tibex-notif-item {
        display: flex; gap: 10px; padding: 10px 16px;
        border-bottom: 1px solid #f8fafc; cursor: pointer;
        transition: background .1s;
      }
      html[data-tibex-theme="dark"] .tibex-notif-item { border-color: #334155; }
      .tibex-notif-item:hover { background: #f8fafc; }
      html[data-tibex-theme="dark"] .tibex-notif-item:hover { background: #0f172a; }
      .tibex-notif-item .ico {
        width: 32px; height: 32px; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 15px; flex-shrink: 0;
      }
      .tibex-notif-item .body { flex: 1; min-width: 0; }
      .tibex-notif-item .body .t {
        font-size: 12.5px; font-weight: 600; color: #1a2332;
        line-height: 1.4; word-break: break-word;
      }
      html[data-tibex-theme="dark"] .tibex-notif-item .body .t { color: #e2e8f0; }
      .tibex-notif-item .body .meta {
        font-size: 11px; color: #94a3b8; margin-top: 3px;
        display: flex; gap: 8px;
      }
      .tibex-notif-item.unread { background: #f0f7ff; }
      html[data-tibex-theme="dark"] .tibex-notif-item.unread { background: #1e3a8a33; }
      .tibex-notif-empty {
        padding: 40px 20px; text-align: center; color: #94a3b8; font-size: 12.5px;
      }
      .tibex-notif-empty .big { font-size: 40px; opacity: .4; margin-bottom: 8px; }
      .tibex-notif-foot {
        padding: 10px 16px; border-top: 1px solid #f1f5f9;
        text-align: center; background: #f8fafc;
      }
      html[data-tibex-theme="dark"] .tibex-notif-foot { background: #0f172a; border-color: #334155; }
      .tibex-notif-foot button {
        background: transparent; border: none; color: #1e40af;
        font-family: inherit; font-size: 12.5px; font-weight: 600;
        cursor: pointer; padding: 4px 10px; border-radius: 6px;
      }
      .tibex-notif-foot button:hover { background: #dbeafe; }
    `;
    document.head.appendChild(s);
  }

  // ─── Dropdown ───
  function buildDropdown() {
    if (_dropdown) return;
    injectCSS();
    _dropdown = document.createElement("div");
    _dropdown.className = "tibex-notif-drop hidden";
    _dropdown.innerHTML = `
      <div class="tibex-notif-head">
        <h4>🔔 Bildirishnomalar</h4>
        <button data-notif-clear>Barchasini o'qilgan</button>
      </div>
      <div class="tibex-notif-list" id="tibexNotifList"></div>
      <div class="tibex-notif-foot">
        <button data-notif-all>Barchasini ko'rish →</button>
      </div>
    `;
    document.body.appendChild(_dropdown);
    _dropdown.querySelector("[data-notif-clear]").addEventListener("click", (e) => {
      e.stopPropagation();
      setSeenTs(Date.now());
      updateBadge();
      renderList();
    });
    _dropdown.querySelector("[data-notif-all]").addEventListener("click", () => {
      closeDropdown();
      // Audit tab'iga o'tish
      const auditTab = document.querySelector('[data-view="audit"]');
      if (auditTab) auditTab.click();
    });
  }

  function openDropdown() {
    buildDropdown();
    renderList();
    _dropdown.classList.remove("hidden");
    setTimeout(() => {
      document.addEventListener("click", _outsideClick, { once: true });
    }, 50);
  }

  function closeDropdown() {
    if (_dropdown) _dropdown.classList.add("hidden");
  }

  function _outsideClick(e) {
    if (_dropdown && !_dropdown.contains(e.target) && !_bellBtn?.contains(e.target)) {
      closeDropdown();
    } else if (!_dropdown?.classList.contains("hidden")) {
      document.addEventListener("click", _outsideClick, { once: true });
    }
  }

  function renderList() {
    const list = document.getElementById("tibexNotifList");
    if (!list) return;
    const audit = window.TIBEX_STORE?.getAudit?.() || [];
    const seenTs = getSeenTs();
    const recent = audit.slice(0, MAX_ITEMS);

    if (recent.length === 0) {
      list.innerHTML = '<div class="tibex-notif-empty"><div class="big">🔕</div>Bildirishnomalar yo\'q</div>';
      return;
    }

    list.innerHTML = recent.map(a => {
      const isUnread = (a.ts || 0) > seenTs;
      const icon = actionIcon(a.action);
      const color = actionColor(a.action);
      return `<div class="tibex-notif-item ${isUnread ? 'unread' : ''}">
        <div class="ico" style="background:${color}22;color:${color};">${icon}</div>
        <div class="body">
          <div class="t">${esc(a.detail || '—')}</div>
          <div class="meta">
            <span>${esc(a.user || '—')}</span>
            <span>·</span>
            <span>${timeAgo(a.ts || 0)}</span>
          </div>
        </div>
      </div>`;
    }).join("");
  }

  function updateBadge() {
    if (!_bellBtn) return;
    const audit = window.TIBEX_STORE?.getAudit?.() || [];
    const seenTs = getSeenTs();
    _unreadCount = audit.filter(a => (a.ts || 0) > seenTs).length;

    let badge = _bellBtn.querySelector(".badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "badge";
      _bellBtn.appendChild(badge);
    }
    if (_unreadCount === 0) {
      badge.classList.add("hidden");
    } else {
      badge.classList.remove("hidden");
      badge.textContent = _unreadCount > 99 ? "99+" : String(_unreadCount);
    }
  }

  // ─── Bell button ───
  function attachToBell(btn) {
    if (btn.dataset.tibexNotifBound === "1") return;
    btn.dataset.tibexNotifBound = "1";
    _bellBtn = btn;
    btn.classList.add("tibex-notif-bell");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (_dropdown?.classList.contains("hidden") || !_dropdown) {
        openDropdown();
      } else {
        closeDropdown();
      }
    });
    updateBadge();
  }

  function findBell() {
    // Admin.html'da qo'ng'iroqcha tugmasini topish
    const candidates = document.querySelectorAll(".topbar button");
    for (const b of candidates) {
      const t = (b.textContent || "").trim();
      const title = (b.title || "").toLowerCase();
      if (t.includes("🔔") || title.includes("bildirishnoma")) {
        attachToBell(b);
        return true;
      }
    }
    return false;
  }

  // ─── WebSocket orqali yangi bildirishnoma ───
  function watchRealtime() {
    if (!window.TIBEX_STORE?.subscribe) return;
    window.TIBEX_STORE.subscribe((data, source) => {
      if (source === "external") {
        updateBadge();
        if (!_dropdown?.classList.contains("hidden")) renderList();
      }
    });
  }

  // ─── Init ───
  function init() {
    if (_bound) return;
    _bound = true;
    injectCSS();
    if (findBell()) {
      watchRealtime();
      // Davriy yangilash
      setInterval(updateBadge, 30000);
      console.log("[TIBEX] Notifications tayyor");
    } else {
      console.log("[TIBEX] Qo'ng'iroqcha topilmadi");
    }
  }

  function waitForBell() {
    if (findBell()) {
      init();
    } else {
      setTimeout(waitForBell, 300);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForBell);
  } else {
    waitForBell();
  }

  window.TIBEX_NOTIF = {
    open: openDropdown,
    close: closeDropdown,
    update: updateBadge,
  };
})();
