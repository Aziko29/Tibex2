
/* TIBEX_DT_FMT_v1 */
function _tibexFmtDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/* ===== block_0 ===== */
/* ═══════════════════════════════════════════════════════════
   TIBEX SHARED STORE — barcha konsollar uchun umumiy
   ═══════════════════════════════════════════════════════════ */
// TIBEX_STORE endi static/tibex-client.js dan keladi

/* ═══════════════════════════════════════════════════════════
   SINXRONIZATSIYA QATLAMI
   ═══════════════════════════════════════════════════════════ */
// CURRENT_USER endi TIBEX_STORE.CURRENT_USER dan (init paytida) olinadi
function can(module, action) {
  try {
    const role = TIBEX_STORE.getRoleByKey(CURRENT_USER.role);
    if (!role) {
      const defaults = {
        cashier: ['patients.view','appointments.view','payments.view','payments.create','payments.refund','payments.close_shift','services.view','reports.view','audit.view'],
        admin: ['*']
      };
      const list = defaults[CURRENT_USER.role] || [];
      if (list.includes('*')) return true;
      return list.includes(`${module}.${action}`);
    }
    if (role.permissions === '*') return true;
    return (role.permissions || []).includes(`${module}.${action}`);
  } catch (e) { return false; }
}

function applyPermissions() {
  document.querySelectorAll('[data-perm]').forEach(el => {
    const [mod, act] = el.dataset.perm.split('.');
    if (!can(mod, act)) {
      el.disabled = true;
      el.style.opacity = .45;
      el.title = 'Ruxsat yo\'q';
    } else {
      el.disabled = false;
      el.style.opacity = '';
    }
  });
}

/* ═══ ADMIN PANELDAN: TO'LOV INTEGRATSIYALARI SIDEBAR ═══ */
function renderPaymentIntegrations() {
  const ints = TIBEX_STORE.getIntegrations() || [];
  const payments = ints.filter(i => i.type === 'payment');
  const box = document.getElementById('paymentIntegrationsList');
  if (!box) return;
  if (payments.length === 0) {
    box.innerHTML = '<div style="font-size:11px;color:var(--dim);text-align:center;padding:8px;">To\'lov tizimlari yo\'q</div>';
    return;
  }
  box.innerHTML = payments.map(p => {
    const dot = p.status === 'connected' ? 'ok' : p.status === 'error' ? 'err' : 'warn';
    const label = p.status === 'connected' ? 'Ulangan' : p.status === 'error' ? 'Xatolik' : p.status === 'pending' ? 'Kutilmoqda' : 'Uzilgan';
    return `<div class="integr-row" title="${esc(p.name)} · ${escAttr(p.provider || '')}">
      <span class="name"><span class="dot ${dot}"></span><span>${esc(p.name)}</span></span>
      <span class="label ${dot}">${label}</span>
    </div>`;
  }).join('');
}

/* ═══ ADMIN PANELDAN: XIZMATLAR SIDEBAR ═══ */
function renderServicesSidebar() {
  const services = TIBEX_STORE.getServices() || [];
  const box = document.getElementById('servicesSidebarList');
  if (!box) return;
  if (services.length === 0) {
    box.innerHTML = '<div style="font-size:11px;color:var(--dim);text-align:center;padding:8px;">Xizmatlar yo\'q</div>';
    return;
  }
  const grouped = {};
  services.filter(s => s.active).forEach(s => {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  });
  box.innerHTML = Object.entries(grouped).map(([cat, list]) => `
    <div style="margin-bottom:6px;">
      <div style="font-weight:700;font-size:10.5px;text-transform:uppercase;color:var(--dim);margin-bottom:4px;">${esc(cat)}</div>
      ${list.map(s => `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:11.5px;">
        <span>${esc(s.name)}</span>
        <span style="font-family:ui-monospace;font-weight:600;color:var(--gold);">${fmtMoney(s.price)}</span>
      </div>`).join('')}
    </div>
  `).join('');
}

/* ═══════════════════════════════════════════════════════════
   KASSA LOGIKASI
   ═══════════════════════════════════════════════════════════ */
const state = {
  currentView: 'pending',
  currentFilter: 'all',
  currentAuditFilter: 'all',
  selectedApptId: null,
  paymentCart: [],
  paymentMethod: 'cash',
  paymentDiscount: 0
};

/* TIBEX_DISCOUNT_LIMIT_v1: admin sozlagan chegirma limitini system_info'dan o'qish */
function discountLimit() {
  const all = TIBEX_STORE.getAll();
  const lim = all?.system_info?.finance?.discount_limit;
  return Number.isFinite(lim) ? lim : 20;
}
function vatEnabled() {
  const all = TIBEX_STORE.getAll();
  return all?.system_info?.finance?.vat !== false;
}
function vatRate() {
  const all = TIBEX_STORE.getAll();
  return all?.system_info?.finance?.vat_rate || 12;
}

/* ═══ YORDAMCHI ═══ */
function toast(msg, type='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return isToday ? fmtTime(ts) : `${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')} ${fmtTime(ts)}`;
}

/* TIBEX_FMTMONEY_SOM_v1 */
function fmtMoney(n) {
  return (n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + " so'm";
}

function initials(name) { return name.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase(); }

function todayPayments() {
  const start = new Date(); start.setHours(0,0,0,0);
  return TIBEX_STORE.getPayments({ status: 'completed' }).filter(p => p.created_at >= start);
}

function todayRefunds() {
  const start = new Date(); start.setHours(0,0,0,0);
  return TIBEX_STORE.getRefunds().filter(r => r.created_at >= start);
}

/* ═══ KASSA HISOBLARI ═══ */
function computeCashTotals() {
  const shift = TIBEX_STORE.getShift();
  const payments = todayPayments();
  const refunds = todayRefunds();

  const cashIn = payments.filter(p => p.method === 'cash').reduce((s,p) => s + p.amount, 0);
  const cardIn = payments.filter(p => p.method === 'card').reduce((s,p) => s + p.amount, 0);
  const onlineIn = payments.filter(p => p.method === 'online').reduce((s,p) => s + p.amount, 0);
  const refundOut = refunds.reduce((s,r) => s + r.amount, 0);
  const totalRevenue = cashIn + cardIn + onlineIn;
  const expectedCash = (shift.opening_balance || 0) + cashIn - refundOut;

  return {
    opening: shift.opening_balance || 0,
    cashIn, cardIn, onlineIn, refundOut,
    totalRevenue,
    expectedCash,
    countCash: payments.filter(p => p.method === 'cash').length,
    countCard: payments.filter(p => p.method === 'card').length,
    countOnline: payments.filter(p => p.method === 'online').length,
    totalPayments: payments.length
  };
}

/* ═══ SIDEBAR UPDATE ═══ */
function updateSidebar() {
  const t = computeCashTotals();
  const shift = TIBEX_STORE.getShift();

  document.getElementById('openingBalance').textContent = fmtMoney(t.opening);
  document.getElementById('cashIncome').textContent = fmtMoney(t.cashIn);
  document.getElementById('cardIncome').textContent = fmtMoney(t.cardIn);
  document.getElementById('onlineIncome').textContent = fmtMoney(t.onlineIn);
  document.getElementById('refundAmount').textContent = fmtMoney(t.refundOut);
  document.getElementById('cashTotal').textContent = fmtMoney(t.expectedCash);

  document.getElementById('statCash').textContent = fmtMoney(t.expectedCash);
  document.getElementById('statToday').textContent = fmtMoney(t.totalRevenue);

  const debts = TIBEX_STORE.getAppointments().filter(a => (a.debt || 0) > 0);
  document.getElementById('statPending').textContent = debts.length;
  document.getElementById('statDebt').textContent = fmtMoney(debts.reduce((s,a) => s + a.debt, 0));

  document.getElementById('sbPaid').textContent = t.totalPayments;
  document.getElementById('sbRevenue').textContent = fmtMoney(t.totalRevenue);
  document.getElementById('sbDebt').textContent = fmtMoney(debts.reduce((s,a) => s + a.debt, 0));
  document.getElementById('sbRefund').textContent = t.refundOut;

  // Shift status
  const status = document.getElementById('shiftStatus');
  if (shift.open) {
    status.className = 'cash-status open';
    status.textContent = '🟢 Ochiq';
    document.getElementById('shiftStart').textContent = fmtTime(shift.opened_at);
  } else {
    status.className = 'cash-status closed';
    status.textContent = '🔴 Yopiq';
    document.getElementById('shiftStart').textContent = fmtTime(shift.closed_at);
  }

  // Shift tab
  document.getElementById('shiftOpening').textContent = fmtMoney(t.opening);
  document.getElementById('shiftIncome').textContent = fmtMoney(t.totalRevenue);
  document.getElementById('shiftRefund').textContent = fmtMoney(t.refundOut);
  document.getElementById('shiftTotal').textContent = fmtMoney(t.expectedCash);
  document.getElementById('mCash').textContent = t.countCash;
  document.getElementById('mCashSum').textContent = fmtMoney(t.cashIn);
  document.getElementById('mCard').textContent = t.countCard;
  document.getElementById('mCardSum').textContent = fmtMoney(t.cardIn);
  document.getElementById('mOnline').textContent = t.countOnline;
  document.getElementById('mOnlineSum').textContent = fmtMoney(t.onlineIn);
  document.getElementById('mTotal').textContent = t.totalPayments;
  document.getElementById('mTotalSum').textContent = fmtMoney(t.totalRevenue);

  // Reports
  document.getElementById('rPaid').textContent = t.totalPayments;
  document.getElementById('rRevenue').textContent = fmtMoney(t.totalRevenue);
  document.getElementById('rDebt').textContent = fmtMoney(debts.reduce((s,a) => s + a.debt, 0));
  document.getElementById('rRefund').textContent = fmtMoney(t.refundOut);

  // Badges
  document.getElementById('tabPendingBadge').textContent = debts.length;
  document.getElementById('tabPaidBadge').textContent = t.totalPayments;
  document.getElementById('tabRefundBadge').textContent = todayRefunds().length;
  document.getElementById('tabDebtorBadge').textContent = debts.length;

  // Filters
  document.getElementById('fAll').textContent = debts.length;
  document.getElementById('fUnpaid').textContent = debts.filter(d => d.paid === 0).length;
  document.getElementById('fPartial').textContent = debts.filter(d => d.paid > 0).length;
  document.getElementById('fDebt').textContent = debts.length;
  document.getElementById('fUrgent').textContent = debts.filter(d => d.priority === 'urgent' || d.priority === 'stat').length;
  const _flw = document.getElementById('fLabWaiting');
  if (_flw) _flw.textContent = TIBEX_STORE.getAppointments().filter(a => a.status === 'lab_waiting').length;

  // Report doctors
  const byDoctor = {};
  todayPayments().forEach(p => {
    const appt = TIBEX_STORE.getAppointment(p.appointment_id);
    if (!appt) return;
    if (!byDoctor[appt.doctor_name]) byDoctor[appt.doctor_name] = { count: 0, total: 0 };
    byDoctor[appt.doctor_name].count++;
    byDoctor[appt.doctor_name].total += p.amount;
  });
  document.getElementById('reportDoctorsBody').innerHTML = Object.entries(byDoctor).map(([n, d]) =>
    `<tr><td><b>${esc(n)}</b></td><td style="text-align:right;" class="amount">${d.count}</td><td style="text-align:right;" class="amount paid">${fmtMoney(d.total)}</td></tr>`
  ).join('') || '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--dim);">Ma\'lumot yo\'q</td></tr>';

  // Report methods
  const byMethod = { cash: {count:0,total:0}, card: {count:0,total:0}, online: {count:0,total:0} };
  todayPayments().forEach(p => {
    if (!byMethod[p.method]) byMethod[p.method] = { count: 0, total: 0 };
    byMethod[p.method].count++;
    byMethod[p.method].total += p.amount;
  });
  const grand = t.totalRevenue || 1;
  document.getElementById('reportMethodsBody').innerHTML = Object.entries(byMethod).map(([m, d]) => {
    const label = m === 'cash' ? '💵 Naqd' : m === 'card' ? '💳 Karta' : '📱 Onlayn';
    const pct = ((d.total/grand)*100).toFixed(1);
    return `<tr><td><b>${label}</b></td><td style="text-align:right;" class="mono">${d.count}</td><td style="text-align:right;" class="amount paid">${fmtMoney(d.total)}</td><td style="text-align:right;" class="mono">${pct}%</td></tr>`;
  }).join('');

  // Integratsiyalar statusi topbarda
  const ints = TIBEX_STORE.getIntegrations() || [];
  const payInts = ints.filter(i => i.type === 'payment');
  const box = document.getElementById('integrStatus');
  if (box) {
    if (payInts.length === 0) {
      box.innerHTML = '<span style="color:#475569;font-size:11px;">—</span>';
    } else {
      box.innerHTML = payInts.map(p => {
        const color = p.status === 'connected' ? '#4ade80' : p.status === 'error' ? '#ef4444' : p.status === 'pending' ? '#fbbf24' : '#475569';
        return `<span title="${esc(p.name)} — ${esc(p.status)}" style="color:${color};cursor:help;">💳</span>`;
      }).join('');
    }
  }
}

/* ═══ PENDING LIST ═══ */
function renderPending() {
  const search = document.getElementById('pendingSearch')?.value.toLowerCase() || '';
  let appts = TIBEX_STORE.getAppointments().filter(a => (a.debt || 0) > 0 && a.status !== 'cancelled');

  if (state.currentFilter === 'unpaid') appts = appts.filter(a => a.paid === 0);
  else if (state.currentFilter === 'partial') appts = appts.filter(a => a.paid > 0);
  else if (state.currentFilter === 'debt') appts = appts.filter(a => a.debt > 0);
  else if (state.currentFilter === 'urgent') appts = appts.filter(a => a.priority === 'urgent' || a.priority === 'stat');
  else if (state.currentFilter === 'lab_waiting') appts = appts.filter(a => a.status === 'lab_waiting');

  if (search) {
    appts = appts.filter(a => {
      const p = TIBEX_STORE.getPatient(a.patient_id);
      if (!p) return false;
      return p.fullname.toLowerCase().includes(search) || p.phone.includes(search) || String(a.id).includes(search);
    });
  }

  const html = appts.map(a => {
    const p = TIBEX_STORE.getPatient(a.patient_id);
    if (!p) return '';
    const isUrgent = a.priority === 'urgent' || a.priority === 'stat';
    const status = a.paid === 0 ? 'unpaid' : a.paid > 0 && a.debt > 0 ? 'partial' : 'paid';
    const statusLabel = status === 'unpaid' ? "To'lanmagan" : status === 'partial' ? 'Qismiy' : "To'langan";
    return `<tr data-id="${a.id}" class="${isUrgent ? 'urgent-row' : ''} ${a.id === state.selectedApptId ? 'selected' : ''}">
      <td class="time-col">${esc(a.scheduled_time)}</td>
      <td>
        <div class="patient-name">${esc(p.fullname)} ${isUrgent ? `<span class="priority ${escAttr(a.priority)}">${a.priority === 'stat' ? 'STAT' : 'SHOSHILINCH'}</span>` : ''}</div>
        <div class="patient-sub">${esc(p.phone)} · Qabul #${a.id}</div>
      </td>
      <td>${esc(a.service.name)}</td>
      <td>${esc(a.doctor_name)}</td>
      <td style="text-align:right;"><div class="amount debt">${fmtMoney(a.debt)}</div></td>
      <td><span class="status ${status}">${statusLabel}</span></td>
      <td>
        <div class="row-actions">
          <button class="gold" data-act="pay" ${!can('payments','create')?'disabled':''}>💰 To'lash</button>
          <button data-act="view">👁</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('pendingBody').innerHTML = html || '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--dim);">To\'lov kutilmayapti ✅</td></tr>';
  attachPendingHandlers();
}

function attachPendingHandlers() {
  document.querySelectorAll('#pendingBody tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return;
      selectAppointment(parseInt(tr.dataset.id));
    });
  });
  document.querySelectorAll('#pendingBody button[data-act]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      const id = parseInt(b.closest('tr').dataset.id);
      if (b.dataset.act === 'pay') openPayment(id);
      else if (b.dataset.act === 'view') selectAppointment(id);
    });
  });
}

/* ═══ PAID LIST ═══ */
function renderPaid() {
  const payments = todayPayments();
  document.getElementById('paidCount').textContent = payments.length;

  const html = payments.map(p => {
    const pt = TIBEX_STORE.getPatient(p.patient_id);
    if (!pt) return '';
    const methodIcon = p.method === 'cash' ? '💵' : p.method === 'card' ? '💳' : '📱';
    const methodLabel = p.method === 'cash' ? 'Naqd' : p.method === 'card' ? 'Karta' : 'Onlayn';
    return `<tr data-id="${p.id}">
      <td class="time-col">${fmtTime(p.created_at)}</td>
      <td><div class="patient-name">${esc(pt.fullname)}</div><div class="patient-sub">${esc(pt.phone)}</div></td>
      <td>${esc(p.services.map(s => s.name).join(', '))}</td>
      <td><span class="status paid">${methodIcon} ${methodLabel}</span></td>
      <td style="text-align:right;"><div class="amount paid">${fmtMoney(p.amount)}</div></td>
      <td>
        <div class="row-actions">
          <button data-act="receipt">🖨 Chek</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('paidBody').innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--dim);">Bugun to\'lov yo\'q</td></tr>';

  document.querySelectorAll('#paidBody button[data-act="receipt"]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(b.closest('tr').dataset.id);
      const p = TIBEX_STORE.getPayments().find(x => x.id === id);
      if (p) showReceipt(p);
    });
  });
}

/* ═══ REFUNDS LIST ═══ */
function renderRefunds() {
  const refunds = TIBEX_STORE.getRefunds();
  document.getElementById('refundCount').textContent = refunds.length;

  const html = refunds.map(r => {
    const p = TIBEX_STORE.getPatient(r.patient_id);
    return `<tr>
      <td class="time-col">${fmtTime(r.created_at)}</td>
      <td><div class="patient-name">${esc(p ? p.fullname : '—')}</div></td>
      <td>${esc(r.reason)}</td>
      <td style="text-align:right;"><div class="amount refund">-${fmtMoney(r.amount)}</div></td>
      <td>${esc(r.cashier)}</td>
    </tr>`;
  }).join('');

  document.getElementById('refundsBody').innerHTML = html || '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--dim);">Qaytarishlar yo\'q</td></tr>';
}

/* ═══ DEBTORS LIST ═══ */
function renderDebtors() {
  const debtors = TIBEX_STORE.getAppointments().filter(a => (a.debt || 0) > 0);
  document.getElementById('debtorsCount').textContent = debtors.length;

  const html = debtors.map(a => {
    const p = TIBEX_STORE.getPatient(a.patient_id);
    if (!p) return '';
    return `<tr data-id="${a.id}">
      <td><div class="patient-name">${esc(p.fullname)}</div><div class="patient-sub">Qabul #${a.id} · ${esc(a.doctor_name)}</div></td>
      <td class="time-col">${esc(p.phone)}</td>
      <td class="time-col">${esc(a.date)}</td>
      <td style="text-align:right;"><div class="amount debt">${fmtMoney(a.debt)}</div></td>
      <td>
        <div class="row-actions">
          <button class="gold" data-act="pay" ${!can('payments','create')?'disabled':''}>💰 To'lash</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('debtorsBody').innerHTML = html || '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--dim);">Qarzdorlar yo\'q</td></tr>';

  document.querySelectorAll('#debtorsBody button[data-act]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      const id = parseInt(b.closest('tr').dataset.id);
      if (b.dataset.act === 'pay') openPayment(id);
    });
  });
}

/* ═══ AUDIT ═══ */
function renderAudit() {
  const search = document.getElementById('auditSearch')?.value.toLowerCase() || '';
  let audit = TIBEX_STORE.getAudit();

  document.getElementById('afAll').textContent = audit.length;
  document.getElementById('afPayment').textContent = audit.filter(a => a.action === 'payment').length;
  document.getElementById('afRefund').textContent = audit.filter(a => a.action === 'refund').length;
  document.getElementById('afShift').textContent = audit.filter(a => a.action === 'shift').length;

  if (state.currentAuditFilter !== 'all') audit = audit.filter(a => a.action === state.currentAuditFilter);
  if (search) audit = audit.filter(a => a.user.toLowerCase().includes(search) || (a.detail||'').toLowerCase().includes(search));

  document.getElementById('auditBody').innerHTML = audit.map(a => `
    <div style="padding:10px 16px;border-bottom:1px solid #f1f5f9;display:flex;gap:12px;align-items:flex-start;font-size:12.5px;">
      <div class="time-col" style="width:70px;flex-shrink:0;">${fmtDateTime(a.ts)}</div>
      <span style="font-size:10px;padding:2px 8px;border-radius:6px;font-weight:700;flex-shrink:0;background:${a.action === 'payment' ? 'var(--ok-tint)' : a.action === 'refund' ? 'var(--info-tint)' : a.action === 'shift' ? 'var(--gold-tint)' : '#f1f5f9'};color:${a.action === 'payment' ? '#166534' : a.action === 'refund' ? '#0c4a6e' : a.action === 'shift' ? '#854d0e' : '#475569'};">${esc(a.action.toUpperCase())}</span>
      <div style="flex:1;min-width:0;">
        <div><b>${esc(a.user)}</b> · <span style="color:var(--muted);font-size:11.5px;">${esc(a.role)}</span></div>
        <div style="color:var(--muted);font-size:11.5px;margin-top:2px;">${esc(a.detail)}</div>
      </div>
    </div>
  `).join('') || '<div style="padding:40px;text-align:center;color:var(--dim);">Yozuvlar yo\'q</div>';
}

/* ═══ SELECT APPOINTMENT — DETAIL PANEL ═══ */
function selectAppointment(id) {
  const appt = TIBEX_STORE.getAppointment(id);
  if (!appt) return;
  const p = TIBEX_STORE.getPatient(appt.patient_id);
  if (!p) return;

  state.selectedApptId = id;
  document.getElementById('detailEmpty').style.display = 'none';
  document.getElementById('detailContent').style.display = 'block';
  document.getElementById('actPayNow').disabled = false;

  const isUrgent = appt.priority === 'urgent' || appt.priority === 'stat';
  const hasDebt = (appt.debt || 0) > 0;

  const apptPayments = TIBEX_STORE.getPayments({ appointment_id: id });

  document.getElementById('detailContent').innerHTML = `
    <div class="patient-card">
      <div class="avatar-name">
        <div class="avatar">${esc(initials(p.fullname))}</div>
        <div>
          <div class="name">${esc(p.fullname)}</div>
          <div class="meta">${p.age} yosh · ${esc(p.gender)} · ${esc(p.blood)}</div>
        </div>
      </div>
      <div class="badges">
        ${isUrgent ? `<span class="badge danger">${appt.priority === 'stat' ? '🔴 STAT' : '🚨 SHOSHILINCH'}</span>` : ''}
        ${p.allergies?.map(a => `<span class=\"badge danger\">⚠ ${esc(a)}</span>`).join('') || ''}
        ${p.chronic?.map(c => `<span class=\"badge warn\">${esc(c)}</span>`).join('') || ''}
      </div>
      <div class="actions">
        ${hasDebt && can('payments','create') ? `<button class="gold" data-action="open-payment" data-id="${id}">💰 To'lovni qabul qilish</button>` : ''}
      </div>
    </div>

    <div class="detail-block">
      <div class="detail-head" data-toggle="detail"><span>📋 Qabul ma'lumotlari</span><span class="chev">▸</span></div>
      <div class="detail-body">
        <div class="detail-row"><span class="k">Qabul #</span><span class="v mono">${appt.id}</span></div>
        <div class="detail-row"><span class="k">Vaqt</span><span class="v mono">${esc(appt.scheduled_time)}</span></div>
        <div class="detail-row"><span class="k">Shifokor</span><span class="v">${esc(appt.doctor_name)}</span></div>
        <div class="detail-row"><span class="k">Xizmat</span><span class="v">${esc(appt.service.name)}</span></div>
        <div class="detail-row"><span class="k">Narx</span><span class="v mono">${fmtMoney(appt.service.price)}</span></div>
        <div class="detail-row"><span class="k">To'langan</span><span class="v ok mono">${fmtMoney(appt.paid)}</span></div>
        <div class="detail-row"><span class="k">Qarz</span><span class="v ${hasDebt ? 'danger' : 'ok'} mono">${fmtMoney(appt.debt)}</span></div>
      </div>
    </div>

    <div class="detail-block collapsed">
      <div class="detail-head" data-toggle="detail"><span>💰 To'lov tarixi (${apptPayments.length})</span><span class="chev">▸</span></div>
      <div class="detail-body">
        ${apptPayments.length === 0 ? '<div style="color:var(--dim);">To\'lov yo\'q</div>' :
          apptPayments.map(pay => `
            <div style="padding:8px 0; border-bottom:1px dashed #f1f5f9;">
              <div style="display:flex; justify-content:space-between;">
                <span class="mono" style="font-weight:600;">${fmtTime(pay.created_at)}</span>
                <span class="mono gold" style="font-weight:700;">${fmtMoney(pay.amount)}</span>
              </div>
              <div style="font-size:11px; color:var(--muted);">${pay.method === 'cash' ? '💵 Naqd' : pay.method === 'card' ? '💳 Karta' : '📱 Onlayn'} · ${esc(pay.cashier)}</div>
            </div>`).join('')}
      </div>
    </div>

    <div class="detail-block collapsed">
      <div class="detail-head" data-toggle="detail"><span>📞 Aloqa</span><span class="chev">▸</span></div>
      <div class="detail-body">
        <div class="detail-row"><span class="k">Telefon</span><span class="v mono">${esc(p.phone)}</span></div>
        <div class="detail-row"><span class="k">Bemor ID</span><span class="v mono">#${p.id}</span></div>
      </div>
    </div>
  `;

  document.querySelectorAll('#detailContent [data-toggle="detail"]').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
  });

  renderPending();
  renderDebtors();
}

/* CSP: inline onclick o'rniga event delegation (data-action) */
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'open-payment') openPayment(Number(t.dataset.id));
  else if (t.dataset.action === 'print') window.print();
});

/* ═══ PAYMENT MODAL ═══ */
function openPayment(apptId) {
  if (!can('payments','create')) return toast('Ruxsat yo\'q', 'bad');
  const appt = TIBEX_STORE.getAppointment(apptId);
  if (!appt) return toast('Qabul topilmadi', 'warn');
  const p = TIBEX_STORE.getPatient(appt.patient_id);
  if (!p) return;

  state.selectedApptId = apptId;
  state.paymentCart = [
    { code: appt.service.code || 'CONS-001', name: appt.service.name, price: appt.service.price }
  ];
  state.paymentMethod = 'cash';
  state.paymentDiscount = 0;

  renderPaymentModal();
  document.getElementById('modalPayment').classList.add('open');
}

function renderPaymentModal() {
  const appt = TIBEX_STORE.getAppointment(state.selectedApptId);
  const p = TIBEX_STORE.getPatient(appt.patient_id);

  const limit = discountLimit();
  if (state.paymentDiscount > limit) state.paymentDiscount = limit;
  if (state.paymentDiscount < 0) state.paymentDiscount = 0;

  const subtotal = state.paymentCart.reduce((s, x) => s + x.price, 0);
  const discountPct = state.paymentDiscount || 0;
  const discountAmount = Math.round(subtotal * discountPct / 100);
  const total = Math.max(0, subtotal - discountAmount);
  const paid = appt.paid || 0;
  const toPay = Math.max(0, total - paid);
  const rate = vatRate();
  const vatAmount = vatEnabled() ? Math.round(total - total / (1 + rate / 100)) : 0;

  const serviceRows = state.paymentCart.map((s, i) => `
    <div class="service-row">
      <div class="info">
        <div class="name">${esc(s.name)}</div>
        <div class="code">${esc(s.code)}</div>
      </div>
      <div class="price">${fmtMoney(s.price)}</div>
      <div class="rm" data-rm="${i}" title="O'chirish">✕</div>
    </div>
  `).join('');

  document.getElementById('paymentBody').innerHTML = `
    <div style="padding:12px 16px; background:var(--gold-tint); border-radius:8px; margin-bottom:16px; display:flex; align-items:center; gap:12px;">
      <div style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg, var(--gold), var(--primary-dark)); color:white; display:flex; align-items:center; justify-content:center; font-weight:700;">${esc(initials(p.fullname))}</div>
      <div style="flex:1;">
        <div style="font-weight:700;">${esc(p.fullname)}</div>
        <div style="font-size:12px; color:var(--muted);">#${p.id} · ${esc(p.phone)} · Qabul #${appt.id}</div>
      </div>
    </div>

    <h4 style="font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:10px;">Xizmatlar</h4>
    <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:16px;">
      ${serviceRows || '<div style="padding:20px; text-align:center; color:var(--dim);">Xizmatlar yo\'q</div>'}
    </div>

    <div class="form-grid" style="margin-bottom:16px;">
      <div class="form-field">
        <label>Chegirma (limit: ${limit}%)</label>
        <input class="input mono" id="payDiscount" type="number" min="0" max="${limit}" value="${discountPct}" style="font-size:16px;">
      </div>
    </div>

    <div class="pay-summary">
      <div class="row"><span>Jami (xizmatlar):</span><span class="v" id="sumSubtotal">${fmtMoney(subtotal)}</span></div>
      <div class="row discount"><span>Chegirma (<span id="sumDiscountPct">${discountPct}</span>%):</span><span class="v" id="sumDiscount">-${fmtMoney(discountAmount)}</span></div>
      ${vatEnabled() ? `<div class="row"><span>shu j-dan QQS (${rate}%):</span><span class="v" id="sumVat">${fmtMoney(vatAmount)}</span></div>` : ''}
      ${paid > 0 ? `<div class="row discount"><span>Oldindan to'langan:</span><span class="v">-${fmtMoney(paid)}</span></div>` : ''}
      <div class="row total"><span>TO'LANISHI KERAK:</span><span class="v" id="sumToPay">${fmtMoney(toPay)}</span></div>
    </div>

    <h4 style="font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:10px;">To'lov usuli</h4>
    <div class="pay-methods" id="payMethods">
      <button class="pay-method ${state.paymentMethod === 'cash' ? 'selected' : ''}" data-method="cash">
        <span class="ico">💵</span><span class="lbl">Naqd</span><span class="sub">Kassa orqali</span>
      </button>
      <button class="pay-method ${state.paymentMethod === 'card' ? 'selected' : ''}" data-method="card">
        <span class="ico">💳</span><span class="lbl">Karta</span><span class="sub">Uzcard / Humo</span>
      </button>
      <button class="pay-method ${state.paymentMethod === 'online' ? 'selected' : ''}" data-method="online" style="grid-column:1/-1;">
        <span class="ico">📱</span><span class="lbl">Onlayn</span><span class="sub">Click / Payme</span>
      </button>
    </div>

    <div class="form-grid" style="margin-top:16px;">
      <div class="form-field">
        <label>To'langan summa</label>
        <input class="input mono" id="payAmount" value="${toPay}" type="number" style="font-size:16px;">
      </div>
      <div class="form-field">
        <label>Qaytim</label>
        <input class="input mono" id="payChange" value="0" readonly style="background:#f8fafc;">
      </div>
    </div>

    <div class="quick-amounts">
      <button class="quick-amount" data-amt="${toPay}">To'liq</button>
      <button class="quick-amount" data-amt="50000">50K</button>
      <button class="quick-amount" data-amt="100000">100K</button>
      <button class="quick-amount" data-amt="200000">200K</button>
    </div>
  `;

  // Handlers
  document.querySelectorAll('#paymentBody .pay-method').forEach(m => {
    m.addEventListener('click', () => {
      document.querySelectorAll('#paymentBody .pay-method').forEach(x => x.classList.remove('selected'));
      m.classList.add('selected');
      state.paymentMethod = m.dataset.method;
    });
  });

  document.querySelectorAll('#paymentBody .rm').forEach(b => {
    b.addEventListener('click', () => {
      state.paymentCart.splice(parseInt(b.dataset.rm), 1);
      renderPaymentModal();
    });
  });

  // TIBEX_DISCOUNT_LIMIT_v1: chegirma maydoni — limitdan oshsa kesiladi,
  // va jami/QQS/to'lanishi kerak qatorlari darhol qayta hisoblanadi.
  const discountInput = document.getElementById('payDiscount');
  discountInput?.addEventListener('input', () => {
    let v = parseInt(discountInput.value, 10);
    if (Number.isNaN(v)) v = 0;
    if (v > limit) { v = limit; toast(`Chegirma limiti ${limit}%`, 'warn'); }
    if (v < 0) v = 0;
    discountInput.value = v;
    state.paymentDiscount = v;
    renderPaymentModal();
  });

  document.querySelectorAll('#paymentBody .quick-amount').forEach(b => {
    b.addEventListener('click', () => {
      document.getElementById('payAmount').value = b.dataset.amt;
      updateChange();
    });
  });

  const amountInput = document.getElementById('payAmount');
  amountInput.addEventListener('input', updateChange);
  updateChange();

  function updateChange() {
    const paid = parseFloat(amountInput.value) || 0;
    const change = Math.max(0, paid - toPay);
    document.getElementById('payChange').value = change;
  }
}

document.getElementById('btnConfirmPayment')?.addEventListener('click', () => {
  if (!can('payments','create')) return toast('Ruxsat yo\'q', 'bad');
  const appt = TIBEX_STORE.getAppointment(state.selectedApptId);
  if (!appt) return;
  const limit = discountLimit();
  const discountPct = Math.max(0, Math.min(limit, state.paymentDiscount || 0));
  const subtotal = state.paymentCart.reduce((s, x) => s + x.price, 0);
  const total = Math.max(0, subtotal - Math.round(subtotal * discountPct / 100));
  const paid = parseFloat(document.getElementById('payAmount').value) || 0;
  const newPaidTotal = (appt.paid || 0) + paid;
  const newDebt = Math.max(0, total - newPaidTotal);

  TIBEX_STORE.addPayment({
    appointment_id: appt.id,
    patient_id: appt.patient_id,
    amount: paid,
    method: state.paymentMethod,
    services: state.paymentCart,
    status: 'completed',
    discount_percent: discountPct
  });

  TIBEX_STORE.updateAppointment(appt.id, {
    paid: newPaidTotal,
    debt: newDebt,
    payment_method: state.paymentMethod,
    paid_at: Date.now()
  });

  const methodLabel = state.paymentMethod === 'cash' ? 'Naqd' : state.paymentMethod === 'card' ? 'Karta' : 'Onlayn';
  toast(`💰 ${fmtMoney(paid)} so'm qabul qilindi (${methodLabel})`, 'gold');

  document.getElementById('modalPayment').classList.remove('open');
  renderAll();

  setTimeout(() => {
    const all = TIBEX_STORE.getAll();
    const lastPayment = (all.payments || []).slice(-1)[0];
    if (lastPayment) showReceipt(lastPayment);
  }, 400);
});

/* ═══ RECEIPT ═══ */
function showReceipt(payment) {
  const p = TIBEX_STORE.getPatient(payment.patient_id);
  const appt = TIBEX_STORE.getAppointment(payment.appointment_id);
  const methodLabel = payment.method === 'cash' ? 'Naqd pul' : payment.method === 'card' ? 'Plastik karta' : 'Onlayn to\'lov';
  const discountPct = payment.discount_percent || 0;
  const subtotal = (payment.services || []).reduce((s, x) => s + (x.price || 0), 0);
  const discountAmount = Math.max(0, subtotal - payment.amount);
  const rate = vatRate();
  const vat = payment.vat || (vatEnabled()
    ? { rate, amount: Math.round(payment.amount - payment.amount / (1 + rate / 100)) }
    : null);

  document.getElementById('receiptContent').innerHTML = `
    <h2>TIBEX KLINIKA</h2>
    <div class="sub">Toshkent sh., Chilonzor tumani<br>Tel: +998 71 200 00 00</div>
    <hr>
    <div class="row"><span>Chek #:</span><span>${String(payment.id).padStart(6, '0')}</span></div>
    <div class="row"><span>Sana:</span><span>${_tibexFmtDateTime(payment.created_at)}</span></div>
    <div class="row"><span>Kassir:</span><span>${esc(payment.cashier)}</span></div>
    <hr>
    <div class="row"><span>Bemor:</span><span>${esc(p.fullname)}</span></div>
    <div class="row"><span>Telefon:</span><span>${esc(p.phone)}</span></div>
    ${appt ? `<div class="row"><span>Shifokor:</span><span>${esc(appt.doctor_name)}</span></div>` : ''}
    <hr>
    ${payment.services.map(s => `<div class="row"><span>${esc(s.name)}</span><span>${fmtMoney(s.price)}</span></div>`).join('')}
    ${discountPct > 0 ? `<div class="row"><span>Chegirma (${discountPct}%):</span><span>-${fmtMoney(discountAmount)}</span></div>` : ''}
    <hr>
    <div class="row total"><span>JAMI:</span><span>${fmtMoney(payment.amount)} so'm</span></div>
    ${vatEnabled() && vat ? `<div class="row"><span>shu j-dan QQS (${vat.rate}%):</span><span>${fmtMoney(vat.amount)} so'm</span></div>` : ''}
    <div class="row"><span>To'lov usuli:</span><span>${methodLabel}</span></div>
    <hr>
    <div class="footer">Xaridingiz uchun rahmat!<br>Salomat bo'ling 🌿<br><br>***</div>
  `;
  document.getElementById('modalReceipt').classList.add('open');
}

/* ═══ REFUND MODAL ═══ */
document.getElementById('btnNewRefund')?.addEventListener('click', openRefundModal);

function openRefundModal() {
  if (!can('payments','refund')) return toast('Ruxsat yo\'q', 'bad');
  const payments = todayPayments();
  const sel = document.getElementById('rfAppt');
  sel.innerHTML = payments.map(p => {
    const pt = TIBEX_STORE.getPatient(p.patient_id);
    return `<option value="${p.id}" data-amount="${p.amount}">#${p.id} — ${esc(pt?.fullname || '?')} — ${fmtMoney(p.amount)} so'm (${fmtTime(p.created_at)})</option>`;
  }).join('');

  if (payments.length === 0) {
    return toast('Bugun to\'lovlar yo\'q', 'warn');
  }

  /* TIBEX_REFUND_LEAK_FIX_v1: addEventListener o'rniga onchange — modal har ochilganda
     yangi listener qo'shilib, xotira oqishiga sabab bo'lmasligi uchun */
  sel.onchange = () => {
    const opt = sel.selectedOptions[0];
    document.getElementById('rfAmount').value = opt.dataset.amount;
  };
  document.getElementById('rfAmount').value = payments[0]?.amount || 0;
  document.getElementById('modalRefund').classList.add('open');
}

document.getElementById('btnConfirmRefund')?.addEventListener('click', () => {
  if (!can('payments','refund')) return toast('Ruxsat yo\'q', 'bad');
  const paymentId = parseInt(document.getElementById('rfAppt').value);
  const payment = TIBEX_STORE.getPayments().find(p => p.id === paymentId);
  if (!payment) return toast('To\'lov topilmadi', 'bad');

  const amount = parseFloat(document.getElementById('rfAmount').value) || 0;
  if (amount <= 0) return toast('Summani kiriting', 'warn');
  if (amount > payment.amount) return toast('Summa to\'lovdan katta', 'bad');

  const reason = document.getElementById('rfReason').value;
  const note = document.getElementById('rfNote').value;
  const method = document.getElementById('rfMethod').value;

  TIBEX_STORE.addRefund({
    payment_id: paymentId,
    patient_id: payment.patient_id,
    amount: amount,
    reason: reason + (note ? ` — ${note}` : ''),
    method: method
  });

  toast(`↩ ${fmtMoney(amount)} so'm qaytarildi`, 'warn');
  document.getElementById('modalRefund').classList.remove('open');
  document.getElementById('rfNote').value = '';
  renderAll();
});

/* ═══ CLOSE SHIFT ═══ */
document.getElementById('actCloseShift')?.addEventListener('click', openCloseShift);

function openCloseShift() {
  if (!can('payments','close_shift')) return toast('Ruxsat yo\'q', 'bad');
  const t = computeCashTotals();
  document.getElementById('expectedCash').textContent = fmtMoney(t.expectedCash) + ' so\'m';
  document.getElementById('actualCash').value = t.expectedCash;
  document.getElementById('cashDiff').textContent = '—';
  document.getElementById('cashDiff').style.color = '';
  document.getElementById('modalCloseShift').classList.add('open');

  const actual = document.getElementById('actualCash');
  const updateDiff = () => {
    const val = parseFloat(actual.value) || 0;
    const diff = val - t.expectedCash;
    const el = document.getElementById('cashDiff');
    if (diff === 0) {
      el.textContent = '0 so\'m ✓ Mos keladi';
      el.style.color = 'var(--ok)';
    } else if (diff > 0) {
      el.textContent = '+' + fmtMoney(diff) + ' so\'m (ortiqcha)';
      el.style.color = 'var(--warn)';
    } else {
      el.textContent = fmtMoney(diff) + ' so\'m (kam)';
      el.style.color = 'var(--danger)';
    }
  };
  actual.addEventListener('input', updateDiff);
  setTimeout(updateDiff, 50);
}

document.getElementById('btnConfirmCloseShift')?.addEventListener('click', () => {
  const actual = parseFloat(document.getElementById('actualCash').value) || 0;
  const note = document.getElementById('closeNote').value;

  if (!confirm('Smenani yopishni tasdiqlaysizmi?')) return;

  const record = TIBEX_STORE.closeShift(actual, note);
  document.getElementById('modalCloseShift').classList.remove('open');
  toast(`🔒 Smena yopildi. Farq: ${fmtMoney(record.difference)} so'm`, record.difference === 0 ? 'ok' : 'warn');
  renderAll();
});

/* ═══ FILTERS / TABS ═══ */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    if (!view) return;
    state.currentView = view;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector(`[data-view-content="${view}"]`)?.classList.add('active');
    renderAll();
  });
});

document.querySelectorAll('.filter-chip[data-filter]').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip[data-filter]').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    state.currentFilter = c.dataset.filter;
    renderPending();
  });
});

document.querySelectorAll('.filter-chip[data-audit]').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip[data-audit]').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    state.currentAuditFilter = c.dataset.audit;
    renderAudit();
  });
});

document.getElementById('pendingSearch')?.addEventListener('input', renderPending);
document.getElementById('auditSearch')?.addEventListener('input', renderAudit);

/* ═══ QUICK ACTIONS ═══ */
document.getElementById('actPayNow')?.addEventListener('click', () => {
  if (state.selectedApptId) openPayment(state.selectedApptId);
  else toast('Bemorni tanlang', 'warn');
});

// TIBEX_MANUAL_PAY_v1: haqiqiy qo'lda to'lov
function _tibexOpenManualPayment() {
  if (!can('payments','create')) return toast("Ruxsat yo'q", 'bad');
  const pidStr = prompt("Bemor ID sini kiriting:");
  if (!pidStr) return;
  const pid = parseInt(pidStr, 10);
  if (!pid) return toast("Noto'g'ri ID", 'warn');
  const p = TIBEX_STORE.getPatient(pid);
  if (!p) return toast("Bemor topilmadi", 'bad');
  const appt = TIBEX_STORE.getAppointments().filter(a => a.patient_id === pid).sort((a,b) => b.id - a.id)[0];
  if (!appt) return toast("Bu bemorda aktiv qabul yo'q", 'warn');
  openPayment(appt.id);
}
document.getElementById('actManualPay')?.addEventListener('click', _tibexOpenManualPayment);
document.getElementById('qaManualPay2')?.addEventListener('click', _tibexOpenManualPayment);

document.getElementById('qaPayNow')?.addEventListener('click', () => {
  if (!can('payments','create')) return toast('Ruxsat yo\'q', 'bad');
  if (state.selectedApptId) openPayment(state.selectedApptId);
  else toast('Bemorni tanlang', 'warn');
});

document.getElementById('qaManualPay2')?.addEventListener('click', () => {
  if (!can('payments','create')) return toast('Ruxsat yo\'q', 'bad');
  toast('➕ Qo\'lda to\'lov — qabulni tanlang', 'info');
});

document.getElementById('qaPayNow')?.addEventListener('click', () => {
  if (!can('payments','create')) return toast('Ruxsat yo\'q', 'bad');
  if (state.selectedApptId) openPayment(state.selectedApptId);
  else toast('Bemorni tanlang', 'warn');
});

document.getElementById('qaManualPay2')?.addEventListener('click', () => {
  if (!can('payments','create')) return toast('Ruxsat yo\'q', 'bad');
  toast('➕ Qo\'lda to\'lov — qabulni tanlang', 'info');
});

document.getElementById('qaSearch')?.addEventListener('click', () => {
  document.querySelector('[data-view="pending"]')?.click();
  setTimeout(() => document.getElementById('pendingSearch')?.focus(), 100);
});

document.getElementById('actPrintReceipt')?.addEventListener('click', () => {
  const payments = todayPayments();
  if (payments.length === 0) return toast('Chek yo\'q', 'warn');
  showReceipt(payments[0]);
});

document.getElementById('btnRefreshPending')?.addEventListener('click', () => { renderAll(); toast('↻ Yangilandi', 'info'); });
document.getElementById('actRefresh')?.addEventListener('click', () => { renderAll(); toast('↻ Yangilandi', 'info'); });
document.getElementById('btnExportPaid')?.addEventListener('click', () => toast('📄 Excel yuklab olinmoqda...', 'info'));
document.getElementById('btnPrintReport')?.addEventListener('click', () => toast('🖨 Chop etilmoqda...', 'info'));
document.getElementById('btnExportReports')?.addEventListener('click', () => toast('📄 Excel yuklab olinmoqda...', 'info'));
document.getElementById('btnPrintDebtors')?.addEventListener('click', () => toast('🖨 Chop etilmoqda...', 'info'));
document.getElementById('btnPrintShift')?.addEventListener('click', () => toast('🖨 Smena hisoboti chop etilmoqda...', 'info'));
document.getElementById('btnExportAudit')?.addEventListener('click', () => toast('📄 Excel yuklab olinmoqda...', 'info'));

/* ═══ MODAL CLOSE ═══ */
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal-backdrop').classList.remove('open')));
document.querySelectorAll('.modal-backdrop').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));
document.getElementById('btnHelp')?.addEventListener('click', () => document.getElementById('kbdModal').classList.add('open'));

/* ═══ KEYBOARD ═══ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
    return;
  }
  if (e.key === 'F1') { e.preventDefault(); document.getElementById('kbdModal').classList.add('open'); }
  if (e.key === 'F2') { e.preventDefault(); document.getElementById('qaSearch').click(); }
  if (e.key === 'F4') { e.preventDefault(); document.getElementById('qaManualPay').click(); }
  if (e.key === 'F5') { e.preventDefault(); renderAll(); toast('↻ Yangilandi', 'ok'); }
  if (e.key === 'F8') { e.preventDefault(); openCloseShift(); }
  if (e.key === 'F9') { e.preventDefault(); if (state.selectedApptId) openPayment(state.selectedApptId); }

  if (e.ctrlKey && ['1','2','3','4','5','6','7'].includes(e.key)) {
    e.preventDefault();
    const views = ['pending', 'paid', 'refunds', 'debtors', 'shift', 'reports', 'audit'];
    document.querySelector(`[data-view="${views[parseInt(e.key)-1]}"]`)?.click();
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); document.getElementById('actPrintReceipt').click(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); openRefundModal(); }

  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && document.activeElement.tagName === 'BODY') {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;
    const rows = [...activeView.querySelectorAll('.data-table tbody tr')].filter(r => r.dataset.id);
    if (rows.length === 0) return;
    e.preventDefault();
    const current = activeView.querySelector('.data-table tbody tr.selected');
    let idx = rows.indexOf(current);
    if (e.key === 'ArrowDown') idx = Math.min(idx + 1, rows.length - 1);
    if (e.key === 'ArrowUp') idx = Math.max(idx - 1, 0);
    if (idx < 0) idx = 0;
    if (rows[idx]) rows[idx].click();
  }
});

/* ═══ RENDER ALL ═══ */
function renderAll() {
  updateSidebar();
  renderPending();
  renderPaid();
  renderRefunds();
  renderDebtors();
  renderAudit();
  renderPaymentIntegrations();  // admin panel bilan sinxron
  renderServicesSidebar();      // admin panel bilan sinxron
  applyPermissions();
}

/* ═══ SYNC ═══ */
TIBEX_STORE.subscribe((data, source) => {
  if (source === 'external') {
    const events = data.events || [];
    const lastEvt = events[events.length - 1];
    if (lastEvt && (Date.now() - lastEvt.ts) < 3000) {
      const nd = document.getElementById('notifDot');
      if (nd) {
        nd.style.display = 'block';
        setTimeout(() => { nd.style.display = 'none'; }, 3000);
      }
      if (lastEvt.t === 'appointment_created') {
        const appt = data.appointments.find(a => a.id === lastEvt.id);
        if (appt) {
          const p = data.patients[String(appt.patient_id)];
          if (p) toast(`📅 Yangi qabul: ${esc(p.fullname)} — ${esc(appt.service.name)}`, 'info');
        }
      } else if (lastEvt.t === 'lab_order_created') {
        toast(`🔬 Lab so'rov: ${lastEvt.id}`, 'info');
      }
    }
  }
  renderAll();
  if (state.selectedApptId) {
    const a = TIBEX_STORE.getAppointment(state.selectedApptId);
    if (a) selectAppointment(state.selectedApptId);
  }
});

/* ═══ INIT ═══ */

/* ===== INIT (API client) ===== */
(async () => {
  try {
    await TIBEX_STORE.init();
    window.CURRENT_USER = TIBEX_STORE.CURRENT_USER;
    // Joriy foydalanuvchi nomini ko'rsatish
    const _tibexLbl = document.getElementById('currentUserLabel');
    if (_tibexLbl) _tibexLbl.textContent = TIBEX_STORE.CURRENT_USER.fullname || TIBEX_STORE.CURRENT_USER.login;
    // Role-specific qiymatlarni serverdan olingan user'dan olamiz
    if (typeof MY_DOCTOR_ID !== 'undefined') MY_DOCTOR_ID = TIBEX_STORE.CURRENT_USER.doctor_id;
    if (typeof MY_DOCTOR_NAME !== 'undefined') MY_DOCTOR_NAME = TIBEX_STORE.CURRENT_USER.fullname || TIBEX_STORE.CURRENT_USER.login;
    if (typeof MY_LAB_ID !== 'undefined') MY_LAB_ID = TIBEX_STORE.CURRENT_USER.id;
    if (typeof MY_LAB_NAME !== 'undefined') MY_LAB_NAME = TIBEX_STORE.CURRENT_USER.fullname || TIBEX_STORE.CURRENT_USER.login;
    if (typeof MY_USER_ID !== 'undefined') MY_USER_ID = TIBEX_STORE.CURRENT_USER.id;
    if (typeof MY_USER_NAME !== 'undefined') MY_USER_NAME = TIBEX_STORE.CURRENT_USER.fullname || TIBEX_STORE.CURRENT_USER.login;
    if (typeof MY_CASHIER_NAME !== 'undefined') MY_CASHIER_NAME = TIBEX_STORE.CURRENT_USER.fullname || TIBEX_STORE.CURRENT_USER.login;
    renderAll();
  } catch (e) {
    console.error("[TIBEX] init xato:", e);
    if (e.message === "UNAUTHORIZED") {
      location.href = "/login.html";
    }
  }
})();
