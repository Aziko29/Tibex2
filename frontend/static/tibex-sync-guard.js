/* TIBEX_SYNC_GUARD — TIBEX_STORE ulanishi "eskirganda" (60s dan ortiq
   yangilanmasa) ogohlantirish, tiklanganda "Aloqa tiklandi" toast.
   Ilgari har bir xodim sahifasida (goh ikki marta!) inline <script>
   sifatida nusxalanган edi — endi bitta umumiy faylda. */
(function () {
  "use strict";
  if (!window.TIBEX_STORE || !window.TIBEX_STORE.subscribe) return;
  var lastSync = Date.now();
  var wasStale = false;
  window.TIBEX_STORE.subscribe(function (data, source) {
    if (source === "external") {
      lastSync = Date.now();
      if (wasStale) {
        wasStale = false;
        if (window.toast) { try { window.toast("🟢 Aloqa tiklandi", "ok", 2000); } catch (_) {} }
      }
    }
  });
  setInterval(function () {
    var stale = Date.now() - lastSync > 60000;
    if (stale && !wasStale) {
      wasStale = true;
      if (window.toast) { try { window.toast("⚠️ Server bilan aloqa yo'qolgan", "warn", 5000); } catch (_) {} }
    }
  }, 20000);
})();
