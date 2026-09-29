/* TIBEX_ADMIN_SHORTCUTS — admin panelidagi klaviatura yorliqlari (F3/F5/F9). */
(function () {
  "use strict";
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "F3") { e.preventDefault(); document.getElementById("btnNewPatient")?.click(); }
    else if (e.key === "F5") { e.preventDefault(); if (typeof renderAll === "function") renderAll(); }
    else if (e.key === "F9") { e.preventDefault(); document.querySelector('[data-view="reports"]')?.click(); }
  });
})();
