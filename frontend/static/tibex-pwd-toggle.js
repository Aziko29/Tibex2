/* TIBEX_PWD_TOGGLE — parolni ko'rsatish/yashirish tugmasi (barcha login/forma
   maydonlarida bir xil). Ilgari har bir sahifada inline <script> sifatida
   nusxalanган edi — CSP (prod) nonce'siz inline scriptni bloklaydi,
   shuning uchun tashqi faylga ko'chirildi. */
(function () {
  "use strict";
  var EYE_OPEN = "👁️";
  var EYE_HIDE = "🙈";

  function bind(root) {
    (root || document).querySelectorAll(".pwd-toggle").forEach(function (btn) {
      if (btn.dataset.tibexPwdBound === "1") return;
      btn.dataset.tibexPwdBound = "1";

      btn.addEventListener("mousedown", function (e) { e.preventDefault(); });

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var wrap = btn.closest(".pwd-wrap");
        if (!wrap) return;
        var inp = wrap.querySelector("input");
        if (!inp) return;
        var showing = inp.type === "text";
        inp.type = showing ? "password" : "text";
        btn.textContent = showing ? EYE_OPEN : EYE_HIDE;
        btn.title = showing ? "Parolni korsatish" : "Parolni yashirish";
        btn.setAttribute("aria-label", btn.title);
        btn.setAttribute("aria-pressed", showing ? "false" : "true");
        try {
          inp.focus();
          var v = inp.value;
          if (inp.setSelectionRange) inp.setSelectionRange(v.length, v.length);
        } catch (_) {}
      });
    });
  }

  function init() {
    bind(document);
    document.addEventListener("click", function () {
      setTimeout(function () { bind(document); }, 100);
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__tibexRebindPwdToggles = bind;
})();
