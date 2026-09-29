/* ══════════════════════════════════════════════════════════════════
 * TIBEX REALTIME PRO v2.0 — UNIVERSAL
 *
 * Bu fayl barcha konsollarda ishlaydi va KELAJAQDA qo'shiladigan
 * konsollar/rollar uchun ham avtomatik ishlaydi.
 *
 * Xususiyatlar:
 *   • renderAll() ni avtomatik wrapperga o'raydi (debounce)
 *   • Focus preservation
 *   • Scroll preservation
 *   • Row flash animation
 *   • Toast dedupe
 *   • Latency indicator
 *   • Reconnect banner
 *   • Online/Offline detection
 *   • Auto-recovery (60s+ stale)
 * ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  if (window.__TIBEX_REALTIME_V2__) return;
  window.__TIBEX_REALTIME_V2__ = true;

  var DEBOUNCE_MS = 80;
  var TOAST_DEDUPE_MS = 3000;
  var STALE_MS = 60000;
  var CHECK_MS = 10000;

  var _pending = null;
  var _callbacks = [];
  var _lastToast = {};
  var _lastEventAt = Date.now();
  var _latency = null;
  var _isOnline = navigator.onLine;
  var _stale = false;

  // ─── CSS ───
  (function () {
    if (document.getElementById("tibex-rt-css")) return;
    var s = document.createElement("style");
    s.id = "tibex-rt-css";
    s.textContent =
      ".sync-status.offline{background:rgba(239,68,68,.15)!important;color:#fca5a5!important}" +
      ".sync-status.offline .dot{background:#ef4444!important;animation:none!important}";
    document.head.appendChild(s);
  })();

  // ═══════════════════════════════════════════════════════════════
  // FOCUS / SCROLL
  // ═══════════════════════════════════════════════════════════════
  function _saveFocus() {
    var el = document.activeElement;
    if (!el || el === document.body) return null;
    if (!el.id && !el.name) return null;
    var st = {
      id: el.id || null,
      name: el.name || null,
      tag: el.tagName,
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
    if (st.tag === "INPUT" || st.tag === "TEXTAREA") st.value = el.value;
    return st;
  }

  function _restoreFocus(st) {
    if (!st) return;
    var el = null;
    if (st.id) el = document.getElementById(st.id);
    if (!el && st.name) {
      el = document.querySelector(st.tag.toLowerCase() + '[name="' + st.name + '"]');
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

  var SCROLL_SEL = ".content, .sidebar, .modal-body, .data-table, #auditBody, .block-body";

  function _saveScroll() {
    var out = [];
    document.querySelectorAll(SCROLL_SEL).forEach(function (el, i) {
      out.push({ i: i, t: el.scrollTop, l: el.scrollLeft });
    });
    return out;
  }

  function _restoreScroll(st) {
    if (!st) return;
    document.querySelectorAll(SCROLL_SEL).forEach(function (el, i) {
      var s = st[i];
      if (!s) return;
      try {
        if (Math.abs(el.scrollTop - s.t) > 3) el.scrollTop = s.t;
        if (Math.abs(el.scrollLeft - s.l) > 3) el.scrollLeft = s.l;
      } catch (e) {}
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // LIVE INDICATOR
  // ═══════════════════════════════════════════════════════════════
  function _pulse() {}

  function _setOnline(ok) {
    var el = document.getElementById("syncStatus");
    if (!el) return;
    if (ok) el.classList.remove("offline");
    else el.classList.add("offline");
  }

  // ═══════════════════════════════════════════════════════════════
  // DEBOUNCED RUN
  // ═══════════════════════════════════════════════════════════════
  function _run() {
    _pending = null;
    var focus = _saveFocus();
    var scroll = _saveScroll();
    var cbs = _callbacks.slice();
    _callbacks = [];
    cbs.forEach(function (cb) {
      try { cb(); } catch (e) { console.error("[REALTIME]", e); }
    });
    _restoreScroll(scroll);
    _restoreFocus(focus);
  }

  function scheduleRender(fn) {
    if (typeof fn === "function") _callbacks.push(fn);
    if (_pending) return;
    _pending = setTimeout(_run, DEBOUNCE_MS);
  }

  // ═══════════════════════════════════════════════════════════════
  // UNIVERSAL: renderAll() NI WRAPPERGA O'RASH
  // (Barcha konsollarda avtomatik ishlaydi — kelajak uchun ham)
  // ═══════════════════════════════════════════════════════════════
  function _patchRenderAll() {
    // window.renderAll ni wrapperga o'rash
    if (typeof window.renderAll === "function" && !window.renderAll.__rtWrapped) {
      var orig = window.renderAll;
      var wrapped = function () {
        // Debounce qilib, focus/scroll saqlab chaqiradi
        scheduleRender(orig);
      };
      wrapped.__rtWrapped = true;
      wrapped.__orig = orig;
      window.renderAll = wrapped;
      console.log("[REALTIME] renderAll() wrapped ✓");
    }

  }

  // ═══════════════════════════════════════════════════════════════
  // TOAST DEDUPE
  // ═══════════════════════════════════════════════════════════════
  function _installToastDedupe() {
    if (!window.toast || window.toast.__dedupe) return;
    var orig = window.toast;
    var wrapped = function (msg, type, dur) {
      var key = String(type || "ok") + "|" + String(msg).slice(0, 80);
      var now = Date.now();
      if (now - (_lastToast[key] || 0) < TOAST_DEDUPE_MS) return;
      _lastToast[key] = now;
      Object.keys(_lastToast).forEach(function (k) {
        if (now - _lastToast[k] > TOAST_DEDUPE_MS * 4) delete _lastToast[k];
      });
      return orig.call(window, msg, type, dur);
    };
    wrapped.__dedupe = true;
    wrapped.__orig = orig;
    window.toast = wrapped;
  }

  // ═══════════════════════════════════════════════════════════════
  // PATCH SUBSCRIBE (event'larni ushlash uchun)
  // ═══════════════════════════════════════════════════════════════
  function _patchSubscribe() {
    if (!window.TIBEX_STORE || typeof window.TIBEX_STORE.subscribe !== "function") return false;
    if (window.TIBEX_STORE.__rtPatched) return true;
    window.TIBEX_STORE.__rtPatched = true;

    var orig = window.TIBEX_STORE.subscribe;
    window.TIBEX_STORE.subscribe = function (cb) {
      var wrapped = function (data, source, meta) {
        if (source === "external") {
          _lastEventAt = Date.now();
        }
        try {
          cb(data, source, meta);
        } catch (e) {
          console.error("[REALTIME cb]", e);
        }
      };
      return orig.call(window.TIBEX_STORE, wrapped);
    };
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // LATENCY
  // ═══════════════════════════════════════════════════════════════
  function _measureLatency(data) {
    if (!data || !data.events || !data.events.length) return;
    var evt = data.events[data.events.length - 1];
    if (evt && evt.ts) {
      var lat = Date.now() - evt.ts;
      if (lat >= 0 && lat < 10000) {
        _latency = Math.round(lat);
        _updateLatency();
      }
    }
  }

  function _updateLatency() {
    var el = document.getElementById("tibexLatency");
    if (!el) {
      var sync = document.getElementById("syncStatus");
      if (!sync) return;
      el = document.createElement("span");
      el.id = "tibexLatency";
      el.style.cssText = "font-size:10px;opacity:.7;margin-left:6px;font-family:ui-monospace,monospace;";
      sync.appendChild(el);
    }
    if (_latency === null) { el.textContent = ""; return; }
    el.style.color = _latency < 200 ? "#4ade80" : _latency < 800 ? "#fbbf24" : "#f87171";
    el.textContent = _latency + "ms";
  }

  // ═══════════════════════════════════════════════════════════════
  // BANNER
  // ═══════════════════════════════════════════════════════════════
  function _showBanner(text, type) {
    var el = document.getElementById("tibexRtBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "tibexRtBanner";
      el.style.cssText =
        "position:fixed;top:60px;left:50%;transform:translateX(-50%);" +
        "padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;" +
        "z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.2);" +
        "transition:opacity .3s,transform .3s;font-family:-apple-system,'Segoe UI',sans-serif;" +
        "display:flex;align-items:center;gap:10px;";
      document.body.appendChild(el);
    }
    var colors = {
      offline: { bg: "#dc2626", fg: "#fff", i: "🔴" },
      reconnect: { bg: "#0369a1", fg: "#fff", i: "🔄" },
      online: { bg: "#15803d", fg: "#fff", i: "🟢" },
      stale: { bg: "#b45309", fg: "#fff", i: "⚠️" }
    };
    var c = colors[type] || colors.online;
    el.style.background = c.bg;
    el.style.color = c.fg;
    el.innerHTML = '<span>' + c.i + '</span><span>' + text + '</span>';
    el.style.display = "flex";
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";
  }

  function _hideBanner() {
    var el = document.getElementById("tibexRtBanner");
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(-20px)";
    setTimeout(function () { if (el.parentNode) el.style.display = "none"; }, 300);
  }

  // ═══════════════════════════════════════════════════════════════
  // ONLINE / OFFLINE
  // ═══════════════════════════════════════════════════════════════
  function _installNetwork() {
    window.addEventListener("online", function () {
      _isOnline = true;
      _showBanner("Aloqa tiklandi — sinxronlanmoqda...", "reconnect");
      if (window.TIBEX_STORE && window.TIBEX_STORE.refresh) {
        window.TIBEX_STORE.refresh();
        setTimeout(_hideBanner, 1800);
      } else {
        setTimeout(_hideBanner, 2000);
      }
    });

    window.addEventListener("offline", function () {
      _isOnline = false;
      _showBanner("Internet aloqasi yo'q", "offline");
    });

    if (!navigator.onLine) _showBanner("Internet aloqasi yo'q", "offline");
  }

  // ═══════════════════════════════════════════════════════════════
  // STALE CHECK + AUTO-RECOVERY
  // ═══════════════════════════════════════════════════════════════
  function _checkStale() {
    if (!_isOnline) return;
    var age = Date.now() - _lastEventAt;
    var threshold = _lastEventAt === 0 ? 5 * 60 * 1000 : STALE_MS;
    if (age > threshold && !_stale) {
      _stale = true;
      if (window.TIBEX_STORE && window.TIBEX_STORE.refresh) {
        // Aloqa sokin bo'lsa, WebSocket hodisasi yo'qolgan bo'lishi mumkin.
        window.TIBEX_STORE.refresh();
        _lastEventAt = Date.now();
        _stale = false;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════
  window.TIBEX_REALTIME_PRO = {
    scheduleRender: scheduleRender,
    smartRender: function () {
      if (typeof window.renderAll === "function") scheduleRender(window.renderAll);
    },
    latency: function () { return _latency; },
    isOnline: function () { return _isOnline; },
    lastEventAt: function () { return _lastEventAt; },
    flashRow: function () {}
  };

  // Aliaslar (eski kod bilan moslik)
  window.TIBEX_REALTIME = window.TIBEX_REALTIME_PRO;

  // ═══════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════
  function _init() {
    // 1. Subscribe patch (event ushlash uchun)
    var subscribeOk = _patchSubscribe();

    // 2. renderAll va boshqa render funksiyalarni wrapperga o'rash
    _patchRenderAll();

    // 3. Toast dedupe
    _installToastDedupe();

    // 4. Network
    _installNetwork();

    // 5. Periodic check
    setInterval(_checkStale, CHECK_MS);

    _lastEventAt = Date.now();

    console.log("[TIBEX] Realtime PRO v2.0 installed ✓",
      subscribeOk ? "" : "(subscribe keyin patchanadi)");
  }

  // Kutish: TIBEX_STORE va renderAll paydo bo'lishi kerak
  function _wait() {
    if (window.TIBEX_STORE) {
      _init();
      return;
    }
    // Agar renderAll hali yo'q bo'lsa — keyinroq qayta patch qilamiz
    if (window.TIBEX_STORE && !window.TIBEX_STORE.__rtPatched) {
      _patchSubscribe();
    }
    if (typeof window.renderAll === "function" && !window.renderAll.__rtWrapped) {
      _patchRenderAll();
    }
    setTimeout(_wait, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _wait);
  } else {
    _wait();
  }
})();
