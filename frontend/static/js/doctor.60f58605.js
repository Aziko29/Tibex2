/* ===== block_0 ===== */
/* ═══ TIBEX DOCTOR CONSOLE v3 ═══ */
const state = {
  currentView: "queue",
  queueFilter: "all",
  labFilter: "all",
  currentAppt: null,
  allergies: [],
  chronic: []
};

function toast(msg, type="ok") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast " + type + " show";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3000);
}

/* TIBEX_FMTMONEY_SOM_v1 */
function fmtMoney(n) {
  return (n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + " so'm";
}
function initials(name) { return (name || "?").split(" ").slice(0, 2).map(s => s[0] || "").join("").toUpperCase(); }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

function statusLabel(s) {
  return { waiting: "Kutmoqda", arrived: "Keldi", in_progress: "Qabulda",
    lab_waiting: "🔬 Lab", lab_ready: "✅ Lab tayyor",
    completed: "Yakunlangan", cancelled: "Bekor" }[s] || s;
}
function priorityLabel(p) { return { normal: "Oddiy", urgent: "Shosh", stat: "STAT" }[p] || p; }

/* ═══ MY APPOINTMENTS ═══ */
function myAppointments(dateStr) {
  const u = TIBEX_STORE.CURRENT_USER || {};
  const doctorId = u.doctor_id;
  let appts = TIBEX_STORE.getAppointments();
  if (doctorId) appts = appts.filter(a => a.doctor_id === doctorId);
  if (dateStr) appts = appts.filter(a => a.date === dateStr);
  return appts;
}

/* ═══ QUEUE ═══ */
function renderQueue() {
  const t = today();
  let appts = myAppointments(t);
  const all = appts.length;
  const waiting = appts.filter(a => a.status === "waiting").length;
  const arrived = appts.filter(a => a.status === "arrived").length;
  const inProg = appts.filter(a => a.status === "in_progress").length;
  const labWaiting = appts.filter(a => a.status === "lab_waiting").length;
  const labReady = appts.filter(a => a.status === "lab_ready").length;
  const lab = labWaiting + labReady;
  const done = appts.filter(a => a.status === "completed").length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("statToday", all);
  set("statWaiting", waiting + arrived);
  set("statInProgress", inProg + lab);
  set("statDone", done);
  set("queueCount", all);
  set("tabQueueBadge", waiting + arrived + inProg);
  set("qfAll", all);
  set("qfWaiting", waiting);
  set("qfArrived", arrived);
  set("qfInProg", inProg);
  set("qfLab", lab);
  set("qfLabWaiting", labWaiting);
  set("qfLabReady", labReady);
  set("qfDone", done);

  if (state.queueFilter === "waiting") appts = appts.filter(a => a.status === "waiting");
  else if (state.queueFilter === "arrived") appts = appts.filter(a => a.status === "arrived");
  else if (state.queueFilter === "in_progress") appts = appts.filter(a => a.status === "in_progress");
  else if (state.queueFilter === "lab") appts = appts.filter(a => a.status === "lab_waiting" || a.status === "lab_ready");
  else if (state.queueFilter === "lab_waiting") appts = appts.filter(a => a.status === "lab_waiting");
  else if (state.queueFilter === "lab_ready") appts = appts.filter(a => a.status === "lab_ready");
  else if (state.queueFilter === "completed") appts = appts.filter(a => a.status === "completed");

  const q = (document.getElementById("queueSearch")?.value || "").toLowerCase();
  if (q) {
    appts = appts.filter(a => {
      const p = TIBEX_STORE.getPatient(a.patient_id);
      if (!p) return false;
      return p.fullname.toLowerCase().includes(q) || (p.phone || "").includes(q);
    });
  }

  appts.sort((a,b) => (a.scheduled_time || "").localeCompare(b.scheduled_time || ""));

  const html = appts.map(a => {
    const p = TIBEX_STORE.getPatient(a.patient_id);
    if (!p) return "";
    const isUrgent = a.priority === "urgent" || a.priority === "stat";
    let actions = '';
    if (a.status === "waiting") actions = '<button data-act="arrive" class="success">✓ Keldi</button>';
    else if (a.status === "arrived") actions = '<button data-act="start" class="success">▶ Boshlash</button>';
    else if (a.status === "in_progress") actions = '<button data-act="open">🩺 Davom</button>';
    else if (a.status === "lab_waiting") actions = '<button data-act="open">🔬 Kutish</button>';
    else if (a.status === "lab_ready") actions = '<button data-act="open" class="success">▶ Davom ettirish</button>';
    else if (a.status === "completed") actions = '<button data-act="view">👁 Ko\'rish</button>';
    actions += '<button data-act="history">📋 Tarix</button>';

    return `<tr data-id="${a.id}">
      <td class="time-col">${esc(a.scheduled_time || "—")}</td>
      <td>${isUrgent ? `<span class="priority-badge ${escAttr(a.priority)}">${esc(priorityLabel(a.priority))}</span>` : "—"}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">
        <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;">${esc(initials(p.fullname))}</div>
        <div><div style="font-weight:600;">${esc(p.fullname)}</div><div style="font-size:11px;color:var(--dim);">#${p.id} · ${p.age} yosh · ${esc(p.phone || "")}</div></div>
      </div></td>
      <td style="font-size:12px;">${esc(a.service?.name || "—")}</td>
      <td><span class="status ${escAttr(a.status)}">${esc(statusLabel(a.status))}</span></td>
      <td><div class="row-actions">${actions}</div></td>
    </tr>`;
  }).join("");

  const body = document.getElementById("queueBody");
  if (body) body.innerHTML = html || '<tr><td colspan="6" class="empty"><div class="big">📋</div>Navbat yo\'q</td></tr>';

  document.querySelectorAll("#queueBody button[data-act]").forEach(b => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(b.closest("tr").dataset.id);
      const act = b.dataset.act;
      if (act === "arrive") {
        TIBEX_STORE.updateAppointment(id, { status: "arrived" });
        toast("✓ Keldi belgilandi", "ok");
        renderAll();
      } else if (act === "start") {
        TIBEX_STORE.updateAppointment(id, { status: "in_progress" });
        toast("▶ Qabul boshlandi", "info");
        openVisit(id);
      } else if (act === "open") {
        openVisit(id);
      } else if (act === "view") {
        openVisit(id, true);
      } else if (act === "history") {
        openPatientHistory(id);
      }
    });
  });
}

/* ═══ TODAY ═══ */
function renderToday() {
  const t = today();
  const appts = myAppointments(t);
  const payments = TIBEX_STORE.getPayments().filter(p => {
    const d = new Date(p.created_at);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` === t;
  });
  const total = payments.reduce((s,p) => s + p.amount, 0);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set("ovTotal", appts.length);
  set("ovWaiting", appts.filter(a => a.status === "waiting" || a.status === "arrived").length);
  set("ovInProg", appts.filter(a => a.status === "in_progress" || a.status === "lab_waiting" || a.status === "lab_ready").length);
  set("ovDone", appts.filter(a => a.status === "completed").length);
  set("ovRevenue", fmtMoney(total));

  const hourOf = a => parseInt((a.scheduled_time || "12:00").split(":")[0]);
  set("ovMorning", appts.filter(a => hourOf(a) < 12).length);
  set("ovAfternoon", appts.filter(a => hourOf(a) >= 12 && hourOf(a) < 17).length);
  set("ovEvening", appts.filter(a => hourOf(a) >= 17).length);
}

/* ═══ PATIENTS (my patients) ═══ */
function renderPatients() {
  const q = (document.getElementById("patientsSearch")?.value || "").toLowerCase();
  const myAppts = myAppointments();
  const patientIds = new Set(myAppts.map(a => a.patient_id));
  let patients = TIBEX_STORE.getAllPatients().filter(p => patientIds.has(p.id));

  if (q) {
    patients = patients.filter(p =>
      p.fullname.toLowerCase().includes(q) ||
      (p.phone || "").includes(q) ||
      String(p.id).includes(q)
    );
  }
  patients.sort((a,b) => b.id - a.id);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("patientsCount", patients.length);

  const html = patients.map(p => {
    const cnt = myAppts.filter(a => a.patient_id === p.id).length;
    return `<tr data-id="${p.id}">
      <td class="time-col">#${p.id}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">
        <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;">${esc(initials(p.fullname))}</div>
        <div><div style="font-weight:600;">${esc(p.fullname)}</div>${(p.allergies||[]).length ? `<div style="font-size:11px;color:var(--danger);">⚠ ${esc(p.allergies.join(", "))}</div>` : ''}</div>
      </div></td>
      <td class="mono">${esc(p.phone || "—")}</td>
      <td class="mono">${p.age}</td>
      <td>${p.gender === "Erkak" ? "👨" : "👩"}</td>
      <td class="mono">${cnt}</td>
      <td><div class="row-actions">
        <button data-act="history">📋 Tarix</button>
      </div></td>
    </tr>`;
  }).join("");

  const body = document.getElementById("patientsBody");
  if (body) body.innerHTML = html || '<tr><td colspan="7" class="empty"><div class="big">🧑</div>Bemorlar yo\'q</td></tr>';

  document.querySelectorAll("#patientsBody button[data-act='history']").forEach(b => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const pid = parseInt(b.closest("tr").dataset.id);
      const appt = myAppts.find(a => a.patient_id === pid);
      if (appt) openPatientHistory(appt.id);
    });
  });
}

/* ═══ LABS ═══ */
function renderLabs() {
  const u = TIBEX_STORE.CURRENT_USER || {};
  const doctorId = u.doctor_id;
  const myAppts = myAppointments();
  const myPatientIds = new Set(myAppts.map(a => a.patient_id));
  let labs = TIBEX_STORE.getLabOrders().filter(l => myPatientIds.has(l.patient_id));

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const newL = labs.filter(l => l.status === "new").length;
  const proc = labs.filter(l => l.status === "received" || l.status === "processing").length;
  const ver = labs.filter(l => l.status === "verified").length;

  set("lfAll", labs.length);
  set("lfNew", newL);
  set("lfProcessing", proc);
  set("lfVerified", ver);
  set("tabLabBadge", ver);
  set("labsCount", labs.length);

  if (state.labFilter === "new") labs = labs.filter(l => l.status === "new");
  else if (state.labFilter === "processing") labs = labs.filter(l => l.status === "received" || l.status === "processing");
  else if (state.labFilter === "verified") labs = labs.filter(l => l.status === "verified");

  const html = labs.slice(0, 100).map(l => {
    const p = TIBEX_STORE.getPatient(l.patient_id);
    const cls = l.status === "verified" ? "completed" : (l.status === "new" ? "waiting" : "in_progress");
    return `<tr data-id="${esc(l.id)}">
      <td class="time-col">${esc(l.id)}</td>
      <td>${esc(p ? p.fullname : "—")}</td>
      <td>${esc(l.test_name)}</td>
      <td><span class="status ${cls}">${esc(l.status)}</span></td>
      <td style="font-size:12px;">${esc(l.result_summary || "—")}</td>
      <td><div class="row-actions">
        <button data-act="view">👁</button>
      </div></td>
    </tr>`;
  }).join("");

  const body = document.getElementById("labsBody");
  if (body) body.innerHTML = html || '<tr><td colspan="6" class="empty"><div class="big">🔬</div>Lab so\'rovlar yo\'q</td></tr>';
}

/* ═══ HISTORY ═══ */
function renderHistory() {
  const q = (document.getElementById("historySearch")?.value || "").toLowerCase();
  let appts = myAppointments().sort((a,b) => (b.id - a.id)).slice(0, 200);

  if (q) {
    appts = appts.filter(a => {
      const p = TIBEX_STORE.getPatient(a.patient_id);
      if (!p) return false;
      return p.fullname.toLowerCase().includes(q) ||
        (a.final_dx || "").toLowerCase().includes(q) ||
        (a.prelim_dx || "").toLowerCase().includes(q);
    });
  }
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("historyCount", appts.length);

  const html = appts.map(a => {
    const p = TIBEX_STORE.getPatient(a.patient_id);
    if (!p) return "";
    const dx = a.final_dx || a.prelim_dx || "—";
    return `<tr data-id="${a.id}">
      <td class="time-col">${esc(a.date)}</td>
      <td class="time-col">${esc(a.scheduled_time || "—")}</td>
      <td><b>${esc(p.fullname)}</b></td>
      <td style="font-size:12px;color:var(--primary);">${esc(dx)}</td>
      <td><span class="status ${escAttr(a.status)}">${esc(statusLabel(a.status))}</span></td>
      <td><div class="row-actions"><button data-act="view">👁 Ko\'rish</button></div></td>
    </tr>`;
  }).join("");
  const body = document.getElementById("historyBody");
  if (body) body.innerHTML = html || '<tr><td colspan="6" class="empty"><div class="big">📚</div>Tarix bo\'sh</td></tr>';

  document.querySelectorAll("#historyBody button[data-act='view']").forEach(b => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(b.closest("tr").dataset.id);
      openVisit(id, true);
    });
  });
}

/* ═══ VISIT MODAL ═══ */
function openVisit(id, readonly = false) {
  const a = TIBEX_STORE.getAppointment(id);
  if (!a) return;
  const p = TIBEX_STORE.getPatient(a.patient_id);
  if (!p) return;
  state.currentAppt = a;

  const vt = document.getElementById("visitTitle");
  if (vt) vt.innerHTML = `🩺 ${esc(p.fullname)} · #${esc(a.id)}`;
  /* TIBEX_LAB_FLOW_v1: lab_ready da ham "Yakunlash" ko'rinadi */
  const bc = document.getElementById("btnComplete");
  if (bc) {
    bc.style.display = readonly ? "none" : "inline-flex";
    bc.textContent = (a.status === "lab_ready") ? "✓ Yakunlash" : "✓ Yakunlash";
  }
  const bd = document.getElementById("btnSaveDraft");
  if (bd) bd.style.display = readonly ? "none" : "inline-flex";

  const vitals = a.vitals || {};
  const rx = a.prescriptions || [];

  const body = document.getElementById("visitBody");
  if (!body) return;

  body.innerHTML = `
    <div style="background:linear-gradient(135deg,var(--primary-tint),#fff);padding:14px;border-radius:8px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;">${esc(initials(p.fullname))}</div>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:700;">${esc(p.fullname)}</div>
          <div style="font-size:12.5px;color:var(--muted);">#${p.id} · ${p.age} yosh · ${esc(p.gender)} · ${esc(p.blood)}</div>
          <div style="font-size:12px;color:var(--muted);">📞 ${esc(p.phone || "—")}</div>
        </div>
      </div>
      ${(p.allergies || []).length ? `<div style="margin-top:10px;padding:6px 10px;background:#fef2f2;border-radius:6px;font-size:12px;color:#991b1b;">⚠ Allergiya: ${(p.allergies||[]).map(x=>esc(x)).join(", ")}</div>` : ""}
      ${(p.chronic || []).length ? `<div style="margin-top:6px;padding:6px 10px;background:#fffbeb;border-radius:6px;font-size:12px;color:#92400e;">💊 Surunkali: ${(p.chronic||[]).map(x=>esc(x)).join(", ")}</div>` : ""}
    </div>

    <div class="locked-section">
      <div class="head"><span class="t">📋 Shikoyat</span></div>
      <textarea class="textarea" id="vComplaint" ${readonly ? "readonly" : ""} placeholder="Bemor shikoyati...">${esc(a.complaint || "")}</textarea>
    </div>

    <div class="locked-section">
      <div class="head"><span class="t">❤️ Vitals</span></div>
      <div class="vitals-grid">
        <div class="vital-box">
          <div class="v">${esc(vitals.bp || "—")}</div>
          <div class="l">TA (mm Hg)</div>
          ${readonly ? "" : `<input class="input" id="vBP" style="margin-top:4px;font-size:12px;padding:4px 6px;" value="${esc(vitals.bp || "")}" placeholder="120/80">`}
        </div>
        <div class="vital-box">
          <div class="v">${esc(vitals.pulse || "—")}</div>
          <div class="l">Puls</div>
          ${readonly ? "" : `<input class="input" id="vPulse" style="margin-top:4px;font-size:12px;padding:4px 6px;" value="${esc(vitals.pulse || "")}" placeholder="72">`}
        </div>
        <div class="vital-box">
          <div class="v">${esc(vitals.temp || "—")}</div>
          <div class="l">Harorat °C</div>
          ${readonly ? "" : `<input class="input" id="vTemp" style="margin-top:4px;font-size:12px;padding:4px 6px;" value="${esc(vitals.temp || "")}" placeholder="36.6">`}
        </div>
        <div class="vital-box">
          <div class="v">${esc(vitals.spo2 || "—")}</div>
          <div class="l">SpO₂ %</div>
          ${readonly ? "" : `<input class="input" id="vSpo2" style="margin-top:4px;font-size:12px;padding:4px 6px;" value="${esc(vitals.spo2 || "")}" placeholder="98">`}
        </div>
      </div>
    </div>

    <div class="locked-section">
      <div class="head"><span class="t">🩺 Tashxislar</span></div>
      <div class="form-grid">
        <div class="form-field">
          <label>Boshlang'ich tashxis</label>
          <input class="input" id="vPreDx" ${readonly ? "readonly" : ""} value="${esc(a.prelim_dx || "")}" placeholder="Masalan: ORVI">
        </div>
        <div class="form-field">
          <label>Yakuniy tashxis</label>
          <input class="input" id="vFinalDx" ${readonly ? "readonly" : ""} value="${esc(a.final_dx || "")}" placeholder="Tasdiqlangan tashxis">
        </div>
      </div>
    </div>

    <div class="locked-section">
      <div class="head">
        <span class="t">💊 Retsept</span>
        ${readonly ? "" : `<button class="btn" style="padding:4px 10px;font-size:11px;" id="btnAddRx">+ Dori qo'shish</button>`}
      </div>
      <div id="rxList">
        ${rx.length ? rx.map((r, i) => `
          <div class="rx-item" data-idx="${i}">
            <input class="input" value="${esc(r.name || "")}" placeholder="Dori nomi" ${readonly ? "readonly" : ""}>
            <input class="input" value="${esc(r.dose || "")}" placeholder="Doza" ${readonly ? "readonly" : ""}>
            <input class="input" value="${esc(r.perDay || "")}" placeholder="Kuniga" ${readonly ? "readonly" : ""}>
            <input class="input" value="${esc(r.days || "")}" placeholder="Kunlar" ${readonly ? "readonly" : ""}>
            ${readonly ? "" : `<button data-rm="${i}">✕</button>`}
          </div>
        `).join("") : '<div style="padding:12px;text-align:center;color:var(--dim);font-size:12px;">Retsept yo\'q</div>'}
      </div>
    </div>

    ${(a.status === "lab_waiting" || a.status === "lab_ready") ? `
    <div class="locked-section" style="border-color:${a.status === 'lab_ready' ? '#86efac' : '#fcd34d'};background:${a.status === 'lab_ready' ? '#f0fdf4' : '#fffbeb'};">
      <div class="head">
        <span class="t">${a.status === 'lab_ready' ? '✅ Lab natijalar tayyor' : '🔬 Lab jarayonida'}</span>
      </div>
      <div style="padding:8px 0;font-size:12.5px;">
        ${(() => {
          const labs = TIBEX_STORE.getLabOrdersByAppt ? TIBEX_STORE.getLabOrdersByAppt(a.id) : [];
          if (!labs.length) return '<div style="color:var(--muted);">Lab so\'rov topilmadi</div>';
          return labs.map(l => {
            const statusMap = {
              new: '<span class="status waiting" style="font-size:10px;">⏳ Yangi</span>',
              received: '<span class="status arrived" style="font-size:10px;">📥 Qabul qilindi</span>',
              processing: '<span class="status in_progress" style="font-size:10px;">🔬 Jarayonda</span>',
              ready: '<span class="status lab_ready" style="font-size:10px;">✅ Tayyor</span>',
              verified: '<span class="status completed" style="font-size:10px;">✅ Tasdiqlangan</span>'
            };
            return `<div style="padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:#fff;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <b>${esc(l.test_name)}</b>
                ${esc(statusMap[l.status] || l.status)}
              </div>
              ${l.result_summary ? `<div style="font-size:12px;color:var(--primary);margin-top:4px;">📊 ${esc(l.result_summary)}</div>` : ''}
              ${l.result_note ? `<div style="font-size:11.5px;color:var(--muted);margin-top:2px;">📝 ${esc(l.result_note)}</div>` : ''}
            </div>`;
          }).join('');
        })()}
      </div>
      ${a.status === 'lab_ready' ? '<div style="font-size:12px;color:#166534;padding:6px 0;">Bemor labdan qaytdi. Davolashni davom ettiring yoki yakunlang.</div>' : ''}
    </div>` : ''}

    <div class="locked-section">
      <div class="head"><span class="t">📝 Izoh</span></div>
      <textarea class="textarea" id="vNote" ${readonly ? "readonly" : ""} placeholder="Qo'shimcha izoh...">${esc(a.draft?.note || "")}</textarea>
    </div>

    ${!readonly ? `
    <div class="locked-section">
      <div class="head"><span class="t">🔬 Lab so'rov</span></div>
      <div class="form-grid">
        <div class="form-field">
          <label>Test nomi</label>
          <input class="input" id="vLabName" placeholder="Masalan: Umumiy qon tahlili">
        </div>
        <div class="form-field">
          <label>Muhimlik</label>
          <select class="select" id="vLabPriority">
            <option value="normal">Oddiy</option>
            <option value="urgent">Shoshilinch</option>
            <option value="stat">STAT</option>
          </select>
        </div>
      </div>
    </div>` : ""}
  `;

  if (!readonly) {
    // TIBEX_LISTENER_CLEANUP_v1: eski listenerlarni olib tashlash
    const _btnAddRx = document.getElementById("btnAddRx");
    if (_btnAddRx && !_btnAddRx._tibexBound) {
      _btnAddRx._tibexBound = true;
      _btnAddRx.addEventListener("click", () => addRxRow());
    }
    document.querySelectorAll("#rxList button[data-rm]").forEach(b => {
      b.addEventListener("click", () => {
        const idx = parseInt(b.dataset.rm);
        const list = TIBEX_STORE.getAppointment(id).prescriptions || [];
        list.splice(idx, 1);
        TIBEX_STORE.updateAppointment(id, { prescriptions: list });
        openVisit(id);
      });
    });
  }

  tibexOpenModal("modalVisit");
}

function addRxRow() {
  const rxList = document.getElementById("rxList");
  if (!rxList) return;
  if (rxList.querySelector("div[style*='text-align']")) rxList.textContent = "";
  const div = document.createElement("div");
  div.className = "rx-item";
  div.innerHTML = `
    <input class="input" placeholder="Dori nomi">
    <input class="input" placeholder="Doza">
    <input class="input" placeholder="Kuniga">
    <input class="input" placeholder="Kunlar">
    <button type="button">✕</button>
  `;
  div.querySelector("button").addEventListener("click", () => div.remove());
  rxList.appendChild(div);
}

/* ═══ COMPLETE ═══ */
tibexSafeBind("btnComplete", "click", async () => {
  const a = state.currentAppt;
  if (!a) return;

  const rx = [];
  document.querySelectorAll("#rxList .rx-item").forEach(el => {
    const inputs = el.querySelectorAll("input");
    const name = inputs[0]?.value.trim();
    if (name) {
      rx.push({
        name,
        dose: inputs[1]?.value.trim() || "",
        perDay: inputs[2]?.value.trim() || "",
        days: inputs[3]?.value.trim() || ""
      });
    }
  });

  /* TIBEX_DOCTOR_SYNC_v1_STATUS_TIMING: status vaqti */
  const labName = document.getElementById("vLabName")?.value.trim();
  const hasLabRequest = !!labName;

  const patch = {
    complaint: document.getElementById("vComplaint")?.value.trim() || "",
    vitals: {
      bp: document.getElementById("vBP")?.value.trim() || "",
      pulse: document.getElementById("vPulse")?.value.trim() || "",
      temp: document.getElementById("vTemp")?.value.trim() || "",
      spo2: document.getElementById("vSpo2")?.value.trim() || ""
    },
    prelim_dx: document.getElementById("vPreDx")?.value.trim() || "",
    final_dx: document.getElementById("vFinalDx")?.value.trim() || "",
    prescriptions: rx,
    draft: { note: document.getElementById("vNote")?.value.trim() || "" }
  };

  /* Lab bo'lmasa — completed */
  if (!hasLabRequest) {
    patch.status = "completed";
  }

  try {
    /* 1) Med ma'lumotlarni saqlash */
    await TIBEX_STORE.updateAppointment(a.id, patch);

    /* TIBEX_DOCTOR_SYNC_v1_LAB_CALL: TIBEX_STORE.addLabOrder orqali */
    if (hasLabRequest) {
      const u = TIBEX_STORE.CURRENT_USER || {};
      /* Backend avtomatik appointment.status = lab_waiting qiladi */
      await TIBEX_STORE.addLabOrder({
        appointment_id: a.id,
        patient_id: a.patient_id,
        test_key: labName.toLowerCase().replace(/\s+/g, "_").slice(0, 40),
        test_name: labName,
        priority: document.getElementById("vLabPriority")?.value || "normal",
        ordered_by: u.fullname || "",
        status: "new"
      });
      toast("🔬 Bemor labga jo'natildi. Natija kutilmoqda.", "info", 5000);
    } else {
      toast("✓ Qabul yakunlandi", "ok");
    }

    tibexCloseModal("modalVisit");
    renderAll();
  } catch (e) {
    toast("Xatolik: " + (e.message || "unknown"), "bad", 5000);
  }
});

/* ═══ DRAFT ═══ */
tibexSafeBind("btnSaveDraft", "click", () => {
  const a = state.currentAppt;
  if (!a) return;
  const patch = {
    complaint: document.getElementById("vComplaint")?.value.trim() || "",
    vitals: {
      bp: document.getElementById("vBP")?.value.trim() || "",
      pulse: document.getElementById("vPulse")?.value.trim() || "",
      temp: document.getElementById("vTemp")?.value.trim() || "",
      spo2: document.getElementById("vSpo2")?.value.trim() || ""
    },
    prelim_dx: document.getElementById("vPreDx")?.value.trim() || "",
    draft: { note: document.getElementById("vNote")?.value.trim() || "" }
  };
  TIBEX_STORE.updateAppointment(a.id, patch);
  toast("💾 Qoralama saqlandi", "info");
});

/* ═══ PATIENT HISTORY ═══ */
function openPatientHistory(apptId) {
  const a = TIBEX_STORE.getAppointment(apptId);
  if (!a) return;
  const p = TIBEX_STORE.getPatient(a.patient_id);
  if (!p) return;
  const appts = myAppointments().filter(x => x.patient_id === p.id);

  const body = document.getElementById("visitBody");
  if (!body) return;
  body.innerHTML = `
    <div style="background:linear-gradient(135deg,var(--primary-tint),#fff);padding:14px;border-radius:8px;margin-bottom:14px;">
      <div style="font-size:16px;font-weight:700;">${esc(p.fullname)}</div>
      <div style="font-size:12.5px;color:var(--muted);">#${p.id} · ${p.age} yosh · ${esc(p.gender)} · ${esc(p.blood)}</div>
      <div style="font-size:12.5px;color:var(--muted);">📞 ${esc(p.phone || "—")}</div>
    </div>
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">📋 Qabullar (${appts.length})</div>
    ${appts.map(x => `
      <div class="locked-section">
        <div class="head"><span class="t">${esc(x.date)} ${esc(x.scheduled_time || "")}</span><span class="status ${escAttr(x.status)}">${esc(statusLabel(x.status))}</span></div>
        <div class="row"><span class="k">Xizmat</span><span class="v">${esc(x.service?.name || "—")}</span></div>
        <div class="row"><span class="k">Tashxis</span><span class="v">${esc(x.final_dx || x.prelim_dx || "—")}</span></div>
      </div>
    `).join("") || '<div class="empty">Qabullar yo\'q</div>'}
  `;
  const vt = document.getElementById("visitTitle");
  if (vt) vt.innerHTML = `📋 Bemor tarixi`;
  const bc = document.getElementById("btnComplete");
  if (bc) bc.style.display = "none";
  const bd = document.getElementById("btnSaveDraft");
  if (bd) bd.style.display = "none";
  tibexOpenModal("modalVisit");
}

/* ═══ NEW PATIENT ═══ */
tibexSafeBind("qaNewPatient", "click", () => {
  if (!TIBEX_STORE.can("patients", "create")) {
    return toast("Ruxsat yo'q: bemor qo'shish (patients.create)", "warn");
  }
  ["pName","pPhone","pAge","pAddress"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id === "pPhone" ? "+998 " : "";
  });
  tibexOpenModal("modalPatient");
  setTimeout(() => document.getElementById("pName")?.focus(), 100);
});
/* TIBEX_DOCTOR_DEDUPE_v1: actNewPatient handler olib tashlandi */

tibexSafeBind("btnSavePatient", "click", async () => {
  const name = document.getElementById("pName").value.trim();
  const phone = document.getElementById("pPhone").value.trim();
  const age = parseInt(document.getElementById("pAge").value) || 0;
  if (!name || !phone || !age) return toast("F.I.Sh, telefon va yosh kerak", "warn");
  try {
    await TIBEX_STORE.addPatient({
      fullname: name, phone, age,
      gender: document.getElementById("pGender").value,
      blood: document.getElementById("pBlood").value,
      address: document.getElementById("pAddress").value.trim(),
      allergies: [], chronic: []
    });
    toast(`✓ Bemor qo'shildi: ${name}`, "ok");
    tibexCloseModal("modalPatient");
    renderAll();
  } catch (e) {
    toast("Xatolik: " + (e.message || ""), "bad");
  }
});

/* ═══ SIDEBAR ═══ */
function renderSidebar() {
  const t = today();
  const appts = myAppointments(t);
  const queue = appts
    .filter(a => a.status === "waiting" || a.status === "arrived" || a.status === "in_progress")
    .sort((a,b) => (a.scheduled_time || "").localeCompare(b.scheduled_time || ""));

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("sbQueueCount", queue.length);

  const queueHtml = queue.length ? queue.map(a => {
    const p = TIBEX_STORE.getPatient(a.patient_id);
    if (!p) return "";
    const isUrgent = a.priority === "urgent" || a.priority === "stat";
    return `<div class="sb-queue-item ${isUrgent ? 'urgent' : ''}" data-appt-id="${a.id}">
      <div class="q-time">${esc(a.scheduled_time || "—")}</div>
      <div class="q-body">
        <div class="q-name">${esc(p.fullname)}</div>
        <div class="q-meta">${esc(statusLabel(a.status))}${isUrgent ? ' · ' + esc(priorityLabel(a.priority)) : ''}</div>
      </div>
      <div class="q-status ${escAttr(a.status)}"></div>
    </div>`;
  }).join("") : '<div class="sb-queue-empty">Navbat bo\'sh</div>';

  const qlist = document.getElementById("sbQueueList");
  if (qlist) qlist.innerHTML = queueHtml;

  document.querySelectorAll("#sbQueueList .sb-queue-item").forEach(el => {
    el.addEventListener("click", () => {
      const id = parseInt(el.dataset.apptId);
      const appt = TIBEX_STORE.getAppointment(id);
      if (!appt) return;
      if (appt.status === "waiting") {
        TIBEX_STORE.updateAppointment(id, { status: "arrived" });
        toast("✓ Keldi belgilandi", "ok");
      }
      openVisit(id);
      renderAll();
    });
  });

  set("sbTotal", appts.length);
  set("sbWaiting", appts.filter(a => a.status === "waiting" || a.status === "arrived").length);
  set("sbProgress", appts.filter(a => a.status === "in_progress").length);
  set("sbDone", appts.filter(a => a.status === "completed").length);

  const u = TIBEX_STORE.CURRENT_USER || {};
  set("sbUserName", u.fullname || "—");
  set("sbUserRole", u.role || "—");
  set("sbAvatar", initials(u.fullname || "DR"));

  /* TIBEX_DOCTOR_CLEANUP_v1: eq va lab hisoblash olib tashlandi */
}

/* ═══ TABS ═══ */
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => {
    const v = t.dataset.view;
    state.currentView = v;
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
    document.querySelector(`[data-view-content="${v}"]`)?.classList.add("active");
    renderAll();
  });
});

/* ═══ FILTERS ═══ */
document.querySelectorAll("[data-qfilter]").forEach(c => {
  c.addEventListener("click", () => {
    document.querySelectorAll("[data-qfilter]").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    state.queueFilter = c.dataset.qfilter;
    renderQueue();
  });
});
document.querySelectorAll("[data-lfilter]").forEach(c => {
  c.addEventListener("click", () => {
    document.querySelectorAll("[data-lfilter]").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    state.labFilter = c.dataset.lfilter;
    renderLabs();
  });
});

/* ═══ SEARCH ═══ */
document.getElementById("queueSearch")?.addEventListener("input", renderQueue);
document.getElementById("historySearch")?.addEventListener("input", renderHistory);
document.getElementById("patientsSearch")?.addEventListener("input", renderPatients);

/* ═══ BUTTONS ═══ */
tibexSafeBind("btnRefresh", "click", () => { renderAll(); toast("↻ Yangilandi", "info"); });
tibexSafeBind("qaRefresh", "click", () => { renderAll(); toast("↻ Yangilandi", "info"); });
tibexSafeBind("btnHelp", "click", () => tibexOpenModal("modalHelp"));
tibexSafeBind("actNextPatient", "click", () => {
  const t = today();
  const next = myAppointments(t).filter(a => a.status === "arrived").sort((a,b) => (a.scheduled_time||"").localeCompare(b.scheduled_time||""))[0];
  if (next) {
    TIBEX_STORE.updateAppointment(next.id, { status: "in_progress" });
    openVisit(next.id);
  } else {
    toast("Navbatda kutilayotgan bemor yo'q", "warn");
  }
});

/* ═══ MODAL CLOSE ═══ */
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => b.closest(".modal-backdrop").classList.remove("open")));
document.querySelectorAll(".modal-backdrop").forEach(m => m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); }));

/* ═══ KEYBOARD ═══ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.open").forEach(m => m.classList.remove("open"));
  if (e.key === "F1") { e.preventDefault(); tibexOpenModal("modalHelp"); }
  if (e.key === "F2") { e.preventDefault(); document.getElementById("qaNewPatient")?.click(); }
  if (e.key === "F5") { e.preventDefault(); renderAll(); }
  if (e.ctrlKey && ["1","2","3","4","5"].includes(e.key)) {
    e.preventDefault();
    const views = ["queue","today","patients","labs","history"];
    document.querySelector(`[data-view="${views[parseInt(e.key)-1]}"]`)?.click();
  }
});

/* ═══ RENDER ALL ═══ */
function renderAll() {
  renderQueue();
  renderToday();
  renderPatients();
  renderLabs();
  renderHistory();
  renderSidebar();
}

/* ═══ RUXSATLAR (TIBEX_ROLE_FORTRESS_v1) ═══
 * Rolda patients.create bo'lmasa (masalan, standart "doctor" roli),
 * "Yangi bemor" tugmasi/tezkor tugmasi ko'rinmaydi va bosilmaydi —
 * aks holda backend 403 qaytarib, foydalanuvchi chalkashib qolardi. */
function applyPermissions() {
  const canCreatePatient = TIBEX_STORE.can("patients", "create");
  const btn = document.getElementById("qaNewPatient");
  if (btn) {
    btn.style.display = canCreatePatient ? "" : "none";
    btn.disabled = !canCreatePatient;
    btn.title = canCreatePatient ? "" : "Ruxsat yo'q: patients.create";
  }
}

/* ═══ INIT ═══ */
(async () => {
  try {
    await TIBEX_STORE.init();
    window.CURRENT_USER = TIBEX_STORE.CURRENT_USER;
    applyPermissions();
    renderAll();
  } catch (e) {
    console.error("[TIBEX] init xato:", e);
    if (e.message === "UNAUTHORIZED") location.href = "/login.html";
  }
})();

/* TIBEX_DOCTOR_CLEANUP_v1: xatolar faqat adminga yuboriladi */
window.__TIBEX_CLIENT_ROLE__ = "doctor";

/* ═══ WEBSOCKET SYNC ═══ */
/* TIBEX_LAB_FLOW_v1: lab_ready bo'lganda toast */
let _lastLabReadyIds = new Set();
TIBEX_STORE.subscribe((data, source) => {
  if (source === "external") {
    /* Lab natijalar tayyor bo'lganda ogohlantirish */
    const u = TIBEX_STORE.CURRENT_USER || {};
    const myIds = new Set(myAppointments().map(a => a.id));
    const ready = TIBEX_STORE.getAppointments().filter(
      a => myIds.has(a.id) && a.status === "lab_ready"
    );
    ready.forEach(a => {
      if (!_lastLabReadyIds.has(a.id)) {
        _lastLabReadyIds.add(a.id);
        const p = TIBEX_STORE.getPatient(a.patient_id);
        toast(`✅ ${p?.fullname || 'Bemor'} — lab natijalar tayyor`, "ok", 6000);
      }
    });
  }
  window.TIBEX_REALTIME_PRO && window.TIBEX_REALTIME_PRO.smartRender ? window.TIBEX_REALTIME_PRO.smartRender() : renderAll();
  if (state.currentAppt) {
    const a = TIBEX_STORE.getAppointment(state.currentAppt.id);
    if (a) state.currentAppt = a;
  }
});
  
