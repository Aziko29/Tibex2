/* =====================================================================
 * TIBEX Session — Logout + Auto-lockscreen
 *
 * Avtomatik ishlaydi:
 *   - Barcha 🚪 tugmalarni (title="Chiqish") logout'ga bog'laydi
 *   - Foydalanuvchi 15 daqiqa harakatsiz bo'lsa — blok ekrani
 *   - Blok ekranida parol terib qayta kirish mumkin
 *
 * Sozlash: window.__TIBEX_IDLE_MINUTES__ = 15
 * ===================================================================== */

(function () {
  "use strict";

  const IDLE_MINUTES = window.__TIBEX_IDLE_MINUTES__ || 15;
  const IDLE_MS = IDLE_MINUTES * 60 * 1000;

  let _idleTimer = null;
  let _locked = false;
  let _lockEl = null;
  let _bound = false;

  // ═══════════════════ Yordamchi ═══════════════════
  // TIBEX_API_BASE_CONSISTENCY_FIX_v1: window.__API_BASE__ faqat login
  // sahifalarida (staff-login.js / bemor-login.js orqali) o'rnatiladi —
  // admin.html va boshqa dashboard
  // sahifalarida bu o'zgaruvchi umuman mavjud emas edi. Natijada bu yerdagi
  // eski kod `window.__API_BASE__ || ""` orqali bo'sh satrga tushib qolardi
  // va so'rov joriy sahifa originiga (masalan Live Server'ning 5500-portiga)
  // yuborilardi — u yerda backend yo'q, shuning uchun logout/lock-unlock
  // so'rovlari 501/404 bilan muvaffaqiyatsiz bo'lardi. Endi tibex-client.js
  // bilan AYNAN bir xil mantiq: agar window.__API_BASE__ aniq berilmagan
  // bo'lsa, joriy hostname'dan 8000-portga hisoblaymiz.
  function _resolveApiBase() {
    if (typeof window.__API_BASE__ === "string") return window.__API_BASE__;
    const loc = window.location;
    if (loc.port === "8000" || loc.port === "" || loc.port === "443" || loc.port === "80") {
      return "";
    }
    return loc.protocol + "//" + loc.hostname + ":8000";
  }

  function _api(path, opts) {
    const API = _resolveApiBase();
    const method = (opts?.method || "GET").toUpperCase();
    const headers = { "Content-Type": "application/json", ...(opts?.headers || {}) };
    const csrf = (window.TIBEX_STORE?.getCsrf?.()
      || window.TIBEX_STORE?.csrf
      || window.TIBEX_STORE?._csrf_public
      || null);
    if (!["GET","HEAD","OPTIONS"].includes(method) && csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
    return fetch(API + path, {
      method,
      credentials: "include",
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
  }

  function _initials(name) {
    return (name || "?").split(" ").slice(0, 2).map(s => s[0] || "").join("").toUpperCase();
  }

  // CSS: static/css/tibex-session.css (HTML da <link> orqali; CSP style-src 'self' — JS da style elementi yaratilmaydi)

  // ═══════════════════ Lock Screen ═══════════════════
  function _buildLock() {
    if (_lockEl) return;
    _lockEl = document.createElement("div");
    _lockEl.className = "tibex-lock";
    _lockEl.id = "tibexLock";
    _lockEl.innerHTML = `
      <div class="tibex-lock-card">
        <div class="tibex-lock-avatar" id="tibexLockAvatar">—</div>
        <div class="tibex-lock-name" id="tibexLockName">Foydalanuvchi</div>
        <div class="tibex-lock-role" id="tibexLockRole">—</div>
        <div class="tibex-lock-clock" id="tibexLockClock">--:--</div>
        <div class="tibex-lock-date" id="tibexLockDate">—</div>
        <input type="password" class="tibex-lock-input" id="tibexLockPass"
               placeholder="Parolingizni kiriting" autocomplete="current-password">
        <button class="tibex-lock-btn" id="tibexLockBtn">🔓 Blokdan chiqish</button>
        <div class="tibex-lock-err" id="tibexLockErr"></div>
        <button class="tibex-lock-out" id="tibexLockOut">Boshqa foydalanuvchi sifatida kirish</button>
      </div>
    `;
    document.body.appendChild(_lockEl);

    document.getElementById("tibexLockBtn").addEventListener("click", _tryUnlock);
    document.getElementById("tibexLockPass").addEventListener("keydown", (e) => {
      if (e.key === "Enter") _tryUnlock();
    });
    document.getElementById("tibexLockOut").addEventListener("click", _doLogout);

    setInterval(_updateClock, 1000);
  }

  function _updateClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const clock = document.getElementById("tibexLockClock");
    const dateEl = document.getElementById("tibexLockDate");
    if (clock) clock.textContent = `${hh}:${mm}`;
    if (dateEl) {
      const months = ["yanvar","fevral","mart","aprel","may","iyun","iyul","avgust","sentabr","oktabr","noyabr","dekabr"];
      const days = ["yakshanba","dushanba","seshanba","chorshanba","payshanba","juma","shanba"];
      dateEl.textContent = `${d.getDate()} ${months[d.getMonth()]}, ${days[d.getDay()]}`;
    }
  }

  function _applyUserInfo() {
    const u = window.TIBEX_STORE?.CURRENT_USER;
    if (!u) return;
    const av = document.getElementById("tibexLockAvatar");
    const nm = document.getElementById("tibexLockName");
    const rl = document.getElementById("tibexLockRole");
    if (av) av.textContent = _initials(u.fullname || u.login);
    if (nm) nm.textContent = u.fullname || u.login;
    if (rl) rl.textContent = u.role || "";
  }

  async function _tryUnlock() {
    const passEl = document.getElementById("tibexLockPass");
    const errEl = document.getElementById("tibexLockErr");
    const btn = document.getElementById("tibexLockBtn");
    const u = window.TIBEX_STORE?.CURRENT_USER;
    if (!u) return _doLogout();

    const password = passEl.value;
    if (!password) {
      errEl.textContent = "Parolni kiriting";
      passEl.focus();
      return;
    }
    btn.disabled = true;
    errEl.textContent = "Tekshirilmoqda...";

    try {
      const r = await _api("/api/auth/login", {
        method: "POST",
        body: { username: u.login, password },
      });
      if (!r.ok) {
        errEl.textContent = "Parol xato";
        passEl.value = "";
        passEl.focus();
        btn.disabled = false;
        return;
      }
      const data = await r.json();
      if (window.TIBEX_STORE?.setCsrf) {
        window.TIBEX_STORE.setCsrf(data.csrf_token);
      }
      _locked = false;
      passEl.value = "";
      errEl.textContent = "";
      document.getElementById("tibexLock").classList.remove("show");
      _resetIdle();
      if (window.toast) {
        try { window.toast("Xush kelibsiz, " + (data.user.fullname || ""), "ok"); } catch (_) {}
      }
    } catch (e) {
      errEl.textContent = "Xatolik: " + (e.message || "unknown");
    } finally {
      btn.disabled = false;
    }
  }

  async function _doLogout() {
    // TIBEX_LOGOUT_RELIABILITY_FIX_v1: avval javob statusini tekshiramiz.
    // Eski kodda status tekshirilmasdi — logout so'rovi 401/403 bilan
    // muvaffaqiyatsiz bo'lsa ham (masalan CSRF eskirgan bo'lsa), kod buni
    // sezmay login.html'ga o'tib ketardi; sessiya serverda hali ham amal
    // qilgani uchun login.html darhol profilga qaytarib yuborardi.
    try {
      const r = await _api("/api/auth/logout", { method: "POST" });
      // 401 = sessiya allaqachon tugagan: chiqish baribir muvaffaqiyatli hisoblanadi.
      if (!r.ok && r.status !== 401) {
        console.error("[TIBEX] Logout so'rovi muvaffaqiyatsiz:", r.status);
        if (window.toast) {
          try { window.toast("Chiqishda xatolik yuz berdi, qayta urinib ko'ring", "bad"); } catch (_) {}
        }
        return; // login.html'ga o'tmaymiz — aks holda darhol qaytarib yuboriladi
      }
    } catch (e) {
      console.error("[TIBEX] Logout tarmoq xatosi:", e);
      if (window.toast) {
        try { window.toast("Tarmoq xatosi: chiqib bo'lmadi", "bad"); } catch (_) {}
      }
      return;
    }
    location.href = "/login.html";
  }

  function _lock() {
    if (_locked) return;
    _locked = true;
    _buildLock();
    _applyUserInfo();
    _updateClock();
    document.getElementById("tibexLock").classList.add("show");
    setTimeout(() => document.getElementById("tibexLockPass")?.focus(), 200);
  }

  function _resetIdle() {
    if (_locked) return;
    clearTimeout(_idleTimer);
    _idleTimer = setTimeout(_lock, IDLE_MS);
  }

  // ═══════════════════ Logout tugmalari ═══════════════════
  function _bindLogoutButtons() {
    document.querySelectorAll("button").forEach((btn) => {
      if (btn._tibexLogoutBound) return;
      const txt = (btn.textContent || "").trim();
      const title = (btn.title || "").toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (
        txt === "🚪" ||
        title === "chiqish" ||
        title.includes("chiqish") ||
        aria.includes("chiqish")
      ) {
        btn._tibexLogoutBound = true;
        if (!btn.getAttribute("type")) btn.setAttribute("type", "button");
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          if (confirm("Tizimdan chiqishni tasdiqlaysizmi?")) {
            _doLogout();
          }
        });
      }
    });
  }

  // ═══════════════════ Init ═══════════════════
  function _bind() {
    if (_bound) return;
    _bound = true;
    _buildLock();
    _bindLogoutButtons();
    ["mousemove","keydown","click","scroll","touchstart","wheel"].forEach((evt) => {
      document.addEventListener(evt, _resetIdle, { passive: true });
    });
    _resetIdle();
  }

  // TIBEX_LOGOUT_STANDARD_v1: 🚪 tugma foydalanuvchi ma'lumoti (CURRENT_USER) kelishini
  // KUTMAYDI. Aks holda sessiya tugagan yoki tarmoq sekin bo'lsa tugma "o'lik" qolardi.
  function _bindLogoutEarly() {
    _bindLogoutButtons();
    // Keyin qo'shiladigan tugmalar uchun (masalan ⚙️/🔑 injektsiyasidan keyin)
    setTimeout(_bindLogoutButtons, 500);
    setTimeout(_bindLogoutButtons, 2000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _bindLogoutEarly);
  } else {
    _bindLogoutEarly();
  }

  // TIBEX_STORE.CURRENT_USER paydo bo'lishini kutamiz
  function _waitForReady() {
    if (window.TIBEX_STORE && window.TIBEX_STORE.CURRENT_USER) {
      _bind();
    } else {
      setTimeout(_waitForReady, 150);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _waitForReady);
  } else {
    _waitForReady();
  }

  // Global API
  window.TIBEX_SESSION = {
    lock: _lock,
    logout: _doLogout,
    idleMinutes: IDLE_MINUTES,
  };
})();