/* ===== block_0 ===== */
/* ═══════════════════ STATE ═══════════════════ */
const state = {
  currentView: 'dashboard',
  patientFilter: 'all',
  apptFilter: 'today',
  editingPatientId: null,
  patientAllergies: [],
  patientChronic: [],
  selectedPatientForAppt: null,
  appointmentPriority: 'normal',
  paymentTargetAppt: null
};

/* ═══════════════════ UTIL ═══════════════════ */
function toast(msg, type='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}
function fmtMoney(n) { return (n || 0).toLocaleString('ru-RU').replace(/,/g, ' '); }
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return `${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`; }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function tomorrow() { const d = new Date(Date.now()+86400000); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function initials(name) { return (name || '?').split(' ').slice(0, 2).map(s => s[0] || '').join('').toUpperCase(); }
function nowTime() { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function statusLabel(s) {
  return { waiting: 'Kutmoqda', arrived: 'Keldi', in_progress: 'Qabulda',
    lab_waiting: '🔬 Lab', lab_ready: '✅ Lab tayyor',
    completed: 'Yakunlangan', cancelled: 'Bekor' }[s] || s;
}
function priorityLabel(p) { return { normal: '🟢 Oddiy', urgent: '🟡 Shoshilinch', stat: '🔴 STAT' }[p] || p; }

/* ═══════════════════ DASHBOARD ═══════════════════ */
function renderDashboard() {
  const todayDate = today();
  const appts = TIBEX_STORE.getAppointments({ date: todayDate });
  const payments = TIBEX_STORE.getPayments().filter(p => {
    const d = new Date(p.created_at);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === todayDate;
  });

  const waiting = appts.filter(a => a.status === 'waiting' || a.status === 'arrived').length;
  const inProg = appts.filter(a => a.status === 'in_progress' || a.status === 'lab_waiting' || a.status === 'lab_ready').length;
  const completed = appts.filter(a => a.status === 'completed').length;
  const revenue = payments.reduce((s,p) => s + p.amount, 0);
  const debt = appts.reduce((s,a) => s + (a.debt || 0), 0);

  document.getElementById('statWaiting').textContent = waiting;
  document.getElementById('statArrived').textContent = appts.filter(a => a.status === 'arrived').length;
  document.getElementById('statInProgress').textContent = inProg;
  document.getElementById('statCompleted').textContent = completed;

  document.getElementById('ovTotal').textContent = appts.length;
  document.getElementById('ovTotalSub').textContent = `${waiting} kutmoqda · ${inProg} qabulda`;
  document.getElementById('ovWaiting').textContent = waiting;
  document.getElementById('ovWaitingSub').textContent = appts.filter(a => a.status === 'arrived').length + ' keldi';
  document.getElementById('ovCompleted').textContent = completed;
  document.getElementById('ovCompletedSub').textContent = appts.length > 0 ? Math.round(completed / appts.length * 100) + '%' : '0%';
  document.getElementById('ovRevenue').textContent = fmtMoney(revenue);
  document.getElementById('ovRevenueSub').textContent = payments.length + ' to\'lov';
  document.getElementById('ovDebt').textContent = fmtMoney(debt);
  document.getElementById('ovDebtSub').textContent = appts.filter(a => (a.debt||0) > 0).length + ' ta bemor';

  document.getElementById('sbTotal').textContent = appts.length;
  document.getElementById('sbWaiting').textContent = waiting;
  document.getElementById('sbDone').textContent = completed;
  document.getElementById('sbDebt').textContent = fmtMoney(debt);

  document.getElementById('tabPatientsBadge').textContent = TIBEX_STORE.getAllPatients().length;
  document.getElementById('tabApptsBadge').textContent = TIBEX_STORE.getAppointments().length;
  document.getElementById('todayCount').textContent = appts.length;

  renderDoctorsQueue();
  renderTodayTable(appts);
}
function renderDoctorsQueue() {
  const todayDate = today();
  const appts = TIBEX_STORE.getAppointments({ date: todayDate });
  const docs = TIBEX_STORE.getDoctors().filter(d => d.active);
  const html = docs.map(d => {
    const cnt = appts.filter(a => a.doctor_id === d.id).length;
    const done = appts.filter(a => a.doctor_id === d.id && a.status === 'completed').length;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px;border-bottom:1px dashed #f1f5f9;">
      <span style="display:flex;align-items:center;gap:6px;font-weight:500;"><span style="width:8px;height:8px;border-radius:50%;background:${done===cnt&&cnt>0?'var(--ok)':'var(--warn)'};"></span>${esc(d.name.split(' ').slice(0,2).join(' '))}</span>
      <span style="font-family:ui-monospace;font-weight:600;color:var(--muted);">${done}/${cnt}</span>
    </div>`;
  }).join('');
  document.getElementById('sbDoctors').innerHTML = html || '<div style="color:var(--dim);font-size:11px;">Shifokorlar yo\'q</div>';
}
function renderTodayTable(appts) {
  const html = appts.map(a => {
    const p = TIBEX_STORE.getPatient(a.patient_id);
    if (!p) return '';
    const isUrgent = a.priority === 'urgent' || a.priority === 'stat';
    const debtCls = (a.debt||0) > 0 ? 'color:var(--danger);font-weight:700;' : 'color:var(--ok);';
    return `<tr data-id="${a.id}">
      <td class="time-col">${esc(a.scheduled_time || '—')}</td>
      <td>${isUrgent ? `<span class="priority-badge ${escAttr(a.priority)}">${a.priority === 'stat' ? 'STAT' : 'SHOSH'}</span>` : '—'}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">
        <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;">${esc(initials(p.fullname))}</div>
        <div><div style="font-weight:600;">${esc(p.fullname)}</div><div style="font-size:11px;color:var(--dim);">#${p.id} · ${p.age} yosh</div></div>
      </div></td>
      <td>${esc(a.doctor_name || '—')}</td>
      <td style="font-size:12px;">${esc(a.service?.name || '—')}</td>
      <td><span class="status ${esc(a.status)}">${esc(statusLabel(a.status))}</span>
        ${a.status === 'lab_waiting' ? '<span style="font-size:10px;color:var(--warn);margin-left:4px;">🔬</span>' : ''}
        ${a.status === 'lab_ready' ? '<span style="font-size:10px;color:var(--ok);margin-left:4px;">✅</span>' : ''}
      </td>
      <td style="font-family:ui-monospace;${debtCls}">${fmtMoney(a.paid||0)}</td>
      <td>${QF.rowActions(a)}</td>
    </tr>`;
  }).join('');
  document.getElementById('todayBody').innerHTML = html || '<tr><td colspan="8" class="empty"><div class="big">📅</div>Bugun navbatlar yo\'q</td></tr>';
  bindTodayActions();
}
function bindTodayActions() {
  document.querySelectorAll('#todayBody button[data-act]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(b.closest('tr').dataset.id);
      const act = b.dataset.act;
      if (act === 'arrive') {
        TIBEX_STORE.updateAppointment(id, { status: 'arrived' });
        toast('Bemor keldi deb belgilandi', 'ok');
      } else if (act === 'start') {
        TIBEX_STORE.updateAppointment(id, { status: 'in_progress' });
        toast('Qabul boshlandi', 'info');
      } else if (act === 'pay') {
        openPaymentModal(id);
      } else if (act === 'history') {
        openHistory(id);
      }
      renderAll();
    });
  });
}

/* ═══════════════════ PATIENTS ═══════════════════ */
function renderPatients() {
  const search = (document.getElementById('patientsSearch')?.value || '').toLowerCase();
  let all = TIBEX_STORE.getAllPatients();

  document.getElementById('pfAll').textContent = all.length;

  if (state.patientFilter === 'recent') {
    const w = Date.now() - 7 * 86400000;
    all = all.filter(p => (p.created_at || 0) >= w);
  } else if (state.patientFilter === 'today') {
    const d = new Date(); d.setHours(0,0,0,0);
    all = all.filter(p => (p.created_at || 0) >= d.getTime());
  }

  if (search) {
    all = all.filter(p =>
      p.fullname.toLowerCase().includes(search) ||
      (p.phone || '').includes(search) ||
      String(p.id).includes(search)
    );
  }

  all.sort((a,b) => b.id - a.id);
  const html = all.slice(0, 200).map(p => `<tr data-id="${p.id}">
    <td class="time-col">#${p.id}</td>
    <td><div style="display:flex;align-items:center;gap:8px;">
      <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;">${esc(initials(p.fullname))}</div>
      <div><div style="font-weight:600;">${esc(p.fullname)}</div>${(p.allergies||[]).length ? `<div style="font-size:11px;color:var(--danger);">⚠ ${esc(p.allergies.join(', '))}</div>` : ''}</div>
    </div></td>
    <td class="mono">${esc(p.phone || '—')}</td>
    <td class="mono">${p.age}</td>
    <td>${p.gender === 'Erkak' ? '👨' : '👩'}</td>
    <td class="mono">${esc(p.blood)}</td>
    <td><div class="row-actions">
      <button data-act="new-appt" class="success">📅 Navbat</button>
      <button data-act="history">📋 Tarix</button>
      <button data-act="edit">✏️</button>
    </div></td>
  </tr>`).join('');
  document.getElementById('patientsBody').innerHTML = html || '<tr><td colspan="7" class="empty"><div class="big">🧑</div>Bemorlar topilmadi</td></tr>';

  document.querySelectorAll('#patientsBody button[data-act]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(b.closest('tr').dataset.id);
      const act = b.dataset.act;
      if (act === 'edit') openPatientModal(id);
      else if (act === 'history') openHistory(id);
      else if (act === 'new-appt') openApptModal(id);
    });
  });
}

function openPatientModal(editId = null) {
  state.editingPatientId = editId;
  state.patientAllergies = [];
  state.patientChronic = [];
  const F = id => document.getElementById(id);
  if (editId) {
    const p = TIBEX_STORE.getPatient(editId);
    if (!p) return;
    document.getElementById('patientModalTitle').innerHTML = `✏️ Bemor tahrirlash — #${esc(editId)}`;
    F('pName').value = p.fullname;
    F('pPhone').value = p.phone;
    F('pAge').value = p.age;
    F('pGender').value = p.gender;
    F('pBlood').value = p.blood;
    F('pAddress').value = p.address || '';
    state.patientAllergies = [...(p.allergies || [])];
    state.patientChronic = [...(p.chronic || [])];
  } else {
    document.getElementById('patientModalTitle').textContent = '🧑 Yangi bemor';
    F('pName').value = '';
    F('pPhone').value = '+998 ';
    F('pAge').value = '';
    F('pGender').value = 'Erkak';
    F('pBlood').value = 'O+';
    F('pAddress').value = '';
  }
  renderPatientTags();
  openModal('modalPatient');
  setTimeout(() => F('pName').focus(), 100);
}

function renderPatientTags() {
  /* TIBEX_FIX_TAGS_v1 */
  const aw = document.getElementById('pAllergyWrap');
  const cw = document.getElementById('pChronicWrap');
  const aiOld = document.getElementById('pAllergyInput');
  const ciOld = document.getElementById('pChronicInput');
  const _aVal = aiOld ? aiOld.value : '';
  const _cVal = ciOld ? ciOld.value : '';
  const aHtml = aiOld ? aiOld.outerHTML : '<input type="text" placeholder="Yozing va Enter...">';
  const cHtml = ciOld ? ciOld.outerHTML : '<input type="text" placeholder="Yozing va Enter...">';
  aw.innerHTML = state.patientAllergies.map((a,i) => `<span class="tag-item">${esc(a)}<span class="x" data-rm-allergy="${esc(i)}">✕</span></span>`).join('') + aHtml;
  cw.innerHTML = state.patientChronic.map((c,i) => `<span class="tag-item warn">${esc(c)}<span class="x" data-rm-chronic="${esc(i)}">✕</span></span>`).join('') + cHtml;
  const nai = document.getElementById('pAllergyInput');
  const nci = document.getElementById('pChronicInput');
  if (nai && _aVal) nai.value = _aVal;
  if (nci && _cVal) nci.value = _cVal;
  nai?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = nai.value.trim().replace(/,$/, '');
      if (v) { state.patientAllergies.push(v); nai.value = ''; renderPatientTags(); document.getElementById('pAllergyInput')?.focus(); }
    }
  });
  nci?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = nci.value.trim().replace(/,$/, '');
      if (v) { state.patientChronic.push(v); nci.value = ''; renderPatientTags(); document.getElementById('pChronicInput')?.focus(); }
    }
  });
  document.querySelectorAll('[data-rm-allergy]').forEach(b => b.addEventListener('click', () => { state.patientAllergies.splice(parseInt(b.dataset.rmAllergy), 1); renderPatientTags(); }));
  document.querySelectorAll('[data-rm-chronic]').forEach(b => b.addEventListener('click', () => { state.patientChronic.splice(parseInt(b.dataset.rmChronic), 1); renderPatientTags(); }));
}

document.getElementById('btnSavePatient')?.addEventListener('click', () => {
  const name = document.getElementById('pName').value.trim();
  const phone = document.getElementById('pPhone').value.trim();
  const age = parseInt(document.getElementById('pAge').value) || 0;
  if (!name || !phone || !age) return toast('F.I.Sh, telefon va yoshni to\'ldiring', 'warn');
  const data = {
    fullname: name, phone, age,
    gender: document.getElementById('pGender').value,
    blood: document.getElementById('pBlood').value,
    address: document.getElementById('pAddress').value.trim(),
    allergies: state.patientAllergies,
    chronic: state.patientChronic
  };
  if (state.editingPatientId) {
    TIBEX_STORE.updatePatient(state.editingPatientId, data);
    toast('✓ Bemor yangilandi', 'ok');
  } else {
    const np = TIBEX_STORE.addPatient(data);
    toast(`✓ Yangi bemor: ${name}`, 'ok');
    closeModal('modalPatient');
    // Auto-open appointment modal for new patient
    setTimeout(() => openApptModal(np.id), 400);
    return;
  }
  closeModal('modalPatient');
  renderAll();
});

/* ═══════════════════ APPOINTMENTS ═══════════════════ */
function renderAppointments() {
  /* TIBEX_QABULXONA_FULL_v1: 'search' e'lon qilinmagan edi (ReferenceError -> renderAll to'xtardi) */
  const search = (document.getElementById('apptsSearch')?.value || '').toLowerCase();

  let appts = TIBEX_STORE.getAppointments();

  const t = today(), tm = tomorrow();
  document.getElementById('afAll').textContent = appts.length;
  document.getElementById('afToday').textContent = appts.filter(a => a.date === t).length;
  document.getElementById('afTomorrow').textContent = appts.filter(a => a.date === tm).length;
  document.getElementById('afWaiting').textContent = appts.filter(a => a.status === 'waiting' || a.status === 'arrived').length;
  const _afLW = document.getElementById('afLabWaiting');
  if (_afLW) _afLW.textContent = appts.filter(a => a.status === 'lab_waiting').length;
  const _afLR = document.getElementById('afLabReady');
  if (_afLR) _afLR.textContent = appts.filter(a => a.status === 'lab_ready').length;
  document.getElementById('afDone').textContent = appts.filter(a => a.status === 'completed').length;

  if (state.apptFilter === 'today') appts = appts.filter(a => a.date === t);
  else if (state.apptFilter === 'tomorrow') appts = appts.filter(a => a.date === tm);
  else if (state.apptFilter === 'waiting') appts = appts.filter(a => a.status === 'waiting' || a.status === 'arrived');
  else if (state.apptFilter === 'lab_waiting') appts = appts.filter(a => a.status === 'lab_waiting');
  else if (state.apptFilter === 'lab_ready') appts = appts.filter(a => a.status === 'lab_ready');
  else if (state.apptFilter === 'completed') appts = appts.filter(a => a.status === 'completed');

  if (search) {
    appts = appts.filter(a => {
      const p = TIBEX_STORE.getPatient(a.patient_id);
      return (p && p.fullname.toLowerCase().includes(search)) ||
        (a.doctor_name || '').toLowerCase().includes(search);
    });
  }

  appts.sort((a,b) => (a.date + a.scheduled_time).localeCompare(b.date + b.scheduled_time));

  const html = appts.slice(0, 300).map(a => {
    const p = TIBEX_STORE.getPatient(a.patient_id);
    if (!p) return '';
    const isUrgent = a.priority === 'urgent' || a.priority === 'stat';
    return `<tr data-id="${a.id}">
      <td class="time-col">${esc(a.date)}</td>
      <td class="time-col">${esc(a.scheduled_time || '—')}</td>
      <td>${isUrgent ? `<span class="priority-badge ${escAttr(a.priority)}">${a.priority === 'stat' ? 'STAT' : 'SHOSH'}</span>` : '—'}</td>
      <td><div style="font-weight:600;">${esc(p.fullname)}</div><div style="font-size:11px;color:var(--dim);">#${p.id} · ${p.age} yosh</div></td>
      <td>${esc(a.doctor_name || '—')}</td>
      <td style="font-size:12px;">${esc(a.service?.name || '—')}</td>
      <td><span class="status ${esc(a.status)}">${esc(statusLabel(a.status))}</span></td>
      <td>${QF.rowActions(a)}</td>
    </tr>`;
  }).join('');
  document.getElementById('apptsBody').innerHTML = html || '<tr><td colspan="8" class="empty"><div class="big">📅</div>Navbatlar yo\'q</td></tr>';

  document.querySelectorAll('#apptsBody button[data-act]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(b.closest('tr').dataset.id);
      if (b.dataset.act === 'arrive') { TIBEX_STORE.updateAppointment(id, { status: 'arrived' }); toast('Keldi belgilandi', 'ok'); renderAll(); }
      else if (b.dataset.act === 'pay') openPaymentModal(id);
      else if (b.dataset.act === 'lab') openLabResults(id);
      else if (b.dataset.act === 'history') openHistory(id);
    });
  });
}

function openApptModal(prefillPatientId = null) {
  const F = id => document.getElementById(id);
  // Populate doctors
  const docs = TIBEX_STORE.getDoctors().filter(d => d.active);
  F('aDoctor').innerHTML = '<option value="">Tanlang...</option>' + docs.map(d => `<option value="${esc(d.id)}">${esc(d.name)} — ${esc(d.specialty)}</option>`).join('');
  // Populate services
  const svcs = TIBEX_STORE.getServices().filter(s => s.active);
  F('aService').innerHTML = '<option value="">Tanlang...</option>' + svcs.map(s => `<option value="${esc(s.code)}">${esc(s.name)} — ${esc(fmtMoney(s.price))}</option>`).join('');
  // Date/time
  F('aDate').value = today();
  F('aTime').value = nowTime();
  F('aComplaint').value = '';
  F('aPaid').value = 0;
  F('aDebt').value = 0;
  state.appointmentPriority = 'normal';
  state.selectedPatientForAppt = null;
  document.querySelectorAll('#aPriority .priority-option').forEach(o => o.classList.toggle('selected', o.dataset.priority === 'normal'));
  F('aPatientSearch').value = '';
  F('aPatientResults').textContent = '';
  F('aPatientSelected').style.display = 'none';

  if (prefillPatientId) {
    const p = TIBEX_STORE.getPatient(prefillPatientId);
    if (p) selectPatientForAppt(p);
  }

  openModal('modalAppt');
  setTimeout(() => F('aPatientSearch').focus(), 100);
}

function selectPatientForAppt(p) {
  state.selectedPatientForAppt = p;
  document.getElementById('aPatientSearch').value = '';
  document.getElementById('aPatientResults').textContent = '';
  const box = document.getElementById('aPatientSelected');
  box.style.display = 'block';
  box.innerHTML = `✓ ${esc(p.fullname)} · ${esc(p.age)} yosh · ${esc(p.phone)}`;
}

document.getElementById('aPatientSearch')?.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  const res = document.getElementById('aPatientResults');
  if (!q) { res.textContent = ''; return; }
  const found = TIBEX_STORE.getAllPatients().filter(p =>
    p.fullname.toLowerCase().includes(q) || (p.phone || '').includes(q) || String(p.id).includes(q)
  ).slice(0, 8);
  res.innerHTML = found.map(p => `<div style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;cursor:pointer;background:#fff;" data-pt="${esc(p.id)}">
    <b>${esc(p.fullname)}</b> · ${p.age} yosh · <span style="font-family:ui-monospace;color:var(--muted);">${esc(p.phone)}</span>
  </div>`).join('') || '<div style="padding:8px;color:var(--dim);font-size:12px;">Topilmadi</div>';
  res.querySelectorAll('[data-pt]').forEach(d => {
    d.addEventListener('click', () => {
      const p = TIBEX_STORE.getPatient(parseInt(d.dataset.pt));
      if (p) selectPatientForAppt(p);
    });
  });
});

document.querySelectorAll('#aPriority .priority-option').forEach(o => {
  o.addEventListener('click', () => {
    state.appointmentPriority = o.dataset.priority;
    document.querySelectorAll('#aPriority .priority-option').forEach(x => x.classList.remove('selected'));
    o.classList.add('selected');
  });
});

document.getElementById('aService')?.addEventListener('change', (e) => {
  const svcs = TIBEX_STORE.getServices();
  const s = svcs.find(x => x.code === e.target.value);
  if (s) {
    document.getElementById('aPaid').value = s.price;
    document.getElementById('aDebt').value = s.price;
  }
});

document.getElementById('btnSaveAppt')?.addEventListener('click', () => {
  if (!state.selectedPatientForAppt) return toast('Bemorni tanlang', 'warn');
  const F = id => document.getElementById(id);
  const docId = parseInt(F('aDoctor').value);
  if (!docId) return toast('Shifokorni tanlang', 'warn');
  const doc = TIBEX_STORE.getDoctors().find(d => d.id === docId);
  const svcCode = F('aService').value;
  const svc = TIBEX_STORE.getServices().find(s => s.code === svcCode);
  const data = {
    patient_id: state.selectedPatientForAppt.id,
    doctor_id: docId,
    doctor_name: doc ? doc.name : '',
    date: F('aDate').value,
    scheduled_time: F('aTime').value,
    priority: state.appointmentPriority,
    service: svc ? { code: svc.code, name: svc.name, price: svc.price } : { code: '', name: '', price: 0 },
    paid: parseInt(F('aPaid').value) || 0,
    debt: parseInt(F('aDebt').value) || 0,
    complaint: F('aComplaint').value.trim() || null
  };
  TIBEX_STORE.addAppointment(data);
  toast(`✓ Navbat yaratildi: ${esc(state.selectedPatientForAppt.fullname)}`, 'ok');
  closeModal('modalAppt');
  renderAll();
});

/* ═══════════════════ PAYMENTS ═══════════════════ */
function renderPayments() {
  const appts = TIBEX_STORE.getAppointments();
  const pending = appts.filter(a => (a.debt || 0) > 0 && a.status !== 'cancelled');
  document.getElementById('payPendingCount').textContent = pending.length;
  const htmlP = pending.map(a => {
    const p = TIBEX_STORE.getPatient(a.patient_id);
    if (!p) return '';
    return `<tr data-id="${a.id}">
      <td class="time-col">${esc(a.date)}</td>
      <td class="time-col">${esc(a.scheduled_time || '—')}</td>
      <td><b>${esc(p.fullname)}</b><div style="font-size:11px;color:var(--dim);">#${p.id}</div></td>
      <td>${esc(a.doctor_name || '—')}</td>
      <td class="mono" style="color:var(--ok);">${fmtMoney(a.paid || 0)}</td>
      <td class="mono" style="color:var(--danger);font-weight:700;">${fmtMoney(a.debt)}</td>
      <td><div class="row-actions">
        ${QF.can('payments','create') ? '<button data-act="pay" class="success">💰 To\'lash</button>' : ''}
      </div></td>
    </tr>`;
  }).join('');
  document.getElementById('payPendingBody').innerHTML = htmlP || '<tr><td colspan="7" class="empty"><div class="big">✓</div>To\'lov kutayotganlar yo\'q</td></tr>';
  document.querySelectorAll('#payPendingBody button[data-act]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openPaymentModal(parseInt(b.closest('tr').dataset.id));
    });
  });

  // Today's payments
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const payments = TIBEX_STORE.getPayments().filter(p => (p.created_at || 0) >= todayStart.getTime());
  document.getElementById('payTodayCount').textContent = payments.length;
  const total = payments.reduce((s,p) => s + p.amount, 0);
  document.getElementById('payTodaySum').textContent = fmtMoney(total) + ' so\'m';
  const htmlT = payments.slice(0, 100).map((p, i) => {
    const pt = TIBEX_STORE.getPatient(p.patient_id);
    const d = new Date(p.created_at);
    const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const methodLabel = { cash: '💵 Naqd', card: '💳 Karta', online: '📱 Onlayn' }[p.method] || p.method;
    return `<tr>
      <td class="time-col">${i+1}</td>
      <td class="time-col">${timeStr}</td>
      <td>${esc(pt ? pt.fullname : '—')}</td>
      <td class="mono" style="color:var(--ok);font-weight:700;">${fmtMoney(p.amount)}</td>
      <td>${methodLabel}</td>
      <td>${esc(p.cashier || '—')}</td>
    </tr>`;
  }).join('');
  document.getElementById('payTodayBody').innerHTML = htmlT || '<tr><td colspan="6" class="empty"><div class="big">💰</div>Bugun to\'lovlar yo\'q</td></tr>';
}

function openPaymentModal(apptId) {
  const a = TIBEX_STORE.getAppointment(apptId);
  if (!a) return;
  const p = TIBEX_STORE.getPatient(a.patient_id);
  if (!p) return;
  state.paymentTargetAppt = a;
  document.getElementById('payPatientName').textContent = p.fullname;
  document.getElementById('payPatientInfo').textContent = `#${p.id} · ${p.age} yosh · ${a.doctor_name || '—'}`;
  document.getElementById('payOldPaid').textContent = fmtMoney(a.paid || 0) + ' so\'m';
  document.getElementById('payOldDebt').textContent = fmtMoney(a.debt || 0) + ' so\'m';
  document.getElementById('payAmount').value = a.debt || 0;
  document.getElementById('payMethod').value = a.payment_method || 'cash';
  openModal('modalPayment');
  setTimeout(() => document.getElementById('payAmount').focus(), 100);
}

document.getElementById('btnSavePayment')?.addEventListener('click', () => {
  const a = state.paymentTargetAppt;
  if (!a) return;
  const amount = parseInt(document.getElementById('payAmount').value) || 0;
  const method = document.getElementById('payMethod').value;
  if (amount <= 0) return toast('Summani kiriting', 'warn');
  if (amount > (a.debt || 0)) return toast('Summa qarzdan katta', 'warn');
  TIBEX_STORE.addPayment({
    appointment_id: a.id,
    patient_id: a.patient_id,
    amount,
    method,
    services: a.service ? [a.service] : []
  });
  toast(`✓ To'lov qabul qilindi: ${fmtMoney(amount)} so'm`, 'ok');
  closeModal('modalPayment');
  renderAll();
});

/* ═══════════════════ HISTORY ═══════════════════ */
function openHistory(patientId) {
  const p = TIBEX_STORE.getPatient(patientId);
  if (!p) return;
  const appts = TIBEX_STORE.getAppointments({ patient_id: patientId });
  const html = `
    <div style="background:linear-gradient(135deg,var(--primary-tint),#fff);padding:16px;border-radius:8px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;">${esc(initials(p.fullname))}</div>
        <div style="flex:1;">
          <div style="font-size:17px;font-weight:700;">${esc(p.fullname)}</div>
          <div style="font-size:12.5px;color:var(--muted);">#${p.id} · ${p.age} yosh · ${esc(p.gender)} · ${esc(p.blood)}</div>
          <div style="font-size:12.5px;color:var(--muted);">📞 ${esc(p.phone)}${esc(p.address ? ' · 📍 ' + p.address : '')}</div>
        </div>
      </div>
    </div>
    ${(p.allergies || []).length || (p.chronic || []).length ? `<div style="margin-bottom:14px;">
      ${(p.allergies||[]).map(a=>`<span class="tag-item">⚠ ${esc(a)}</span>`).join(' ')}
      ${(p.chronic||[]).map(c=>`<span class="tag-item warn">💊 ${esc(c)}</span>`).join(' ')}
    </div>` : ''}
    <h4 style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">📋 Qabullar (${appts.length})</h4>
    ${appts.length ? appts.map(a => `
      <div class="locked-section">
        <div class="head"><span class="t">${esc(a.date)} ${esc(a.scheduled_time)}</span></div>
        <div class="row"><span class="k">Shifokor</span><span class="v">${esc(a.doctor_name || '—')}</span></div>
        <div class="row"><span class="k">Holat</span><span class="v">${esc(statusLabel(a.status))}</span></div>
        <div class="row"><span class="k">Xizmat</span><span class="v">${esc(a.service?.name || '—')}</span></div>
        ${a.prelim_dx ? `<div class="row"><span class="k">Tashxis</span><span class="v">${esc(a.final_dx || a.prelim_dx)}</span></div>` : ''}
        <div class="row"><span class="k">To'lov</span><span class="v mono">${fmtMoney(a.paid || 0)} / ${fmtMoney((a.paid || 0) + (a.debt || 0))}</span></div>
      </div>
    `).join('') : '<div class="empty">Qabullar yo\'q</div>'}
  `;
  document.getElementById('historyBody').innerHTML = html;
  openModal('modalHistory');
}


/* TIBEX_QABULXONA_IMPROVE_v1: lab natijalarni ko'rish */
function openLabResults(apptId) {
  const a = TIBEX_STORE.getAppointment(apptId);
  if (!a) return;
  const p = TIBEX_STORE.getPatient(a.patient_id);
  if (!p) return;

  const labs = TIBEX_STORE.getLabOrdersByAppt ? TIBEX_STORE.getLabOrdersByAppt(apptId) : [];

  const statusMap = {
    new: '<span class="status waiting">⏳ Yangi</span>',
    received: '<span class="status arrived">📥 Qabul qilindi</span>',
    processing: '<span class="status in_progress">🔬 Jarayonda</span>',
    ready: '<span class="status lab_ready">✅ Tayyor</span>',
    verified: '<span class="status completed">✓ Tasdiqlangan</span>'
  };

  const body = document.getElementById('historyBody');
  body.innerHTML = `
    <div style="background:linear-gradient(135deg,var(--primary-tint),#fff);padding:14px;border-radius:8px;margin-bottom:14px;">
      <div style="font-size:16px;font-weight:700;">${esc(p.fullname)}</div>
      <div style="font-size:12.5px;color:var(--muted);">#${p.id} · ${p.age} yosh · ${esc(a.doctor_name)}</div>
    </div>
    <h4 style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">🔬 Lab so'rovlar (${labs.length})</h4>
    ${labs.length ? labs.map(l => `
      <div class="locked-section">
        <div class="head">
          <span class="t">${esc(l.test_name)}</span>
          ${statusMap[l.status] || esc(l.status)}
        </div>
        <div class="row"><span class="k">So'rov vaqti</span><span class="v mono">${new Date(l.created_at || 0).toLocaleString('uz')}</span></div>
        ${l.result_summary ? `<div class="row"><span class="k">Xulosa</span><span class="v" style="color:var(--primary);">${esc(l.result_summary)}</span></div>` : ''}
        ${l.result_note ? `<div class="row"><span class="k">Izoh</span><span class="v">${esc(l.result_note)}</span></div>` : ''}
      </div>
    `).join('') : '<div class="empty">Lab so\'rov yo\'q</div>'}
  `;
  openModal('modalHistory');
}

/* ═══════════════════ MODAL HELPERS ═══════════════════ */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal-backdrop').classList.remove('open')));
document.querySelectorAll('.modal-backdrop').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));

/* ═══════════════════ TABS ═══════════════════ */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const v = tab.dataset.view;
    state.currentView = v;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
    document.querySelector(`[data-view-content="${v}"]`)?.classList.add('active');
    renderAll();
  });
});

document.querySelectorAll('.filter-chip[data-pfilter]').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip[data-pfilter]').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    state.patientFilter = c.dataset.pfilter;
    renderPatients();
  });
});
document.querySelectorAll('.filter-chip[data-afilter]').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip[data-afilter]').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    state.apptFilter = c.dataset.afilter;
    renderAppointments();
  });
});

/* ═══════════════════ BUTTONS ═══════════════════ */
document.getElementById('btnNewPatient')?.addEventListener('click', () => openPatientModal());
document.getElementById('btnNewPatient2')?.addEventListener('click', () => openPatientModal());
document.getElementById('actNewPatient')?.addEventListener('click', () => openPatientModal());
document.getElementById('qaNewPatient')?.addEventListener('click', () => openPatientModal());

document.getElementById('qaNewAppt')?.addEventListener('click', () => openApptModal());
document.getElementById('btnTodayNewAppt')?.addEventListener('click', () => openApptModal());

document.getElementById('qaSearch')?.addEventListener('click', () => {
  document.querySelector('[data-view="patients"]')?.click();
  setTimeout(() => document.getElementById('patientsSearch')?.focus(), 200);
});

document.getElementById('btnRefresh')?.addEventListener('click', () => { renderAll(); toast('↻ Yangilandi', 'info'); });
document.getElementById('btnHelp')?.addEventListener('click', () => openModal('modalHelp'));

/* ═══════════════════ SEARCH INPUTS ═══════════════════ */
document.getElementById('patientsSearch')?.addEventListener('input', renderPatients);
document.getElementById('apptsSearch')?.addEventListener('input', renderAppointments);

/* ═══════════════════ KEYBOARD ═══════════════════ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
  if (e.key === 'F1') { e.preventDefault(); openModal('modalHelp'); }
  if (e.key === 'F2') { e.preventDefault(); openPatientModal(); }
  if (e.key === 'F3') { e.preventDefault(); openApptModal(); }
  if (e.key === 'F4') { e.preventDefault(); document.querySelector('[data-view="patients"]')?.click(); setTimeout(() => document.getElementById('patientsSearch')?.focus(), 200); }
  if (e.key === 'F5') { e.preventDefault(); renderAll(); }
  if (e.ctrlKey && ['1','2','3','4'].includes(e.key)) {
    e.preventDefault();
    const views = ['dashboard','patients','appointments','payments'];
    document.querySelector(`[data-view="${views[parseInt(e.key)-1]}"]`)?.click();
  }
});

/* ═══════════════════ RENDER ALL ═══════════════════ */
function renderAll() {
  renderDashboard();
  renderPatients();
  renderAppointments();
  renderPayments();
}

/* ═══════════════════ USER INFO ═══════════════════ */
function applyUserInfo() {
  const u = TIBEX_STORE.CURRENT_USER;
  if (!u) return;
  document.getElementById('userName').textContent = u.fullname || u.login;
  document.getElementById('userRole').textContent = u.role || '—';
  document.getElementById('userAvatar').textContent = initials(u.fullname || u.login);
}

/* ═══════════════════ INIT ═══════════════════ */
(async () => {
  try {
    await TIBEX_STORE.init();
    window.CURRENT_USER = TIBEX_STORE.CURRENT_USER;
    applyUserInfo();
    renderAll();
  } catch (e) {
    console.error('[TIBEX] init xato:', e);
    if (e.message === 'UNAUTHORIZED') location.href = '/login.html';
  }
})();

/* ═══════════════════ WEBSOCKET SYNC ═══════════════════ */
TIBEX_STORE.subscribe((data, source) => {
  window.TIBEX_REALTIME_PRO && window.TIBEX_REALTIME_PRO.smartRender ? window.TIBEX_REALTIME_PRO.smartRender() : renderAll();
});
