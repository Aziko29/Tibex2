/* TIBEX_ROLE_REFRESH — rol/ruxsatlar yangilanganda UI'ni qayta chizish.
   Ilgari har bir xodim sahifasida inline <script> sifatida nusxalanган edi. */
window.__TIBEX_ROLE_REFRESH__ = function () {
  try {
    if (typeof applyPermissions === "function") {
      applyPermissions();
    }
    if (typeof renderAll === "function") {
      renderAll();
    }
    if (window.toast) {
      try { window.toast("🔐 Ruxsatlaringiz yangilandi", "info", 3000); } catch (_) {}
    }
  } catch (e) { console.warn("[ROLE_REFRESH]", e); }
};
