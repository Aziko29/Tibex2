/* ══════════════════════════════════════════════════════════════════════
 * TIBEX SCANNER v9.0 — Universal QR + Barcode Reader (Hardened)
 *
 * Tuzatishlar (v8 dan):
 *   1. Kamera labellari uchun avval ruxsat so'raladi (enumerateDevices
 *      bo'sh label qaytarmasligi uchun).
 *   2. stopCamera() barcha tracklarni ISHONCHLI to'xtatadi.
 *   3. AVTOFILL FAQAT OQ RO'YXAT (whitelist) elementlarga yoziladi.
 *   4. Skanerlangan kod uzunligi va tarkibi cheklanadi/tozalanadi.
 *   5. Engine fallback: html5 → zxing → native.
 *   6. Sahifa fonda bo'lsa kamera to'xtatiladi.
 *   7. Torch tugmasi holati UI'da ko'rinadi.
 *   8. DB lookup va handler xatolari izolyatsiya qilingan.
 * ══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  if (window.__TIBEX_SCANNER_V9__) return;
  window.__TIBEX_SCANNER_V9__ = true;

  var MAX_CODE_LEN = 512;
  var DUP_WINDOW_MS = 1500;
  var ENGINE_ORDER = ["html5", "zxing", "native"];

  var _engine = null;
  var _engineObj = null;
  var _running = false;
  var _video = null;
  var _lastCode = "", _lastCodeAt = 0;
  var _scanCount = 0;
  var _history = [];
  var _autoCloseTimer = null, _autoCloseRemain = 0;
  var _selectedCameraId = null;
  var _cameras = [];
  var _wasOpenBeforeHide = false;
  var _permissionStream = null;

  var FMT = {
    "QR_CODE": "QR Code", "qr_code": "QR Code",
    "CODE_128": "Code 128", "code_128": "Code 128",
    "CODE_39": "Code 39", "code_39": "Code 39",
    "CODE_93": "Code 93", "code_93": "Code 93",
    "CODABAR": "Codabar", "codabar": "Codabar",
    "EAN_13": "EAN-13", "ean_13": "EAN-13",
    "EAN_8": "EAN-8", "ean_8": "EAN-8",
    "ITF": "ITF", "itf": "ITF",
    "UPC_A": "UPC-A", "upc_a": "UPC-A",
    "UPC_E": "UPC-E", "upc_e": "UPC-E",
    "DATA_MATRIX": "Data Matrix", "data_matrix": "Data Matrix",
    "PDF_417": "PDF417", "pdf417": "PDF417",
    "AZTEC": "Aztec", "aztec": "Aztec"
  };
  function fmtLabel(f) { return FMT[f] || FMT[String(f).toUpperCase()] || (f || "?").toUpperCase(); }

  function sanitizeCode(raw) {
    if (raw === null || raw === undefined) return "";
    var s = String(raw);
    if (s.length > MAX_CODE_LEN) s = s.slice(0, MAX_CODE_LEN);
    s = s.replace(/[\x00-\x1F\x7F]/g, "");
    return s.trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // CSS
  // ═══════════════════════════════════════════════════════════════
  function injectCSS() {
    if (document.getElementById("tibex-sc9-css")) return;
    var s = document.createElement("style");
    s.id = "tibex-sc9-css";
    s.textContent = [
      ".sc9-modal{position:fixed;inset:0;background:#000;z-index:999999;display:none;flex-direction:column;font-family:-apple-system,'Segoe UI',sans-serif;}",
      ".sc9-modal.show{display:flex;}",
      ".sc9-head{height:56px;background:rgba(0,0,0,.92);color:#fff;display:flex;align-items:center;padding:0 16px;gap:10px;flex-shrink:0;}",
      ".sc9-head h3{flex:1;font-size:15px;font-weight:700;margin:0;}",
      ".sc9-eng{font-size:10.5px;padding:3px 10px;border-radius:10px;font-weight:700;background:#334155;color:#fff;}",
      ".sc9-eng.html5{background:#15803d;}",".sc9-eng.zxing{background:#a16207;}",".sc9-eng.native{background:#7c3aed;}",
      ".sc9-head button{background:rgba(255,255,255,.15);color:#fff;border:none;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}",
      ".sc9-head button:hover{background:rgba(255,255,255,.25);}",
      ".sc9-head button.primary{background:#dc2626;}",
      ".sc9-head button.torch-on{background:#f59e0b;color:#000;}",
      ".sc9-vw{flex:1;position:relative;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;}",
      ".sc9-vw video{width:100%!important;height:100%!important;object-fit:contain;}",
      ".sc9-vw #sc9Reader{width:100%;height:100%;}",
      ".sc9-vw #sc9Reader video{width:100%!important;height:100%!important;object-fit:contain;}",
      ".sc9-overlay{position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;}",
      ".sc9-frame{width:78%;max-width:500px;aspect-ratio:16/9;border:3px solid rgba(148,163,184,.6);border-radius:14px;transition:border-color .2s;position:relative;}",
      ".sc9-frame.detected{border-color:rgba(74,222,128,.95);box-shadow:0 0 40px rgba(74,222,128,.6);}",
      ".sc9-frame::before{content:'';position:absolute;left:10px;right:10px;height:3px;background:linear-gradient(90deg,transparent,#60a5fa,transparent);animation:sc9Scan 2.2s ease-in-out infinite;border-radius:3px;}",
      "@keyframes sc9Scan{0%,100%{top:6px;}50%{top:calc(100% - 10px);}}",
      ".sc9-live{position:absolute;top:20px;left:20px;right:20px;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);border-radius:12px;padding:12px 16px;font-family:ui-monospace,monospace;font-size:13px;color:#fff;max-width:520px;margin:0 auto;display:none;}",
      ".sc9-live.show{display:block;}",
      ".sc9-live .fmt{display:inline-block;padding:3px 10px;border-radius:10px;font-weight:700;font-size:11px;background:#334155;margin-right:8px;}",
      ".sc9-live .fmt.qr{background:#7c3aed;}",
      ".sc9-live .fmt.barcode{background:#0369a1;}",
      ".sc9-live .txt{word-break:break-all;line-height:1.5;color:#fff;}",
      ".sc9-live .db{margin-top:8px;padding:6px 10px;border-radius:6px;font-size:11.5px;display:none;}",
      ".sc9-live .db.show{display:block;}",
      ".sc9-live .db.found{background:rgba(34,197,94,.25);color:#4ade80;}",
      ".sc9-live .db.not-found{background:rgba(239,68,68,.25);color:#f87171;}",
      ".sc9-status{position:absolute;bottom:20px;left:20px;right:20px;text-align:center;color:#fff;font-size:14px;font-weight:600;text-shadow:0 2px 8px rgba(0,0,0,.9);}",
      ".sc9-status.ok{color:#4ade80;}",".sc9-status.err{color:#f87171;}",".sc9-status.warn{color:#fbbf24;}",
      ".sc9-timer{position:absolute;top:16px;right:16px;background:rgba(0,0,0,.7);color:#fbbf24;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;font-family:ui-monospace,monospace;display:none;}",
      ".sc9-timer.show{display:block;}",
      ".sc9-foot{background:rgba(0,0,0,.92);padding:12px 16px;display:flex;flex-direction:column;gap:8px;flex-shrink:0;}",
      ".sc9-foot .row{display:flex;gap:8px;align-items:center;}",
      ".sc9-foot input{flex:1;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;font-size:14px;font-family:ui-monospace,monospace;outline:none;}",
      ".sc9-foot input:focus{border-color:#4ade80;}",
      ".sc9-foot input::placeholder{color:rgba(255,255,255,.45);}",
      ".sc9-foot .btn{padding:10px 16px;border-radius:8px;border:none;background:#1e40af;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;}",
      ".sc9-foot .btn:hover{background:#1e3a8a;}",
      ".sc9-foot .btn.toggle{padding:8px 12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);}",
      ".sc9-foot .btn.toggle.active{background:#f59e0b;color:#000;border-color:#f59e0b;}",
      ".sc9-foot .sel{padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;font-size:12px;font-family:inherit;cursor:pointer;}",
      ".sc9-foot .sel option{background:#1e293b;color:#fff;}",
      ".sc9-err{padding:40px 20px;color:#fff;text-align:center;}",
      ".sc9-err .big{font-size:64px;margin-bottom:20px;}",
      ".sc9-err .msg{font-size:14px;line-height:1.6;max-width:520px;margin:0 auto;opacity:.9;}",
      ".sc9-err button{margin-top:20px;padding:12px 24px;border-radius:8px;border:none;background:#1e40af;color:#fff;font-weight:700;cursor:pointer;font-family:inherit;}"
    ].join("");
    document.head.appendChild(s);
  }

  // ═══════════════════════════════════════════════════════════════
  // MODAL
  // ═══════════════════════════════════════════════════════════════
  function build() {
    if (document.getElementById("tibexSc9Modal")) return;
    injectCSS();

    var m = document.createElement("div");
    m.id = "tibexSc9Modal";
    m.className = "sc9-modal";
    m.innerHTML = [
      '<div class="sc9-head">',
      '  <h3>📷 Skaner</h3>',
      '  <span class="sc9-eng" id="sc9Eng">—</span>',
      '  <button class="sc9-torch" title="Chiroq">🔦</button>',
      '  <button class="sc9-close primary">Yopish (Esc)</button>',
      '</div>',
      '<div class="sc9-vw" id="sc9VideoWrap">',
      '  <div id="sc9Reader"></div>',
      '  <div class="sc9-overlay"><div class="sc9-frame" id="sc9Frame"></div></div>',
      '  <div class="sc9-live" id="sc9Live">',
      '    <div><span class="fmt" id="sc9Fmt">?</span><span class="txt" id="sc9Text">—</span></div>',
      '    <div class="db" id="sc9Db"></div>',
      '  </div>',
      '  <div class="sc9-timer" id="sc9Timer"></div>',
      '  <div class="sc9-status" id="sc9Status">Kodni ramka ichiga joylashtiring...</div>',
      '</div>',
      '<div class="sc9-foot">',
      '  <div class="row">',
      '    <input type="text" class="sc9-manual" placeholder="Yoki kodni qo\'lda kiriting..." autocomplete="off" maxlength="' + MAX_CODE_LEN + '">',
      '    <button class="btn sc9-submit">→</button>',
      '  </div>',
      '  <div class="row">',
      '    <button class="btn toggle sc9-sound active" title="Ovoz">🔊</button>',
      '    <button class="btn toggle sc9-vibro active" title="Vibro">📳</button>',
      '    <select class="sel sc9-timer-sel">',
      '      <option value="0">⏱ O\'chmaydi</option>',
      '      <option value="30">⏱ 30s</option>',
      '      <option value="60">⏱ 1m</option>',
      '      <option value="120">⏱ 2m</option>',
      '      <option value="300">⏱ 5m</option>',
      '    </select>',
      '    <select class="sel sc9-cam-sel" title="Kamera"></select>',
      '  </div>',
      '</div>'
    ].join("");
    document.body.appendChild(m);

    m.querySelector(".sc9-close").addEventListener("click", close);
    m.querySelector(".sc9-submit").addEventListener("click", function () {
      var raw = m.querySelector(".sc9-manual").value;
      var v = sanitizeCode(raw);
      if (v) onDetected(v, "manual");
    });
    m.querySelector(".sc9-manual").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var v = sanitizeCode(e.target.value);
        if (v) onDetected(v, "manual");
      }
    });
    m.querySelector(".sc9-sound").addEventListener("click", function () { this.classList.toggle("active"); });
    m.querySelector(".sc9-vibro").addEventListener("click", function () { this.classList.toggle("active"); });
    m.querySelector(".sc9-timer-sel").addEventListener("change", function () {
      resetAutoClose(parseInt(this.value, 10) || 0);
    });
    m.querySelector(".sc9-cam-sel").addEventListener("change", function () {
      _selectedCameraId = this.value;
      restartCamera();
    });
    m.querySelector(".sc9-torch").addEventListener("click", toggleTorch);
    m.addEventListener("click", function (e) { if (e.target === m) close(); });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && m.classList.contains("show")) close();
    });

    document.addEventListener("visibilitychange", function () {
      var modalEl = document.getElementById("tibexSc9Modal");
      var isOpen = modalEl && modalEl.classList.contains("show");
      if (document.hidden) {
        if (isOpen && _running) {
          _wasOpenBeforeHide = true;
          stopCamera();
          setStatus("⏸ Kamera to'xtatildi (sahifa fonda)");
        }
      } else {
        if (_wasOpenBeforeHide && isOpen) {
          _wasOpenBeforeHide = false;
          startCamera();
        }
      }
    });
    window.addEventListener("pagehide", function () { stopCamera(); });
    window.addEventListener("beforeunload", function () { stopCamera(); });
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTO-CLOSE
  // ═══════════════════════════════════════════════════════════════
  function resetAutoClose(sec) {
    if (_autoCloseTimer) { clearInterval(_autoCloseTimer); _autoCloseTimer = null; }
    var el = document.getElementById("sc9Timer");
    if (!sec) { if (el) el.classList.remove("show"); return; }
    _autoCloseRemain = sec;
    if (el) { el.classList.add("show"); el.textContent = "⏱ " + sec + "s"; }
    _autoCloseTimer = setInterval(function () {
      _autoCloseRemain--;
      if (_autoCloseRemain <= 0) { clearInterval(_autoCloseTimer); _autoCloseTimer = null; close(); return; }
      if (el) el.textContent = "⏱ " + _autoCloseRemain + "s";
    }, 1000);
  }

  // ═══════════════════════════════════════════════════════════════
  // AUDIO
  // ═══════════════════════════════════════════════════════════════
  var _audio = null;
  function tone(freq, dur, delay) {
    var sBtn = document.querySelector(".sc9-sound");
    if (sBtn && !sBtn.classList.contains("active")) return;
    try {
      if (!_audio) _audio = new (window.AudioContext || window.webkitAudioContext)();
      if (_audio.state === "suspended") _audio.resume();
      var t = _audio.currentTime + (delay || 0) / 1000;
      var o = _audio.createOscillator(), g = _audio.createGain();
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur / 1000);
      o.connect(g); g.connect(_audio.destination);
      o.start(t); o.stop(t + dur / 1000);
    } catch (e) {}
  }
  function beep(kind) {
    if (kind === "detect") { tone(600, 40); }
    else if (kind === "success") { tone(880, 70); tone(1320, 70, 80); }
    else if (kind === "error") { tone(300, 150); tone(200, 150, 160); }
    else { tone(440, 200); }
  }
  function vibrate(p) {
    var vBtn = document.querySelector(".sc9-vibro");
    if (vBtn && !vBtn.classList.contains("active")) return;
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // ENGINE
  // ═══════════════════════════════════════════════════════════════
  function engineAvailable(name) {
    if (name === "html5") return !!window.Html5Qrcode;
    if (name === "zxing") return !!(window.ZXing && window.ZXing.BrowserMultiFormatReader);
    if (name === "native") return "BarcodeDetector" in window;
    return false;
  }
  function nextAvailableEngine(exclude) {
    for (var i = 0; i < ENGINE_ORDER.length; i++) {
      var name = ENGINE_ORDER[i];
      if (exclude && exclude.indexOf(name) >= 0) continue;
      if (engineAvailable(name)) return name;
    }
    return null;
  }
  function setEngine() {
    var el = document.getElementById("sc9Eng");
    if (!el) return;
    var M = { html5: "⚡ HTML5", zxing: "🔄 ZXing", native: "⚡ Native" };
    el.textContent = M[_engine] || "—";
    el.className = "sc9-eng " + (_engine || "");
  }

  // ═══════════════════════════════════════════════════════════════
  // CAMERA RO'YXATI (label olish uchun ruxsat so'raladi)
  // ═══════════════════════════════════════════════════════════════
  async function ensurePermissionForLabels() {
    try {
      var devs = await navigator.mediaDevices.enumerateDevices();
      var hasLabels = devs.some(function (d) { return d.kind === "videoinput" && d.label; });
      if (hasLabels) return;
      _permissionStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }
      });
    } catch (e) {
      // davom etamiz
    } finally {
      if (_permissionStream) {
        _permissionStream.getTracks().forEach(function (t) { t.stop(); });
        _permissionStream = null;
      }
    }
  }

  async function listCameras() {
    await ensurePermissionForLabels();
    try {
      var devs = await navigator.mediaDevices.enumerateDevices();
      _cameras = devs.filter(function (d) { return d.kind === "videoinput"; });
      var sel = document.querySelector(".sc9-cam-sel");
      if (sel) {
        sel.innerHTML = _cameras.map(function (c, i) {
          return '<option value="' + escapeHtml(c.deviceId) + '">' + escapeHtml(c.label || ("Kamera " + (i + 1))) + '</option>';
        }).join("");
        if (_cameras.length > 0 && !_selectedCameraId) {
          var back = _cameras.find(function (c) { return /back|rear|environment/i.test(c.label); });
          _selectedCameraId = back ? back.deviceId : _cameras[0].deviceId;
        }
        if (_selectedCameraId) sel.value = _selectedCameraId;
      }
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // START CAMERA
  // ═══════════════════════════════════════════════════════════════
  async function startCamera(triedEngines) {
    triedEngines = triedEngines || [];
    var candidate = _engine && triedEngines.indexOf(_engine) < 0 && engineAvailable(_engine)
      ? _engine
      : nextAvailableEngine(triedEngines);

    if (!candidate) {
      showError("Skaner kutubxonasi topilmadi", "Html5Qrcode, ZXing va Native BarcodeDetector — birortasi ham mavjud/ishlamadi.");
      return;
    }
    _engine = candidate;
    setEngine();

    var ok;
    if (_engine === "html5") ok = await startHtml5();
    else if (_engine === "zxing") ok = await startZxing();
    else ok = await startNative();

    if (!ok) {
      triedEngines.push(_engine);
      var next = nextAvailableEngine(triedEngines);
      if (next) {
        console.warn("[SCANNER] '" + _engine + "' ishlamadi, '" + next + "' ga o'tilmoqda...");
        _engine = next;
        return startCamera(triedEngines);
      } else {
        showError("Kamera ishga tushmadi", "Barcha mavjud dvigatellar sinab ko'rildi, muvaffaqiyatsiz.");
      }
    }
  }

  async function startHtml5() {
    try {
      var readerEl = document.getElementById("sc9Reader");
      if (!readerEl) return false;
      readerEl.innerHTML = "";

      _engineObj = new Html5Qrcode("sc9Reader", {
        verbose: false,
        formatsToSupport: [
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
        ]
      });

      var config = {
        fps: 15,
        qrbox: function (w, h) {
          var m = Math.min(w, h);
          return { width: Math.round(m * 0.75), height: Math.round(m * 0.75) };
        },
        aspectRatio: 1.777,
        disableFlip: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      };

      var videoConstraints = {
        deviceId: _selectedCameraId ? { exact: _selectedCameraId } : undefined,
        facingMode: _selectedCameraId ? undefined : { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      };

      await _engineObj.start(videoConstraints, config, onDetectedCallback, function () {});
      _running = true;
      setStatus("Kodni ramka ichiga joylashtiring...");
      console.log("[SCANNER] Html5Qrcode ishga tushdi");
      return true;
    } catch (e) {
      console.error("[SCANNER] Html5Qrcode xato:", e);
      await safeStopEngineObj();
      return false;
    }
  }

  async function startZxing() {
    try {
      var videoWrap = document.getElementById("sc9VideoWrap");
      if (!videoWrap) return false;
      var oldVideo = videoWrap.querySelector("video");
      if (oldVideo) oldVideo.remove();

      _video = document.createElement("video");
      _video.setAttribute("playsinline", "true");
      _video.setAttribute("muted", "true");
      _video.style.cssText = "width:100%;height:100%;object-fit:contain;";
      videoWrap.insertBefore(_video, videoWrap.firstChild);

      var codeReader = new ZXing.BrowserMultiFormatReader();
      _engineObj = codeReader;

      var deviceId = _selectedCameraId || null;
      await codeReader.decodeFromVideoDevice(deviceId, _video, function (result) {
        if (result && result.getText) {
          var fmt = "unknown";
          try {
            var fo = result.getBarcodeFormat && result.getBarcodeFormat();
            var N = { 0: "aztec", 1: "codabar", 2: "code_39", 3: "code_93", 4: "code_128", 5: "data_matrix",
                      6: "ean_8", 7: "ean_13", 8: "itf", 9: "maxicode", 10: "pdf417", 11: "qr_code",
                      12: "rss_14", 13: "rss_expanded", 14: "upc_a", 15: "upc_e" };
            fmt = N[fo] || "unknown";
          } catch (e2) {}
          onDetected(sanitizeCode(result.getText()), fmt);
        }
      });
      _running = true;
      setStatus("Kodni ramka ichiga joylashtiring...");
      console.log("[SCANNER] ZXing ishga tushdi");
      return true;
    } catch (e) {
      console.error("[SCANNER] ZXing xato:", e);
      await safeStopEngineObj();
      return false;
    }
  }

  async function startNative() {
    try {
      var videoWrap = document.getElementById("sc9VideoWrap");
      if (!videoWrap) return false;
      var oldVideo = videoWrap.querySelector("video");
      if (oldVideo) oldVideo.remove();

      _video = document.createElement("video");
      _video.setAttribute("playsinline", "true");
      _video.setAttribute("muted", "true");
      _video.autoplay = true;
      _video.style.cssText = "width:100%;height:100%;object-fit:contain;";
      videoWrap.insertBefore(_video, videoWrap.firstChild);

      var constraints = {
        video: _selectedCameraId
          ? { deviceId: { exact: _selectedCameraId } }
          : { facingMode: { ideal: "environment" } }
      };
      var stream = await navigator.mediaDevices.getUserMedia(constraints);
      _video.srcObject = stream;
      await _video.play();

      var detector = new BarcodeDetector({
        formats: ["qr_code", "code_128", "code_39", "code_93", "codabar",
                  "ean_13", "ean_8", "itf", "upc_a", "upc_e"]
      });
      _engineObj = detector;
      _running = true;
      setStatus("Kodni ramka ichiga joylashtiring...");

      function loop() {
        if (!_running) return;
        detector.detect(_video).then(function (bcs) {
          if (bcs && bcs.length > 0) {
            var b = bcs[0];
            onDetected(sanitizeCode(b.rawValue || ""), b.format || "unknown");
          }
        }).catch(function () {}).finally(function () {
          if (_running) setTimeout(loop, 200);
        });
      }
      loop();
      console.log("[SCANNER] Native ishga tushdi");
      return true;
    } catch (e) {
      console.error("[SCANNER] Native xato:", e);
      await safeStopEngineObj();
      return false;
    }
  }

  function onDetectedCallback(text, result) {
    var fmt = "unknown";
    try {
      if (result && result.result && result.result.format) {
        fmt = result.result.format.formatName || "unknown";
      }
    } catch (e) {}
    onDetected(sanitizeCode(text), fmt);
  }

  // ═══════════════════════════════════════════════════════════════
  // ON DETECTED
  // ═══════════════════════════════════════════════════════════════
  function onDetected(code, fmt) {
    code = sanitizeCode(code);
    if (!code || code.length < 2) return;
    fmt = fmt || "unknown";

    var now = Date.now();
    if (code === _lastCode && (now - _lastCodeAt) < DUP_WINDOW_MS) return;
    _lastCode = code; _lastCodeAt = now;
    _scanCount++;

    beep("detect");
    vibrate(50);

    var inDb = false, dbInfo = "";
    try {
      if (window.TIBEX_STORE && typeof window.TIBEX_STORE.getLabOrder === "function") {
        var order = window.TIBEX_STORE.getLabOrder(code);
        if (order) {
          inDb = true;
          var p = null;
          try {
            p = typeof window.TIBEX_STORE.getPatient === "function"
              ? window.TIBEX_STORE.getPatient(order.patient_id)
              : null;
          } catch (e2) {}
          dbInfo = (p && p.fullname ? p.fullname : "?") + " — " + (order.test_name || "");
          beep("success");
          vibrate([80, 50, 80]);
        }
      }
    } catch (e) {
      console.error("[SCANNER] TIBEX_STORE lookup xatosi:", e);
    }

    if (!inDb) {
      beep("error");
      vibrate([150, 80, 150]);
    }

    updateLive(fmt, code, inDb, dbInfo);
    setStatus(
      inDb ? "✅ " + fmtLabel(fmt) : "🔍 " + fmtLabel(fmt) + " (bazada yo'q)",
      inDb ? "ok" : "warn"
    );

    _history.unshift({ t: new Date().toLocaleTimeString("uz"), fmt: fmt, code: code });
    if (_history.length > 20) _history.pop();

    autofill(code);

    if (inDb && typeof window.__TIBEX_ON_BARCODE__ === "function") {
      try { window.__TIBEX_ON_BARCODE__(code, { keepOpen: true }); }
      catch (e) { console.error("[SCANNER] __TIBEX_ON_BARCODE__ xatosi:", e); }
    }
  }

  function updateLive(fmt, text, inDb, dbInfo) {
    var panel = document.getElementById("sc9Live");
    if (!panel) return;
    panel.classList.add("show");
    var fEl = document.getElementById("sc9Fmt");
    var tEl = document.getElementById("sc9Text");
    var dEl = document.getElementById("sc9Db");
    var isQR = String(fmt).toLowerCase().indexOf("qr") >= 0;
    if (fEl) {
      fEl.textContent = fmtLabel(fmt);
      fEl.className = "fmt " + (isQR ? "qr" : "barcode");
    }
    if (tEl) tEl.textContent = text;
    if (dEl) {
      if (inDb) {
        dEl.className = "db found show";
        dEl.textContent = "✅ Bazada: " + dbInfo;
      } else {
        dEl.className = "db not-found show";
        dEl.textContent = "❌ Bazada topilmadi";
      }
    }
    var frame = document.getElementById("sc9Frame");
    if (frame) {
      frame.classList.add("detected");
      setTimeout(function () { frame.classList.remove("detected"); }, 1500);
    }
  }

  function setStatus(text, cls) {
    var el = document.getElementById("sc9Status");
    if (el) {
      el.textContent = text;
      el.className = "sc9-status" + (cls ? " " + cls : "");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // AVTOFILL — FAQAT OQ RO'YXAT (whitelist)
  // ═══════════════════════════════════════════════════════════════
  function isWritable(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly) return false;
    // MUHIM: offsetParent === null position:fixed elementlar uchun noto'g'ri
    // ishlaydi. Shu sababli offsetWidth/Height tekshiruviga o'tamiz.
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    return true;
  }
  function setFieldValue(el, code) {
    if (!isWritable(el)) return;
    el.value = code;
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
  }

  function autofill(code) {
    var scanInput = document.getElementById("scanInput");
    if (scanInput) setFieldValue(scanInput, code);

    var searchInp = document.getElementById("incomingSearch");
    if (searchInp && isWritable(searchInp) && !searchInp.value) {
      setFieldValue(searchInp, code);
    }

    var resultId = document.getElementById("resultsOrderId");
    if (resultId) resultId.textContent = code;

    try {
      var targets = document.querySelectorAll("[data-tibex-scan-target]");
      targets.forEach(function (el) {
        if (el.id === "scanInput" || el.id === "incomingSearch") return;
        setFieldValue(el, code);
      });
    } catch (e) {}

    var manual = document.querySelector(".sc9-manual");
    if (manual) manual.value = "";
  }

  async function toggleTorch() {
    try {
      var v = document.querySelector("#sc9VideoWrap video");
      if (!v || !v.srcObject) return;
      var track = v.srcObject.getVideoTracks()[0];
      if (!track || !track.getCapabilities) return;
      var caps = track.getCapabilities();
      if (!caps.torch) { if (window.toast) window.toast("Bu kamerada chiroq yo'q", "warn"); return; }
      var on = track.getSettings && track.getSettings().torch;
      await track.applyConstraints({ advanced: [{ torch: !on }] });
      var btn = document.querySelector(".sc9-torch");
      if (btn) btn.classList.toggle("torch-on", !on);
    } catch (e) {}
  }

  function showError(title, detail) {
    var wrap = document.getElementById("sc9VideoWrap");
    if (!wrap) return;
    wrap.innerHTML = '<div class="sc9-err"><div class="big">📷</div>' +
      '<div class="msg"><b>' + escapeHtml(title) + '</b><br><br>' + escapeHtml(detail) + '</div>' +
      '<button class="sc9-retry">Qayta urinish</button></div>';
    var btn = wrap.querySelector(".sc9-retry");
    if (btn) btn.addEventListener("click", function () {
      wrap.innerHTML = '<div id="sc9Reader"></div>' +
        '<div class="sc9-overlay"><div class="sc9-frame" id="sc9Frame"></div></div>' +
        '<div class="sc9-live" id="sc9Live"><div><span class="fmt" id="sc9Fmt">?</span><span class="txt" id="sc9Text">—</span></div><div class="db" id="sc9Db"></div></div>' +
        '<div class="sc9-timer" id="sc9Timer"></div>' +
        '<div class="sc9-status" id="sc9Status">Kodni ramka ichiga joylashtiring...</div>';
      startCamera();
    });
  }

  async function safeStopEngineObj() {
    try {
      if (_engine === "html5" && _engineObj && _engineObj.stop) {
        await _engineObj.stop().catch(function () {});
        try { _engineObj.clear(); } catch (e) {}
      } else if (_engine === "zxing" && _engineObj) {
        try { _engineObj.reset(); } catch (e) {}
      }
    } catch (e) {}
    _engineObj = null;
  }

  async function stopCamera() {
    _running = false;
    await safeStopEngineObj();

    try {
      var wrap = document.getElementById("sc9VideoWrap");
      var vids = wrap ? wrap.querySelectorAll("video") : [];
      vids.forEach(function (v) {
        if (v.srcObject) {
          v.srcObject.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
          v.srcObject = null;
        }
      });
    } catch (e) {}

    _video = null;
  }

  async function restartCamera() {
    await stopCamera();
    await listCameras();
    await startCamera();
  }

  async function open() {
    if (location.protocol !== "https:" &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1") {
      if (window.toast) window.toast("HTTPS yoki localhost kerak", "bad");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (window.toast) window.toast("Kamera API mavjud emas", "bad");
      return;
    }

    build();
    document.getElementById("tibexSc9Modal").classList.add("show");

    try {
      if (window.TIBEX_CAMERA_FORTRESS && typeof window.TIBEX_CAMERA_FORTRESS.prepareCamera === "function") {
        await window.TIBEX_CAMERA_FORTRESS.prepareCamera();
      }
    } catch (e) {
      if (window.toast) window.toast("Bloklangan: " + (e && e.message ? e.message : "?"), "bad");
      setTimeout(close, 2500);
      return;
    }

    await listCameras();
    await startCamera();
  }

  async function close() {
    var m = document.getElementById("tibexSc9Modal");
    if (m) m.classList.remove("show");
    await stopCamera();
    if (_autoCloseTimer) { clearInterval(_autoCloseTimer); _autoCloseTimer = null; }
  }

  window.TIBEX_SMART_CAMERA = {
    open: open,
    close: close,
    isSupported: function () {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
                (window.Html5Qrcode || window.ZXing || ("BarcodeDetector" in window)));
    },
    engine: function () { return _engine; },
    history: function () { return _history.slice(); },
    scanCount: function () { return _scanCount; }
  };

  console.log("[TIBEX] Scanner v9.0 (hardened) ✓");
  console.log("  Html5Qrcode:", window.Html5Qrcode ? "✓" : "✗");
  console.log("  ZXing:", window.ZXing ? "✓" : "✗");
  console.log("  Native:", "BarcodeDetector" in window ? "✓" : "✗");
})();
