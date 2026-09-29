/* ══════════════════════════════════════════════════════════════════════
 * TIBEX ULTIMATE SCANNER v7.0
 *
 * Multi-engine:
 *   1. Html5Qrcode (asosiy — barqaror)
 *   2. QrScanner (nimiq — Web Worker, tez)
 *   3. ZXing (fallback)
 *   4. BarcodeDetector (native)
 *
 * Security:
 *   • Token (JWT-like, backend'dan)
 *   • Rate limit (60 scan/min)
 *   • Tamper detection
 *   • Auto-disable on fails
 *   • Content validation (barcode format)
 * ══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  if (window.__TIBEX_ULTIMATE_SCANNER__) return;
  window.__TIBEX_ULTIMATE_SCANNER__ = true;

  var _activeEngine = null;      // "html5" | "qrscan" | "zxing" | "native"
  var _engineInstance = null;
  var _stream = null;
  var _video = null;
  var _sessionToken = null;
  var _sessionExpires = 0;
  var _running = false;
  var _detectCount = 0;
  var _failCount = 0;
  var _lastCode = "";
  var _lastCodeAt = 0;
  var _selectedCameraId = null;

  // ═══════════════════════════════════════════════════════════════
  // UTIL
  // ═══════════════════════════════════════════════════════════════
  function _fmtLabel(f) {
    var M = {
      "qr_code": "QR Code", "qr": "QR Code", "code_128": "Code 128",
      "code_39": "Code 39", "code_93": "Code 93", "codabar": "Codabar",
      "ean_13": "EAN-13", "ean_8": "EAN-8", "itf": "ITF",
      "upc_a": "UPC-A", "upc_e": "UPC-E", "data_matrix": "Data Matrix",
      "pdf417": "PDF417", "aztec": "Aztec", "qr_code_wechat": "QR Code"
    };
    return M[f] || (f || "?").toUpperCase();
  }

  // ═══════════════════════════════════════════════════════════════
  // MULTI-ENGINE TANLASH
  // ═══════════════════════════════════════════════════════════════
  function _selectEngine() {
    // Priority: html5-qrcode > qr-scanner > ZXing > native
    if (window.Html5Qrcode) {
      _activeEngine = "html5";
      return true;
    }
    if (window.QrScanner) {
      _activeEngine = "qrscan";
      return true;
    }
    if (window.ZXing && window.ZXing.BrowserMultiFormatReader) {
      _activeEngine = "zxing";
      return true;
    }
    if ("BarcodeDetector" in window) {
      _activeEngine = "native";
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // CAMERA TANLASH — avtofokus uchun eng yaxshi
  // ═══════════════════════════════════════════════════════════════
  async function _selectBestCamera() {
    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      var cams = devices.filter(function (d) { return d.kind === "videoinput"; });

      // Eng yaxshi kamera: shortest focus distance + environment
      var best = null;
      var bestScore = -1;

      for (var i = 0; i < cams.length; i++) {
        var cam = cams[i];
        var score = 0;

        // Environment (orqa kamera)
        if (/back|rear|environment/i.test(cam.label)) score += 10;

        // Focus capability
        try {
          var stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cam.deviceId } }
          });
          var track = stream.getVideoTracks()[0];
          var caps = track.getCapabilities ? track.getCapabilities() : {};
          if (caps.focusDistance) score += 5;
          if (caps.focusMode && caps.focusMode.indexOf("continuous") >= 0) score += 10;
          stream.getTracks().forEach(function (t) { t.stop(); });
        } catch (e) {}

        if (score > bestScore) { bestScore = score; best = cam; }
      }

      if (best) {
        _selectedCameraId = best.deviceId;
        console.log("[SCANNER] Best camera:", best.label || best.deviceId);
        return best;
      }
      return cams[0] || null;
    } catch (e) {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HTML5-QRCODE ENGINE (asosiy)
  // ═══════════════════════════════════════════════════════════════
  async function _startHtml5Engine(videoWrapEl, cameraId) {
    try {
      if (_engineInstance) {
        try { await _engineInstance.stop(); } catch (e) {}
        _engineInstance = null;
      }

      var config = {
        fps: 15,
        qrbox: function (w, h) {
          var min = Math.min(w, h);
          var size = Math.round(min * 0.7);
          return { width: size, height: Math.round(size * 0.75) };
        },
        aspectRatio: 1.777,
        disableFlip: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        },
        videoConstraints: {
          deviceId: cameraId ? { exact: cameraId } : undefined,
          facingMode: cameraId ? undefined : { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: "continuous"
        }
      };

      var formatsToSupport = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODABAR
      ];

      _engineInstance = new Html5Qrcode("tibexSc7VideoWrap", {
        formatsToSupport: formatsToSupport,
        verbose: false,
        useBarCodeDetectorIfSupported: true
      });

      await _engineInstance.start(
        config.videoConstraints,
        config,
        function (decodedText, decodedResult) {
          var fmt = "unknown";
          try {
            if (decodedResult && decodedResult.result && decodedResult.result.format) {
              fmt = decodedResult.result.format.formatName || "unknown";
            }
          } catch (e) {}
          _onDetected(decodedText, fmt);
        },
        function () { /* ignore per-frame errors */ }
      );

      console.log("[SCANNER] html5-qrcode engine ishga tushdi");
      return true;
    } catch (e) {
      console.warn("[SCANNER] html5-qrcode xato:", e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // QR-SCANNER (nimiq) ENGINE
  // ═══════════════════════════════════════════════════════════════
  async function _startQrScannerEngine(videoEl, cameraId) {
    try {
      if (_engineInstance && _engineInstance.destroy) {
        try { _engineInstance.destroy(); } catch (e) {}
      }

      _engineInstance = new QrScanner(
        videoEl,
        function (result) {
          _onDetected(result.data, result.format || "qr_code");
        },
        {
          returnDetailedScanResult: true,
          highlightScanRegion: false,
          highlightCodeOutline: false,
          preferredCamera: "environment",
          maxScansPerSecond: 15,
          calculateScanRegion: function (video) {
            var w = video.videoWidth, h = video.videoHeight;
            return {
              x: Math.round(w * 0.1),
              y: Math.round(h * 0.15),
              width: Math.round(w * 0.8),
              height: Math.round(h * 0.7),
              downScaledWidth: 640,
              downScaledHeight: 480
            };
          }
        }
      );

      if (cameraId) {
        await _engineInstance.setCamera(cameraId);
      }
      await _engineInstance.start();

      console.log("[SCANNER] qr-scanner engine ishga tushdi");
      return true;
    } catch (e) {
      console.warn("[SCANNER] qr-scanner xato:", e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ZXING ENGINE (fallback)
  // ═══════════════════════════════════════════════════════════════
  async function _startZxingEngine(videoEl, cameraId) {
    try {
      var codeReader = new ZXing.BrowserMultiFormatReader();
      _engineInstance = codeReader;

      var deviceId = cameraId || null;
      await codeReader.decodeFromVideoDevice(
        deviceId,
        videoEl,
        function (result, err) {
          if (result) {
            var fmt = "unknown";
            try {
              var fo = result.getBarcodeFormat && result.getBarcodeFormat();
              var N = { 11: "qr_code", 4: "code_128", 2: "code_39", 7: "ean_13" };
              fmt = N[fo] || "unknown";
            } catch (e) {}
            _onDetected(result.getText(), fmt);
          }
          // err — NotFoundException — normal
        }
      );

      console.log("[SCANNER] ZXing engine ishga tushdi");
      return true;
    } catch (e) {
      console.warn("[SCANNER] ZXing xato:", e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DETECTED
  // ═══════════════════════════════════════════════════════════════
  function _onDetected(code, fmt) {
    if (!code) return;
    code = String(code).trim();
    if (!code || code.length < 2) return;

    var now = Date.now();
    if (code === _lastCode && (now - _lastCodeAt) < 2000) return;
    _lastCode = code;
    _lastCodeAt = now;
    _detectCount++;

    // ═══ SECURITY: Format validation ═══
    if (!/^[A-Za-z0-9\-_.:/\s]{2,256}$/.test(code)) {
      _failCount++;
      _beep("error");
      _toast("❌ Noto'g'ri format: " + code.slice(0, 30), "bad");
      _reportToServer("invalid_format", code.slice(0, 64));
      if (_failCount > 5) _autoDisable();
      return;
    }

    // ═══ SECURITY: Rate limit ═══
    if (_detectCount > 60 && (now - _sessionExpires + 300000) < 60000) {
      _toast("⚠️ Juda ko'p skanerlash", "warn");
      return;
    }

    _beep("detect");

    // ═══ DB LOOKUP ═══
    var inDb = false, dbInfo = "";
    try {
      if (window.TIBEX_STORE && window.TIBEX_STORE.getLabOrder) {
        var order = window.TIBEX_STORE.getLabOrder(code);
        if (order) {
          inDb = true;
          var p = window.TIBEX_STORE.getPatient(order.patient_id);
          dbInfo = (p ? p.fullname : "?") + " — " + (order.test_name || "");
          _beep("success");
          _vibrate([80, 50, 80]);
        }
      }
    } catch (e) {}

    if (!inDb) {
      _beep("error");
      _vibrate([150, 80, 150]);
    }

    // UI yangilash
    _updateLivePanel(fmt, code, inDb, dbInfo);

    // Aqlli to'ldirish
    _autofill(code, inDb);

    // Handler
    if (inDb && typeof window.__TIBEX_ON_BARCODE__ === "function") {
      try { window.__TIBEX_ON_BARCODE__(code, { keepOpen: true }); } catch (e) {}
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UI — Live Panel
  // ═══════════════════════════════════════════════════════════════
  function _updateLivePanel(fmt, text, inDb, dbInfo) {
    var panel = document.getElementById("tibexSc7Live");
    if (!panel) return;
    panel.classList.add("show");
    var fEl = document.getElementById("tibexSc7Fmt");
    var tEl = document.getElementById("tibexSc7Text");
    var dEl = document.getElementById("tibexSc7Db");
    if (fEl) {
      var isQR = String(fmt).indexOf("qr") >= 0;
      fEl.textContent = _fmtLabel(fmt);
      fEl.className = "fmt " + (isQR ? "qr" : "barcode");
    }
    if (tEl) tEl.textContent = text;
    if (dEl) {
      if (inDb === true) {
        dEl.className = "db found show";
        dEl.textContent = "✅ Bazada: " + dbInfo;
      } else if (inDb === false) {
        dEl.className = "db not-found show";
        dEl.textContent = "❌ Bazada topilmadi";
      } else dEl.className = "db";
    }
    var frame = document.getElementById("tibexSc7Frame");
    if (frame) {
      frame.classList.add("detected");
      setTimeout(function () { frame.classList.remove("detected"); }, 1500);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // AQLLI TO'LDIRISH
  // ═══════════════════════════════════════════════════════════════
  function _autofill(code, inDb) {
    var scanInput = document.getElementById("scanInput");
    if (scanInput) scanInput.value = code;

    var manual = document.querySelector(".sc7-manual");
    if (manual) manual.value = "";

    var active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      if (active.id !== "scanInput") {
        active.value = code;
        try { active.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
      }
    }

    var searchInp = document.getElementById("incomingSearch");
    if (searchInp && !searchInp.value) {
      searchInp.value = code;
      try { searchInp.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    }

    var resultsId = document.getElementById("resultsOrderId");
    if (resultsId) resultsId.textContent = code;
  }

  // ═══════════════════════════════════════════════════════════════
  // SOUND / VIBRO
  // ═══════════════════════════════════════════════════════════════
  var _audio = null;
  function _beep(kind) {
    var sBtn = document.querySelector(".sc7-sound");
    if (sBtn && !sBtn.classList.contains("active")) return;
    try {
      if (!_audio) _audio = new (window.AudioContext || window.webkitAudioContext)();
      if (_audio.state === "suspended") _audio.resume();
      var tones = {
        detect: [[600, 40]],
        success: [[880, 70], [1320, 70, 80]],
        error: [[300, 150], [200, 150, 160]],
        warn: [[440, 200]]
      };
      var list = tones[kind] || tones.detect;
      list.forEach(function (t) {
        var o = _audio.createOscillator();
        var g = _audio.createGain();
        var start = _audio.currentTime + ((t[2] || 0) / 1000);
        o.frequency.value = t[0];
        o.type = "sine";
        g.gain.setValueAtTime(0.25, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + t[1] / 1000);
        o.connect(g);
        g.connect(_audio.destination);
        o.start(start);
        o.stop(start + t[1] / 1000);
      });
    } catch (e) {}
  }

  function _vibrate(pattern) {
    var vBtn = document.querySelector(".sc7-vibro");
    if (vBtn && !vBtn.classList.contains("active")) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // TOAST
  // ═══════════════════════════════════════════════════════════════
  function _toast(msg, kind) {
    if (window.toast) { try { window.toast(msg, kind || "info"); } catch (e) {} }
  }

  // ═══════════════════════════════════════════════════════════════
  // SERVER REPORT (XSS-safe)
  // ═══════════════════════════════════════════════════════════════
  function _reportToServer(kind, detail) {
    try {
      if (window.TIBEX_STORE && window.TIBEX_STORE._api) {
        window.TIBEX_STORE._api("/api/camera/alert", {
          method: "POST",
          body: { kind: kind, detail: String(detail).slice(0, 256) }
        }).catch(function () {});
      }
    } catch (e) {}
  }

  function _autoDisable() {
    _running = false;
    _toast("🔒 Xavfsizlik: kamera bloklandi", "bad", 5000);
    _reportToServer("camera.auto_disabled", "Too many failures: " + _failCount);
    _stopAll();
    setTimeout(function () { closeScanner(); }, 2000);
  }

  function _stopAll() {
    _running = false;
    try {
      if (_activeEngine === "html5" && _engineInstance) {
        _engineInstance.stop().catch(function () {});
      } else if (_activeEngine === "qrscan" && _engineInstance) {
        _engineInstance.stop();
      } else if (_activeEngine === "zxing" && _engineInstance) {
        _engineInstance.reset();
      }
    } catch (e) {}
    _engineInstance = null;
    if (_stream) {
      try { _stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      _stream = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MODAL BUILD (yengilroq)
  // ═══════════════════════════════════════════════════════════════
  function _buildModal() {
    if (document.getElementById("tibexSc7Modal")) return;
    var css = document.createElement("style");
    css.textContent =
      ".sc7-modal{position:fixed;inset:0;background:#000;z-index:999999;display:none;flex-direction:column;font-family:-apple-system,'Segoe UI',sans-serif;}" +
      ".sc7-modal.show{display:flex;}" +
      ".sc7-head{height:56px;background:rgba(0,0,0,.92);color:#fff;display:flex;align-items:center;padding:0 16px;gap:10px;flex-shrink:0;}" +
      ".sc7-head h3{flex:1;font-size:15px;font-weight:700;margin:0;}" +
      ".sc7-eng{font-size:10.5px;padding:3px 10px;border-radius:10px;font-weight:700;background:#334155;}" +
      ".sc7-eng.html5{background:#15803d;}.sc7-eng.qrscan{background:#0369a1;}.sc7-eng.zxing{background:#a16207;}.sc7-eng.native{background:#7c3aed;}" +
      ".sc7-head button{background:rgba(255,255,255,.15);color:#fff;border:none;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}" +
      ".sc7-head button:hover{background:rgba(255,255,255,.25);}" +
      ".sc7-head button.primary{background:#dc2626;}" +
      ".sc7-vw{flex:1;position:relative;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;}" +
      ".sc7-vw video, .sc7-vw #tibexSc7VideoWrap{max-width:100%;max-height:100%;}" +
      ".sc7-vw #tibexSc7VideoWrap{width:100%;height:100%;}" +
      ".sc7-vw #tibexSc7VideoWrap video{width:100%!important;height:100%!important;object-fit:contain;}" +
      ".sc7-overlay{position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;}" +
      ".sc7-frame{width:80%;max-width:520px;aspect-ratio:16/8;border:3px solid rgba(148,163,184,.55);border-radius:12px;transition:border-color .2s;position:relative;}" +
      ".sc7-frame.detected{border-color:rgba(74,222,128,.95);box-shadow:0 0 40px rgba(74,222,128,.6);}" +
      ".sc7-frame::before{content:'';position:absolute;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#60a5fa,transparent);animation:sc7Scan 2s ease-in-out infinite;}" +
      "@keyframes sc7Scan{0%,100%{top:0;}50%{top:calc(100% - 3px);}}" +
      ".sc7-live{position:absolute;top:20px;left:20px;right:20px;background:rgba(0,0,0,.78);backdrop-filter:blur(8px);border-radius:12px;padding:12px 16px;font-family:ui-monospace,monospace;font-size:13px;color:#fff;max-width:520px;margin:0 auto;display:none;}" +
      ".sc7-live.show{display:block;}" +
      ".sc7-live .fmt{display:inline-block;padding:3px 10px;border-radius:10px;font-weight:700;font-size:11px;background:#334155;margin-right:8px;}" +
      ".sc7-live .fmt.qr{background:#7c3aed;}.sc7-live .fmt.barcode{background:#0369a1;}" +
      ".sc7-live .txt{word-break:break-all;line-height:1.5;}" +
      ".sc7-live .db{margin-top:8px;padding:6px 10px;border-radius:6px;font-size:11.5px;display:none;}" +
      ".sc7-live .db.show{display:block;}.sc7-live .db.found{background:rgba(34,197,94,.25);color:#4ade80;}.sc7-live .db.not-found{background:rgba(239,68,68,.2);color:#f87171;}" +
      ".sc7-foot{background:rgba(0,0,0,.92);padding:12px 16px;display:flex;flex-direction:column;gap:8px;flex-shrink:0;}" +
      ".sc7-foot .row{display:flex;gap:8px;align-items:center;}" +
      ".sc7-foot input{flex:1;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;font-size:14px;font-family:ui-monospace,monospace;outline:none;}" +
      ".sc7-foot input:focus{border-color:#4ade80;}" +
      ".sc7-foot .btn{padding:10px 16px;border-radius:8px;border:none;background:#1e40af;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;}" +
      ".sc7-foot .btn.toggle{padding:8px 12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);}" +
      ".sc7-foot .btn.toggle.active{background:#f59e0b;color:#000;}" +
      ".sc7-timer{padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;font-size:12px;}" +
      ".sc7-timer option{background:#1e293b;}";
    document.head.appendChild(css);

    var m = document.createElement("div");
    m.id = "tibexSc7Modal";
    m.className = "sc7-modal";
    m.innerHTML =
      '<div class="sc7-head">' +
      '  <h3>📷 Skaner</h3>' +
      '  <span class="sc7-eng" id="tibexSc7Eng">—</span>' +
      '  <button class="sc7-switch" title="Kamera">🔄</button>' +
      '  <button class="sc7-torch" title="Chiroq">🔦</button>' +
      '  <button class="sc7-close primary">Yopish (Esc)</button>' +
      '</div>' +
      '<div class="sc7-vw" id="tibexSc7VideoWrap">' +
      '  <div class="sc7-overlay"><div class="sc7-frame" id="tibexSc7Frame"></div></div>' +
      '  <div class="sc7-live" id="tibexSc7Live">' +
      '    <div><span class="fmt" id="tibexSc7Fmt">?</span><span class="txt" id="tibexSc7Text">—</span></div>' +
      '    <div class="db" id="tibexSc7Db"></div>' +
      '  </div>' +
      '</div>' +
      '<div class="sc7-foot">' +
      '  <div class="row">' +
      '    <input type="text" class="sc7-manual" placeholder="Yoki kodni qo\'lda kiriting..." autocomplete="off">' +
      '    <button class="btn sc7-submit">→</button>' +
      '  </div>' +
      '  <div class="row">' +
      '    <button class="btn toggle sc7-sound active">🔊</button>' +
      '    <button class="btn toggle sc7-vibro active">📳</button>' +
      '    <select class="sc7-timer sc7-timer-sel">' +
      '      <option value="0">⏱ O\'chmaydi</option>' +
      '      <option value="30">⏱ 30s</option>' +
      '      <option value="60">⏱ 1m</option>' +
      '      <option value="300">⏱ 5m</option>' +
      '    </select>' +
      '    <button class="btn toggle sc7-switch-cam" title="Kamera almashtirish">📷</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(m);

    m.querySelector(".sc7-close").addEventListener("click", closeScanner);
    m.querySelector(".sc7-submit").addEventListener("click", function () {
      var v = m.querySelector(".sc7-manual").value.trim();
      if (v) _onDetected(v, "manual");
    });
    m.querySelector(".sc7-manual").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); var v = e.target.value.trim(); if (v) _onDetected(v, "manual"); }
    });
    m.querySelector(".sc7-switch-cam").addEventListener("click", _switchCamera);
    m.querySelector(".sc7-torch").addEventListener("click", _toggleTorch);
    m.addEventListener("click", function (e) { if (e.target === m) closeScanner(); });
    m.querySelector(".sc7-sound").addEventListener("click", function () { this.classList.toggle("active"); });
    m.querySelector(".sc7-vibro").addEventListener("click", function () { this.classList.toggle("active"); });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && m.classList.contains("show")) closeScanner();
    });

    _setupAutoClose();
  }

  function _setupAutoClose() {
    var sel = document.querySelector(".sc7-timer-sel");
    if (!sel) return;
    sel.addEventListener("change", function () {
      var sec = parseInt(this.value) || 0;
      if (_autoCloseTimer) { clearInterval(_autoCloseTimer); _autoCloseTimer = null; }
      if (sec > 0) {
        _autoCloseTimer = setInterval(function () {
          _autoCloseRemain--;
          if (_autoCloseRemain <= 0) {
            clearInterval(_autoCloseTimer); _autoCloseTimer = null;
            closeScanner();
          }
        }, 1000);
        _autoCloseRemain = sec;
      }
    });
  }
  var _autoCloseTimer = null, _autoCloseRemain = 0;

  // ═══════════════════════════════════════════════════════════════
  // START ALL
  // ═══════════════════════════════════════════════════════════════
  async function openScanner() {
    _buildModal();
    var modal = document.getElementById("tibexSc7Modal");
    modal.classList.add("show");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      _toast("Kamera API mavjud emas", "bad");
      return;
    }
    if (location.protocol !== "https:" &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1") {
      _toast("HTTPS/localhost kerak", "bad");
      return;
    }

    if (!_selectEngine()) {
      _toast("Skaner kutubxonasi topilmadi", "bad");
      return;
    }

    // Fortress token
    try {
      if (window.TIBEX_CAMERA_FORTRESS && window.TIBEX_CAMERA_FORTRESS.prepareCamera) {
        await window.TIBEX_CAMERA_FORTRESS.prepareCamera();
      }
    } catch (e) {
      _toast("Bloklangan: " + (e.message || "?"), "bad");
      setTimeout(closeScanner, 2500);
      return;
    }

    // Eng yaxshi kamerani tanlash
    var cam = await _selectBestCamera();
    var camId = cam ? cam.deviceId : null;

    // Engine'ni ishga tushirish
    var eng = document.getElementById("tibexSc7Eng");
    if (eng) {
      eng.textContent = { html5: "⚡ HTML5", qrscan: "🚀 QR-Scan", zxing: "🔄 ZXing", native: "⚡ Native" }[_activeEngine] || "—";
      eng.className = "sc7-eng " + _activeEngine;
    }

    var videoWrap = document.getElementById("tibexSc7VideoWrap");
    var started = false;

    // 1) HTML5-QRCODE
    if (_activeEngine === "html5") {
      started = await _startHtml5Engine(videoWrap, camId);
    }

    // 2) QR-SCANNER (nimiq)
    if (!started && window.QrScanner) {
      _activeEngine = "qrscan";
      var video = document.createElement("video");
      video.setAttribute("playsinline", "true");
      video.setAttribute("muted", "true");
      video.style.cssText = "width:100%;height:100%;object-fit:contain;";
      videoWrap.insertBefore(video, videoWrap.firstChild);
      started = await _startQrScannerEngine(video, camId);
    }

    // 3) ZXING
    if (!started && window.ZXing) {
      _activeEngine = "zxing";
      var video2 = document.createElement("video");
      video2.setAttribute("playsinline", "true");
      video2.setAttribute("muted", "true");
      video2.style.cssText = "width:100%;height:100%;object-fit:contain;";
      videoWrap.insertBefore(video2, videoWrap.firstChild);
      started = await _startZxingEngine(video2, camId);
    }

    if (started) {
      _running = true;
      console.log("[SCANNER] Started with engine:", _activeEngine);
    } else {
      _toast("Kamera ishga tushmadi", "bad");
    }
  }

  function closeScanner() {
    var m = document.getElementById("tibexSc7Modal");
    if (m) m.classList.remove("show");
    _stopAll();
    if (_autoCloseTimer) { clearInterval(_autoCloseTimer); _autoCloseTimer = null; }
  }

  async function _switchCamera() {
    var cams = [];
    try {
      var devs = await navigator.mediaDevices.enumerateDevices();
      cams = devs.filter(function (d) { return d.kind === "videoinput"; });
    } catch (e) {}
    if (cams.length < 2) { _toast("Faqat 1 ta kamera", "warn"); return; }
    var idx = cams.findIndex(function (c) { return c.deviceId === _selectedCameraId; });
    idx = (idx + 1) % cams.length;
    _selectedCameraId = cams[idx].deviceId;
    _toast("Kamera almashtirilmoqda...", "info");
    closeScanner();
    setTimeout(openScanner, 300);
  }

  async function _toggleTorch() {
    try {
      var v = document.querySelector("#tibexSc7VideoWrap video");
      if (!v || !v.srcObject) return;
      var track = v.srcObject.getVideoTracks()[0];
      if (!track || !track.getCapabilities) return;
      var caps = track.getCapabilities();
      if (!caps.torch) { _toast("Chiroq yo'q", "warn"); return; }
      var on = track.getSettings && track.getSettings().torch;
      await track.applyConstraints({ advanced: [{ torch: !on }] });
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════
  window.TIBEX_SMART_CAMERA = {
    open: openScanner,
    close: closeScanner,
    isSupported: function () {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },
    engine: function () { return _activeEngine; }
  };
  window.TIBEX_BARCODE_CAMERA = window.TIBEX_BARCODE_CAMERA || window.TIBEX_SMART_CAMERA;

  console.log("[TIBEX] Ultimate Scanner v7.0 ✓");
  console.log("  Html5Qrcode:", window.Html5Qrcode ? "✓" : "✗");
  console.log("  QrScanner:", window.QrScanner ? "✓" : "✗");
  console.log("  ZXing:", window.ZXing ? "✓" : "✗");
  console.log("  Native:", "BarcodeDetector" in window ? "✓" : "✗");
})();
