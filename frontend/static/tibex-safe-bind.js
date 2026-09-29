/* TIBEX_SAFE_BIND — global xatolarni ushlaydigan event bind helper
   va modal ochish/yopish yordamchilari. */
(function () {
  "use strict";
  window.tibexSafeBind = function (id, event, handler) {
    const el = document.getElementById(id);
    if (!el) { console.warn("[TIBEX] Element topilmadi:", id); return false; }
    el.addEventListener(event, function (e) {
      try { handler.call(this, e); } catch (err) {
        console.error("[TIBEX] Handler xatosi (" + id + "):", err);
        if (window.toast) { try { window.toast("Xatolik: " + err.message, "bad"); } catch (_) {} }
      }
    });
    return true;
  };
  window.addEventListener("error", function (e) { console.error("[TIBEX Global]", e.error || e.message); });
  window.addEventListener("unhandledrejection", function (e) { console.error("[TIBEX Promise]", e.reason); });
  window.tibexOpenModal = function (id) { const el = document.getElementById(id); if (el) el.classList.add("open"); };
  window.tibexCloseModal = function (id) { const el = document.getElementById(id); if (el) el.classList.remove("open"); };
})();
