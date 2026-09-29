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

  // ─── CSS ───
  function _injectCSS() {
    if (document.getElementById("tibex-pwd-css")) return;
    const s = document.createElement("style");
    s.id = "tibex-pwd-css";
    s.textContent = `
      .tibex-pwd-backdrop{position:fixed;inset:0;background:rgba(12,23,41,.6);display:none;align-items:center;justify-content:center;z-index:99998;padding:20px;font-family:-apple-system,"Segoe UI",Roboto,sans-serif}
      .tibex-pwd-backdrop.show{display:flex}
      .tibex-pwd-modal{background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);width:100%;max-width:520px;overflow:hidden;animation:tibexPwdIn .2s}
      @keyframes tibexPwdIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
      .tibex-pwd-head{padding:16px 20px;border-bottom:1px solid #dde3e8;display:flex;justify-content:space-between;align-items:center}
      .tibex-pwd-head h3{font-size:15px;font-weight:700;color:#1a2332;margin:0;display:flex;align-items:center;gap:8px}
      .tibex-pwd-head .x{background:transparent;border:none;font-size:20px;color:#64748b;cursor:pointer;padding:4px 8px;border-radius:6px}
      .tibex-pwd-head .x:hover{background:#f1f5f9;color:#dc2626}
      .tibex-pwd-body{padding:20px;color:#1a2332;font-size:14px}
      .tibex-pwd-foot{padding:14px 20px;border-top:1px solid #dde3e8;display:flex;justify-content:flex-end;gap:8px;background:#f8fafc}
      .tibex-pwd-field{margin-bottom:14px}
      .tibex-pwd-field label{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px}
      .tibex-pwd-field input{width:100%;border:1px solid #dde3e8;border-radius:6px;padding:10px 12px;font-family:inherit;font-size:14px;color:#1a2332;background:#fff;box-sizing:border-box}
      .tibex-pwd-field input:focus{outline:none;border-color:#1e40af;box-shadow:0 0 0 3px rgba(30,64,175,.12)}
      .tibex-pwd-btn{padding:9px 16px;border-radius:6px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;border:1px solid #dde3e8;background:#fff;color:#1a2332}
      .tibex-pwd-btn:hover{border-color:#1e40af;color:#1e40af}
      .tibex-pwd-btn.primary{background:#1e40af;color:#fff;border-color:#1e40af}
      .tibex-pwd-btn.primary:hover{background:#1e3a8a}
      .tibex-pwd-btn.danger{background:#dc2626;color:#fff;border-color:#dc2626}
      .tibex-pwd-btn.danger:hover{background:#991b1b}
      .tibex-pwd-btn:disabled{opacity:.55;cursor:not-allowed}
      .tibex-pwd-strength{height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden;margin-top:6px}
      .tibex-pwd-strength .fill{height:100%;width:0;transition:all .2s}
      .tibex-pwd-strength .fill.low{width:33%;background:#dc2626}
      .tibex-pwd-strength .fill.mid{width:66%;background:#b45309}
      .tibex-pwd-strength .fill.high{width:100%;background:#15803d}
      .tibex-pwd-hint{font-size:11px;color:#94a3b8;margin-top:4px}
      .tibex-pwd-msg{padding:10px 12px;border-radius:6px;font-size:12.5px;margin-bottom:14px}
      .tibex-pwd-msg.err{background:#fef2f2;color:#991b1b;border-left:3px solid #dc2626}
      .tibex-pwd-msg.ok{background:#dcfce7;color:#166534;border-left:3px solid #15803d}
      .tibex-pwd-msg.warn{background:#fffbeb;color:#92400e;border-left:3px solid #b45309}
      .tibex-pwd-pwdbox{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:12px;margin:12px 0;text-align:center}
      .tibex-pwd-pwdbox .code{font-family:ui-monospace,monospace;font-size:18px;font-weight:700;letter-spacing:2px;color:#1e40af;user-select:all;word-break:break-all;padding:8px 0}
      .tibex-pwd-btn-mini{background:transparent;border:1px solid #dde3e8;padding:4px 8px;border-radius:5px;font-family:inherit;font-size:11px;color:#64748b;cursor:pointer;font-weight:500}
      .tibex-pwd-btn-mini:hover{border-color:#1e40af;color:#1e40af;background:#dbeafe}
      .tibex-pwd-counter{font-size:11px;padding:3px 8px;border-radius:10px;font-weight:700;font-family:ui-monospace,monospace}
      .tibex-pwd-counter.ok{background:#dcfce7;color:#166534}
      .tibex-pwd-counter.warn{background:#fffbeb;color:#92400e}
      .tibex-pwd-counter.bad{background:#fef2f2;color:#991b1b}
    `;
    document.head.appendChild(s);
  }

  function _buildModal() {
    if (_modalEl) return;
    _injectCSS();
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
    const spacer = topbar.querySelector(".spacer");
    if (spacer) spacer.parentNode.insertBefore(btn, spacer.nextSibling);
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
