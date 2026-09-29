/* ══════════════════════════════════════════════════════════════════
 * TIBEX DARK THEME v2 — Comprehensive (WCAG AA+)
 * GitHub Dark palitrasi. Barcha elementlarni qamrab oladi.
 * ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var SETTINGS_KEY = "tibex_settings_v1";
  var ATTR = "data-tibex-theme";


  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { theme: "light" };
      return JSON.parse(raw) || { theme: "light" };
    } catch (_) {
      return { theme: "light" };
    }
  }

  function apply() {
    var s = loadSettings();
    var theme = s.theme || "light";
    var isDark = theme === "dark" ||
      (theme === "auto" && window.matchMedia &&
       window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute(ATTR, isDark ? "dark" : "light");
  }

  var _last = null;
  function watch() {
    var s = loadSettings();
    if (s.theme !== _last) {
      _last = s.theme;
      apply();
    }
    setTimeout(watch, 800);
  }

  function init() {
    apply();
    watch();
    if (window.matchMedia) {
      try {
        window.matchMedia("(prefers-color-scheme: dark)")
          .addEventListener("change", apply);
      } catch (_) {}
    }
    console.log("[TIBEX] Dark theme v2 yuklandi ✓");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
