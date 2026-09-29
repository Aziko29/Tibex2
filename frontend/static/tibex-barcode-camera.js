/* ═══════════════════════════════════════════════════════════════════
 * TIBEX BARCODE CAMERA v2.0 — Universal
 *
 * Ikkita engine:
 *   1. Native BarcodeDetector (agar mavjud — macOS/Android/ChromeOS)
 *   2. ZXing-js fallback (Windows/Linux uchun)
 *
 * Xavfsizlik:
 *   • HTTPS/localhost talab
 *   • Self-hosted ZXing (CSP-safe)
 *   • Rate limit (60 skan/daqiqa)
 *   • Hech qanday external network
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  if (window.__TIBEX_BARCODE_CAMERA_V2__) return;
  window.__TIBEX_BARCODE_CAMERA_V2__ = true;

  var RATE_LIMIT = 60; // per minute
  var RATE_WINDOW = 60000;

  var _stream = null;
  var _video = null;
  var _canvas = null;
  var _ctx = null;
  var _detector = null;
  var _zxingReader = null;
  var _running = false;
  var _rafId = null;
  var _torchOn = false;
  var _currentDeviceId = null;
  var _deviceIndex = 0;
  var _lastDetected = "";
  var _lastDetectedAt = 0;
  var _scanHistory = [];
  var _engine = "unknown"; // "native" | "zxing" | "none"

  // ─── Rate limit ───
  function _checkRateLimit() {
    var now = Date.now();
    _scanHistory = _scanHistory.filter(function (t) { return now - t < RATE_WINDOW; });
    if (_scanHistory.length >= RATE_LIMIT) {
      return false;
    }
    _scanHistory.push(now);
    return true;
  }

  // ─── CSS ───
  function _injectCSS() {
    if (document.getElementById("tibex-barcode-css")) return;
    var s = document.createElement("style");
    s.id = "tibex-barcode-css";
    s.textContent =
      ".tibex-bc-modal{position:fixed;inset:0;background:#000;z-index:999999;display:none;flex-direction:column;}" +
      ".tibex-bc-modal.show{display:flex;}" +
      ".tibex-bc-header{height:56px;background:rgba(0,0,0,.9);color:#fff;display:flex;align-items:center;padding:0 16px;gap:10px;flex-shrink:0;font-family:-apple-system,'Segoe UI',sans-serif;}" +
      ".tibex-bc-header h3{flex:1;font-size:15px;font-weight:700;margin:0;}" +
      ".tibex-bc-header .engine{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700;}" +
      ".tibex-bc-header .engine.native{background:#15803d;}" +
      ".tibex-bc-header .engine.zxing{background:#a16207;}" +
      ".tibex-bc-header button{background:rgba(255,255,255,.15);color:#fff;border:none;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}" +
      ".tibex-bc-header button:hover{background:rgba(255,255,255,.25);}" +
      ".tibex-bc-header button.primary{background:#1e40af;}" +
      ".tibex-bc-header button.primary:hover{background:#1e3a8a;}" +
      ".tibex-bc-video-wrap{flex:1;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;}" +
      ".tibex-bc-video{max-width:100%;max-height:100%;display:block;}" +
      ".tibex-bc-overlay{position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;}" +
      ".tibex-bc-frame{width:80%;max-width:480px;aspect-ratio:16/8;border:3px solid rgba(74,222,128,.9);border-radius:12px;box-shadow:0 0 40px rgba(74,222,128,.4) inset,0 0 20px rgba(74,222,128,.3);position:relative;}" +
      ".tibex-bc-frame::before{content:'';position:absolute;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#4ade80,transparent);animation:tibexBcScan 2s ease-in-out infinite;}" +
      "@keyframes tibexBcScan{0%,100%{top:0;}50%{top:calc(100% - 3px);}}" +
      ".tibex-bc-status{position:absolute;bottom:20px;left:20px;right:20px;text-align:center;color:#fff;font-size:14px;font-weight:600;font-family:-apple-system,sans-serif;text-shadow:0 2px 8px rgba(0,0,0,.8);}" +
      ".tibex-bc-status.ok{color:#4ade80;}" +
      ".tibex-bc-status.err{color:#f87171;}" +
      ".tibex-bc-status.warn{color:#fbbf24;}" +
      ".tibex-bc-footer{background:rgba(0,0,0,.9);padding:12px 16px;display:flex;gap:8px;flex-shrink:0;}" +
      ".tibex-bc-footer input{flex:1;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;font-size:14px;font-family:ui-monospace,monospace;outline:none;}" +
      ".tibex-bc-footer input:focus{border-color:#4ade80;}" +
      ".tibex-bc-footer input::placeholder{color:rgba(255,255,255,.4);}" +
      ".tibex-bc-footer button{padding:10px 16px;border-radius:8px;border:none;background:#1e40af;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;}" +
      ".tibex-bc-actions{display:flex;gap:6px;padding:0 16px 12px;background:rgba(0,0,0,.9);}" +
      ".tibex-bc-actions button{flex:1;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.05);color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;}" +
      ".tibex-bc-actions button:hover{background:rgba(255,255,255,.15);}" +
      ".tibex-bc-actions button.active{background:#f59e0b;color:#000;border-color:#f59e0b;}" +
      ".tibex-bc-error{padding:40px 20px;color:#fff;text-align:center;font-family:-apple-system,sans-serif;}" +
      ".tibex-bc-error .big{font-size:64px;margin-bottom:20px;}" +
      ".tibex-bc-error .msg{font-size:14px;line-height:1.6;max-width:520px;margin:0 auto;opacity:.9;}" +
      ".tibex-bc-error .hint{margin-top:16px;font-size:12.5px;opacity:.65;}" +
      ".tibex-bc-error button{margin-top:20px;padding:12px 24px;border-radius:8px;border:none;background:#1e40af;color:#fff;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;}";
    document.head.appendChild(s);
  }

  // ─── Build modal ───
  function _buildModal() {
    if (document.getElementById("tibexBcModal")) return;
    _injectCSS();

    var modal = document.createElement("div");
    modal.id = "tibexBcModal";
    modal.className = "tibex-bc-modal";
    modal.innerHTML =
      '<div class="tibex-bc-header">' +
      '  <h3>📷 Shtrix kod / QR skanerlash</h3>' +
      '  <span class="engine" id="tibexBcEngine">—</span>' +
      '  <button class="tibex-bc-switch" title="Kamera almashtirish">🔄</button>' +
      '  <button class="tibex-bc-torch" title="Chiroq">🔦</button>' +
      '  <button class="tibex-bc-close primary">Yopish</button>' +
      '</div>' +
      '<div class="tibex-bc-video-wrap">' +
      '  <video class="tibex-bc-video" autoplay playsinline muted></video>' +
      '  <div class="tibex-bc-overlay">' +
      '    <div class="tibex-bc-frame"></div>' +
      '    <div class="tibex-bc-status">Kodni ramka ichiga joylashtiring...</div>' +
      '  </div>' +
      '</div>' +
      '<div class="tibex-bc-actions">' +
      '  <button class="tibex-bc-labels active">🔊 Ovoz</button>' +
      '  <button class="tibex-bc-vibro active">📳 Vibro</button>' +
      '</div>' +
      '<div class="tibex-bc-footer">' +
      '  <input type="text" class="tibex-bc-manual" placeholder="Yoki kodni qo\'lda kiriting..." autocomplete="off">' +
      '  <button class="tibex-bc-submit">→</button>' +
      '</div>';

    document.body.appendChild(modal);

    _video = modal.querySelector(".tibex-bc-video");
    _canvas = document.createElement("canvas");
    _ctx = _canvas.getContext("2d", { willReadFrequently: true });

    modal.querySelector(".tibex-bc-close").addEventListener("click", closeCamera);
    modal.querySelector(".tibex-bc-switch").addEventListener("click", switchCamera);
    modal.querySelector(".tibex-bc-torch").addEventListener("click", toggleTorch);
    modal.querySelector(".tibex-bc-submit").addEventListener("click", function () {
      var inp = modal.querySelector(".tibex-bc-manual");
      var code = (inp.value || "").trim();
      if (code) _onDetected(code);
    });
    modal.querySelector(".tibex-bc-manual").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var code = (e.target.value || "").trim();
        if (code) _onDetected(code);
      }
      if (e.key === "Escape") closeCamera();
    });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeCamera();
    });

    var soundBtn = modal.querySelector(".tibex-bc-labels");
    soundBtn.addEventListener("click", function () {
      soundBtn.classList.toggle("active");
    });
    var vibroBtn = modal.querySelector(".tibex-bc-vibro");
    vibroBtn.addEventListener("click", function () {
      vibroBtn.classList.toggle("active");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("show")) closeCamera();
    });
  }

  // ─── Beep ───
  var _audioCtx = null;
  function _beep() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var ctx = _audioCtx;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(function () { try { osc.stop(); } catch (e) {} }, 100);
      setTimeout(function () {
        try {
          var o2 = ctx.createOscillator();
          var g2 = ctx.createGain();
          o2.frequency.value = 1320;
          o2.type = "sine";
          g2.gain.value = 0.15;
          o2.connect(g2);
          g2.connect(ctx.destination);
          o2.start();
          setTimeout(function () { try { o2.stop(); } catch (e) {} }, 100);
        } catch (e) {}
      }, 130);
    } catch (e) {}
  }

  function _vibrate() {
    try { if (navigator.vibrate) navigator.vibrate([80, 50, 80]); } catch (e) {}
  }

  function _setStatus(text, cls) {
    var el = document.querySelector("#tibexBcModal .tibex-bc-status");
    if (!el) return;
    el.textContent = text;
    el.className = "tibex-bc-status" + (cls ? " " + cls : "");
  }

  function _setEngine(name) {
    var el = document.getElementById("tibexBcEngine");
    if (!el) return;
    var labels = {
      native: "⚡ NATIVE",
      zxing: "🔄 ZXing"
    };
    el.textContent = labels[name] || "—";
    el.className = "engine " + name;
  }

  function _showError(title, detail, hint) {
    var wrap = document.querySelector("#tibexBcModal .tibex-bc-video-wrap");
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="tibex-bc-error">' +
      '  <div class="big">📷</div>' +
      '  <div class="msg"><b>' + esc(title) + '</b><br><br>' + esc(detail) + '</div>' +
      (hint ? '  <div class="hint">' + esc(hint) + '</div>' : '') +
      '  <button class="tibex-bc-retry">Qayta urinish</button>' +
      '</div>';
    wrap.querySelector(".tibex-bc-retry").addEventListener("click", function () {
      wrap.innerHTML =
        '<video class="tibex-bc-video" autoplay playsinline muted></video>' +
        '<div class="tibex-bc-overlay">' +
        '  <div class="tibex-bc-frame"></div>' +
        '  <div class="tibex-bc-status">Kodni ramka ichiga joylashtiring...</div>' +
        '</div>';
      _video = wrap.querySelector(".tibex-bc-video");
      _startCamera();
    });
  }

  // ─── Engine tanlash ───
  function _selectEngine() {
    // 1. Native BarcodeDetector
    if ("BarcodeDetector" in window) {
      try {
        _detector = new BarcodeDetector({
          formats: [
            "code_128", "code_39", "code_93", "codabar",
            "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code"
          ]
        });
        _engine = "native";
        _setEngine("native");
        return true;
      } catch (e) {
        try {
          _detector = new BarcodeDetector();
          _engine = "native";
          _setEngine("native");
          return true;
        } catch (e2) {}
      }
    }

    // 2. ZXing fallback
    if (window.ZXing && window.ZXing.BrowserMultiFormatReader) {
      try {
        _zxingReader = new window.ZXing.BrowserMultiFormatReader();
        _engine = "zxing";
        _setEngine("zxing");
        return true;
      } catch (e) {}
    }

    _engine = "none";
    return false;
  }

  // ─── Start camera ───
  async function _startCamera() {
    _buildModal();

    // Kamera mavjudmi?
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      _showError(
        "Kamera API mavjud emas",
        "Brauzer yoki sahifa kamera API ni qo'llab-quvvatlamaydi.",
        "HTTPS yoki localhost kerak. Chrome/Edge/Firefox eng yangi versiyasini ishlatib ko'ring."
      );
      return;
    }

    // HTTPS tekshiruvi
    var isSecure = location.protocol === "https:" ||
                   location.hostname === "localhost" ||
                   location.hostname === "127.0.0.1";
    if (!isSecure) {
      _showError(
        "HTTPS talab qilinadi",
        "Kamera faqat HTTPS yoki localhost da ishlaydi.",
        "Sabab: brauzer xavfsizlik siyosati. Nginx orqali HTTPS o'rnating yoki localhost ishlating."
      );
      return;
    }

    // Engine tanlash
    if (!_selectEngine()) {
      _showError(
        "Skanerlash engine mavjud emas",
        "BarcodeDetector ham, ZXing ham topilmadi.",
        "ZXing kutubxonasi yuklanmagan bo'lishi mumkin. Sahifani yangilang yoki administratorga murojaat qiling."
      );
      return;
    }

    // Kamera constraint
    var constraints = {
      audio: false,
      video: _currentDeviceId ?
        { deviceId: { exact: _currentDeviceId } } :
        { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
    };

    try {
      _stream = await navigator.mediaDevices.getUserMedia(constraints);
      _video.srcObject = _stream;
      await _video.play();

      var track = _stream.getVideoTracks()[0];
      var caps = track.getCapabilities ? track.getCapabilities() : {};
      var hasTorch = !!caps.torch;

      var torchBtn = document.querySelector("#tibexBcModal .tibex-bc-torch");
      if (torchBtn) torchBtn.style.display = hasTorch ? "" : "none";

      _setStatus("Kodni ramka ichiga joylashtiring...");
      _running = true;
      _detectLoop();

    } catch (e) {
      var msg = "Kameraga ulanib bo'lmadi";
      var hint = "";
      if (e.name === "NotAllowedError") {
        msg = "Kamera ruxsati berilmadi";
        hint = "Brauzer manzil satri yonidagi qulf belgisini bosing → Kamera → Ruxsat berish";
      } else if (e.name === "NotFoundError") {
        msg = "Kamera qurilmasi topilmadi";
        hint = "Kompyuterga kamera ulanganligini tekshiring";
      } else if (e.name === "NotReadableError") {
        msg = "Kamera band";
        hint = "Boshqa dastur (Zoom, Teams) kamerani ishlatayotgan bo'lishi mumkin";
      }
      _showError(msg, e.name + ": " + e.message, hint);
    }
  }

  // ─── Detect loop ───
  async function _detectLoop() {
    if (!_running) return;
    if (_video.readyState !== 4) {
      _rafId = requestAnimationFrame(_detectLoop);
      return;
    }

    try {
      if (_engine === "native" && _detector) {
        var barcodes = await _detector.detect(_video);
        if (barcodes && barcodes.length > 0) {
          var code = barcodes[0].rawValue || "";
          if (code) {
            _onDetected(code);
            return;
          }
        }
      } else if (_engine === "zxing" && _zxingReader) {
        // ZXing canvas orqali ishlaydi
        var w = _video.videoWidth;
        var h = _video.videoHeight;
        if (w > 0 && h > 0) {
          _canvas.width = w;
          _canvas.height = h;
          _ctx.drawImage(_video, 0, 0, w, h);
          var imgData = _ctx.getImageData(0, 0, w, h);
          try {
            var result = _zxingReader.decodeFromImageData(imgData);
            if (result && result.getText) {
              var zxCode = result.getText();
              if (zxCode) {
                _onDetected(zxCode);
                return;
              }
            }
          } catch (ze) {
            // ZXing NotFoundException — oddiy holat
          }
        }
      }
    } catch (e) {
      // Silent
    }

    _rafId = requestAnimationFrame(_detectLoop);
  }

  // ─── TIBEX_CAMERA_SIMPLE_v1: oddiy _onDetected ───
  function _onDetected(code) {
    if (!code) return;
    code = String(code).trim();
    if (!code) return;

    // Rate limit
    if (!_checkRateLimit()) {
      _setStatus("⚠️ Juda ko'p skanerlash — 1 daqiqa kuting", "warn");
      return;
    }

    // Dedupe (3s)
    var now = Date.now();
    if (code === _lastDetected && (now - _lastDetectedAt) < 3000) return;
    _lastDetected = code;
    _lastDetectedAt = now;

    // Feedback
    var soundBtn = document.querySelector("#tibexBcModal .tibex-bc-labels");
    var vibroBtn = document.querySelector("#tibexBcModal .tibex-bc-vibro");
    if (!soundBtn || soundBtn.classList.contains("active")) _beep();
    if (!vibroBtn || vibroBtn.classList.contains("active")) _vibrate();

    _setStatus("✅ Topildi: " + code, "ok");

    setTimeout(function () {
      closeCamera();
      if (typeof window.__TIBEX_ON_BARCODE__ === "function") {
        try { window.__TIBEX_ON_BARCODE__(code); } catch (e) {}
      }
    }, 400);
  }

  function _stopCamera() {
    _running = false;
    if (_rafId) { try { cancelAnimationFrame(_rafId); } catch (e) {} _rafId = null; }
    if (_stream) {
      try { _stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      _stream = null;
    }
    if (_video) { try { _video.srcObject = null; } catch (e) {} }
    _torchOn = false;
  }

  async function switchCamera() {
    try {
      var devs = await navigator.mediaDevices.enumerateDevices();
      var cams = devs.filter(function (d) { return d.kind === "videoinput"; });
      if (cams.length < 2) {
        _setStatus("Faqat 1 ta kamera", "warn");
        setTimeout(function () { _setStatus("Kodni ramka ichiga joylashtiring..."); }, 1500);
        return;
      }
      _deviceIndex = (_deviceIndex + 1) % cams.length;
      _currentDeviceId = cams[_deviceIndex].deviceId;
      _stopCamera();
      await _startCamera();
    } catch (e) {}
  }

  async function toggleTorch() {
    if (!_stream) return;
    var track = _stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;
    var caps = track.getCapabilities();
    if (!caps.torch) return;
    try {
      _torchOn = !_torchOn;
      await track.applyConstraints({ advanced: [{ torch: _torchOn }] });
      var btn = document.querySelector("#tibexBcModal .tibex-bc-torch");
      if (btn) btn.classList.toggle("active", _torchOn);
    } catch (e) {}
  }

  function openCamera() {
    _buildModal();
    document.getElementById("tibexBcModal").classList.add("show");
    _startCamera();
  }

  function closeCamera() {
    var modal = document.getElementById("tibexBcModal");
    if (modal) modal.classList.remove("show");
    _stopCamera();
  }

  window.TIBEX_BARCODE_CAMERA = {
    open: openCamera,
    close: closeCamera,
    isSupported: function () {
      return !!(navigator.mediaDevices &&
                navigator.mediaDevices.getUserMedia &&
                ("BarcodeDetector" in window || window.ZXing));
    },
    engine: function () { return _engine; },
    isCameraAvailable: async function () {
      try {
        var devs = await navigator.mediaDevices.enumerateDevices();
        return devs.some(function (d) { return d.kind === "videoinput"; });
      } catch (e) {
        // Fallback: ruxsat so'rash
        try {
          var s = await navigator.mediaDevices.getUserMedia({ video: true });
          s.getTracks().forEach(function (t) { t.stop(); });
          return true;
        } catch (e2) {
          return false;
        }
      }
    }
  };

  console.log("[TIBEX] Barcode Camera v2.0 ✓");
  console.log("  Native BarcodeDetector:", "BarcodeDetector" in window ? "✓" : "✗");
  console.log("  ZXing fallback:", window.ZXing ? "✓" : "✗");
})();
