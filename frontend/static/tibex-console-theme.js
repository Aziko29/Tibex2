/* A single day/night control shared by all console roles. */
(function () {
  "use strict";
  var KEY = "tibex_settings_v1";
  function read() {
    try { return Object.assign({ theme: "light" }, JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch (_) { return { theme: "light" }; }
  }
  function dark(s) {
    return s.theme === "dark" || (s.theme === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  var SVG = '<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
  var ICON_SUN = SVG + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var ICON_MOON = SVG + '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function updateButton() {
    var value = document.documentElement.getAttribute("data-tibex-theme") || document.documentElement.getAttribute("data-theme") || "light";
    var btn = document.querySelector("[data-tibex-theme-toggle]");
    if (!btn) return;
    // Admin konsolida (.tb-btn) bir xil uslubdagi SVG ikon, boshqa rollarda avvalgi emoji.
    if (btn.classList.contains("tb-btn")) btn.innerHTML = value === "dark" ? ICON_SUN : ICON_MOON;
    else btn.textContent = value === "dark" ? "☀️" : "🌙";
    btn.setAttribute("aria-pressed", value === "dark" ? "true" : "false");
    btn.title = value === "dark" ? "Kunduzgi rejimga o'tish" : "Tungi rejimga o'tish";
    btn.setAttribute("aria-label", btn.title);
  }
  function apply(s) {
    var value = dark(s) ? "dark" : "light";
    document.documentElement.setAttribute("data-tibex-theme", value);
    document.documentElement.setAttribute("data-theme", value);
    updateButton();
  }
  function init() {
    var topbar = document.querySelector(".topbar");
    if (topbar && !topbar.querySelector("[data-tibex-theme-toggle]") && !document.getElementById("themeToggle")) {
      var btn = document.createElement("button");
      btn.type = "button";
      var adminActions = topbar.querySelector(".tb-actions");
      btn.className = (adminActions ? "tb-btn" : "icon-btn") + " tibex-theme-toggle";
      btn.setAttribute("data-tibex-theme-toggle", "1");
      var spacer = topbar.querySelector(".spacer");
      // Admin: tema tugmasi "Chiqish" (⏻) dan oldin turadi — chiqish doim oxirgi.
      if (adminActions) adminActions.insertBefore(btn, adminActions.querySelector("#btnLogout"));
      else if (spacer) topbar.insertBefore(btn, spacer.nextSibling);
      else topbar.appendChild(btn);
      btn.addEventListener("click", function () {
        var s = read();
        s.theme = dark(s) ? "light" : "dark";
        s.lastModified = Date.now();
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
        apply(s);
      });
    }
    apply(read());
    window.addEventListener("storage", function (e) { if (e.key === KEY) apply(read()); });
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { var s = read(); if (s.theme === "auto") apply(s); });
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-tibex-set-btn]")) setTimeout(function () { apply(read()); }, 0);
    });
    new MutationObserver(updateButton).observe(document.documentElement, { attributes: true, attributeFilter: ["data-tibex-theme", "data-theme"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
