/* =====================================================================
 * TIBEX Clinic Info — admin sozlagan klinika ma'lumotlarini
 * barcha konsollarga (shifokor/qabulxona/kassa/laboratoriya) yetkazadi.
 *
 * Muammo edi: /api/bootstrap orqali system_info.clinic {name, phone,
 * address} allaqachon HAR BIR rol uchun keshga kelardi, lekin faqat
 * admin.html shuni o'qirdi. Bu fayl o'sha ma'lumotni ".logo" elementiga
 * (hover tooltip) va sahifa sarlavhasiga qo'yadi — hech qanday backend
 * o'zgarishisiz, mavjud snapshot'dan foydalanadi.
 * ===================================================================== */
(function () {
  "use strict";

  let _applied = false;

  function _apply() {
    const store = window.TIBEX_STORE;
    const cache = store && store.getAll && store.getAll();
    const clinic = cache && cache.system_info && cache.system_info.clinic;
    if (!clinic || !clinic.name) return;

    const logo = document.querySelector(".logo");
    if (logo) {
      logo.title = [clinic.name, clinic.phone, clinic.address]
        .filter(Boolean)
        .join(" · ");
    }

    if (!_applied && document.title) {
      document.title = document.title.replace(/^TIBEX/, clinic.name);
    }
    _applied = true;
  }

  function _waitAndApply() {
    const store = window.TIBEX_STORE;
    if (store && store.getAll && store.getAll() && store.getAll().system_info) {
      _apply();
      if (store.subscribe) store.subscribe(_apply);
    } else {
      setTimeout(_waitAndApply, 200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _waitAndApply);
  } else {
    _waitAndApply();
  }
})();
