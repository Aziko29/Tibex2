/* TIBEX_QABULXONA_FULL_v1 — Faza 1: jonli navbat, jadval, qabulxona vositalari */
window.__TIBEX_CLIENT_ROLE__ = 'reception';
(function () {
  'use strict';
  const S = window.TIBEX_STORE;
  const $ = (id) => document.getElementById(id);
  const can = (m, a) => { try { return typeof S.can === 'function' && !!S.can(m, a); } catch (e) { return false; } };
  const cfg = () => { try { return window.TIBEX_SETTINGS.load() || {}; } catch (e) { return {}; } };
  const waitLimit = () => Number(cfg().receptionWaitLimit) || 15;
  const slotStep = () => [15, 20, 30].includes(Number(cfg().receptionSlotStep)) ? Number(cfg().receptionSlotStep) : 30;
  const HOURS = { from: 8 * 60, to: 18 * 60 };
  /* backend/app/state_machine.py bilan mos: reception roli uchun ruxsat etilgan o'tishlar */
  /* backend/app/state_machine.py nusxasi (APPOINTMENT_TRANSITIONS) + reception roli maqsadlari */
  const SM = {
    waiting: ['arrived', 'in_progress', 'delayed', 'cancelled', 'no_show'],
    arrived: ['in_progress', 'delayed', 'cancelled', 'no_show'],
    in_progress: ['lab_waiting', 'completed', 'delayed', 'cancelled'],
    lab_waiting: ['lab_ready', 'completed', 'cancelled'],
    lab_ready: ['completed', 'cancelled'],
    delayed: ['waiting', 'in_progress', 'arrived', 'cancelled', 'no_show'],
    completed: [], cancelled: [], no_show: []
  };
  const RECEP = ['arrived', 'delayed', 'cancelled', 'no_show'];
  const allowed = (a, to) => to !== a.status && (SM[a.status] || []).includes(to) && RECEP.includes(to);
  const ACT = {
    arrived: { t: '✓ Keldi', toast: 'Bemor keldi deb belgilandi' },
    delayed: { t: '⏳ Kechikdi', toast: 'Kechikdi deb belgilandi' },
    cancelled: { t: '✕ Bekor', toast: 'Navbat bekor qilindi', ask: 'Bekor qilish sababi' },
    no_show: { t: '🚫 Kelmadi', toast: 'Kelmadi deb belgilandi', ask: 'Kelmaslik sababi' }
  };
  const FINAL = ['completed', 'cancelled', 'no_show'];
  const COLS = [
    ['Kutmoqda', ['waiting', 'delayed']], ['Keldi', ['arrived']], ['Qabulda', ['in_progress']],
    ['Lab', ['lab_waiting', 'lab_ready']], ['Yakun', ['completed']]
  ];
  let schedDate = today();
  let lastCount = null;
  const min = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const ready = () => !!window.CURRENT_USER;

  function since(a) {
    const ref = a.arrived_at || a.status_changed_at;
    let t = typeof ref === 'number' ? ref : ref ? Date.parse(ref) : NaN;
    if (isNaN(t)) t = Date.parse(a.date + 'T' + (a.scheduled_time || '00:00'));
    return t;
  }
  function fmtWait(t) {
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 0) return '—';
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  const isWaiting = (a) => ['waiting', 'arrived', 'delayed'].includes(a.status);
  const isLate = (a) => isWaiting(a) && (Date.now() - since(a)) / 60000 >= waitLimit();

  function actions(a) {
    const out = [];
    if (FINAL.includes(a.status)) out.push('<span title="Yakuniy holat — o\'zgartirib bo\'lmaydi" aria-label="Yakuniy holat">🔒</span>');
    else if (can('appointments', 'edit')) Object.keys(ACT).filter((to) => allowed(a, to)).forEach((to) => out.push(`<button type="button" data-qf="${to}" aria-label="${escAttr(ACT[to].t)}">${ACT[to].t}</button>`));
    if ((a.debt || 0) > 0 && can('payments', 'create') && a.status !== 'cancelled') out.push('<button type="button" data-qf="pay" aria-label="To\'lov qabul qilish">💰</button>');
    if ((a.status === 'lab_ready' || a.status === 'lab_waiting') && can('lab', 'view')) out.push('<button type="button" data-qf="lab" aria-label="Lab natijalar">🔬</button>');
    out.push('<button type="button" data-qf="history" aria-label="Tarix">📋</button>');
    return out.join('');
  }

  function card(a) {
    const p = S.getPatient(a.patient_id);
    if (!p) return '';
    const pr = a.priority === 'stat' ? 'stat' : a.priority === 'urgent' ? 'urgent' : '';
    const timer = isWaiting(a) ? `<span class="qf-timer ${isLate(a) ? 'late' : ''}" data-qf-since="${since(a)}" title="Kutish vaqti">⏱ ${fmtWait(since(a))}</span>` : '';
    return `<div class="qf-card ${pr}" data-id="${escAttr(a.id)}">
      <div class="nm">${esc(p.fullname)}</div>
      <div class="meta"><span>${esc(a.scheduled_time || '—')}</span><span>${esc(priorityLabel(a.priority))}</span><span>${esc(statusLabel(a.status))}</span>${timer}</div>
      <div class="qf-acts">${actions(a)}</div></div>`;
  }

  function stateBox(icon, text, btnId, btnText) {
    return `<div class="qf-state"><div class="big">${icon}</div><div>${esc(text)}</div>${btnId ? `<button type="button" class="btn" id="${btnId}">${esc(btnText)}</button>` : ''}</div>`;
  }

  function renderBoard() {
    const box = $('qfBoard');
    if (!ready()) { box.innerHTML = '<div class="qf-skel"></div><div class="qf-skel"></div>'; return; }
    if (!can('appointments', 'view')) { box.innerHTML = stateBox('🔒', "Sizda navbatlarni ko'rish uchun ruxsat yo'q"); return; }
    try {
      const appts = S.getAppointments({ date: today() }).filter((a) => a.status !== 'cancelled' && a.status !== 'no_show');
      $('qfLiveCount').textContent = appts.length;
      if (!appts.length) {
        box.innerHTML = stateBox('🛎', "Bugun navbatlar yo'q. Yangi navbat yarating.", can('appointments', 'create') ? 'qfEmptyNew' : '', '➕ Yangi navbat');
        $('qfEmptyNew')?.addEventListener('click', () => openApptModal());
        return;
      }
      const docs = S.getDoctors().filter((d) => d.active);
      box.innerHTML = docs.map((d) => {
        const mine = appts.filter((a) => a.doctor_id === d.id);
        if (!mine.length) return '';
        return `<section class="qf-doc" aria-label="${escAttr(d.name)}"><div class="qf-doc-head"><span>👨‍⚕️ ${esc(d.name)}</span><span>${mine.length}</span></div><div class="qf-cols">` +
          COLS.map(([t, sts]) => { const c = mine.filter((a) => sts.includes(a.status)); return `<div class="qf-col"><h5><span>${t}</span><span>${c.length}</span></h5>${c.map(card).join('')}</div>`; }).join('') +
          '</div></section>';
      }).join('') || stateBox('👨‍⚕️', "Faol shifokorlar bo'yicha navbat yo'q");
    } catch (e) {
      console.error('[QF] board', e);
      box.innerHTML = stateBox('⚠️', "Jonli navbatni chizishda xato", 'qfRetryBoard', '↻ Qayta urinish');
      $('qfRetryBoard')?.addEventListener('click', renderBoard);
    }
  }

  function renderSchedule() {
    const box = $('qfSchedule');
    $('qfDate').value = schedDate;
    if (!ready()) { box.innerHTML = '<div class="qf-skel"></div>'; return; }
    if (!can('appointments', 'view')) { box.innerHTML = stateBox('🔒', "Sizda jadvalni ko'rish uchun ruxsat yo'q"); return; }
    try {
      const docs = S.getDoctors().filter((d) => d.active);
      if (!docs.length) { box.innerHTML = stateBox('👨‍⚕️', "Faol shifokorlar yo'q. Admin shifokor qo'shishi kerak."); return; }
      const step = slotStep();
      const appts = S.getAppointments({ date: schedDate }).filter((a) => a.status !== 'cancelled' && a.status !== 'no_show');
      const canNew = can('appointments', 'create');
      let h = '<table class="qf-sched"><thead><tr><th class="t">Vaqt</th>' + docs.map((d) => `<th>${esc(d.name)}</th>`).join('') + '</tr></thead><tbody>';
      for (let m = HOURS.from; m < HOURS.to; m += step) {
        h += `<tr><td class="t">${hm(m)}</td>`;
        docs.forEach((d) => {
          const here = appts.filter((a) => a.doctor_id === d.id && min(a.scheduled_time) >= m && min(a.scheduled_time) < m + step);
          if (here.length) {
            h += '<td>' + here.map((a) => { const p = S.getPatient(a.patient_id); return `<button type="button" class="qf-busy ${escAttr(a.status)}" data-hist="${escAttr(a.patient_id)}" title="Band: ${escAttr(a.scheduled_time)}">${esc(a.scheduled_time)} ${esc(p ? p.fullname : '—')}</button>`; }).join('') + '</td>';
          } else {
            h += `<td><button type="button" class="qf-slot" data-doc="${escAttr(d.id)}" data-time="${hm(m)}" ${canNew ? '' : 'disabled title="Ruxsat yo\'q"'} aria-label="${escAttr(d.name + ' ' + hm(m) + ' bo\'sh')}">+</button></td>`;
          }
        });
        h += '</tr>';
      }
      box.innerHTML = h + '</tbody></table>';
      box.querySelectorAll('.qf-slot:not(:disabled)').forEach((b) => b.addEventListener('click', () => {
        openApptModal();
        $('aDoctor').value = b.dataset.doc; $('aDate').value = schedDate; $('aTime').value = b.dataset.time;
      }));
      box.querySelectorAll('[data-hist]').forEach((b) => b.addEventListener('click', () => openHistory(parseInt(b.dataset.hist))));
    } catch (e) {
      console.error('[QF] schedule', e);
      box.innerHTML = stateBox('⚠️', 'Jadvalni chizishda xato', 'qfRetrySched', '↻ Qayta urinish');
      $('qfRetrySched')?.addEventListener('click', renderSchedule);
    }
  }

  function lateList() { return ready() ? S.getAppointments({ date: today() }).filter(isLate) : []; }
  function renderLate() {
    const n = lateList().length;
    $('qfLateBadge').textContent = n;
    $('qfLateBadge').hidden = !n;
  }
  function openLate() {
    const l = lateList();
    $('qfLateBody').innerHTML = l.length ? l.map((a) => { const p = S.getPatient(a.patient_id); return `<div class="qf-late-row" data-id="${escAttr(a.id)}"><div><b>${esc(p ? p.fullname : '—')}</b><div class="fs-11 text-muted">${esc(a.doctor_name || '—')} · ${esc(a.scheduled_time || '')} · ${esc(statusLabel(a.status))}</div></div><div class="qf-acts"><span class="qf-timer late" data-qf-since="${since(a)}">⏱ ${fmtWait(since(a))}</span>${actions(a)}</div></div>`; }).join('') : stateBox('✅', `Kutish limiti (${waitLimit()} daqiqa) oshgan bemor yo'q`);
    openModal('modalLate');
  }

  /* karta/qator tugmalari (delegatsiya) */
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-qf]');
    if (!b || b.disabled) return;
    const row = b.closest('[data-id]');
    const id = parseInt(row && row.dataset.id);
    const a = S.getAppointment(id);
    if (!a) return;
    const act = b.dataset.qf;
    if (act === 'pay') return openPaymentModal(id);
    if (act === 'lab') return openLabResults(id);
    if (act === 'history') return openHistory(a.patient_id);
    if (!ACT[act] || !allowed(a, act) || !can('appointments', 'edit')) return toast("Bu amal hozir mumkin emas", 'warn');
    changeStatus(a, act, b);
  });

  /* Sana boshqaruvi */
  const shift = (d) => { const x = new Date(schedDate + 'T00:00:00'); x.setDate(x.getDate() + d); schedDate = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); renderSchedule(); };
  $('qfDatePrev').addEventListener('click', () => shift(-1));
  $('qfDateNext').addEventListener('click', () => shift(1));
  $('qfDateToday').addEventListener('click', () => { schedDate = today(); renderSchedule(); });
  $('qfDate').addEventListener('change', (e) => { if (e.target.value) { schedDate = e.target.value; renderSchedule(); } });
  $('qfLiveRefresh').addEventListener('click', () => { S.refresh && S.refresh(); renderAll(); toast('↻ Yangilandi', 'info'); });

  /* Vositalar */
  $('qfFind').addEventListener('click', () => $('qaSearch').click());
  $('qfLate').addEventListener('click', openLate);

  /* Chek */
  let clinic = {};
  function receiptList() {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const l = S.getPayments().filter((p) => (p.created_at || 0) >= t0.getTime());
    $('qfReceiptBody').innerHTML = l.length ? l.map((p) => { const pt = S.getPatient(p.patient_id); return `<div class="qf-rc"><span>#${esc(p.id)} · ${esc(pt ? pt.fullname : '—')} · <b>${esc(fmtMoney(p.amount))}</b></span><button type="button" class="btn" data-rc="${escAttr(p.id)}" aria-label="Chekni chop etish">🖨</button></div>`; }).join('') : stateBox('🧾', "Bugun to'lovlar yo'q");
  }
  $('qfReceipt').addEventListener('click', async () => {
    if (!can('payments', 'view')) return toast("Ruxsat yo'q", 'warn');
    try { clinic = await S.getSettings() || {}; } catch (e) { clinic = {}; }
    receiptList(); openModal('modalReceipt');
  });
  $('qfReceiptBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rc]'); if (!b) return;
    const p = S.getPayments().find((x) => String(x.id) === b.dataset.rc); if (!p) return;
    const pt = S.getPatient(p.patient_id); const d = new Date(p.created_at);
    const M = { cash: 'Naqd', card: 'Karta', online: 'Onlayn' };
    $('qfPrintArea').innerHTML = `<h4>${esc(clinic.clinic_name || 'Klinika')}</h4><p>${esc(clinic.clinic_phone || '')}</p><p>${esc(clinic.clinic_address || '')}</p><hr>
      <div class="r"><span>Chek №</span><span>${esc(p.id)}</span></div><div class="r"><span>Sana</span><span>${esc(fmtDate(d))} ${esc(String(d.getHours()).padStart(2, '0'))}:${esc(String(d.getMinutes()).padStart(2, '0'))}</span></div>
      <div class="r"><span>Bemor</span><span>${esc(pt ? pt.fullname : '—')}</span></div><div class="r"><span>Usul</span><span>${esc(M[p.method] || p.method || '')}</span></div>
      <div class="r"><b>Summa</b><b>${esc(fmtMoney(p.amount))} so'm</b></div><hr><p>Rahmat!</p>`;
    document.body.classList.add('qf-printing');
    const done = () => { document.body.classList.remove('qf-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  });
  $('qfPrint').addEventListener('click', () => { const f = $('qfReceiptBody').querySelector('[data-rc]'); f ? f.click() : toast("Chop etiladigan chek yo'q", 'warn'); });

  /* Tezkor ro'yxatga olish (2 qadam) */
  let qrStep = 1, qrBusy = false;
  const fmtPhone = (v) => { let d = v.replace(/\D/g, ''); if (d.startsWith('998')) d = d.slice(3); d = d.slice(0, 9); const g = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean); return '+998' + (g.length ? ' ' + g.join(' ') : ' '); };
  $('qrPhone').addEventListener('input', (e) => { e.target.value = fmtPhone(e.target.value); });
  function qrShow(step) {
    qrStep = step;
    $('qrStep1').classList.toggle('qf-hidden', step !== 1); $('qrStep2').classList.toggle('qf-hidden', step !== 2);
    $('qrBack').hidden = step === 1; $('qrNext').textContent = step === 1 ? 'Keyingisi ▶' : '✓ Saqlash';
    $('qrTitle').textContent = `⚡ Tezkor ro'yxatga olish — ${step}/2`; $('qrErr').textContent = '';
  }
  $('qfQuickReg').addEventListener('click', () => {
    if (!can('patients', 'create') || !can('appointments', 'create')) return toast("Ruxsat yo'q", 'warn');
    $('qrName').value = ''; $('qrPhone').value = '+998 '; $('qrAge').value = '';
    $('qrDoctor').innerHTML = '<option value="">Tanlang...</option>' + S.getDoctors().filter((d) => d.active).map((d) => `<option value="${escAttr(d.id)}">${esc(d.name)} — ${esc(d.specialty)}</option>`).join('');
    $('qrService').innerHTML = '<option value="">Tanlang...</option>' + S.getServices().filter((s) => s.active).map((s) => `<option value="${escAttr(s.code)}">${esc(s.name)} — ${esc(fmtMoney(s.price))}</option>`).join('');
    $('qrDate').value = today(); $('qrTime').value = nowTime();
    qrShow(1); openModal('modalQuick'); setTimeout(() => $('qrName').focus(), 80);
  });
  $('qrBack').addEventListener('click', () => qrShow(1));
  $('qrNext').addEventListener('click', async () => {
    if (qrBusy) return;
    const err = (m) => { $('qrErr').textContent = m; };
    if (qrStep === 1) {
      if ($('qrName').value.trim().length < 3) return err("F.I.Sh kiriting (kamida 3 belgi)");
      if (!/^\+998 \d{2} \d{3} \d{2} \d{2}$/.test($('qrPhone').value)) return err("Telefon +998 XX XXX XX XX formatida bo'lsin");
      const age = parseInt($('qrAge').value); if (!(age >= 0 && age <= 120)) return err("Yosh 0–120 oralig'ida bo'lsin");
      return qrShow(2);
    }
    const doc = S.getDoctors().find((d) => String(d.id) === $('qrDoctor').value);
    const svc = S.getServices().find((s) => s.code === $('qrService').value);
    if (!doc || !svc) return err('Shifokor va xizmatni tanlang');
    if (!$('qrDate').value || !$('qrTime').value) return err('Sana va vaqtni kiriting');
    qrBusy = true; $('qrNext').disabled = true; $('qrNext').textContent = '⏳ Saqlanmoqda...';
    let pt = null;
    try {
      pt = await S._api('/api/patients', { method: 'POST', body: { fullname: $('qrName').value.trim(), phone: $('qrPhone').value, age: parseInt($('qrAge').value), gender: $('qrGender').value, blood: "Noma'lum", address: '', allergies: [], chronic: [] } });
      await S._api('/api/appointments', { method: 'POST', body: { patient_id: pt.id, doctor_id: doc.id, doctor_name: doc.name, date: $('qrDate').value, scheduled_time: $('qrTime').value, priority: 'normal', service: { code: svc.code, name: svc.name, price: svc.price }, paid: 0, debt: 0, complaint: null } });
      closeModal('modalQuick'); toast("✓ Bemor va navbat yaratildi", 'ok');
    } catch (e) {
      err((pt ? "Bemor yaratildi, lekin navbat yaratilmadi: " : '') + (e && e.message ? e.message : 'Xato'));
    } finally {
      qrBusy = false; $('qrNext').disabled = false; $('qrNext').textContent = '✓ Saqlash';
      S.refresh && S.refresh();
    }
  });

  /* Ruxsat bo'yicha ko'rinish: data-perm="modul.amal&modul.amal" */
  function applyPerms() {
    document.querySelectorAll('[data-perm]').forEach((el) => {
      el.hidden = !el.dataset.perm.split('&').every((k) => can(k.split('.')[0], k.split('.')[1]));
    });
    const act = document.querySelector('.tab.active');
    if (act && act.hidden) document.querySelector('.tab[data-view="dashboard"]').click();
  }

  function beep() {
    try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(); o.frequency.value = 880; o.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close(); }, 150); } catch (e) { /* ovoz mavjud emas */ }
  }

  const baseRenderAll = window.renderAll;
  window.renderAll = function () {
    baseRenderAll();
    if (!ready()) return;
    applyPerms(); renderBoard(); renderSchedule(); renderLate();
    const n = S.getAppointments({ date: today() }).length;
    if (lastCount !== null && n > lastCount && cfg().receptionNewApptSound) beep();
    lastCount = n;
  };

  setInterval(() => {
    document.querySelectorAll('[data-qf-since]').forEach((el) => {
      const t = +el.dataset.qfSince; el.textContent = '⏱ ' + fmtWait(t);
      el.classList.toggle('late', (Date.now() - t) / 60000 >= waitLimit());
    });
  }, 1000);
  setInterval(() => { if (ready()) renderLate(); }, 60000);

  /* Boshlang'ich holat: init tugagach (CURRENT_USER o'rnatiladi) */
  let tries = 0;
  const boot = setInterval(() => {
    if (ready() || ++tries > 100) {
      clearInterval(boot);
      if (!ready()) return;
      window.renderAll();
      const v = cfg().receptionStartView;
      const tab = v && document.querySelector('.tab[data-view="' + v + '"]');
      if (tab && !tab.hidden) tab.click();
    }
  }, 100);

  /* ═════════ FAZA 2: to'liq interaktiv funksiyalar ═════════ */
  const Q = window.QF = { can: can, rowActions: (a) => `<td-actions></td-actions>` };
  Q.rowActions = (a) => `<div class="row-actions">${actions(a)}</div>`;
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const wait = (fn, ms) => new Promise((res) => { const t0 = Date.now(); (function tick() { const v = fn(); if (v || Date.now() - t0 > ms) return res(v); setTimeout(tick, 150); })(); });

  /* Backend xatolarini xaritalash (401 ni klient o'zi login'ga yo'naltiradi) */
  function fail(e, errEl) {
    const st = e && e.status, msg = (e && e.message) || 'Xato';
    let m;
    if (msg === 'UNAUTHORIZED') return;
    if (st === 403) { m = "Sizda bu amal uchun ruxsat yo'q"; S.refresh(); applyPerms(); }
    else if (st === 404) { m = "Yozuv o'chirilgan. Ro'yxat yangilanmoqda"; S.refresh(); }
    else if (st === 409) { m = msg + ". Yangi ma'lumot yuklanmoqda"; S.refresh(); }
    else if (st === 400 || st === 422) m = msg;
    else if (st === 429) m = "Biroz kuting va qayta urinib ko'ring";
    else m = "Server bilan aloqa xatosi. Qayta urinib ko'ring";
    if (errEl) errEl.textContent = m;
    toast(m, 'bad');
  }
  Q.fail = fail;
  async function busy(btn, fn) {
    if (btn.disabled) return;
    const t = btn.textContent; btn.disabled = true; btn.textContent = '⏳ ...';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; }
  }
  /* Sabab/tasdiq oynasi: Promise<string|null> (null = bekor) */
  function ask(o) {
    return new Promise((res) => {
      $('askTitle').textContent = o.title; $('askText').textContent = o.text || '';
      $('askReason').hidden = !o.reason; $('askReason').value = ''; $('askErr').textContent = '';
      const ok = $('askOk'); ok.textContent = o.ok || 'Tasdiqlash';
      const m = $('modalAsk'); let done = false;
      const fin = (v) => { if (done) return; done = true; obs.disconnect(); ok.onclick = null; closeModal('modalAsk'); res(v); };
      ok.onclick = () => { const r = $('askReason').value.trim(); if (o.reason && r.length < 3) { $('askErr').textContent = 'Sabab kamida 3 belgi'; return; } fin(o.reason ? r : 'ok'); };
      const obs = new MutationObserver(() => { if (!m.classList.contains('open')) fin(null); });
      obs.observe(m, { attributes: true, attributeFilter: ['class'] });
      openModal('modalAsk'); setTimeout(() => (o.reason ? $('askReason') : ok).focus(), 60);
    });
  }
  async function changeStatus(a, to, btn) {
    let reason = null;
    if (ACT[to].ask) { reason = await ask({ title: ACT[to].t, text: ACT[to].ask, reason: true, ok: ACT[to].t }); if (!reason) return; }
    if (btn) btn.disabled = true;
    try {
      const body = { status: to }; if (reason) body.cancel_reason = reason; /* backend maydoni Faza 3 */
      await S._api('/api/appointments/' + a.id, { method: 'PATCH', body: body });
      toast(ACT[to].toast, 'ok'); S.refresh();
    } catch (e) { fail(e); } finally { if (btn) btn.disabled = false; }
  }

  /* Qadam-qadam tekshiruv yordamchilari */
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const phoneOk = (v) => /^\+998 \d{2} \d{3} \d{2} \d{2}$/.test(v);
  function findDup(name, phone, age, exceptId) {
    const d = digits(phone), n = name.trim().toLowerCase();
    return S.getAllPatients().find((p) => p.id !== exceptId && p.id > 0 && ((d.length >= 12 && digits(p.phone) === d) || (p.fullname.trim().toLowerCase() === n && Number(p.age) === Number(age))));
  }

  /* ── BEMORLAR ── */
  let pPage = 1; const PAGE = 25;
  Q.patientActions = (p) => {
    const b = [];
    if (can('appointments', 'create')) b.push('<button type="button" class="success" data-qp="appt" aria-label="Yangi navbat">📅 Navbat</button>');
    b.push('<button type="button" data-qp="hist" aria-label="Tarix">📋 Tarix</button>');
    if (can('patients', 'edit')) b.push('<button type="button" data-qp="edit" aria-label="Tahrirlash">✏️</button><button type="button" data-qp="acc" aria-label="Bemor kabineti">🔑</button>');
    if (can('patients', 'delete')) b.push('<button type="button" class="danger" data-qp="del" aria-label="O\'chirish">🗑</button>');
    return '<div class="row-actions">' + b.join('') + '</div>';
  };
  window.renderPatients = function () {
    const body = $('patientsBody'); if (!body || !ready()) return;
    if (!can('patients', 'view')) { body.innerHTML = `<tr><td colspan="7">${stateBox('🔒', "Ruxsat yo'q: bemorlar ro'yxatini ko'rish mumkin emas")}</td></tr>`; $('pPager').innerHTML = ''; return; }
    const q = ($('patientsSearch').value || '').toLowerCase().trim();
    let all = S.getAllPatients().filter((p) => p.id > 0);
    $('pfAll').textContent = all.length;
    const f = state.patientFilter;
    if (f === 'recent') all = all.filter((p) => (p.created_at || 0) >= Date.now() - 7 * 86400000);
    else if (f === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); all = all.filter((p) => (p.created_at || 0) >= d.getTime()); }
    else if (f === 'debtor') { const ids = new Set(S.getAppointments().filter((a) => (a.debt || 0) > 0 && a.status !== 'cancelled').map((a) => a.patient_id)); all = all.filter((p) => ids.has(p.id)); }
    else if (f === 'visit') { const ids = new Set(S.getAppointments({ date: today() }).filter((a) => a.status !== 'waiting' && a.status !== 'cancelled' && a.status !== 'no_show').map((a) => a.patient_id)); all = all.filter((p) => ids.has(p.id)); }
    if (q) all = all.filter((p) => p.fullname.toLowerCase().includes(q) || digits(p.phone).includes(digits(q)) && digits(q) || String(p.id) === q.replace('#', ''));
    all.sort((a, b) => b.id - a.id);
    const pages = Math.max(1, Math.ceil(all.length / PAGE)); if (pPage > pages) pPage = pages;
    const rows = all.slice((pPage - 1) * PAGE, pPage * PAGE);
    body.innerHTML = rows.map((p) => `<tr data-id="${escAttr(p.id)}"><td class="time-col">#${esc(p.id)}</td>
      <td><b>${esc(p.fullname)}</b>${(p.allergies || []).length ? `<div class="fs-11 text-danger">⚠ ${esc(p.allergies.join(', '))}</div>` : ''}</td>
      <td class="mono">${esc(p.phone || '—')}</td><td class="mono">${esc(p.age)}</td><td>${p.gender === 'Erkak' ? '👨' : '👩'}</td><td class="mono">${esc(p.blood)}</td>
      <td>${Q.patientActions(p)}</td></tr>`).join('') || `<tr><td colspan="7">${stateBox('🧑', q || f !== 'all' ? 'Bemor topilmadi. Qidiruv yoki filtrni o\'zgartiring.' : "Bemorlar yo'q. Birinchi bemorni qo'shing.", can('patients', 'create') && !q && f === 'all' ? 'qfEmptyPt' : '', '➕ Yangi bemor')}</td></tr>`;
    $('qfEmptyPt')?.addEventListener('click', () => openPatientModal());
    $('pPager').innerHTML = all.length > PAGE ? `<button type="button" class="btn" data-pg="-1" ${pPage <= 1 ? 'disabled' : ''}>◀</button><span>${pPage} / ${pages} · ${all.length} ta</span><button type="button" class="btn" data-pg="1" ${pPage >= pages ? 'disabled' : ''}>▶</button>` : '';
  };
  $('pPager').addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) { pPage += +b.dataset.pg; renderPatients(); } });
  /* Serverdan qidiruv: 30 kundan eski bemorlar snapshotda yo'q (TIBEX_RECEPTION_SYNC_v1) */
  let remoteT = null, remoteSeq = 0, redispatch = false;
  function remoteFind(q, after) {
    if (redispatch) return;
    clearTimeout(remoteT);
    q = (q || '').trim();
    if (q.replace('#', '').length < (q[0] === '#' ? 1 : 3) || !can('patients', 'view')) return;
    remoteT = setTimeout(async () => {
      const my = ++remoteSeq;
      try {
        const list = await S._api('/api/patients?limit=50&q=' + encodeURIComponent(q));
        if (my === remoteSeq && S.mergePatients(list)) after();
      } catch (e) { /* qidiruv xatosi asosiy oqimni to'xtatmasin */ }
    }, 350);
  }
  $('patientsSearch').addEventListener('input', (e) => { remoteFind(e.target.value, () => renderPatients()); });
  $('aPatientSearch').addEventListener('input', (e) => {
    remoteFind(e.target.value, () => { redispatch = true; try { $('aPatientSearch').dispatchEvent(new Event('input')); } finally { redispatch = false; } });
  });
  $('patientsSearch').addEventListener('input', () => { pPage = 1; renderPatients(); }); /* eski listener asl renderPatients'ni chaqiradi — shundan keyin bizniki qayta chizadi */
  document.querySelectorAll('.filter-chip[data-pfilter]').forEach((c) => c.addEventListener('click', () => { pPage = 1; }));

  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-qp]'); if (!b || b.disabled) return;
    const id = parseInt(b.closest('tr').dataset.id), p = S.getPatient(id); if (!p) return;
    const act = b.dataset.qp;
    if (act === 'appt') openApptModal(id);
    else if (act === 'hist') openHistory(id);
    else if (act === 'edit') openPatientModal(id);
    else if (act === 'acc') openAccount(p);
    else if (act === 'del') {
      if (!can('patients', 'delete')) return toast("Ruxsat yo'q", 'warn');
      const c = S.countPatientData ? S.countPatientData(id) : { appointments: 0, labs: 0, payments: 0 };
      const ok = await ask({ title: "🗑 Bemorni o'chirish", text: `${p.fullname}: ${c.appointments} navbat, ${c.payments} to'lov, ${c.labs} lab. O'chirilsinmi?`, ok: "O'chirish" });
      if (!ok) return;
      b.disabled = true;
      try { await S._api('/api/patients/' + id, { method: 'DELETE' }); S.forgetPatient && S.forgetPatient(id); toast("✓ Bemor o'chirildi", 'ok'); S.refresh(); } catch (er) { fail(er); } finally { b.disabled = false; }
    }
  });

  /* Bemor formasi */
  const _opm = window.openPatientModal;
  window.openPatientModal = function (id) {
    if (!can('patients', id ? 'edit' : 'create')) return toast("Sizda bu amal uchun ruxsat yo'q", 'warn');
    _opm(id); $('pErr').textContent = '';
    if (!id) $('pPhone').value = '+998 ';
  };
  $('pPhone').addEventListener('input', (e) => { e.target.value = fmtPhone(e.target.value); });
  (function () {
    const old = $('btnSavePatient'), btn = old.cloneNode(true); old.replaceWith(btn);
    btn.addEventListener('click', () => busy(btn, async () => {
      const err = (m) => { $('pErr').textContent = m; };
      const name = $('pName').value.trim(), phone = $('pPhone').value.trim(), ageRaw = $('pAge').value;
      const age = parseInt(ageRaw), editId = state.editingPatientId;
      if (name.length < 3) return err('F.I.Sh majburiy (kamida 3 belgi)');
      if (!phoneOk(phone)) return err("Telefon +998 XX XXX XX XX formatida bo'lsin");
      if (ageRaw === '' || !(age >= 0 && age <= 120)) return err("Yosh 0–120 oralig'ida bo'lsin");
      if (!can('patients', editId ? 'edit' : 'create')) return err("Ruxsat yo'q");
      const dup = findDup(name, phone, age, editId);
      if (dup) {
        const go = await ask({ title: '⚠ Takror bemor', text: `Shu bemor mavjud: ${dup.fullname} (#${dup.id}). Ochilsinmi?`, ok: 'Ochish' });
        if (go) { closeModal('modalPatient'); openHistory(dup.id); }
        return;
      }
      const data = { fullname: name, phone: phone, age: age, gender: $('pGender').value, blood: $('pBlood').value, address: $('pAddress').value.trim(), allergies: state.patientAllergies, chronic: state.patientChronic };
      try {
        if (editId) { await S._api('/api/patients/' + editId, { method: 'PATCH', body: data }); toast('✓ Bemor yangilandi', 'ok'); closeModal('modalPatient'); S.refresh(); }
        else {
          const np = await S._api('/api/patients', { method: 'POST', body: data });
          toast('✓ Yangi bemor: ' + name, 'ok'); closeModal('modalPatient'); S.refresh();
          if (can('appointments', 'create') && await wait(() => S.getPatient(np.id), 4000)) openApptModal(np.id);
        }
      } catch (e) { fail(e, $('pErr')); }
    }));
  })();

  /* Bemor kabineti */
  let accPatient = null;
  function openAccount(p) {
    if (!can('patients', 'edit')) return toast("Ruxsat yo'q", 'warn');
    accPatient = p; $('accInfo').textContent = p.fullname + ' · ' + (p.phone || ''); $('accPass').value = ''; $('accErr').textContent = '';
    openModal('modalAcc'); setTimeout(() => $('accPass').focus(), 60);
  }
  function accSave(kind) {
    return (e) => busy(e.currentTarget, async () => {
      const pw = $('accPass').value;
      if (pw.length < 10) { $('accErr').textContent = 'Parol kamida 10 belgi'; return; }
      try {
        if (kind === 'create') await S.createPatientAccount(accPatient.id, pw); else await S.resetPatientPassword(accPatient.id, pw);
        toast(kind === 'create' ? '✓ Kabinet yaratildi' : '✓ Parol yangilandi', 'ok'); closeModal('modalAcc');
      } catch (er) { fail(er, $('accErr')); }
    });
  }
  $('accOk').addEventListener('click', accSave('create'));
  $('accReset').addEventListener('click', accSave('reset'));

  /* ── NAVBAT YARATISH ── */
  const _oam = window.openApptModal;
  window.openApptModal = function (pid) {
    if (!can('appointments', 'create')) return toast("Sizda bu amal uchun ruxsat yo'q", 'warn');
    _oam(pid); $('aErr').textContent = '';
  };
  (function () {
    const old = $('btnSaveAppt'), btn = old.cloneNode(true); old.replaceWith(btn);
    btn.addEventListener('click', () => busy(btn, async () => {
      const err = (m) => { $('aErr').textContent = m; };
      const p = state.selectedPatientForAppt;
      if (!p) return err('Bemorni tanlang');
      const doc = S.getDoctors().find((d) => String(d.id) === $('aDoctor').value && d.active);
      if (!doc) return err('Faol shifokorni tanlang');
      const svc = S.getServices().find((x) => x.code === $('aService').value && x.active);
      if (!svc) return err('Faol xizmatni tanlang');
      const date = $('aDate').value, time = $('aTime').value;
      if (!date || !time) return err('Sana va vaqtni kiriting');
      if (date < today()) return err("O'tgan sanaga navbat yozib bo'lmaydi");
      if (date === today() && time < nowTime()) return err("O'tgan vaqtga navbat yozib bo'lmaydi");
      const step = slotStep(), tm = min(time);
      const clash = S.getAppointments({ date: date }).find((a) => a.doctor_id === doc.id && !['cancelled', 'no_show'].includes(a.status) && Math.floor(min(a.scheduled_time) / step) === Math.floor(tm / step));
      if (clash) return err(`Bu slot band (${clash.scheduled_time}). Boshqa vaqt tanlang`);
      if (!can('appointments', 'create')) return err("Ruxsat yo'q");
      try {
        await S._api('/api/appointments', { method: 'POST', body: { patient_id: p.id, doctor_id: doc.id, doctor_name: doc.name, date: date, scheduled_time: time, priority: state.appointmentPriority, service: { code: svc.code, name: svc.name, price: svc.price }, paid: 0, debt: 0, complaint: $('aComplaint').value.trim() || null } });
        toast('✓ Navbat yaratildi: ' + p.fullname, 'ok'); closeModal('modalAppt'); S.refresh();
      } catch (e) { fail(e, $('aErr')); }
    }));
  })();

  /* ── TO'LOV ── */
  let payCfg = { discount_limit: 0, vat: false };
  function payCalc() {
    const a = state.paymentTargetAppt; if (!a) return;
    const price = (a.service && a.service.price) || 0;
    const dp = parseInt($('payDiscount').value) || 0;
    const total = price - Math.round(price * dp / 100), max = Math.max(0, total - (a.paid || 0));
    const amt = parseInt($('payAmount').value) || 0;
    $('payCalc').innerHTML = `<div class="kv-row-tight"><span>Xizmat:</span><b class="font-mono">${esc(fmtMoney(price))}</b></div><div class="kv-row-tight"><span>Chegirmadan keyin:</span><b class="font-mono">${esc(fmtMoney(total))}</b></div><div class="kv-row-tight"><span>Maksimal to'lov:</span><b class="font-mono">${esc(fmtMoney(max))}</b></div>` + (payCfg.vat ? `<div class="kv-row-tight"><span>Shundan QQS (12%):</span><b class="font-mono">${esc(fmtMoney(Math.round(amt * 12 / 112)))}</b></div>` : '');
    return { dp: dp, max: max, amt: amt };
  }
  window.openPaymentModal = async function (apptId) {
    if (!can('payments', 'create')) return toast("Sizda bu amal uchun ruxsat yo'q", 'warn');
    try { const st = await S.getSettings(true); payCfg = { discount_limit: Math.max(0, parseInt(st.discount_limit) || 0), vat: !!st.vat }; } catch (e) { return fail(e); }
    const a = S.getAppointment(apptId), pt = a && S.getPatient(a.patient_id); if (!a || !pt) return;
    state.paymentTargetAppt = a;
    $('payPatientName').textContent = pt.fullname; $('payPatientInfo').textContent = `#${pt.id} · ${pt.age} yosh · ${a.doctor_name || '—'}`;
    $('payOldPaid').textContent = fmtMoney(a.paid || 0) + " so'm"; $('payOldDebt').textContent = fmtMoney(a.debt || 0) + " so'm";
    $('payAmount').value = a.debt || 0; $('payMethod').value = 'cash'; $('payDiscount').value = 0; $('payDiscount').max = payCfg.discount_limit;
    $('payDiscount').disabled = payCfg.discount_limit === 0; $('payDiscHint').textContent = `(maks. ${payCfg.discount_limit}%)`; $('payErr').textContent = '';
    [...$('payMethod').options].forEach((o) => { if (o.value === 'online') o.textContent = "📱 Onlayn / o'tkazma"; });
    payCalc(); openModal('modalPayment');
  };
  ['payAmount', 'payDiscount'].forEach((i) => $(i).addEventListener('input', payCalc));
  (function () {
    const old = $('btnSavePayment'), btn = old.cloneNode(true); old.replaceWith(btn);
    btn.addEventListener('click', () => busy(btn, async () => {
      const err = (m) => { $('payErr').textContent = m; };
      const a = state.paymentTargetAppt; if (!a) return;
      const c = payCalc(), method = $('payMethod').value;
      if (!can('payments', 'create')) return err("Ruxsat yo'q");
      if (!(c.amt > 0)) return err('Summani kiriting');
      if (c.dp < 0 || c.dp > payCfg.discount_limit) return err(`Chegirma 0–${payCfg.discount_limit}% oralig'ida bo'lsin (admin limiti)`);
      if (c.amt > c.max) return err(`Summa ruxsat etilgan maksimumdan katta (${fmtMoney(c.max)})`);
      const svcCode = a.service && a.service.code; if (!svcCode) return err('Navbatda xizmat kodi yo\'q');
      try {
        await S._api('/api/payments', { method: 'POST', headers: { 'Idempotency-Key': uuid() }, body: { appointment_id: a.id, patient_id: a.patient_id, amount: c.amt, method: method, services: [{ code: svcCode }], discount_percent: c.dp } });
        toast(`✓ To'lov qabul qilindi: ${fmtMoney(c.amt)} so'm`, 'ok'); closeModal('modalPayment'); S.refresh();
      } catch (e) { fail(e, $('payErr')); }
    }));
  })();

  /* Excel eksport (backend /api/export/payments.xlsx — formula-injection himoyasi serverda) */
  $('qfExport').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    if (!can('reports', 'export')) return toast("Ruxsat yo'q", 'warn');
    try {
      const r = await fetch('/api/export/payments.xlsx', { credentials: 'include' });
      if (!r.ok) { const er = new Error(r.statusText); er.status = r.status; throw er; }
      const u = URL.createObjectURL(await r.blob()), l = document.createElement('a');
      l.href = u; l.download = 'tolovlar.xlsx'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000);
    } catch (er) { fail(er); }
  }));

  /* Ruxsatsiz yashirin tabga dasturiy o'tishni to'sish (F4, Ctrl+N) */
  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('.tab[hidden]'); if (t) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

  /* Modal fokus tuzog'i + ochilganda/yopilganda fokus */
  const openers = new Map();
  const mo = new MutationObserver((list) => list.forEach((r) => {
    const m = r.target, open = m.classList.contains('open');
    if (open && !openers.has(m)) { openers.set(m, r.oldValue && r.oldValue.includes('open') ? null : document.activeElement); }
    if (!open && openers.has(m)) { const o = openers.get(m); openers.delete(m); if (o && o.focus && document.contains(o)) o.focus(); }
  }));
  document.querySelectorAll('.modal-backdrop').forEach((m) => mo.observe(m, { attributes: true, attributeFilter: ['class'], attributeOldValue: true }));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const m = [...document.querySelectorAll('.modal-backdrop.open')].pop(); if (!m) return;
    const f = [...m.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && !x.hidden && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!m.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
})();
