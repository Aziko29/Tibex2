/* ══════════════════════════════════════════════════════════════════
 * TIBEX Password UI — universal parol boshqaruvi
 * TIBEX_PWD_UI_v2 (fixed: TIBEX_STORE._api)
 *
 * Avtomatik ishlaydi:
 *   • Topbar'ga "🔑 Parol" tugmasini qo'shadi
 *   • Modal: eski + yangi parol + kuchlilik
 *   • Limit tugaganda: "Admin bilan bog'laning"
 *   • Admin panel: har bir xodim uchun "🔑 Reset"
 * ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const esc = window.esc;

  const MAX_CHANGES_PER_HOUR = 5;
  let _bound = false;
  let _modalEl = null;

  function _initials(name) {
    return (name || "?").split(" ").slice(0, 2).map(s => s[0] || "").join("").toUpperCase();
  }

  // ─── API chaqiruv: TIBEX_STORE._api() orqali (CSRF avtomatik) ───
  async function _api(path, method, body) {
    const store = window.TIBEX_STORE;
    if (!store || typeof store._api !== "function") {
      throw new Error("TIBEX_STORE tayyor emas. Sahifani yangilang.");
    }
    const m = (method || "GET").toUpperCase();
    const opts = { method: m };
    if (body !== undefined && body !== null && m !== "GET" && m !== "HEAD") {
      opts.body = body;
    }
    return await store._api(path, opts);
  }

  // CSS: static/css/tibex-password.css (HTML da <link> orqali; CSP style-src 'self' — JS da style elementi yaratilmaydi)

  function _buildModal() {
    if (_modalEl) return;
    _modalEl = document.createElement("div");
    _modalEl.className = "tibex-pwd-backdrop";
    _modalEl.id = "tibexPwdModal";
    _modalEl.innerHTML = `
      <div class="tibex-pwd-modal">
        <div class="tibex-pwd-head">
          <h3 id="tibexPwdTitle">🔑 Parolni almashtirish</h3>
          <button class="x" data-pwd-close>✕</button>
        </div>
        <div class="tibex-pwd-body" id="tibexPwdBody"></div>
        <div class="tibex-pwd-foot" id="tibexPwdFoot"></div>
      </div>
    `;
    document.body.appendChild(_modalEl);
    _modalEl.addEventListener("click", (e) => { if (e.target === _modalEl) _closeModal(); });
    _modalEl.querySelector("[data-pwd-close]").addEventListener("click", _closeModal);
  }

  function _closeModal() { _modalEl?.classList.remove("show"); }

  function _openModal() {
    _buildModal();
    _renderChangeForm();
    _modalEl.classList.add("show");
  }

  function _renderChangeForm() {
    const u = window.TIBEX_STORE?.CURRENT_USER || {};
    const changes = u.password_change_count || 0;
    const counterCls = "ok";
    const counterText = "Tarix: " + changes;

    document.getElementById("tibexPwdTitle").innerHTML = "🔑 Parolni almashtirish";

    document.getElementById("tibexPwdBody").innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
        '<div style="font-size:12.5px;color:#64748b;"><b>' + esc(u.fullname || "—") + '</b> · ' + esc(u.login || "—") + '</div>' +
        '<span class="tibex-pwd-counter ' + counterCls + '">' + counterText + '</span>' +
      '</div>' +
      '<div class="tibex-pwd-field"><label>Eski parol <span style="color:#dc2626;">*</span></label>' +
        '<input type="password" id="tibexPwdOld" placeholder="Eski parolingiz" autocomplete="current-password"></div>' +
      '<div class="tibex-pwd-field"><label>Yangi parol <span style="color:#dc2626;">*</span></label>' +
        '<input type="password" id="tibexPwdNew" placeholder="Kamida 10 belgi" autocomplete="new-password">' +
        '<div class="tibex-pwd-strength"><div class="fill" id="tibexPwdStrengthFill"></div></div>' +
        '<div class="tibex-pwd-hint" id="tibexPwdHint">Kamida 10 belgi: katta + kichik harf, raqam, belgi</div></div>' +
      '<div class="tibex-pwd-field"><label>Tasdiqlash <span style="color:#dc2626;">*</span></label>' +
        '<input type="password" id="tibexPwdConfirm" placeholder="Yangi parolni qayta kiriting" autocomplete="new-password"></div>' +
      '<div id="tibexPwdFormMsg"></div>';

    document.getElementById("tibexPwdFoot").innerHTML =
      '<button class="tibex-pwd-btn" data-pwd-close-foot>Bekor qilish</button>' +
      '<button class="tibex-pwd-btn primary" id="tibexPwdSave">✓ Parolni almashtirish</button>';

    document.querySelector("[data-pwd-close-foot]").addEventListener("click", _closeModal);
    document.getElementById("tibexPwdSave").addEventListener("click", _doChangePassword);
    document.getElementById("tibexPwdNew").addEventListener("input", _updateStrength);
    setTimeout(() => document.getElementById("tibexPwdOld")?.focus(), 100);
  }

  function _updateStrength(e) {
    const v = e.target.value || "";
    let score = 0;
    if (v.length >= 10) score++;
    if (/[a-z]/.test(v)) score++;
    if (/[A-Z]/.test(v)) score++;
    if (/\d/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v)) score++;
    const fill = document.getElementById("tibexPwdStrengthFill");
    fill.className = "fill " + (score <= 2 ? "low" : score <= 4 ? "mid" : "high");
    const hint = document.getElementById("tibexPwdHint");
    const msgs = {0:"Juda zaif",1:"Zaif",2:"O'rtacha",3:"Yaxshi",4:"Kuchli",5:"Juda kuchli ✓"};
    hint.textContent = msgs[score] || "—";
    hint.style.color = score >= 4 ? "#15803d" : score >= 3 ? "#b45309" : "#dc2626";
  }

  async function _doChangePassword() {
    const oldPwd = document.getElementById("tibexPwdOld").value;
    const newPwd = document.getElementById("tibexPwdNew").value;
    const confirm = document.getElementById("tibexPwdConfirm").value;
    const btn = document.getElementById("tibexPwdSave");
    const msgBox = document.getElementById("tibexPwdFormMsg");
    msgBox.innerHTML = "";

    if (!oldPwd) { msgBox.innerHTML = '<div class="tibex-pwd-msg err">Eski parolni kiriting</div>'; return; }
    if (!newPwd) { msgBox.innerHTML = '<div class="tibex-pwd-msg err">Yangi parolni kiriting</div>'; return; }
    if (newPwd.length < 10) { msgBox.innerHTML = '<div class="tibex-pwd-msg err">Parol kamida 10 belgi</div>'; return; }
    if (newPwd !== confirm) { msgBox.innerHTML = '<div class="tibex-pwd-msg err">Parollar mos emas</div>'; return; }
    if (newPwd === oldPwd) { msgBox.innerHTML = '<div class="tibex-pwd-msg err">Yangi parol eskisi bilan bir xil</div>'; return; }

    btn.disabled = true;
    btn.textContent = "Tekshirilmoqda...";

    try {
      const r = await _api("/api/auth/change-password", "POST", {
        old_password: oldPwd,
        new_password: newPwd,
      });
      if (window.TIBEX_STORE?.CURRENT_USER) {
        window.TIBEX_STORE.CURRENT_USER.password_change_count =
          (window.TIBEX_STORE.CURRENT_USER.password_change_count || 0) + 1;
      }
      msgBox.innerHTML = '<div class="tibex-pwd-msg ok"><b>✓ ' + esc(r.message) + '</b></div>';
      if (window.toast) { try { window.toast(r.message, "ok"); } catch (_) {} }
      setTimeout(_closeModal, 1800);
    } catch (e) {
      msgBox.innerHTML = '<div class="tibex-pwd-msg err"><b>✗ Xatolik:</b> ' + esc(e.message || "unknown") + '</div>';
      btn.disabled = false;
      btn.textContent = "✓ Parolni almashtirish";
    }
  }

  async function _adminReset(userId, userName) {
    _buildModal();
    document.getElementById("tibexPwdTitle").innerHTML = "🔑 Admin Reset — " + esc(userName);
    document.getElementById("tibexPwdBody").innerHTML =
      '<div class="tibex-pwd-msg warn"><b>⚠️ Diqqat:</b> Xodim uchun <b>yangi tasodifiy parol</b> ' +
      'generatsiya qilinadi. Eski parol o\'chiriladi va barcha sessiyalar bekor qilinadi.</div>' +
      '<div style="padding:12px;background:#f8fafc;border-radius:6px;font-size:13px;margin-bottom:14px;">' +
        'Xodim: <b>' + esc(userName) + '</b><br>Parol uzunligi: <b>12 belgi</b><br>Hisoblagich: <b>0/5</b> (qayta boshlanadi)</div>' +
      // TIBEX_ADMIN_RESET_AUTH_FIX_v1: bu amalni tasdiqlash uchun
      // chaqiruvchining (sizning) joriy parolingiz talab qilinadi.
      '<div class="tibex-pwd-field"><label>Sizning parolingiz <span style="color:#dc2626;">*</span></label>' +
        '<input type="password" id="tibexPwdAdminActorPwd" placeholder="Joriy parolingiz" autocomplete="current-password"></div>' +
      '<div id="tibexPwdAdminResetMsg"></div>';
    document.getElementById("tibexPwdFoot").innerHTML =
      '<button class="tibex-pwd-btn" data-pwd-close-foot>Bekor qilish</button>' +
      '<button class="tibex-pwd-btn danger" id="tibexPwdAdminReset">🔑 Reset qilish</button>';
    document.querySelector("[data-pwd-close-foot]").addEventListener("click", _closeModal);
    document.getElementById("tibexPwdAdminReset").addEventListener("click", async () => {
      const btn = document.getElementById("tibexPwdAdminReset");
      const msgBox = document.getElementById("tibexPwdAdminResetMsg");
      const actorPwd = document.getElementById("tibexPwdAdminActorPwd").value;
      if (!actorPwd) {
        msgBox.innerHTML = '<div class="tibex-pwd-msg err">Parolingizni kiriting</div>';
        return;
      }
      btn.disabled = true;
      btn.textContent = "Generatsiya...";
      try {
        const r = await _api("/api/users/" + userId + "/admin-reset-password", "POST", { password: actorPwd });
        _renderAdminResetResult(userName, r);
      } catch (e) {
        msgBox.innerHTML = '<div class="tibex-pwd-msg err"><b>✗ Xatolik:</b> ' + esc(e.message || "unknown") + '</div>';
        btn.disabled = false;
        btn.textContent = "🔑 Reset qilish";
      }
    });
    _modalEl.classList.add("show");
  }

  function _renderAdminResetResult(userName, r) {
    document.getElementById("tibexPwdBody").innerHTML =
      '<div class="tibex-pwd-msg ok"><b>✓ Parol muvaffaqiyatli generatsiya qilindi</b></div>' +
      '<div style="font-size:12.5px;color:#64748b;margin-bottom:8px;">Xodim: <b>' + esc(userName) + '</b> · login: <b>' + esc(r.user?.login || "—") + '</b></div>' +
      '<div class="tibex-pwd-pwdbox">' +
        '<div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;">Yangi parol</div>' +
        '<div class="code" id="tibexPwdResultCode">' + esc(r.new_password) + '</div>' +
        '<button class="tibex-pwd-btn-mini" id="tibexPwdCopyBtn">📋 Nusxa olish</button></div>' +
      '<div class="tibex-pwd-msg warn" style="margin-top:12px;"><b>⚠️ Parolni xavfsiz kanal orqali xodimga yetkazing.</b> Sahifa yangilangach parol qayta ko\'rinmaydi.</div>';
    document.getElementById("tibexPwdFoot").innerHTML =
      '<button class="tibex-pwd-btn primary" data-pwd-close-foot>✓ Tushunarli</button>';
    document.querySelector("[data-pwd-close-foot]").addEventListener("click", () => _closeModal());
    document.getElementById("tibexPwdCopyBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(r.new_password);
        const btn = document.getElementById("tibexPwdCopyBtn");
        btn.textContent = "✓ Nusxa olindi";
        setTimeout(() => btn.textContent = "📋 Nusxa olish", 1500);
      } catch (_) {
        const el = document.getElementById("tibexPwdResultCode");
        const range = document.createRange();
        range.selectNode(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      }
    });
  }

  function _injectTopbarButton() {
    const topbar = document.querySelector(".topbar");
    if (!topbar || topbar.querySelector("[data-tibex-pwd-btn]")) return;
    const u = window.TIBEX_STORE?.CURRENT_USER;
    const changes = u?.password_change_count || 0;
    const counterCls = "ok";
    const btn = document.createElement("button");
    btn.setAttribute("data-tibex-pwd-btn", "1");
    btn.title = "Parolni almashtirish (soatiga ko'pi bilan " + MAX_CHANGES_PER_HOUR + " marta)";
    btn.style.cssText = "display:flex;align-items:center;gap:6px;position:relative;";
    btn.innerHTML = '🔑 Parol <span class="tibex-pwd-counter ' + counterCls + '" style="font-size:10px;padding:2px 6px;">' + changes + '</span>';
    btn.addEventListener("click", _openModal);
    btn.type = "button";
    // Standart tartib: ⚙️ Sozlamalar → 🔑 Parol → 🚪 Chiqish
    const set = topbar.querySelector("[data-tibex-set-btn]");
    const out = topbar.querySelector("#btnLogout, button[title='Chiqish']");
    const spacer = topbar.querySelector(".spacer");
    if (set) set.parentNode.insertBefore(btn, set.nextSibling);
    else if (out) topbar.insertBefore(btn, out);
    else if (spacer) spacer.parentNode.insertBefore(btn, spacer.nextSibling);
    else topbar.appendChild(btn);
  }

  function _injectAdminResetButtons() {
    if (!document.querySelector('[data-view="users"]')) return;
    const usersBody = document.getElementById("usersBody");
    if (!usersBody) return;
    document.querySelectorAll('#usersBody tr').forEach(tr => {
      const actions = tr.querySelector(".row-actions");
      if (!actions || actions.querySelector("[data-tibex-admin-reset]")) return;
      const userId = parseInt(tr.dataset.id);
      if (!userId || userId < 0) return;
      const userName = tr.querySelector("td:nth-child(2)")?.textContent?.trim() || "—";
      const btn = document.createElement("button");
      btn.setAttribute("data-tibex-admin-reset", userId);
      btn.title = "Admin parol reset";
      btn.textContent = "🔑";
      btn.style.cssText = "background:transparent;border:1px solid #dde3e8;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:11px;";
      btn.addEventListener("click", (e) => { e.stopPropagation(); _adminReset(userId, userName); });
      actions.appendChild(btn);
    });
  }

  function _watchUsersTable() {
    const t = document.getElementById("usersBody");
    if (!t) return;
    const obs = new MutationObserver(() => _injectAdminResetButtons());
    obs.observe(t, { childList: true, subtree: true });
  }

  function _waitForStore() {
    if (window.TIBEX_STORE && window.TIBEX_STORE.CURRENT_USER) {
      _bind();
    } else {
      setTimeout(_waitForStore, 200);
    }
  }

  function _bind() {
    if (_bound) return;
    _bound = true;
    _buildModal();
    // TIBEX_DEDUPE: disabled — admin.html'da allaqachon 🔑 tugma bor
    // _injectAdminResetButtons();
    // _watchUsersTable();
    console.log("[TIBEX] Password UI v2 tayyor (dedupe)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _waitForStore);
  } else {
    _waitForStore();
  }

  // ─── Global API ───
  window.TIBEX_PWD = {
    open: _openModal,
    adminReset: _adminReset,
    MAX_CHANGES: MAX_CHANGES_PER_HOUR
  };

  // ─── Eski admin.html mosligi (eski 🔑 tugmalari uchun) ───
  window.openResetPwdModal = function (id) {
    const u = window.TIBEX_STORE?.getUsers?.()?.find?.(x => x.id === id);
    if (u) _adminReset(id, u.fullname || u.login);
    else _adminReset(id, "Foydalanuvchi #" + id);
  };
})();
