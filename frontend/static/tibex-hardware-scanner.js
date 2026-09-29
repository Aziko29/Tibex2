/* ═══════════════════════════════════════════════════════════════════
 * TIBEX HARDWARE SCANNER v1.0
 *
 * USB/Bluetooth shtrix kod skanerlarni qo'llab-quvvatlaydi.
 * Ular klaviatura kabi ishlaydi (keyboard wedge):
 *   • Tez yozadi (< 30ms orasida)
 *   • Oxirida Enter yuboradi
 *
 * Xavfsizlik:
 *   • Faqat shu sahifada ishlaydi
 *   • Rate limit
 *   • Focus yo'qolmaydi (input ichida yozilsa — skip)
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  if (window.__TIBEX_HARDWARE_SCANNER__) return;
  window.__TIBEX_HARDWARE_SCANNER__ = true;

  var MIN_LENGTH = 6;
  var MAX_INTERVAL_MS = 35;    // Ketma-ket belgilar orasi
  var MAX_TOTAL_MS = 800;      // Butun kod yozilishi max
  var RESET_TIMEOUT = 500;     // Kutish vaqti

  var _buffer = "";
  var _firstAt = 0;
  var _lastAt = 0;
  var _resetTimer = null;

  function _isInputFocused() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    // Kamera modalida — skip
    if (el.closest && el.closest("#tibexBcModal")) return true;
    return false;
  }

  function _reset() {
    _buffer = "";
    _firstAt = 0;
    _lastAt = 0;
    if (_resetTimer) {
      clearTimeout(_resetTimer);
      _resetTimer = null;
    }
  }

  function _emit(code) {
    if (!code || code.length < MIN_LENGTH) return;
    // Event trigger
    if (typeof window.__TIBEX_ON_BARCODE__ === "function") {
      try { window.__TIBEX_ON_BARCODE__(code); } catch (e) {}
    }
    // Custom event
    try {
      window.dispatchEvent(new CustomEvent("tibex-barcode", { detail: { code: code, source: "hardware" } }));
    } catch (e) {}
  }

  function _onKeyDown(e) {
    // Inputda yozilsa — skip
    if (_isInputFocused()) return;

    // Faqat oddiy belgilar
    var key = e.key;
    if (key === "Shift" || key === "Control" || key === "Alt" ||
        key === "Meta" || key === "CapsLock" || key === "Tab") {
      return;
    }

    var now = Date.now();

    if (key === "Enter") {
      if (_buffer.length >= MIN_LENGTH) {
        var totalTime = now - _firstAt;
        if (totalTime <= MAX_TOTAL_MS) {
          e.preventDefault();
          var code = _buffer;
          _reset();
          _emit(code);
          return;
        }
      }
      _reset();
      return;
    }

    // Faqat printable chars
    if (key.length !== 1) {
      _reset();
      return;
    }

    // Interval tekshiruvi
    if (_lastAt > 0 && (now - _lastAt) > MAX_INTERVAL_MS) {
      _reset();
    }

    if (_buffer.length === 0) _firstAt = now;
    _lastAt = now;
    _buffer += key;

    // Reset timer
    if (_resetTimer) clearTimeout(_resetTimer);
    _resetTimer = setTimeout(_reset, RESET_TIMEOUT);

    // Juda uzun — kesish
    if (_buffer.length > 128) _reset();
  }

  function _onKeyPress(e) {
    // Eski brauzerlar uchun fallback (ixtiyoriy)
  }

  // Listenerlarni o'rnatish
  document.addEventListener("keydown", _onKeyDown, true);
  document.addEventListener("keypress", _onKeyPress, true);

  // Public API
  window.TIBEX_HARDWARE_SCANNER = {
    isActive: function () { return true; },
    status: function () {
      return {
        bufferLength: _buffer.length,
        lastAt: _lastAt,
        active: true
      };
    },
    reset: _reset
  };

  console.log("[TIBEX] Hardware Scanner v1.0 ✓ (keyboard wedge)");
})();
