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
  function updateButton() {
    var value = document.documentElement.getAttribute("data-tibex-theme") || document.documentElement.getAttribute("data-theme") || "light";
    var btn = document.querySelector("[data-tibex-theme-toggle]");
    if (!btn) return;
    btn.textContent = value === "dark" ? "☀️" : "🌙";
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
      if (adminActions) adminActions.appendChild(btn);
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
