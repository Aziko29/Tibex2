/* =====================================================================
 * TIBEX Bemor kabineti — faqat /api/portal/* endpointlari orqali ishlaydi.
 * Bu endpointlar backendda `_require_patient` bilan qulflangan: role_key
 * "patient" bo'lmasa 403, va barcha so'rovlar user.patient_id bo'yicha
 * avtomatik filtrlanadi (boshqa bemor ma'lumotiga yo'l yo'q).
 * ===================================================================== */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const esc = window.esc;

  function toast(msg, type) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show " + (type || "");
    setTimeout(() => { el.className = "toast"; }, 3000);
  }

  function fmtDate(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    return d.toLocaleDateString("uz-UZ") + " " + d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  }
  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("uz-UZ");
  }

  const STATUS_LABELS = {
    waiting: "⏳ Kutmoqda", arrived: "👋 Keldi", in_progress: "🩺 Qabulda",
    lab_waiting: "🔬 Lab kutish", lab_ready: "✅ Lab tayyor", completed: "✓ Yakun",
    new: "🆕 Yangi", processing: "⏳ Jarayonda", verified: "✅ Tasdiqlangan",
    paid: "✓ To'landi", pending: "⏳ Kutilmoqda", refunded: "↩ Qaytarildi",
  };
  function statusLabel(s) { return STATUS_LABELS[s] || s || "—"; }

  // ─── Tab navigatsiyasi ───
  $$(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      $$(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.viewContent === view));
    });
  });

  // ─── Modal ochish/yopish ───
  document.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => b.closest(".modal-backdrop").classList.remove("open"))
  );

  let PATIENT = null;

  async function loadProfile() {
    PATIENT = await window.TIBEX_STORE._api("/api/portal/me");
    $("#sbUserName").textContent = PATIENT.fullname || "—";
    $("#sbAvatar").textContent = (PATIENT.fullname || "?").split(" ").slice(0, 2).map(s => s[0] || "").join("").toUpperCase();
    $("#pfFullname").textContent = PATIENT.fullname || "—";
    $("#pfPhone").textContent = PATIENT.phone || "—";
    $("#pfAge").textContent = PATIENT.age ?? "—";
    $("#pfGender").textContent = PATIENT.gender || "—";
    $("#pfBlood").textContent = PATIENT.blood || "—";
    $("#pfAddress").textContent = PATIENT.address || "—";
    $("#pfAllergies").textContent = (PATIENT.allergies || []).join(", ") || "Yo'q";
    $("#pfChronic").textContent = (PATIENT.chronic || []).join(", ") || "Yo'q";
  }

  async function loadSummary() {
    const s = await window.TIBEX_STORE._api("/api/portal/summary");
    $("#statAppt").textContent = s.appointments_count;
    $("#statLab").textContent = s.lab_orders_count;
    $("#statDebt").textContent = fmtMoney(s.total_debt);
    $("#sbAppt").textContent = s.appointments_count;
    $("#sbLab").textContent = s.lab_orders_count;
    $("#sbPaid").textContent = fmtMoney(s.total_paid);
    $("#sbDebt").textContent = fmtMoney(s.total_debt);
    $("#ovAppt").textContent = s.appointments_count;
    $("#ovLab").textContent = s.lab_orders_count;
    $("#ovPaid").textContent = fmtMoney(s.total_paid);
    $("#ovDebt").textContent = fmtMoney(s.total_debt);
  }

  async function loadAppointments() {
    const rows = await window.TIBEX_STORE._api("/api/portal/appointments");
    $("#apptCount").textContent = rows.length;
    $("#tabApptBadge").textContent = rows.length;

    $("#apptBody").innerHTML = rows.map((a) => `
      <tr>
        <td>${esc(a.date || "—")}</td>
        <td>${esc(a.scheduled_time || "—")}</td>
        <td>${esc(a.doctor_name || "—")}</td>
        <td>${esc(a.service || "—")}</td>
        <td>${esc(statusLabel(a.status))}</td>
        <td>${esc(a.final_dx || a.prelim_dx || "—")}</td>
        <td>${a.paid ? "✓" : "—"}</td>
        <td>${a.debt ? fmtMoney(a.debt) : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="8" class="text-muted text-center">Tashriflar yo'q</td></tr>`;

    $("#recentApptBody").innerHTML = rows.slice(0, 5).map((a) => `
      <tr>
        <td>${esc(a.date || "—")}</td>
        <td>${esc(a.doctor_name || "—")}</td>
        <td>${esc(a.service || "—")}</td>
        <td>${esc(statusLabel(a.status))}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="text-muted text-center">Tashriflar yo'q</td></tr>`;
  }

  async function loadLabs() {
    const rows = await window.TIBEX_STORE._api("/api/portal/lab-orders");
    $("#labCount").textContent = rows.length;
    $("#tabLabBadge").textContent = rows.length;
    $("#labBody").innerHTML = rows.map((o) => `
      <tr>
        <td>${esc(o.test_name || "—")}</td>
        <td>${esc(statusLabel(o.status))}</td>
        <td>${esc(o.result_summary || "—")}</td>
        <td>${fmtDate(o.verified_at)}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="text-muted text-center">Lab natijalar yo'q</td></tr>`;
  }

  async function loadPayments() {
    const rows = await window.TIBEX_STORE._api("/api/portal/payments");
    $("#paymentCount").textContent = rows.length;
    $("#paymentBody").innerHTML = rows.map((p) => `
      <tr>
        <td>${fmtDate(p.created_at)}</td>
        <td>${fmtMoney(p.amount)}</td>
        <td>${esc(p.method || "—")}</td>
        <td>${esc(statusLabel(p.status))}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="text-muted text-center">To'lovlar yo'q</td></tr>`;
  }

  async function renderAll() {
    await Promise.all([loadProfile(), loadSummary(), loadAppointments(), loadLabs(), loadPayments()]);
  }

  // ─── Profilni tahrirlash ───
  $("#btnEditProfile").addEventListener("click", () => {
    $("#editPhone").value = PATIENT.phone || "+998 ";
    $("#editAddress").value = PATIENT.address || "";
    window.tibexOpenModal("modalEditProfile");
  });

  $("#btnSaveProfile").addEventListener("click", async () => {
    const btn = $("#btnSaveProfile");
    btn.disabled = true;
    try {
      await window.TIBEX_STORE._api("/api/portal/me", {
        method: "PATCH",
        body: { phone: $("#editPhone").value.trim(), address: $("#editAddress").value.trim() },
      });
      window.tibexCloseModal("modalEditProfile");
      toast("Profil yangilandi", "ok");
      await loadProfile();
    } catch (e) {
      toast("Xatolik: " + (e.message || "noma'lum"), "bad");
    } finally {
      btn.disabled = false;
    }
  });

  // ─── Telegram ulash ───
  let tgPollTimer = null;

  async function loadTelegramStatus() {
    try {
      const s = await window.TIBEX_STORE._api("/api/portal/telegram/status");
      $("#tgNotConfigured").style.display = s.available ? "none" : "block";
      $("#tgLinked").style.display = s.available && s.linked ? "block" : "none";
      $("#tgUnlinked").style.display = s.available && !s.linked ? "block" : "none";
      if (s.linked && tgPollTimer) {
        clearInterval(tgPollTimer);
        tgPollTimer = null;
        $("#tgLinkBox").style.display = "none";
        toast("Telegram ulandi!", "ok");
      }
      return s;
    } catch (e) {
      console.error("[BEMOR] telegram status xatosi:", e);
    }
  }

  $("#btnTgLink")?.addEventListener("click", async () => {
    const btn = $("#btnTgLink");
    btn.disabled = true;
    try {
      const info = await window.TIBEX_STORE._api("/api/telegram/bot-info");
      if (!info.configured || !info.username) throw new Error("Telegram bot sozlanmagan");
      const link = `https://t.me/${encodeURIComponent(info.username.replace(/^@/, ""))}?start`;
      $("#tgLinkBox").style.display = "block";
      window.open(link, "_blank", "noopener");
      if (tgPollTimer) clearInterval(tgPollTimer);
      tgPollTimer = setInterval(loadTelegramStatus, 3000);
    } catch (e) {
      toast("Xatolik: " + (e.message || "noma'lum"), "bad");
    } finally {
      btn.disabled = false;
    }
  });

  $("#btnTgRefreshStatus")?.addEventListener("click", loadTelegramStatus);

  $("#btnTgUnlink")?.addEventListener("click", async () => {
    const btn = $("#btnTgUnlink");
    btn.disabled = true;
    try {
      await window.TIBEX_STORE._api("/api/portal/telegram/unlink", { method: "POST" });
      toast("Telegram uzildi", "ok");
      await loadTelegramStatus();
    } catch (e) {
      toast("Xatolik: " + (e.message || "noma'lum"), "bad");
    } finally {
      btn.disabled = false;
    }
  });

  // ─── Init ───
  (async function init() {
    try {
      await window.TIBEX_STORE.init();
      const role = window.TIBEX_STORE.ROLE;
      if (role !== "patient") {
        // Xodim shu sahifaga tushib qolsa — o'z konsoliga qaytariladi.
        location.href = "/login.html";
        return;
      }
      await renderAll();
      await loadTelegramStatus();
    } catch (e) {
      console.error("[BEMOR] init xatosi:", e);
      if (String(e.message) !== "UNAUTHORIZED") {
        toast("Ma'lumotlarni yuklab bo'lmadi: " + (e.message || "noma'lum"), "bad");
      }
    }
  })();
})();
