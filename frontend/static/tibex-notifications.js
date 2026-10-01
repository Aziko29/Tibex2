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

  // CSS: static/css/tibex-notifications.css (HTML da <link> orqali; CSP style-src 'self' — JS da style elementi yaratilmaydi)

  // ─── Dropdown ───
  function buildDropdown() {
    if (_dropdown) return;
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
