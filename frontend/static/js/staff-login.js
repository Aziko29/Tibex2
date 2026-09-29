/* ================================================================
 * TIBEX — Xodim uchun login sahifasi (login.html)
 * Faqat login/parol orqali kirish. Bemor uchun alohida sahifa:
 * bemor-login.html (u yerda faqat OTP oqimi ishlaydi).
 * ================================================================ */

const $ = (sel) => document.querySelector(sel);

// ─── API base: sahifa joylashuviga qarab ───
// TIBEX_API_BASE_FIX_v1: bu HAMMA sahifada (login va dashboard) bir xil
// mantiq bilan hisoblanishi SHART — aks holda login sahifasi bitta hostga
// cookie o'rnatadi, dashboard esa boshqa hostga so'rov yuboradi va cookie
// hech qachon yetib bormaydi.
window.__API_BASE__ = (() => {
  const loc = window.location;
  if (loc.port === "8000" || loc.port === "" || loc.port === "443" || loc.port === "80") {
    return "";
  }
  return loc.protocol + "//" + loc.hostname + ":8000";
})();

const esc = window.esc;

function showAlert(id, msg, type = "error") {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<span>${esc(type === "error" ? "⚠️" : type === "success" ? "✓" : "ℹ️")}</span><span>${esc(msg)}</span>`;
  el.className = `alert show ${type}`;
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle("loading", loading);
}

// Rolga qarab yo'naltirish (xodim rollari + bemor — sessiya bemorniki
// bo'lib chiqsa ham to'g'ri konsolga yuboramiz).
const ROLE_DEST = {
  admin:     "admin.html",
  doctor:    "shifokor.html",
  reception: "qabulxona.html",
  cashier:   "kassa.html",
  lab:       "labaratoriya.html",
  patient:   "bemor.html",
};

// ═══════════════════════════════════════════════════════════════
// XODIM LOGIN (login/parol)
// ═══════════════════════════════════════════════════════════════

$("#staffForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const login = $("#staffLogin").value.trim();
  const password = $("#staffPassword").value;
  if (!login || !password) return;

  const btn = $("#staffSubmit");
  setLoading(btn, true);

  try {
    const r = await fetch(`${window.__API_BASE__}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: login, password }),
    });

    if (!r.ok) {
      let msg = "Login yoki parol xato";
      try { msg = (await r.json()).detail || msg; } catch (_) {}
      throw new Error(msg);
    }

    const data = await r.json();

    // Bemor hisobi bu yerdan (xodim sahifasidan) kira olmaydi — bemorlar
    // faqat bemor-login.html orqali, telefon+SMS bilan kiradi.
    if (data.user.role === "patient") {
      showAlert("staffAlert", "Bemorlar bu sahifadan kira olmaydi. \"Bemorman\" havolasidan foydalaning.");
      setLoading(btn, false);
      // Xavfsizlik uchun — tasodifan ochilgan bemor sessiyasini yopamiz.
      fetch(`${window.__API_BASE__}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
      return;
    }

    showAlert("staffAlert", `Xush kelibsiz, ${esc(data.user.fullname)}!`, "success");
    const dest = ROLE_DEST[data.user.role] || "admin.html";
    setTimeout(() => { window.location.href = dest; }, 400);
  } catch (err) {
    showAlert("staffAlert", err.message || "Kirishda xatolik");
    setLoading(btn, false);
  }
});

// ═══════════════════════════════════════════════════════════════
// SAHIFA YUKLANGANDA — agar sessiya bor bo'lsa, yo'naltirish
// ═══════════════════════════════════════════════════════════════
(async () => {
  try {
    const r = await fetch(`${window.__API_BASE__}/api/auth/me`, { credentials: "include" });
    if (r.ok) {
      const user = await r.json();
      window.location.href = ROLE_DEST[user.role] || "admin.html";
    }
  } catch (_) {
    // Sessiya yo'q — login formani ko'rsatamiz
  }
})();
