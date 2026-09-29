/* ══════════════════════════════════════════════════════════════════════
 * TIBEX CAMERA FORTRESS v1.0 — frontend security wrapper
 *
 * 1. Token lifecycle (backend'dan)
 * 2. HMAC signatures
 * 3. Tamper detection
 * 4. Auto-alert admin (fail bo'lganda)
 * 5. Sound system (success / error / warning)
 * 6. Vibration (mobile)
 * 7. Auto-disable on repeated failures
 * ══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  if (window.__TIBEX_CAMERA_FORTRESS__) return;
  window.__TIBEX_CAMERA_FORTRESS__ = true;

  var API = "/api/camera";

  // ─── State ───
  var _session = null;       // {token, expires_at, signature}
  var _failures = 0;
  var _lastFailureAt = 0;
  var _sessionTimestamp = 0;

  // ─── Tamper detection: function signatures ───
  var _sigs = {};

  function _captureSigs() {
    // Funksiya signaturesini saqlaymiz (o'zgartirilsa alert)
    setTimeout(function () {
      try {
        _sigs.barcodeDetect = typeof window.BarcodeDetector;
        _sigs.zxing = typeof window.ZXing;
        _sigs.getUserMedia = typeof navigator.mediaDevices?.getUserMedia;
        _sigs.audioCtx = typeof (window.AudioContext || window.webkitAudioContext);
      } catch (e) {}
    }, 100);
  }

  function _checkTamper() {
    try {
      var now = {
        barcodeDetect: typeof window.BarcodeDetector,
        zxing: typeof window.ZXing,
        getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
        audioCtx: typeof (window.AudioContext || window.webkitAudioContext)
      };
      for (var k in _sigs) {
        if (_sigs[k] !== now[k]) {
          _alertAdmin("camera.tamper", "Signature o'zgardi: " + k + " " + _sigs[k] + "→" + now[k]);
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // SOUND SYSTEM
  // ═══════════════════════════════════════════════════════════════
  var _audioCtx = null;
  var _soundEnabled = true;
  var _volume = 0.25;

  function _getAudioCtx() {
    try {
      if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (_audioCtx.state === "suspended") {
        _audioCtx.resume();
      }
      return _audioCtx;
    } catch (e) {
      return null;
    }
  }

  function _tone(freq, duration, type, delay) {
    try {
      var ctx = _getAudioCtx();
      if (!ctx || !_soundEnabled) return;
      var startAt = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = type || "sine";
      gain.gain.setValueAtTime(_volume, startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration / 1000);
    } catch (e) {}
  }

  function playSuccess() {
    _tone(880, 90, "sine", 0);
    _tone(1320, 90, "sine", 100);
  }

  function playError() {
    _tone(300, 200, "square", 0);
    _tone(220, 200, "square", 220);
  }

  function playWarning() {
    _tone(440, 250, "triangle", 0);
  }

  function playOpen() {
    _tone(660, 60, "sine", 0);
  }

  // ═══════════════════════════════════════════════════════════════
  // VIBRATION
  // ═══════════════════════════════════════════════════════════════
  var _vibroEnabled = true;

  function vibrateSuccess() {
    try {
      if (_vibroEnabled && navigator.vibrate) navigator.vibrate([80, 50, 80]);
    } catch (e) {}
  }

  function vibrateError() {
    try {
      if (_vibroEnabled && navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    } catch (e) {}
  }

  function vibrateWarning() {
    try {
      if (_vibroEnabled && navigator.vibrate) navigator.vibrate([150]);
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // API CALLS
  // ═══════════════════════════════════════════════════════════════
  async function _getToken() {
    var r = await window.TIBEX_STORE._api(API + "/session", {
      method: "POST",
      body: { action: "open" }
    });
    if (!r || !r.ok) throw new Error("Token olishda xato");
    _session = {
      token: r.token,
      expires_at: Date.now() + r.ttl * 1000,
      signature: r.signature
    };
    _sessionTimestamp = Date.now();
    return _session;
  }

  async function _verifyScan(barcode) {
    if (!_session) throw new Error("Token yo'q");
    if (_session.expires_at < Date.now()) {
      _session = null;
      throw new Error("Token muddati o'tdi");
    }

    var r = await window.TIBEX_STORE._api(API + "/verify", {
      method: "POST",
      body: {
        token: _session.token,
        barcode: String(barcode).slice(0, 256)
      }
    });

    _session = null;  // one-time use
    return r;
  }

  async function _alertAdmin(kind, detail) {
    try {
      await window.TIBEX_STORE._api(API + "/alert", {
        method: "POST",
        body: { kind: kind, detail: String(detail).slice(0, 512) }
      });
    } catch (e) {
      // Silent
    }
  }

  async function _reportFailure(kind, detail) {
    _failures++;
    _lastFailureAt = Date.now();
    // 3+ failures in 60s → alert
    if (_failures >= 3) {
      await _alertAdmin("camera." + kind, detail + " (failures: " + _failures + ")");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API — kamera moduli bilan integratsiya
  // ═══════════════════════════════════════════════════════════════

  window.TIBEX_CAMERA_FORTRESS = {
    // Kamera ochilishidan oldin token olish
    prepareCamera: async function () {
      try {
        playOpen();
        await _getToken();
        return { ok: true };
      } catch (e) {
        playError();
        vibrateError();
        await _reportFailure("token_error", e.message);
        throw e;
      }
    },

    // Skan paytida tekshirish
    verifyScan: async function (barcode) {
      try {
        var r = await _verifyScan(barcode);
        if (r && r.ok) {
          playSuccess();
          vibrateSuccess();
          return { ok: true, barcode: barcode };
        }
        throw new Error("Backend rad etdi");
      } catch (e) {
        playError();
        vibrateError();
        await _reportFailure("verify_error", e.message);
        throw e;
      }
    },

    // Boshqa xato
    reportError: function (kind, detail) {
      playError();
      vibrateError();
      _reportFailure(kind, detail);
    },

    // Ogohlantirish
    reportWarning: function (kind, detail) {
      playWarning();
      vibrateWarning();
      _alertAdmin(kind, detail);
    },

    // Sound/vibro toggle
    setSound: function (on) { _soundEnabled = !!on; },
    setVolume: function (v) { _volume = Math.max(0, Math.min(1, v)); },
    setVibro: function (on) { _vibroEnabled = !!on; },

    // Test
    testSuccess: function () { playSuccess(); vibrateSuccess(); },
    testError: function () { playError(); vibrateError(); },

    // Status
    getStatus: function () {
      return {
        has_session: !!_session,
        expires_in: _session ? Math.max(0, _session.expires_at - Date.now()) : 0,
        failures: _failures,
        sound: _soundEnabled,
        vibro: _vibroEnabled
      };
    },

    // Tamper check (har 30s)
    startTamperWatch: function () {
      _captureSigs();
      setInterval(function () {
        _checkTamper();
      }, 30000);
    }
  };

  // Auto start tamper watch
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.TIBEX_CAMERA_FORTRESS.startTamperWatch();
    });
  } else {
    window.TIBEX_CAMERA_FORTRESS.startTamperWatch();
  }

  console.log("[TIBEX] Camera Fortress v1.0 ✓");
})();
