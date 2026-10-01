/* ================================================================
 * TIBEX — Login sahifasidagi mavzu (light/dark) tugmasi.
 * Boshqa xodim sahifalari (admin/qabulxona/kassa/lab/shifokor)
 * bilan bir xil kalit va atributdan foydalanadi:
 *   localStorage "tibex_settings_v1"  { theme: "light"|"dark"|"auto", ... }
 *   <html data-tibex-theme="light|dark">
 * shuning uchun bu yerda tanlangan mavzu tizimga kirgandan keyin
 * ham (va aksincha) saqlanib qoladi. tibex-theme-dark.js allaqachon
 * sahifa yuklanganda joriy mavzuni qo'llaydi — bu skript faqat
 * tugma bosilganda mavzuni almashtiradi.
 * ================================================================ */
(function () {
  "use strict";

  var KEY = "tibex_settings_v1";
  var ATTR = "data-tibex-theme";

  function loadSettings() {
    try {
      var raw = localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return Object.assign({ theme: "light" }, parsed);
    } catch (_) {
      return { theme: "light" };
    }
  }

  function saveSettings(s) {
    try {
      s.lastModified = Date.now();
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (_) {}
  }

  function isCurrentlyDark() {
    return document.documentElement.getAttribute(ATTR) === "dark";
  }

  function updateIcon(btn) {
    if (!btn) return;
    var dark = isCurrentlyDark();
    btn.textContent = dark ? "☀️" : "🌙";
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    btn.title = dark ? "Kunduzgi rejimga o'tish" : "Tungi rejimga o'tish";
  }

  function toggle(btn) {
    var s = loadSettings();
    var nextDark = !isCurrentlyDark();
    s.theme = nextDark ? "dark" : "light";
    saveSettings(s);
    document.documentElement.setAttribute(ATTR, nextDark ? "dark" : "light");
    updateIcon(btn);
  }

  function init() {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    updateIcon(btn);
    btn.addEventListener("click", function () { toggle(btn); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
