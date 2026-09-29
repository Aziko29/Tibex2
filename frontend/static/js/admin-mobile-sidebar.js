/* TIBEX_MOBILE_SIDEBAR — admin panelida mobil hamburger menyu. */
(function () {
  "use strict";
  if (window.__TIBEX_MOBILE_SB__) return;
  window.__TIBEX_MOBILE_SB__ = true;
  function init() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('btnHamburger')) return;
    const btn = document.createElement('button');
    btn.id = 'btnHamburger';
    btn.className = 'hamburger';
    btn.textContent = '☰';
    btn.setAttribute('aria-label', 'Menyu');
    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.insertBefore(btn, topbar.firstChild);
    btn.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
