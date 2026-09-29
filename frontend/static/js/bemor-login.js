/* ================================================================
 * TIBEX — Bemor uchun login sahifasi (bemor-login.html)
 * Bemor Telegram OTP yoki admin bergan bir martalik kod bilan kiradi. Backendda
 * /api/otp/* endpointlari faqat ro'yxatdan o'tgan bemor telefon
 * raqamlari uchun ishlaydi — boshqa hech kim (jumladan xodimlar)
 * shu yo'l bilan sessiya oча olmaydi.
 * ================================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

window.__API_BASE__ = (() => {
  const loc = window.location;
  if (loc.port === "8000" || loc.port === "" || loc.port === "443" || loc.port === "80") {
    return "";
  }
  return loc.protocol + "//" + loc.hostname + ":8000";
})();

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function showAlert(id, msg, type = "error") {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<span>${esc(type === "error" ? "⚠️" : type === "success" ? "✓" : "ℹ️")}</span><span>${esc(msg)}</span>`;
  el.className = `alert show ${type}`;
}
function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.className = "alert";
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle("loading", loading);
}

// Xodim rollari uchun manzillar — agar bu sahifaga xodim sessiyasi bilan
// kirib qolsa, o'z konsoliga qaytariladi (bemor OTP oqimidan foydalana
// olmaydi).
const ROLE_DEST = {
  admin:     "admin.html",
  doctor:    "shifokor.html",
  reception: "qabulxona.html",
  cashier:   "kassa.html",
  lab:       "labaratoriya.html",
  patient:   "bemor.html",
};

// ═══════════════════════════════════════════════════════════════
// BEMOR OTP (Telegram yoki admin bergan bir martalik kod)
// ═══════════════════════════════════════════════════════════════

let otpPhone = "";
let otpCountdownTimer = null;
let otpExpireAt = 0;

function goToOtpStep(step) {
  $("#otpStepPhone").classList.toggle("active", step === "phone");
  $("#otpStepCode").classList.toggle("active", step === "code");
  if (step === "code") {
    const inputs = $$("#otpInputs input");
    inputs.forEach((i) => { i.value = ""; i.classList.remove("filled"); });
    inputs[0]?.focus();
  } else {
    stopCountdown();
  }
}

function startCountdown(seconds) {
  stopCountdown();
  otpExpireAt = Date.now() + seconds * 1000;

  const el = $("#otpCountdown");
  const tick = () => {
    const left = Math.max(0, Math.floor((otpExpireAt - Date.now()) / 1000));
    const m = String(Math.floor(left / 60)).padStart(2, "0");
    const s = String(left % 60).padStart(2, "0");
    el.textContent = `${m}:${s}`;
    el.className = "countdown" + (left === 0 ? " expired" : left < 60 ? " warn" : "");
    if (left === 0) {
      stopCountdown();
      $("#otpVerifyBtn").disabled = true;
    }
  };
  tick();
  otpCountdownTimer = setInterval(tick, 1000);
}

function stopCountdown() {
  if (otpCountdownTimer) clearInterval(otpCountdownTimer);
  otpCountdownTimer = null;
}

// OTP inputlarni boshqarish
$$("#otpInputs input").forEach((input, idx, arr) => {
  input.addEventListener("input", (e) => {
    const digits = e.target.value.replace(/\D/g, "");

    // iOS/Android SMS-kodni avtomatik taklif qilganda (QuickType/
    // autofill) ba'zi brauzerlar butun kodni bitta inputga "input"
    // hodisasi orqali qo'yadi (paste emas) — shuni barcha kataklarga
    // tarqatamiz, aks holda faqat 1-xonasi qolib, qolgani yo'qolardi.
    if (digits.length > 1) {
      arr.forEach((inp, i) => {
        inp.value = digits[i] || "";
        inp.classList.toggle("filled", !!inp.value);
      });
      arr[Math.min(digits.length, arr.length) - 1].focus();
      if (arr.every((x) => x.value)) setTimeout(() => $("#otpVerifyBtn").click(), 100);
      return;
    }

    e.target.value = digits.slice(0, 1);
    e.target.classList.toggle("filled", !!e.target.value);
    if (e.target.value && idx < arr.length - 1) arr[idx + 1].focus();
    if (arr.every((x) => x.value)) setTimeout(() => $("#otpVerifyBtn").click(), 100);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !e.target.value && idx > 0) {
      arr[idx - 1].focus();
      arr[idx - 1].value = "";
      arr[idx - 1].classList.remove("filled");
    }
    if (e.key === "ArrowLeft" && idx > 0) arr[idx - 1].focus();
    if (e.key === "ArrowRight" && idx < arr.length - 1) arr[idx + 1].focus();
  });

  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
    if (text.length >= 6) {
      arr.forEach((inp, i) => {
        inp.value = text[i] || "";
        inp.classList.toggle("filled", !!inp.value);
      });
      arr[5].focus();
      setTimeout(() => $("#otpVerifyBtn").click(), 100);
    }
  });
});

// Kirish kodi so'rash — backend kodni faqat Telegramga yuboradi; SMS fallback yo'q.
$("#otpSendBtn").addEventListener("click", async () => {
  hideAlert("patientAlert");
  const phone = $("#patientPhone").value.trim();
  if (!phone) return;

  const btn = $("#otpSendBtn");
  setLoading(btn, true);

  try {
    const r = await fetch(`${window.__API_BASE__}/api/otp/request`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });

    if (!r.ok) {
      let msg = "Xatolik";
      try { msg = (await r.json()).detail || msg; } catch (_) {}
      throw new Error(msg);
    }

    const data = await r.json();
    otpPhone = phone;
    $("#otpSentPhone").textContent = phone;

    showAlert("patientAlert", "Agar bemor akkaunti Telegram botga ulangan bo'lsa, kod botga yuboriladi. Admin bergan kod bo'lsa, uni kiriting.", "info");
    goToOtpStep("code");
    startCountdown(data.ttl_seconds || 300);
  } catch (err) {
    showAlert("patientAlert", err.message || "Telegram kodini so'rashda xatolik");
  } finally {
    setLoading(btn, false);
  }
});

// Kodni tasdiqlash
$("#otpVerifyBtn").addEventListener("click", async () => {
  hideAlert("patientAlert");
  const code = Array.from($$("#otpInputs input")).map((i) => i.value).join("");
  if (code.length !== 6) {
    showAlert("patientAlert", "6 xonali kodni to'liq kiriting");
    return;
  }

  const btn = $("#otpVerifyBtn");
  setLoading(btn, true);

  try {
    const r = await fetch(`${window.__API_BASE__}/api/otp/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: otpPhone, code }),
    });

    if (!r.ok) {
      let msg = "Kod xato";
      try { msg = (await r.json()).detail || msg; } catch (_) {}
      throw new Error(msg);
    }

    const data = await r.json();
    stopCountdown();
    showAlert("patientAlert", `Xush kelibsiz, ${esc(data.user.fullname)}!`, "success");
    setTimeout(() => { window.location.href = "bemor.html"; }, 400);
  } catch (err) {
    showAlert("patientAlert", err.message || "Kodni tekshirishda xatolik");
    $$("#otpInputs input").forEach((i) => { i.value = ""; i.classList.remove("filled"); });
    $$("#otpInputs input")[0]?.focus();
    setLoading(btn, false);
  }
});

// Orqaga (telefon raqamga qaytish)
$("#otpBackBtn").addEventListener("click", () => {
  hideAlert("patientAlert");
  goToOtpStep("phone");
});

// Telefon input: avtomatik formatlash
$("#patientPhone").addEventListener("input", (e) => {
  let v = e.target.value.replace(/[^\d+]/g, "");
  if (v && !v.startsWith("+")) v = "+" + v;
  e.target.value = v;
});

// ═══════════════════════════════════════════════════════════════
// SAHIFA YUKLANGANDA — agar sessiya bor bo'lsa, yo'naltirish.
// Bemor bo'lsa — kabinetiga; xodim bo'lib qolsa — o'z konsoliga
// (bu sahifa faqat bemorlar uchun, xodim shu yerda "kirmaydi").
// ═══════════════════════════════════════════════════════════════
(async () => {
  try {
    const r = await fetch(`${window.__API_BASE__}/api/auth/me`, { credentials: "include" });
    if (r.ok) {
      const user = await r.json();
      window.location.href = ROLE_DEST[user.role] || "login.html";
    }
  } catch (_) {
    // Sessiya yo'q — OTP formani ko'rsatamiz
  }
})();

// Bot nomi server sozlamasidan olinadi; token hech qachon brauzerga berilmaydi.
(async () => {
  const link = document.getElementById("patientTelegramLink");
  if (!link) return;
  try {
    const response = await fetch(`${window.__API_BASE__}/api/telegram/bot-info`);
    if (!response.ok) return;
    const info = await response.json();
    if (info.configured && info.username) {
      link.href = `https://t.me/${encodeURIComponent(info.username.replace(/^@/, ""))}?start`;
      link.hidden = false;
    }
  } catch (_) {}
})();
