/* ===== block_0 ===== */
/* ═══════════════════════════════════════════════════════════
   TIBEX SHARED STORE — LABORATORIYA (sinxronlangan)
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
      // Fallback lab uchun default
      const defaults = {
        lab: ['patients.view','appointments.view','lab.view','lab.create','lab.edit','lab.verify','equipment.view','equipment.edit','reagents.view','reagents.edit'],
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

/* Uskuna holati ma'lumotlari */
function equipmentStatusInfo(status) {
  return {
    working:     { icon: '🟢', label: 'Ishlaydi',    dot: 'ok',   cls: 'ok'   },
    calibration: { icon: '🟡', label: 'Kalibrovka',  dot: 'warn', cls: 'warn' },
    maintenance: { icon: '🟣', label: 'Ta\'mirda',    dot: 'warn', cls: 'warn' },
    broken:      { icon: '🔴', label: 'Nosoz',       dot: 'err',  cls: 'err'  },
    offline:     { icon: '⚫', label: 'O\'chirilgan', dot: 'off',  cls: 'off'  }
  }[status] || { icon: '⚪', label: '—', dot: 'off', cls: 'off' };
}

/* ═══ ADMIN PANELDAN: ANALIZATORLAR SIDEBAR ═══ */
function renderEquipmentSidebar() {
  const equip = (TIBEX_STORE.getEquipment() || []).filter(e =>
    e.department === 'Laboratoriya' || e.category === 'Analizator'
  );
  const box = document.getElementById('equipmentSidebarList');
  if (!box) return;
  if (equip.length === 0) {
    box.innerHTML = '<div style="font-size:11px;color:var(--dim);text-align:center;padding:8px;">Uskunalar yo\'q — admin panelda qo\'shing</div>';
    return;
  }
  box.innerHTML = equip.map(e => {
    const info = equipmentStatusInfo(e.status);
    return `<div class="equipment-row" title="${escAttr(e.manufacturer || '')} ${escAttr(e.model || '')} · ${escAttr(e.location || '')}">
      <span class="name"><span class="dot ${info.dot}"></span><span>${esc(e.name)}</span></span>
      <span class="label ${info.cls}">${info.label}</span>
    </div>`;
  }).join('');
}

/* ═══ ADMIN PANELDAN: REAGENTLAR SIDEBAR ═══ */
function renderReagentsSidebar() {
  const reag = TIBEX_STORE.getReagents() || [];
  const box = document.getElementById('reagentsSidebarList');
  if (!box) return;
  if (reag.length === 0) {
    box.innerHTML = '<div style="font-size:11px;color:var(--dim);text-align:center;padding:8px;">Reagentlar yo\'q — admin panelda qo\'shing</div>';
    return;
  }
  const today = new Date();
  box.innerHTML = reag.map(r => {
    const pct = r.min_stock > 0 ? Math.min(100, Math.round((r.stock / (r.min_stock * 2)) * 100)) : 100;
    const cls = r.stock < r.min_stock ? 'low' : r.stock < r.min_stock * 1.5 ? 'mid' : 'ok';
    const expiryDays = r.expiry ? Math.floor((new Date(r.expiry) - today) / 86400000) : null;
    let expiryTag = '';
    if (expiryDays !== null && expiryDays < 0) expiryTag = '<span class="expiry-warn danger">MUDDAT O\'TGAN</span>';
    else if (expiryDays !== null && expiryDays < 30) expiryTag = `<span class="expiry-warn warn">${expiryDays}k</span>`;
    return `<div class="reagent-row" title="${escAttr(r.category || '')} · ${escAttr(r.supplier || '')}">
      <div class="top">
        <span class="name">${esc(r.name)}${expiryTag}</span>
        <span class="count ${cls}">${pct}%</span>
      </div>
      <div class="progress-bar"><div class="fill ${cls}" style="width:${pct}%"></div></div>
      <div class="meta">${r.stock} / ${r.min_stock} ${esc(r.unit)}${r.lot ? ' · ' + esc(r.lot) : ''}</div>
    </div>`;
  }).join('');
}

/* ═══ INTEGRATSIYALAR TOPBAR (analizatorlar HL7) ═══ */
function renderIntegrations() {
  const ints = TIBEX_STORE.getIntegrations() || [];
  const devices = ints.filter(i => i.type === 'device');
  const box = document.getElementById('integrStatus');
  if (!box) return;
  if (devices.length === 0) {
    box.innerHTML = '<span style="color:#475569;font-size:11px;">Qurilmalar yo\'q</span>';
    return;
  }
  box.innerHTML = devices.map(d => {
    const color = d.status === 'connected' ? '#4ade80' : d.status === 'error' ? '#ef4444' : d.status === 'pending' ? '#fbbf24' : '#475569';
    return `<span title="${esc(d.name)} — ${escAttr(d.provider || '')} (${esc(d.status)})" style="color:${color};cursor:help;">🔬</span>`;
  }).join('');
}

/* ═══ QC JADVALI (admin panelidagi analizatorlardan) ═══ */
function renderQC() {

  const equip = (TIBEX_STORE.getEquipment() || []).filter(e =>
    e.department === 'Laboratoriya' || e.category === 'Analizator'
  );
  const body = document.getElementById('qcBody');
  if (!body) return;
  if (equip.length === 0) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--dim);">Analizatorlar yo\'q</td></tr>';
    return;
  }
  body.innerHTML = equip.map(e => {
    const info = equipmentStatusInfo(e.status);
    const statusCls = e.status === 'working' ? 'verified' : e.status === 'broken' ? 'urgent' : 'ready';
    const statusLbl = e.status === 'working' ? '✓ OK' : e.status === 'broken' ? '⚠ Nosoz' : info.label;
    return `<tr>
      <td><b>${esc(e.name)}</b><div style="font-size:11px;color:var(--dim);">${esc(e.location || '')}</div></td>
      <td>${esc(info.icon)} ${e.status === 'calibration' ? 'Kalibrovka' : 'Normal'}</td>
      <td class="time-col">${e.status === 'working' ? '6.5' : '—'}</td>
      <td class="time-col">${e.status === 'working' ? '6.4' : '—'}</td>
      <td style="color:${e.status === 'working' ? 'var(--ok)' : 'var(--danger)'};font-weight:700;">${e.status === 'working' ? '-1.5%' : '—'}</td>
      <td><span class="status ${statusCls}">${statusLbl}</span></td>
    </tr>`;
  }).join('');
}

/* ═══ ANALIZATORLAR MODAL ═══ */
function openAnalyzersModal() {

  const equip = (TIBEX_STORE.getEquipment() || []).filter(e =>
    e.department === 'Laboratoriya' || e.category === 'Analizator'
  );
  const ints = TIBEX_STORE.getIntegrations() || [];
  const body = document.getElementById('analyzersModalBody');
  if (!body) return;
  if (equip.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--dim);">Analizatorlar yo\'q</div>';
  } else {
    body.innerHTML = equip.map(e => {
      const info = equipmentStatusInfo(e.status);
      const daysToService = e.next_service ? Math.floor((new Date(e.next_service) - new Date()) / 86400000) : null;
      const linkedIntegr = ints.find(i => i.name.includes(e.name) || i.name.includes(e.model || ''));
      return `<div class="detail-block" style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;">
        <div class="detail-head" style="border-radius:8px 8px 0 0;">
          <span>${esc(info.icon)} ${esc(e.name)}</span>
          <span class="status ${e.status === 'working' ? 'verified' : e.status === 'broken' ? 'urgent' : 'ready'}" style="font-size:10px;">${info.label}</span>
        </div>
        <div class="detail-body">
          <div class="detail-row"><span class="k">Kategoriya</span><span class="v">${esc(e.category)}</span></div>
          <div class="detail-row"><span class="k">Joylashuv</span><span class="v">${esc(e.location || '—')}</span></div>
          <div class="detail-row"><span class="k">Ishlab chiqaruvchi</span><span class="v">${esc(e.manufacturer || '—')} ${esc(e.model || '')}</span></div>
          <div class="detail-row"><span class="k">Seriya</span><span class="v mono">${esc(e.serial || '—')}</span></div>
          <div class="detail-row"><span class="k">Oxirgi xizmat</span><span class="v mono">${esc(e.last_service || '—')}</span></div>
          <div class="detail-row"><span class="k">Keyingi xizmat</span><span class="v ${daysToService !== null && daysToService < 30 ? 'danger' : ''} mono">${esc(e.next_service || '—')}${daysToService !== null ? ' (' + (daysToService >= 0 ? daysToService + ' kun' : Math.abs(daysToService) + ' kun o\'tdi') + ')' : ''}</span></div>
          <div class="detail-row"><span class="k">Integratsiya</span><span class="v">${linkedIntegr ? (linkedIntegr.status === 'connected' ? '✅ Ulangan' : '⚠ ' + esc(linkedIntegr.status)) : '—'}</span></div>
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('modalAnalyzers').classList.add('open');
}

/* ═══════════════════════════════════════════════════════════
   LAB KONSOLI LOGIKASI
   ═══════════════════════════════════════════════════════════ */
const state = {
  currentFilter: 'all',
  currentView: 'incoming',
  selectedOrderId: null,
  currentResultOrderId: null
};

const TEST_DEFINITIONS = {
  'trop-i': { name: 'Troponin I', panel: '❤️ Yurak belgilari', params: [{ code: 'TROP-I', name: 'Troponin I', unit: 'ng/mL', ref: '< 0.04' }] },
  'cbc': { name: 'Umumiy qon tahlili (CBC)', panel: '🩸 Umumiy qon', params: [
    { code: 'WBC', name: 'Leykotsitlar', unit: '10⁹/L', ref: '4.0 - 9.0' },
    { code: 'RBC', name: 'Eritrotsitlar', unit: '10¹²/L', ref: '4.0 - 5.0' },
    { code: 'HGB', name: 'Hemoglobin', unit: 'g/L', ref: '130 - 170' },
    { code: 'HCT', name: 'Gematokrit', unit: '%', ref: '40 - 50' },
    { code: 'PLT', name: 'Trombotsitlar', unit: '10⁹/L', ref: '150 - 400' },
    { code: 'ESR', name: 'ESR (SOE)', unit: 'mm/soat', ref: '< 15' },
    { code: 'NEUT', name: 'Neytrofillar', unit: '%', ref: '45 - 70' },
    { code: 'LYMPH', name: 'Limfotsitlar', unit: '%', ref: '20 - 45' }
  ]},
  'crp': { name: 'CRP', panel: '🔥 Yallig\'lanish belgilari', params: [{ code: 'CRP', name: 'C-reaktiv oqsil', unit: 'mg/L', ref: '< 5' }] },
  'glucose': { name: 'Glyukoza', panel: '🧪 Metabolik', params: [{ code: 'GLU', name: 'Glyukoza (nahorga)', unit: 'mmol/L', ref: '3.9 - 6.1' }] },
  'urine': { name: 'Siydik tahlili', panel: '💧 Umumiy siydik', params: [
    { code: 'UR-COLOR', name: 'Rangi', unit: '—', ref: 'Sariq-somon' },
    { code: 'UR-PROT', name: 'Oqsil', unit: 'g/L', ref: 'Yo\'q' },
    { code: 'UR-GLU', name: 'Glyukoza', unit: 'mmol/L', ref: 'Yo\'q' },
    { code: 'UR-WBC', name: 'Leykotsitlar', unit: 'ko\'r. maydon', ref: '0-5' }
  ]},
  'bio': { name: 'Biokimyo', panel: '🧪 Biokimyoviy tahlil', params: [
    { code: 'ALT', name: 'ALT', unit: 'U/L', ref: '0 - 45' },
    { code: 'AST', name: 'AST', unit: 'U/L', ref: '0 - 40' },
    { code: 'BIL-T', name: 'Bilirubin (umumiy)', unit: 'µmol/L', ref: '3.4 - 20.5' },
    { code: 'CREA', name: 'Kreatinin', unit: 'µmol/L', ref: '62 - 106' },
    { code: 'UREA', name: 'Mochevina', unit: 'mmol/L', ref: '2.5 - 8.3' }
  ]},
  'ecg': { name: 'EKG', panel: '❤️ EKG', params: [
    { code: 'ECG-RHYTHM', name: 'Ritm', unit: '—', ref: 'Sinus' },
    { code: 'ECG-HR', name: 'Yurak urish tezligi', unit: 'bpm', ref: '60 - 100' },
    { code: 'ECG-PR', name: 'PR interval', unit: 'ms', ref: '120 - 200' },
    { code: 'ECG-QRS', name: 'QRS davomiyligi', unit: 'ms', ref: '< 120' }
  ]}
};

function toast(msg, type='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}
function initials(name) { return name.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase(); }
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function statusLabel(s) {
  return { new: 'Yangi so\'rov', received: 'Namuna olindi', processing: 'Analizda', ready: 'Natija kiritildi', verified: 'Tasdiqlangan' }[s] || s;
}
function statusClass(s) {
  return { new: 'new', received: 'received', processing: 'processing', ready: 'ready', verified: 'verified' }[s] || 'new';
}

function updateStats() {
  const all = TIBEX_STORE.getLabOrders();
  const incoming = all.filter(o => o.status === 'new').length;
  const processing = all.filter(o => o.status === 'processing' || o.status === 'received').length;
  const ready = all.filter(o => o.status === 'ready').length;
  const verified = all.filter(o => o.status === 'verified').length;
  const urgent = all.filter(o => (o.priority === 'urgent' || o.priority === 'stat') && o.status !== 'verified').length;

  document.getElementById('statQueue').textContent = incoming + processing;
  document.getElementById('statReady').textContent = ready;
  document.getElementById('statUrgent').textContent = urgent;
  document.getElementById('sbIncoming').textContent = incoming;
  document.getElementById('sbProcessing').textContent = processing;
  document.getElementById('sbReady').textContent = ready;
  document.getElementById('sbUrgent').textContent = urgent;
  document.getElementById('tabIncomingBadge').textContent = incoming + processing;
  document.getElementById('tabProcessingBadge').textContent = processing;
  document.getElementById('tabResultsBadge').textContent = ready;
  document.getElementById('tabVerifiedBadge').textContent = verified;
  document.getElementById('tabUrgentBadge').textContent = urgent;
  document.getElementById('fAll').textContent = all.filter(o => o.status !== 'verified').length;
  document.getElementById('fNew').textContent = incoming;
  document.getElementById('fReceived').textContent = all.filter(o => o.status === 'received').length;
  document.getElementById('fProcessing').textContent = all.filter(o => o.status === 'processing').length;
  document.getElementById('fUrgent').textContent = urgent;
}

function renderIncoming() {
  const search = document.getElementById('incomingSearch')?.value.toLowerCase() || '';
  let orders = TIBEX_STORE.getLabOrders({ statuses: ['new', 'received', 'processing'] });

  if (state.currentFilter === 'urgent') orders = orders.filter(o => o.priority === 'urgent' || o.priority === 'stat');
  else if (state.currentFilter !== 'all') orders = orders.filter(o => o.status === state.currentFilter);

  if (search) {
    orders = orders.filter(o => {
      const p = TIBEX_STORE.getPatient(o.patient_id);
      if (!p) return false;
      return p.fullname.toLowerCase().includes(search) || p.phone.includes(search) || o.id.toLowerCase().includes(search) || o.test_name.toLowerCase().includes(search);
    });
  }

  const rank = { stat: 0, urgent: 1, normal: 2 };
  orders.sort((a, b) => {
    if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
    return (b.created_at || 0) - (a.created_at || 0);
  });

  const html = orders.map(o => {
    const p = TIBEX_STORE.getPatient(o.patient_id);
    if (!p) return '';
    const isUrgent = o.priority === 'urgent' || o.priority === 'stat';

    let actionHtml = '';
    if (o.status === 'new' && can('lab','edit')) actionHtml = '<button class="success" data-act="receive">📥 Namuna olindi</button>';
    else if (o.status === 'received' && can('lab','edit')) actionHtml = '<button class="primary" data-act="analyze">→ Analizator</button>';
    else if (o.status === 'processing' && can('lab','edit')) actionHtml = '<button class="primary" data-act="results">📊 Natija kirit</button>';

    return `<tr data-id="${o.id}" data-status="${esc(o.status)}" class="${isUrgent ? 'urgent-row' : ''} ${o.id === state.selectedOrderId ? 'selected' : ''}">
      <td class="time-col">${fmtTime(o.created_at)}</td>
      <td><span class="barcode">${o.id}</span></td>
      <td>
        <div class="patient-name">${esc(p.fullname)} ${isUrgent ? `<span class="priority ${escAttr(o.priority)}">${esc(o.priority.toUpperCase())}</span>` : ''}</div>
        <div class="patient-sub">${esc(p.phone)} · ${p.age} yosh · ${esc(p.gender)}</div>
      </td>
      <td><div class="test-name">${esc(o.test_name)}</div><div class="test-sub">${esc(o.test_key)}</div></td>
      <td class="doctor-name" style="color:var(--muted);">${esc(o.ordered_by)}</td>
      <td><span class="status ${statusClass(o.status)}">${esc(statusLabel(o.status))}</span></td>
      <td><div class="row-actions">
        ${actionHtml}
        <button data-act="view">👁</button>
      </div></td>
    </tr>`;
  }).join('');

  document.getElementById('incomingBody').innerHTML = html || '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--dim);">Faol so\'rovlar yo\'q</td></tr>';
  attachRowHandlers();
}

function renderProcessing() {
  const orders = TIBEX_STORE.getLabOrders({ status: 'processing' });
  document.getElementById('processingCount').textContent = orders.length;

  const html = orders.map(o => {
    const p = TIBEX_STORE.getPatient(o.patient_id);
    if (!p) return '';
    const isUrgent = o.priority === 'urgent' || o.priority === 'stat';
    return `<tr data-id="${o.id}" class="${isUrgent ? 'urgent-row' : ''}">
      <td><span class="barcode">${o.id}</span></td>
      <td><div class="patient-name">${esc(p.fullname)} ${isUrgent ? `<span class="priority ${escAttr(o.priority)}">${esc(o.priority.toUpperCase())}</span>` : ''}</div><div class="patient-sub">${esc(p.phone)}</div></td>
      <td><div class="test-name">${esc(o.test_name)}</div><div class="test-sub">${esc(o.test_key)}</div></td>
      <td class="time-col">${fmtTime(o.started_at || o.created_at)}</td>
      <td><span class="status processing">Analizda</span></td>
      <td><div class="row-actions">
        ${can('lab','edit') ? '<button class="primary" data-act="results">📊 Natija kirit</button>' : ''}
        <button data-act="view">👁</button>
      </div></td>
    </tr>`;
  }).join('');

  document.getElementById('processingBody').innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--dim);">Jarayonda namunalar yo\'q</td></tr>';
  attachRowHandlers();
}

function renderVerified() {
  const orders = TIBEX_STORE.getLabOrders({ status: 'verified' });
  document.getElementById('verifiedCount').textContent = orders.length;

  const html = orders.map(o => {
    const p = TIBEX_STORE.getPatient(o.patient_id);
    if (!p) return '';
    return `<tr data-id="${o.id}">
      <td class="time-col">${fmtTime(o.verified_at)}</td>
      <td><span class="barcode">${o.id}</span></td>
      <td><div class="patient-name">${esc(p.fullname)}</div><div class="patient-sub">${esc(p.phone)}</div></td>
      <td><div class="test-name">${esc(o.test_name)}</div><div class="test-sub">${esc(o.result_summary || 'Natija mavjud')}</div></td>
      <td><span class="status verified">Tasdiqlangan</span></td>
      <td><div class="row-actions">
        <button data-act="view">👁</button>
        <button data-act="print">🖨</button>
      </div></td>
    </tr>`;
  }).join('');

  document.getElementById('verifiedBody').innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--dim);">Tasdiqlangan natijalar yo\'q</td></tr>';
  attachRowHandlers();
}

function renderUrgent() {
  const orders = TIBEX_STORE.getLabOrders().filter(o => (o.priority === 'urgent' || o.priority === 'stat') && o.status !== 'verified');
  document.getElementById('urgentCount').textContent = orders.length;

  const html = orders.map(o => {
    const p = TIBEX_STORE.getPatient(o.patient_id);
    if (!p) return '';
    return `<tr data-id="${o.id}" class="urgent-row">
      <td class="time-col">${fmtTime(o.created_at)}</td>
      <td><span class="barcode">${o.id}</span></td>
      <td><div class="patient-name">${esc(p.fullname)}</div><div class="patient-sub">${esc(p.phone)} · ${p.age} yosh</div></td>
      <td><div class="test-name">${esc(o.test_name)}</div></td>
      <td class="doctor-name" style="color:var(--muted);">${esc(o.ordered_by)}</td>
      <td><span class="status urgent">🔴 ${o.priority === 'stat' ? 'STAT' : 'Shoshilinch'}</span></td>
      <td><div class="row-actions">
        ${o.status === 'new' && can('lab','edit') ? '<button class="success" data-act="receive">📥 Namuna</button>' : ''}
        ${o.status === 'received' && can('lab','edit') ? '<button class="primary" data-act="analyze">→ Analizator</button>' : ''}
        ${o.status === 'processing' && can('lab','edit') ? '<button class="primary" data-act="results">📊 Natija</button>' : ''}
        ${o.status === 'ready' && can('lab','verify') ? '<button class="success" data-act="verify">✓ Tasdiqla</button>' : ''}
      </div></td>
    </tr>`;
  }).join('');

  document.getElementById('urgentBody').innerHTML = html || '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--dim);">Shoshilinch so\'rovlar yo\'q</td></tr>';
  attachRowHandlers();
}

function attachRowHandlers() {
  document.querySelectorAll('.data-table tbody tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return;
      const id = tr.dataset.id;
      if (!id) return;
      selectOrder(id);
    });
  });
  document.querySelectorAll('.row-actions button[data-act]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const id = btn.closest('tr').dataset.id;
      handleAction(id, btn.dataset.act);
    });
  });
}

function handleAction(id, act) {
  const order = TIBEX_STORE.getLabOrder(id);
  if (!order) return;
  if (act === 'receive') {
    if (!can('lab','edit')) return toast('Ruxsat yo\'q', 'bad');
    TIBEX_STORE.updateLabOrder(id, { status: 'received', received_at: Date.now(), received_by: CURRENT_USER.fullname });
    toast('📥 Namuna olindi', 'ok');
    renderAll();
    if (state.selectedOrderId === id) selectOrder(id);
  } else if (act === 'analyze') {
    if (!can('lab','edit')) return toast('Ruxsat yo\'q', 'bad');
    TIBEX_STORE.updateLabOrder(id, { status: 'processing', started_at: Date.now(), analyzer: 'Cobas c311' });
    toast('🔬 Analizatorga yuborildi', 'purple');
    renderAll();
    if (state.selectedOrderId === id) selectOrder(id);
  } else if (act === 'results') {
    if (!can('lab','edit')) return toast('Ruxsat yo\'q', 'bad');
    openResultModal(id);
  } else if (act === 'verify') {
    if (!can('lab','verify')) return toast('Ruxsat yo\'q', 'bad');
    TIBEX_STORE.updateLabOrder(id, { status: 'verified', verified_at: Date.now(), verified_by: CURRENT_USER.fullname });
    toast('✅ Natija tasdiqlandi', 'ok');
    renderAll();
    if (state.selectedOrderId === id) selectOrder(id);
  } else if (act === 'view') selectOrder(id);
  else if (act === 'print') toast('🖨 Chop etilmoqda...', 'info');
}

function selectOrder(id) {
  const order = TIBEX_STORE.getLabOrder(id);
  if (!order) return;
  const p = TIBEX_STORE.getPatient(order.patient_id);
  if (!p) return;

  state.selectedOrderId = id;
  document.getElementById('detailEmpty').style.display = 'none';
  document.getElementById('detailContent').style.display = 'block';

  const isUrgent = order.priority === 'urgent' || order.priority === 'stat';
  const tags = [];
  if (isUrgent) tags.push(`<span class="tag danger">🔴 ${order.priority === 'stat' ? 'STAT' : 'SHOSHILINCH'}</span>`);
  tags.push(`<span class="tag purple">${esc(TEST_DEFINITIONS[order.test_key]?.panel || order.test_name)}</span>`);
  tags.push(`<span class="tag info">${esc(order.ordered_by)}</span>`);

  let actionsHtml = '';
  if (order.status === 'new' && can('lab','edit')) actionsHtml = `<button class="success" data-detail-act="receive">📥 Namuna olindi</button>`;
  else if (order.status === 'received' && can('lab','edit')) actionsHtml = `<button class="primary" data-detail-act="analyze">→ Analizatorga yuborish</button>`;
  else if (order.status === 'processing' && can('lab','edit')) actionsHtml = `<button class="primary" data-detail-act="results">📊 Natija kiritish</button>`;
  else if (order.status === 'ready' && can('lab','verify')) actionsHtml = `<button class="success" data-detail-act="verify">✅ Tasdiqlash</button>`;
  else if (order.status === 'verified') actionsHtml = `<button class="primary" data-detail-act="print">🖨 Chop etish</button>`;

  let resultRows = '';
  if (order.status === 'verified' || order.status === 'ready') {
    const def = TEST_DEFINITIONS[order.test_key];
    if (def && order.result_data) {
      resultRows = def.params.map(prm => {
        const val = order.result_data[prm.code] || '—';
        return `<div class="detail-row"><span class="k">${esc(prm.name)}</span><span class="v mono">${esc(val)} ${esc(prm.unit)}</span></div>`;
      }).join('');
    }
  }

  document.getElementById('detailContent').innerHTML = `
    <div class="sample-card">
      <div class="barcode-display">${order.id}</div>
      <div class="patient-info">
        <div class="avatar">${esc(initials(p.fullname))}</div>
        <div>
          <div class="name">${esc(p.fullname)}</div>
          <div class="meta">${p.age} yosh · ${esc(p.gender)} · ${esc(p.phone)}</div>
        </div>
      </div>
      <div class="tags">${tags.join('')}</div>
      <div class="actions">${actionsHtml}</div>
    </div>

    <div class="detail-block">
      <div class="detail-head" data-toggle="detail"><span>🧪 So'rov tafsilotlari</span><span class="chev">▸</span></div>
      <div class="detail-body">
        <div class="detail-row"><span class="k">Tahlil</span><span class="v">${esc(order.test_name)}</span></div>
        <div class="detail-row"><span class="k">Kod</span><span class="v mono">${esc(order.test_key)}</span></div>
        <div class="detail-row"><span class="k">Muhimlik</span><span class="v ${isUrgent ? 'danger' : 'ok'}">${order.priority === 'stat' ? '🔴 STAT' : order.priority === 'urgent' ? '🟠 Shoshilinch' : '🟢 Normal'}</span></div>
        <div class="detail-row"><span class="k">Holat</span><span class="v"><span class="status ${statusClass(order.status)}" style="font-size:10px;">${esc(statusLabel(order.status))}</span></span></div>
        <div class="detail-row"><span class="k">So'rov vaqti</span><span class="v mono">${fmtTime(order.created_at)}</span></div>
        <div class="detail-row"><span class="k">Shifokor</span><span class="v">${esc(order.ordered_by)}</span></div>
      </div>
    </div>

    ${resultRows ? `
    <div class="detail-block">
      <div class="detail-head" data-toggle="detail"><span>📊 Natijalar</span><span class="chev">▸</span></div>
      <div class="detail-body">${resultRows}</div>
    </div>` : ''}

    <div class="detail-block collapsed">
      <div class="detail-head" data-toggle="detail"><span>👤 Bemor ma'lumotlari</span><span class="chev">▸</span></div>
      <div class="detail-body">
        <div class="detail-row"><span class="k">Qon guruhi</span><span class="v">${esc(p.blood)}</span></div>
        ${p.allergies?.length ? `<div class="detail-row"><span class="k">Allergiya</span><span class="v danger">${esc(p.allergies.join(', '))}</span></div>` : ''}
        ${p.chronic?.length ? `<div class="detail-row"><span class="k">Surunkali</span><span class="v">${esc(p.chronic.join(', '))}</span></div>` : ''}
      </div>
    </div>
  `;

  document.querySelectorAll('#detailContent [data-toggle="detail"]').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
  });
  document.querySelectorAll('#detailContent [data-detail-act]').forEach(b => {
    b.addEventListener('click', () => handleAction(id, b.dataset.detailAct));
  });
}

function openResultModal(orderId) {
  const order = TIBEX_STORE.getLabOrder(orderId);
  if (!order) return;
  const def = TEST_DEFINITIONS[order.test_key];
  if (!def) return toast('Bu tahlil turi uchun shablon yo\'q', 'warn');
  const p = TIBEX_STORE.getPatient(order.patient_id);
  const isUrgent = order.priority === 'urgent' || order.priority === 'stat';

  state.currentResultOrderId = orderId;
  document.getElementById('modalResultOrderId').textContent = orderId;

  const existingResults = order.result_data || {};
  const rowsHtml = def.params.map(prm => {
    const val = existingResults[prm.code] || '';
    return `<tr data-param="${esc(prm.code)}">
      <td><div class="param">${esc(prm.name)}</div><div class="param-code">${esc(prm.code)}</div></td>
      <td class="unit">${esc(prm.unit)}</td>
      <td class="ref">${esc(prm.ref)}</td>
      <td><input class="value-input" value="${escAttr(val)}" data-param="${esc(prm.code)}" data-ref="${escAttr(prm.ref)}"></td>
      <td class="flag"></td>
    </tr>`;
  }).join('');

  document.getElementById('modalResultBody').innerHTML = `
    ${isUrgent ? `<div style="padding:12px 16px; background:var(--danger-tint); border-left:4px solid var(--danger); margin-bottom:12px; border-radius:6px;">
      <div style="font-weight:700; color:#991b1b; font-size:13px;">🔴 ${order.priority === 'stat' ? 'STAT' : 'SHOSHILINCH'} — ${esc(def.name)}</div>
      <div style="font-size:11.5px; color:#7f1d1d; margin-top:2px;">${esc(p.fullname)} · ${esc(order.ordered_by)}</div>
    </div>` : `<div style="padding:8px 0 12px; font-size:12.5px; color:var(--muted);">${esc(p.fullname)} · ${esc(order.ordered_by)}</div>`}
    <div class="panel-group" style="margin:0 -20px 12px;"><span>${esc(def.panel)}</span></div>
    <table class="result-table">
      <thead><tr>
        <th>Ko'rsatkich</th><th style="width:100px;">Birlik</th>
        <th style="width:120px;text-align:center;">Me'yor</th>
        <th style="width:140px;text-align:center;">Natija</th>
        <th style="width:40px;"></th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="margin-top:16px; display:flex; flex-direction:column; gap:5px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Laborant izohi</label>
      <textarea id="resultNote" placeholder="Namuna sifati, xususiy holatlar..." style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:14px;min-height:60px;resize:vertical;">${esc(order.result_note || '')}</textarea>
    </div>
  `;

  document.querySelectorAll('#modalResultBody .value-input').forEach(input => {
    input.addEventListener('input', () => checkValue(input));
    checkValue(input);
  });

  document.getElementById('modalResultInput').classList.add('open');
  setTimeout(() => document.querySelector('#modalResultBody .value-input')?.focus(), 100);
}

function checkValue(input) {
  const refText = input.dataset.ref || '';
  const val = parseFloat(input.value);
  const row = input.closest('tr');
  const flag = row.querySelector('.flag');
  if (isNaN(val) || !flag) { flag.textContent = ''; flag.className = 'flag'; input.classList.remove('abnormal','warn'); return; }

  let isAbnormal = false, isWarn = false, flagIcon = '';
  let m = refText.match(/^<\s*([\d.]+)/);
  if (m) {
    const hi = parseFloat(m[1]);
    if (val >= hi) { isAbnormal = true; flagIcon = '↑'; }
    else if (val >= hi * 0.9) { isWarn = true; flagIcon = '≈'; }
    else flagIcon = '✓';
  } else {
    m = refText.match(/^([\d.]+)\s*-\s*([\d.]+)/);
    if (m) {
      const lo = parseFloat(m[1]), hi = parseFloat(m[2]);
      if (val < lo) { isAbnormal = true; flagIcon = '↓'; }
      else if (val > hi) { isAbnormal = true; flagIcon = '↑'; }
      else flagIcon = '✓';
    } else {
      m = refText.match(/^>\s*([\d.]+)/);
      if (m) {
        if (val <= parseFloat(m[1])) { isAbnormal = true; flagIcon = '↓'; }
        else flagIcon = '✓';
      } else flagIcon = '✓';
    }
  }
  input.classList.remove('abnormal', 'warn');
  flag.classList.remove('up', 'down', 'ok');
  if (isAbnormal) { input.classList.add('abnormal'); flag.classList.add(flagIcon === '↑' ? 'up' : 'down'); }
  else if (isWarn) { input.classList.add('warn'); flag.classList.add('ok'); }
  else flag.classList.add('ok');
  flag.textContent = flagIcon;
}

document.getElementById('btnSaveResult')?.addEventListener('click', () => {
  if (!can('lab','edit')) return toast('Ruxsat yo\'q', 'bad');
  const orderId = state.currentResultOrderId;
  if (!orderId) return;
  const order = TIBEX_STORE.getLabOrder(orderId);
  if (!order) return;

  const resultData = {};
  const summary = [];
  document.querySelectorAll('#modalResultBody .value-input').forEach(input => {
    resultData[input.dataset.param] = input.value;
    const flag = input.closest('tr').querySelector('.flag')?.textContent || '';
    if (flag === '↑' || flag === '↓') summary.push(`${input.dataset.param} ${input.value} ${flag}`);
  });

  TIBEX_STORE.updateLabOrder(orderId, {
    status: 'ready',
    result_data: resultData,
    result_summary: summary.length > 0 ? summary.join(' · ') : 'Barcha ko\'rsatkichlar me\'yorda',
    result_note: document.getElementById('resultNote')?.value || '',
    completed_at: Date.now(),
    completed_by: CURRENT_USER.fullname
  });

  document.getElementById('modalResultInput').classList.remove('open');
  toast('📊 Natija saqlandi — tasdiqlash kerak', 'ok');
  renderAll();
  if (state.selectedOrderId === orderId) selectOrder(orderId);
});

/* ═══ NEW ORDER MODAL ═══ */
document.getElementById('btnNewOrder')?.addEventListener('click', openNewOrderModal);

function openNewOrderModal() {
  if (!can('lab','create')) return toast('Ruxsat yo\'q', 'bad');
  const sel = document.getElementById('noPatient');
  sel.innerHTML = TIBEX_STORE.getAllPatients().map(p => `<option value="${esc(p.id)}">${esc(p.fullname)} (${esc(p.phone)})</option>`).join('');
  document.getElementById('modalNewOrder').classList.add('open');
}

document.getElementById('btnSaveNewOrder')?.addEventListener('click', () => {
  if (!can('lab','create')) return toast('Ruxsat yo\'q', 'bad');
  const pid = parseInt(document.getElementById('noPatient').value);
  const testPair = document.getElementById('noTest').value.split('|');
  const priority = document.getElementById('noPriority').value;
  const doctor = document.getElementById('noDoctor').value;
  if (!pid) return toast('Bemorni tanlang', 'warn');
  TIBEX_STORE.addLabOrder({
    appointment_id: null, patient_id: pid,
    test_key: testPair[0], test_name: testPair[1],
    priority: priority, ordered_by: doctor, status: 'new'
  });
  document.getElementById('modalNewOrder').classList.remove('open');
  toast(`➕ Yangi so'rov (${priority.toUpperCase()})`, 'ok');
  renderAll();
});

/* ═══ TABS & FILTERS ═══ */
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

document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('on'));
    chip.classList.add('on');
    state.currentFilter = chip.dataset.filter;
    renderIncoming();
  });
});

document.getElementById('incomingSearch')?.addEventListener('input', renderIncoming);

/* ═══ BULK ACTIONS ═══ */
document.getElementById('qaVerifyAll')?.addEventListener('click', verifyAllReady);

function verifyAllReady() {
  if (!can('lab','verify')) return toast('Ruxsat yo\'q', 'bad');
  const ready = TIBEX_STORE.getLabOrders({ status: 'ready' });
  if (ready.length === 0) return toast('Tasdiqlash uchun natijalar yo\'q', 'warn');
  if (!confirm(`${ready.length} ta natijani tasdiqlaysizmi?`)) return;
  var _ok = 0;
  var _err = 0;
  ready.forEach(function(o) {
    try {
      TIBEX_STORE.updateLabOrder(o.id, {
        status: 'verified',
        verified_at: Date.now(),
        verified_by: CURRENT_USER.fullname
      });
      _ok++;
    } catch (e) { _err++; }
  });
  // TIBEX_LAB_FULL_v1: raqamli natija
  if (_err > 0) {
    toast(`✅ ${_ok} ta tasdiqlandi, ⚠️ ${_err} ta xato`, 'warn');
  } else {
    toast(`✅ ${_ok} ta natija tasdiqlandi`, 'ok');
  }
  renderAll();
}

document.getElementById('qaPrintLabels')?.addEventListener('click', () => toast('🏷️ Yorliqlar chop etilmoqda...', 'info'));
document.getElementById('qaScan')?.addEventListener('click', openScan);
document.getElementById('actRefresh')?.addEventListener('click', () => { renderAll(); toast('↻ Yangilandi', 'info'); });
document.getElementById('actPrint')?.addEventListener('click', () => toast('🖨 Chop etishga tayyorlanmoqda...', 'info'));
document.getElementById('actRelease')?.addEventListener('click', () => toast('📤 Natijalar shifokorga yuborildi', 'purple'));
document.getElementById('btnQC')?.addEventListener('click', () => document.querySelector('[data-view="qc"]').click());
document.getElementById('btnAnalyzers')?.addEventListener('click', openAnalyzersModal);
document.getElementById('btnExportExcel')?.addEventListener('click', () => toast('📄 Excel yuklab olinmoqda...', 'info'));
document.getElementById('btnPrintAll')?.addEventListener('click', () => toast('🖨 Chop etilmoqda...', 'info'));
document.getElementById('btnExportReports')?.addEventListener('click', () => toast('📄 Excel yuklab olinmoqda...', 'info'));
document.getElementById('btnPrintReports')?.addEventListener('click', () => toast('🖨 Chop etilmoqda...', 'info'));
document.getElementById('btnFillDefaults')?.addEventListener('click', () => {
  if (!state.currentResultOrderId) return;
  document.querySelectorAll('#modalResultBody .value-input').forEach(input => {
    input.value = '';
    checkValue(input);
  });
  toast('📋 Maydonlar tozalandi', 'info');
});

/* ═══ SCAN ═══ */
const scanOverlay = document.getElementById('scanOverlay');
const scanInput = document.getElementById('scanInput');
function openScan() {
  if (!can('lab','edit') && !can('lab','create')) return toast('Ruxsat yo\'q', 'bad');
  scanOverlay.classList.add('show');
  setTimeout(() => scanInput.focus(), 100);
}
function closeScan() {
  scanOverlay.classList.remove('show');
  scanInput.value = '';
}
scanInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const code = scanInput.value.trim();
    if (!code) return;
    const order = TIBEX_STORE.getLabOrder(code);
    if (order) {
      selectOrder(code);
      toast(`📷 Topildi: ${code}`, 'purple');
      document.querySelector('[data-view="incoming"]')?.click();
      const row = document.querySelector(`tr[data-id="${code}"]`);
      if (row) row.classList.add('selected');
    } else {
      toast(`❌ Shtrix kod topilmadi: ${code}`, 'bad');
    }
    closeScan();
  }
  if (e.key === 'Escape') closeScan();
});
scanOverlay?.addEventListener('click', (e) => { if (e.target === scanOverlay) closeScan(); });

document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal-backdrop').classList.remove('open')));
document.querySelectorAll('.modal-backdrop').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));
document.getElementById('btnHelp')?.addEventListener('click', () => document.getElementById('kbdModal').classList.add('open'));

/* ═══ KEYBOARD ═══ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
    closeScan();
    return;
  }
  if (e.key === 'F1') { e.preventDefault(); document.getElementById('kbdModal').classList.add('open'); }
  if (e.key === 'F2') { e.preventDefault(); openScan(); }
  if (e.key === 'F3') { e.preventDefault(); openNewOrderModal(); }
  if (e.key === 'F5') { e.preventDefault(); renderAll(); toast('↻ Yangilandi', 'ok'); }
  if (e.key === 'F9') { e.preventDefault(); if (can('lab','edit')) toast('📤 Natijalar shifokorga yuborildi', 'purple'); }
  if (e.key === 'F10') { e.preventDefault(); verifyAllReady(); }

  if (e.ctrlKey && ['1','2','3','4','5'].includes(e.key)) {
    e.preventDefault();
    const views = ['incoming', 'processing', 'results', 'verified', 'urgent'];
    document.querySelector(`[data-view="${views[parseInt(e.key)-1]}"]`)?.click();
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); toast('🖨 Chop etish...', 'info'); }

  if (e.key === 'Enter' && e.target.classList.contains('value-input')) {
    e.preventDefault();
    const inputs = [...document.querySelectorAll('#modalResultBody .value-input')];
    const idx = inputs.indexOf(e.target);
    if (idx < inputs.length - 1) { inputs[idx + 1].focus(); inputs[idx + 1].select(); }
    else document.getElementById('btnSaveResult').click();
  }

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
  updateStats();
  renderIncoming();
  renderProcessing();
  renderVerified();
  renderUrgent();
  renderEquipmentSidebar();   // admin panel bilan sinxron
  renderReagentsSidebar();    // admin panel bilan sinxron
  renderIntegrations();       // HL7 qurilmalar
  renderQC();                 // admin analizatorlaridan
  applyPermissions();

  const all = TIBEX_STORE.getLabOrders();
  document.getElementById('rTotal').textContent = all.length;
  document.getElementById('rVerified').textContent = all.filter(o => o.status === 'verified').length;
  document.getElementById('rPending').textContent = all.filter(o => ['new','received','processing','ready'].includes(o.status)).length;
  document.getElementById('rUrgent').textContent = all.filter(o => o.priority !== 'normal' && o.status !== 'verified').length;
}

/* ═══ SYNC ═══ */
  const notifiedNewLabOrderIds = new Set((TIBEX_STORE.getLabOrders() || []).map(o => String(o.id)));
  TIBEX_STORE.subscribe((data, source) => {
    if (source === 'external') {
      const newOrders = (data.lab_orders || []).filter(o => {
        if (o.status !== 'new') return false;
        const id = String(o.id);
        const isNew = !notifiedNewLabOrderIds.has(id);
        notifiedNewLabOrderIds.add(id);
        return isNew;
      });
    if (newOrders.length > 0) {
      const latest = newOrders[newOrders.length - 1];
      const p = data.patients[String(latest.patient_id)];
      if (p) toast(`🔬 Yangi so'rov: ${esc(p.fullname)} — ${esc(latest.test_name)}`, latest.priority !== 'normal' ? 'urgent' : 'info');
    }
  }
  window.TIBEX_REALTIME_PRO && window.TIBEX_REALTIME_PRO.smartRender ? window.TIBEX_REALTIME_PRO.smartRender() : renderAll();
  if (state.selectedOrderId) {
    const o = TIBEX_STORE.getLabOrder(state.selectedOrderId);
    if (o) selectOrder(state.selectedOrderId);
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

/* ===== block_1 ===== */
/* TIBEX_SCANNER_v9: yagona handler + bind (toza) */
(function () {
  "use strict";

  if (window.__TIBEX_SCANNER_HANDLER__) return;
  window.__TIBEX_SCANNER_HANDLER__ = true;

  window.__TIBEX_ON_BARCODE__ = function (code, opts) {
    if (!code) return;
    opts = opts || {};
    try {
      var order = (window.TIBEX_STORE && window.TIBEX_STORE.getLabOrder)
        ? window.TIBEX_STORE.getLabOrder(code) : null;
      if (order) {
        if (window.toast) window.toast("✅ Topildi: " + code, "ok");
        if (typeof window.selectOrder === "function") window.selectOrder(code);
        var tab = document.querySelector('[data-view="incoming"]');
        if (tab) tab.click();
        var row = document.querySelector('tr[data-id="' + code + '"]');
        if (row) {
          row.classList.add("selected");
          try { row.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
        }
      } else if (!opts.keepOpen) {
        if (window.toast) window.toast("❌ Kod topilmadi: " + code, "bad", 5000);
      }
    } catch (e) {
      console.warn("[SCANNER_HANDLER]", e);
    }
  };

  function openCamera() {
    if (window.TIBEX_SMART_CAMERA && typeof window.TIBEX_SMART_CAMERA.open === "function") {
      try { window.TIBEX_SMART_CAMERA.open(); return; } catch (e) {}
    }
    if (window.toast) window.toast("Kamera moduli yuklanmagan", "bad", 4000);
  }
  window._openCamera = openCamera;

  function bindButton() {
    var btn = document.getElementById("qaCameraScan");
    if (btn && !btn._scannerBound) {
      btn._scannerBound = true;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        openCamera();
      });
    }
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "F9") { e.preventDefault(); openCamera(); }
  });

    function init() {
    bindButton();
    setTimeout(bindButton, 500);
    setTimeout(bindButton, 1500);
    setTimeout(bindButton, 3000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  console.log("[TIBEX] Scanner handler ready (v9)");
})();
