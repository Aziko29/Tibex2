/* ══════════════════════════════════════════════════════════════════
 * TIBEX REALTIME v1.0 — smart re-render engine
 *
 * Maqsad: xodimlar uchun refresh odatini yo'q qilish.
 * WebSocket orqali kelgan o'zgarishlarni aqlli render qiladi:
 *   • Focus yo'qolmaydi (yozayotganda)
 *   • Scroll sakramaydi
 *   • O'zgargan qatorlar flash animatsiya oladi
 *   • Toast spam yo'q
 * ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  if (window.__TIBEX_REALTIME_INSTALLED__) return;
  window.__TIBEX_REALTIME_INSTALLED__ = true;

  var DEBOUNCE_MS = 80;
  var HIGHLIGHT_MS = 1500;

  var _scheduled = null;
  var _pending = [];
  var _changed = [];

  // ─── CSS ───
  (function () {
    if (document.getElementById("tibex-realtime-css")) return;
    var s = document.createElement("style");
    s.id = "tibex-realtime-css";
    s.textContent =
      "@keyframes tibexRowFlash{0%{background-color:rgba(59,130,246,.28)}100%{background-color:transparent}}" +
      "@keyframes tibexRowNew{0%{background-color:rgba(34,197,94,.35)}100%{background-color:transparent}}" +
      "@keyframes tibexLivePulse{0%{box-shadow:0 0 0 0 rgba(74,222,128,.6)}100%{box-shadow:0 0 0 10px rgba(74,222,128,0)}}" +
      ".tibex-row-updated{animation:tibexRowFlash 1.4s ease-out}" +
      ".tibex-row-new{animation:tibexRowNew 1.8s ease-out}" +
      ".sync-status.live-pulse .dot{animation:tibexLivePulse .7s ease-out}" +
      ".sync-status.offline{background:rgba(239,68,68,.15)!important;color:#fca5a5!important}" +
      ".sync-status.offline .dot{background:#ef4444!important;animation:none!important}";
    document.head.appendChild(s);
  })();

  // ─── Focus preservation ───
  function _saveFocus() {
    var el = document.activeElement;
    if (!el || el === document.body) return null;
    var tag = el.tagName;
    if (!el.id && !el.name) return null;
    var st = {
      id: el.id || null,
      name: el.name || null,
      tag: tag,
      selStart: null,
      selEnd: null,
      value: undefined,
      scrollTop: el.scrollTop
    };
    try {
      if (typeof el.selectionStart === "number") {
        st.selStart = el.selectionStart;
        st.selEnd = el.selectionEnd;
      }
    } catch (e) {}
    if (tag === "INPUT" || tag === "TEXTAREA") st.value = el.value;
    return st;
  }

  function _restoreFocus(st) {
    if (!st) return;
    var el = null;
    if (st.id) el = document.getElementById(st.id);
    if (!el && st.name) {
      el = document.querySelector(
        st.tag.toLowerCase() + '[name="' + st.name + '"]'
      );
    }
    if (!el) return;
    try {
      if ((st.tag === "INPUT" || st.tag === "TEXTAREA") &&
          el.value !== st.value && document.activeElement !== el) {
        el.value = st.value;
      }
      el.focus({ preventScroll: true });
      if (typeof st.selStart === "number" && el.setSelectionRange) {
        el.setSelectionRange(st.selStart, st.selEnd);
      }
      if (typeof st.scrollTop === "number") el.scrollTop = st.scrollTop;
    } catch (e) {}
  }

  // ─── Scroll preservation ───
  var SCROLL_SEL = ".content, .sidebar, .modal-body, .data-table, #auditBody";

  function _saveScroll() {
    var out = [];
    document.querySelectorAll(SCROLL_SEL).forEach(function (el, i) {
      out.push({ idx: i, top: el.scrollTop, left: el.scrollLeft });
    });
    return out;
  }

  function _restoreScroll(st) {
    if (!st) return;
    document.querySelectorAll(SCROLL_SEL).forEach(function (el, i) {
      var s = st[i];
      if (!s) return;
      try {
        if (Math.abs(el.scrollTop - s.top) > 3) el.scrollTop = s.top;
        if (Math.abs(el.scrollLeft - s.left) > 3) el.scrollLeft = s.left;
      } catch (e) {}
    });
  }

  // ─── Event → entity map ───
  var ENTITY_MAP = {
    patient: "patients", appointment: "appointments", lab: "lab_orders",
    payment: "payments", refund: "refunds", user: "users",
    doctor: "doctors", service: "services", role: "roles",
    equipment: "equipment", reagent: "reagents", integration: "integrations"
  };

  function _record(evt) {
    if (!evt || !evt.type || !evt.data) return;
    var parts = String(evt.type).split(".");
    var entity = ENTITY_MAP[parts[0]];
    if (!entity) return;
    var id = evt.data.id;
    if (id === undefined || id === null) return;
    _changed.push({ entity: entity, action: parts[1] || "updated", id: id });
  }

  // ─── Row flash ───
  function _flash() {
    if (!_changed.length) return;
    var upd = new Set();
    var add = new Set();
    _changed.forEach(function (c) {
      var k = String(c.id);
      if (c.action === "created") add.add(k);
      else if (c.action === "updated") upd.add(k);
    });
    _changed = [];
    document.querySelectorAll(
      "tbody tr[data-id], .audit-row[data-id], .sb-queue-item[data-appt-id]"
    ).forEach(function (row) {
      var id = row.dataset.id || row.dataset.apptId;
      if (!id) return;
      if (add.has(String(id))) {
        row.classList.add("tibex-row-new");
        setTimeout(function () { row.classList.remove("tibex-row-new"); }, HIGHLIGHT_MS);
      } else if (upd.has(String(id))) {
        row.classList.add("tibex-row-updated");
        setTimeout(function () { row.classList.remove("tibex-row-updated"); }, HIGHLIGHT_MS);
      }
    });
  }

  // ─── Live indicator ───
  function _pulse() {
    var el = document.getElementById("syncStatus");
    if (!el) return;
    el.classList.add("live-pulse");
    setTimeout(function () { el.classList.remove("live-pulse"); }, 700);
  }

  function _setOnline(ok) {
    var el = document.getElementById("syncStatus");
    if (!el) return;
    if (ok) el.classList.remove("offline");
    else el.classList.add("offline");
  }

  // ─── Debounced render ───
  function _run() {
    _scheduled = null;
    var focus = _saveFocus();
    var scroll = _saveScroll();
    var cbs = _pending.slice();
    _pending = [];
    cbs.forEach(function (cb) {
      try { cb(); } catch (e) { console.error("[REALTIME]", e); }
    });
    _restoreScroll(scroll);
    _restoreFocus(focus);
    requestAnimationFrame(_flash);
  }

  function scheduleRender(fn) {
    if (typeof fn === "function") _pending.push(fn);
    if (_scheduled) return;
    _scheduled = setTimeout(_run, DEBOUNCE_MS);
  }

  // ─── Patch TIBEX_STORE.subscribe ───
  function _patch() {
    if (!window.TIBEX_STORE || typeof window.TIBEX_STORE.subscribe !== "function") {
      return false;
    }
    if (window.TIBEX_STORE.__realtimePatched) return true;
    window.TIBEX_STORE.__realtimePatched = true;

    var orig = window.TIBEX_STORE.subscribe;
    window.TIBEX_STORE.subscribe = function (cb) {
      var wrapped = function (data, source) {
        if (data && data.events && data.events.length) {
          data.events.forEach(_record);
        }
        if (source === "external") _pulse();
        scheduleRender(function () {
          try { cb(data, source); } catch (e) { console.error("[REALTIME cb]", e); }
        });
      };
      return orig.call(window.TIBEX_STORE, wrapped);
    };
    return true;
  }

  // ─── Online / Offline ───
  function _installOnline() {
    window.addEventListener("online", function () {
      _setOnline(true);
      if (window.TIBEX_STORE && window.TIBEX_STORE.init) {
        window.TIBEX_STORE.init().catch(function () {});
      }
    });
    window.addEventListener("offline", function () { _setOnline(false); });
    _setOnline(navigator.onLine);
  }

  // ─── Public API ───
  window.TIBEX_REALTIME = {
    scheduleRender: scheduleRender,
    flashRow: function (sel, id) {
      var el = document.querySelector(sel + '[data-id="' + id + '"]');
      if (!el) return;
      el.classList.add("tibex-row-updated");
      setTimeout(function () { el.classList.remove("tibex-row-updated"); }, HIGHLIGHT_MS);
    },
    pulse: _pulse
  };

  // ─── Init ───
  function _wait() {
    if (_patch()) {
      _installOnline();
      console.log("[TIBEX] Realtime v1.0 installed ✓");
    } else {
      setTimeout(_wait, 100);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _wait);
  } else {
    _wait();
  }
})();
