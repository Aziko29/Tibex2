/* ══════════════════════════════════════════════════════════════════
 * TIBEX Safe — XSS himoyasi uchun xavfsiz funksiyalar
 * TIBEX_SAFE_v1
 *
 * Ishlatish:
 *   `<div>${esc(p.fullname)}</div>`
 *   `<a href="${escAttr(url)}">`
 *   `<script>const x = ${escJson(obj)};</script>`
 * ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const HTML_ENTITIES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;",
    "`": "&#x60;",
    "=": "&#x3D;",
  };

  // ─── HTML escape (matn uchun) ───
  window.esc = function (s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"'`=\/]/g, (c) => HTML_ENTITIES[c] || c);
  };

  // ─── Attribute escape (href, src uchun) ───
  window.escAttr = function (s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"'`=]/g, (c) => HTML_ENTITIES[c] || c);
  };

  // ─── URL escape (href uchun) ───
  window.escUrl = function (s) {
    if (s === null || s === undefined) return "";
    const str = String(s);
    // javascript: va data: bilan boshlanishni bloklash
    if (/^\s*(javascript|data|vbscript):/i.test(str)) {
      return "#blocked";
    }
    try {
      return encodeURI(str);
    } catch (_) {
      return "";
    }
  };

  // ─── JSON escape (<script> ichida ishlatish uchun) ───
  window.escJson = function (obj) {
    const json = JSON.stringify(obj);
    return json.replace(/[<>&\u2028\u2029]/g, (c) => {
      return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
    });
  };

  // ─── Chuqur escape (butun obyekt uchun) ───
  window.escDeep = function (obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "string") return window.esc(obj);
    if (typeof obj === "number" || typeof obj === "boolean") return obj;
    if (Array.isArray(obj)) return obj.map(window.escDeep);
    if (typeof obj === "object") {
      const out = {};
      for (const k of Object.keys(obj)) {
        out[k] = window.escDeep(obj[k]);
      }
      return out;
    }
    return obj;
  };

  console.log("[TIBEX] Safe escape tayyor");
})();

/* TIBEX_FRONTEND_ERROR_REPORT_v1 */
(function(){
  "use strict";
  if (window.__TIBEX_ERR_REPORT__) return;
  window.__TIBEX_ERR_REPORT__ = true;
  const _q = [];
  let _t = null;
  function _send(payload) {
    _q.push(payload);
    if (_t) return;
    _t = setTimeout(() => {
      const batch = _q.splice(0, 10);
      try {
        fetch("/api/monitoring/frontend-errors", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ errors: batch }),
        }).catch(() => {});
      } catch (_) {}
      _t = null;
    }, 2000);
  }
  window.addEventListener("error", (e) => {
    _send({ type: "error", message: String(e.message || "").slice(0,500),
      filename: String(e.filename || "").slice(0,200),
      lineno: e.lineno, colno: e.colno,
      stack: String(e.error && e.error.stack || "").slice(0,1000),
      url: location.href, ua: navigator.userAgent, ts: Date.now() });
  });
  window.addEventListener("unhandledrejection", (e) => {
    _send({ type: "promise",
      message: String(e.reason && e.reason.message || e.reason || "").slice(0,500),
      stack: String(e.reason && e.reason.stack || "").slice(0,1000),
      url: location.href, ts: Date.now() });
  });
})();
