const $ = (id) => document.getElementById(id);
let latest = null;
let controlToken = '';
let history = [];
let tagsLoaded = false;
let refreshing = false;
let toastTimer = null;
const colors = ['#36c7d7', '#27d17f', '#ffb84a', '#b282ff'];
const modbusWatchBits = [
  { address: '%M0', key: 'systemEnable', label: 'SYSTEM_ENABLE', source: 'hasil permissive' },
  { address: '%M5', key: 'commissioning', label: 'Commissioning OK', source: 'tombol SCADA' },
  { address: '%M300', key: 'safety', label: 'Safety OK', source: 'virtual %I0.0' },
  { address: '%M301', key: 'limitClose1', label: 'Limit Close G1', source: 'virtual %I0.1' },
  { address: '%M302', key: 'limitOpen1', label: 'Limit Open G1', source: 'virtual %I0.2' },
  { address: '%M303', key: 'limitClose2', label: 'Limit Close G2', source: 'virtual %I0.3' },
  { address: '%M304', key: 'limitOpen2', label: 'Limit Open G2', source: 'virtual %I0.4' },
  { address: '%M305', key: 'limitClose3', label: 'Limit Close G3', source: 'virtual %I0.5' },
  { address: '%M306', key: 'limitOpen3', label: 'Limit Open G3', source: 'virtual %I0.6' },
  { address: '%M307', key: 'overload1', label: 'Overload G1 OK', source: 'virtual %I0.7' },
  { address: '%M308', key: 'overload2', label: 'Overload G2 OK', source: 'virtual %I0.8' },
  { address: '%M309', key: 'overload3', label: 'Overload G3 OK', source: 'virtual %I0.9' },
  { address: '%M344', key: 'auto', label: 'Mode AUTO', source: 'virtual %I1.24' },
  { address: '%M351', key: 'reset', label: 'Reset Fault', source: 'virtual %I1.31' },
  { address: '%M370', key: 'run', label: 'Enable Simulator', source: 'izin gerak SCADA' }
];

function text(id, value) { $(id).textContent = value; }
function number(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
function safe(value) { const e = document.createElement('span'); e.textContent = String(value); return e.innerHTML; }
function encoderPercentToCount(gateId, percent) {
  const gate = latest?.data?.gates?.[gateId - 1];
  let min = Number(gate?.encoderMinCount);
  let max = Number(gate?.encoderMaxCount);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) { min = 0; max = 255; }
  return Math.max(0, Math.min(255, Math.round(min + ((max - min) * percent / 100))));
}

function gateCard(gate) {
  return `<article id="gate${gate.id}" class="gate-card">
    <div class="gate-head"><h2>GATE ${gate.id}</h2><span class="status">—</span></div>
    <div class="gate-main">
      <div class="gate-gauge"><div class="gate-water"></div><i class="gate-blade"></i></div>
      <div class="position"><strong><em class="position-value">—</em><small>%</small></strong><span class="position-mm">—</span>
        <div class="encoder-readout">
          <b>ROTARY E6CP</b>
          <span class="encoder-count">count —</span>
          <small class="encoder-map">—</small>
        </div>
        <div class="signals"><span>AUTO OPEN</span><span>AUTO CLOSE</span><span>PANEL OPEN</span><span>PANEL CLOSE</span></div>
        <div class="target-row"><input id="target${gate.id}" type="number" min="0" max="100" step="1" aria-label="Target pintu ${gate.id}"><button data-gate="${gate.id}" disabled>SET</button></div>
        <small class="target-note">%MW${49 + gate.id} · 4005${gate.id} · target 0–100%</small>
        <small class="motion-note"></small>
      </div>
    </div>
  </article>`;
}

function updateGate(gate, snapshot) {
  const card = $(`gate${gate.id}`);
  const status = card.querySelector('.status');
  const rev3 = snapshot.data.rev3;
  const blocked = !snapshot.data.system.enabled || !snapshot.data.system.commissioningOk || (rev3?.compatible && rev3.blockers?.length > 0);
  const auto = snapshot.simulatorInputPanelEnabled ? snapshot.data.simInputs?.values?.auto
    : rev3?.compatible ? rev3.inputs?.auto : snapshot.mode === 'simulation' ? true : undefined;
  status.textContent = !snapshot.connected ? 'STALE' : gate.fault ? 'FAULT' : blocked ? 'INHIBITED' : auto === false ? 'AUTO OFF' : auto === true ? 'PERMIT OK' : 'AUTO ?';
  status.className = `status${gate.fault || !snapshot.connected || blocked || auto !== true ? ' fault' : ''}`;
  card.querySelector('.motion-note').textContent = !snapshot.connected
    ? 'Data tidak terkini; izin gerak dan posisi belum dapat dipastikan.'
    : gate.fault ? 'Fault pintu aktif. SET hanya menyimpan target; periksa fault dan feedback encoder di PLC.'
    : blocked ? 'Gerak ditahan PLC: lihat alasan pada panel izin gerak. SET hanya menyimpan target, bukan posisi aktual.'
    : auto === false ? 'AUTO OFF: target tidak diikuti otomatis. AUTO berasal dari input PLC; posisi aktual memerlukan feedback encoder.'
    : auto !== true ? 'Status AUTO belum terverifikasi. SET hanya menyimpan target; posisi aktual tetap mengikuti encoder.'
    : 'Izin umum dan AUTO aktif. SET = target; posisi aktual mengikuti encoder. Limit dan fault tetap berlaku.';
  card.querySelector('.position-value').textContent = number(gate.positionPct);
  card.querySelector('.position-mm').textContent = `${number(gate.positionMm, 0)} / ${gate.maxHeightMm || '—'} mm`;
  card.querySelector('.encoder-count').textContent = `count ${Number.isFinite(gate.encoderCount) ? gate.encoderCount : '—'} · min ${Number.isFinite(gate.encoderMinCount) ? gate.encoderMinCount : '—'} · max ${Number.isFinite(gate.encoderMaxCount) ? gate.encoderMaxCount : '—'}`;
  card.querySelector('.encoder-map').textContent = `${gate.encoderInputBits || 'input encoder'} → ${gate.encoderWord || 'word count'} → posisi %/mm`;
  card.querySelector('.gate-blade').style.height = `${100 - Math.max(0, Math.min(100, gate.positionPct || 0))}%`;
  const signals = [gate.autoOpenRequest, gate.autoCloseRequest, gate.panelOpenRequest, gate.panelCloseRequest];
  card.querySelectorAll('.signals span').forEach((element, index) => element.classList.toggle('on', snapshot.connected && signals[index]));
  const input = $(`target${gate.id}`);
  if (input.dataset.dirty !== 'true' && document.activeElement !== input) input.value = gate.targetPct;
  card.querySelector('button').disabled = !snapshot.connected || !(snapshot.simulationControlEnabled || snapshot.writeEnabled) || input.dataset.pending === 'true';
}

function render(snapshot) {
  latest = snapshot;
  renderRev3Inputs(snapshot);
  renderModbusWatch(snapshot);
  text('sourceInfo', snapshot.mode === 'simulation' ? 'SUMBER: SIMULASI JAVASCRIPT — bukan data sensor' :
    `SUMBER: MODBUS TCP · ${snapshot.source?.host || 'IP BELUM DIATUR'}:${snapshot.source?.port || 502} · Unit ID ${snapshot.source?.unitId ?? 1}${snapshot.error ? ` · ${snapshot.error}` : ''}`);
  $('sourceInfo').className = snapshot.connected ? 'good' : 'warn';
  text('mode', snapshot.mode.toUpperCase());
  const connection = $('connection');
  connection.className = snapshot.connected ? 'online' : 'offline';
  connection.textContent = snapshot.connected ? (snapshot.mode === 'simulation' ? 'SIMULATOR ONLINE' : 'PLC ONLINE') : 'OFFLINE';
  text('latency', snapshot.latencyMs ?? '—');
  text('lastUpdate', snapshot.timestamp ? new Date(snapshot.timestamp).toLocaleTimeString('id-ID') : 'Belum ada data');
  text('writeState', snapshot.simulationControlEnabled ? 'SIM ONLY' : snapshot.writeEnabled ? (controlToken ? 'TOKEN SET' : 'TOKEN REQ.') : 'LOCKED');
  $('controlSession').disabled = !snapshot.writeEnabled || snapshot.simulationControlEnabled;
  text('controlSession', controlToken ? 'KUNCI SESI' : 'BUKA SESI KONTROL');
  text('controlHint', snapshot.simulationControlEnabled ? 'SET hanya mengubah simulasi · bukan PLC fisik' : snapshot.simulatorInputPanelEnabled ? 'Target + input simulator melalui Modbus' : snapshot.rev3ControlEnabled ? 'Target + %M5 / %M6 · input fisik READ ONLY' : 'Whitelist %MW50…%MW52');
  $('writeState').className = snapshot.writeEnabled ? 'warn' : 'good';
  renderAlarms(snapshot.alarms || []);
  if (!snapshot.data) {
    text('systemState', 'NO DATA');
    $('systemState').className = 'warn';
    text('commissioning', 'Status PLC belum tersedia');
    text('waterPct', '—'); text('waterMm', '—');
    $('waterFill').style.height = '0%';
    document.querySelector('.process-panel').hidden = true;
    $('gateGrid').replaceChildren();
    history = []; drawTrend();
    return;
  }
  document.querySelector('.process-panel').hidden = false;
  const { system, water, gates } = snapshot.data;
  text('systemState', system.enabled ? 'ENABLED' : 'DISABLED');
  $('systemState').className = system.enabled ? 'good' : 'warn';
  text('commissioning', system.commissioningOk ? 'Commissioning OK' : 'Commissioning NOT OK');
  text('waterPct', number(water.levelPct));
  text('waterMm', number(water.levelMm, 0));
  $('waterFill').style.height = `${Math.max(0, Math.min(100, water.levelPct || 0))}%`;
  gates.forEach((gate) => { $(`miniGate${gate.id}`).style.height = `${100 - Math.max(0, Math.min(100, gate.positionPct || 0))}%`; });
  if (!$('gateGrid').children.length) {
    $('gateGrid').innerHTML = gates.map(gateCard).join('');
    document.querySelectorAll('[data-gate]').forEach((button) => button.addEventListener('click', () => setTarget(Number(button.dataset.gate))));
    gates.forEach((gate) => $(`target${gate.id}`).addEventListener('input', (event) => { event.target.dataset.dirty = 'true'; }));
  }
  gates.forEach((gate) => updateGate(gate, snapshot));
  if (!snapshot.connected) return;
  history.push([water.levelPct, ...gates.map((gate) => gate.positionPct)]);
  if (history.length > 90) history.shift();
  drawTrend();
}

function renderModbusWatch(snapshot) {
  const element = $('modbusWatch');
  if (!element) return;
  const simValues = snapshot.data?.simInputs?.values || {};
  const rev3Values = snapshot.data?.rev3?.values || {};
  const rev3Inputs = snapshot.data?.rev3?.inputs || {};
  element.innerHTML = modbusWatchBits.map((bit) => {
    let value;
    if (bit.key === 'systemEnable') value = snapshot.data?.system?.enabled;
    else if (bit.key === 'commissioning') value = simValues.commissioning ?? rev3Values.commissioning ?? snapshot.data?.system?.commissioningOk;
    else value = simValues[bit.key] ?? rev3Inputs[bit.key];
    const known = typeof value === 'boolean';
    return `<div class="watch-bit${value === true ? ' on' : value === false ? ' off' : ''}">
      <b>${safe(bit.address)}</b>
      <span>${safe(bit.label)}<small>${safe(bit.source)}</small></span>
      <strong>${known ? Number(value) : '—'}</strong>
    </div>`;
  }).join('');
}

function renderAlarms(alarms) {
  text('alarmCount', `${alarms.length} ACTIVE`);
  $('alarms').innerHTML = alarms.length
    ? alarms.map((a) => `<div class="alarm ${safe(a.severity)}"><b>${safe(a.message)}</b><small>${safe(a.code)} · ${safe(a.severity.toUpperCase())}</small></div>`).join('')
    : '<p class="good">✓ Tidak ada alarm aktif</p>';
}

function renderRev3Inputs(snapshot) {
  if (snapshot.simulatorInputPanelEnabled) return renderSimulatorInputs(snapshot);
  text('inputPanelTitle','KONTROL & INPUT REV3');
  text('inputPanelProfile','BEFORE_SIM_INPUTS · INPUT PLC READ ONLY');
  text('inputInstructions','AWGC_REV3_BEFORE_SIM_INPUTS: Safety, overload, AUTO, limit dan encoder dibaca dari input PLC (atau input simulator Schneider), bukan tombol SCADA. ENABLE hanya melepas STOP %M6; tidak memaksa %M0 atau melewati proteksi. Posisi aktual membutuhkan feedback encoder. STOP SCADA bukan E-Stop.');
  const info = snapshot.data?.rev3;
  const allowed = snapshot.rev3ControlEnabled && snapshot.writeEnabled && snapshot.connected && info?.compatible;
  const meta = snapshot.rev3ControlMeta || {};
  const buttons = $('simInputButtons');
  $('simEncoders').hidden = true;
  $('rev3PhysicalInputs').hidden = false;
  document.querySelectorAll('[data-encoder]').forEach(button => { button.disabled = true; });
  $('confirmCommissioning').disabled = !allowed;
  if (buttons.dataset.profile !== 'rev3' || (!buttons.children.length && Object.keys(meta).length)) {
    buttons.dataset.profile = 'rev3';
    const actions = [
      { name: 'run', value: true, label: 'ENABLE', physical: '%M6 = 0 · lepas STOP' },
      { name: 'run', value: false, label: 'STOP SCADA', physical: '%M6 = 1 · tahan gerak' },
      { name: 'commissioning', value: true, label: 'KONFIRMASI COMMISSIONING', physical: '%M5 = 1 · persetujuan operator' },
      { name: 'commissioning', value: false, label: 'NONAKTIFKAN COMMISSIONING', physical: '%M5 = 0' }
    ];
    buttons.innerHTML = actions.filter(action => Object.hasOwn(meta, action.name)).map(action => `<button type="button" data-rev3-control="${action.name}" data-value="${action.value}"${action.name === 'run' && !action.value ? ' class="stop-control"' : ''}><span>${action.label}<br><small>${action.physical}</small></span><b>—</b></button>`).join('');
    document.querySelectorAll('[data-rev3-control]').forEach(button => button.addEventListener('click', () => {
      const name = button.dataset.rev3Control;
      const value = button.dataset.value === 'true';
      if (!controlToken) { $('authDialog').showModal(); return; }
      if (name === 'commissioning' && value) { $('commissioningChecked').checked = false; $('commissioningDialog').showModal(); return; }
      sendRev3Control({name,value});
    }));
  }
  text('simInputStatus', !snapshot.connected ? 'PLC OFFLINE — kontrol dikunci; input dan output belum dapat diverifikasi.' : !info?.compatible
    ? 'Profil AWGC_REV3_BEFORE_SIM_INPUTS belum terverifikasi. Periksa koneksi, mode RUN dan identitas proyek yang sedang aktif; kontrol tetap terkunci.'
    : !snapshot.rev3ControlEnabled || !snapshot.writeEnabled ? 'BEFORE_SIM_INPUTS terdeteksi · monitor-only, penulisan kontrol dikunci oleh konfigurasi.'
    : !controlToken ? 'BEFORE_SIM_INPUTS terdeteksi · buka sesi dengan token, lalu pilih perintah. Safety, OL, AUTO dan limit tetap READ ONLY.'
    : 'BEFORE_SIM_INPUTS terdeteksi · token sesi tersimpan; setiap perintah diperiksa dan diverifikasi baca-balik.');
  document.querySelectorAll('[data-rev3-control]').forEach(button => {
    const name = button.dataset.rev3Control;
    const value = snapshot.connected && info?.compatible ? info.values?.[name] : undefined;
    const selected = typeof value === 'boolean' && value === (button.dataset.value === 'true');
    button.disabled = !allowed;
    button.classList.toggle('on', selected);
    button.querySelector('b').textContent = value === undefined ? '—' : name === 'run' ? (value ? 'ENABLE · %M6=0' : 'STOP · %M6=1') : value ? 'OK · %M5=1' : 'BELUM OK · %M5=0';
  });
  $('rev3PhysicalInputs').innerHTML = Object.entries(snapshot.rev3InputMeta || {}).map(([name,tag]) => {
    const value = snapshot.connected && info?.compatible ? info.inputs?.[name] : undefined;
    return `<div class="physical-input${value === true ? ' on' : ''}"><span>${safe(tag.label)}<br><small>${safe(tag.physical)} → %M${safe(tag.address)} · READ ONLY</small></span><b>${value === undefined ? '—' : value ? 'ON' : 'OFF'}</b></div>`;
  }).join('');
  const blockers = [...(info?.blockers || [])];
  if (info?.inputs?.auto === false) blockers.push('AUTO OFF — target tidak diikuti otomatis');
  else if (info?.inputs?.auto !== true) blockers.push('Status AUTO belum terverifikasi');
  if (snapshot.data?.system.enabled === false && !blockers.length) blockers.push('SYSTEM_ENABLE %M0 OFF');
  text('rev3Blockers', !snapshot.connected || !info?.compatible ? 'Izin gerak belum dapat diperiksa; tunggu data PLC yang valid.' : blockers.length ? 'Gerak target tertahan: ' + blockers.join(' · ') + '. Input fisik tidak dapat diubah dari SCADA.' : 'Izin umum dan AUTO OK. Limit dan fault tetap berlaku; SET tidak menghasilkan feedback encoder.');
  text('simOutputStatus', snapshot.connected && info?.compatible ? (info.outputs || []).map(g => `G${g.id}: OPEN=${Number(g.open)} CLOSE=${Number(g.close)}`).join(' | ') + ' (mirror output %Q0.0…5; bukan bukti motor atau pintu bergerak)' : 'Status output belum dapat diverifikasi.');
}

function renderSimulatorInputs(snapshot) {
  text('inputPanelTitle','INPUT SIMULATOR SCHNEIDER');
  text('inputPanelProfile','SIM INPUTS · OUTPUT FISIK OFF');
  text('controlHint','Target + input simulator melalui Modbus');
  const info = snapshot.data?.simInputs;
  const allowed = snapshot.connected && snapshot.writeEnabled && info?.compatible;
  $('simEncoders').hidden = false;
  $('rev3PhysicalInputs').hidden = true;
  $('confirmCommissioning').disabled = true;
  if ($('commissioningDialog').open) $('commissioningDialog').close('profile-changed');
  if ($('simInputButtons').dataset.profile !== 'sim' || (!$('simInputButtons').children.length && Object.keys(snapshot.simulatorInputMeta || {}).length)) {
    $('simInputButtons').dataset.profile = 'sim';
    $('simInputButtons').innerHTML = Object.entries(snapshot.simulatorInputMeta || {}).map(([name,tag]) => `<button type="button" data-sim-input="${safe(name)}"><span>${safe(tag.label)}<br><small>%M${tag.address}</small></span><b>—</b></button>`).join('');
    document.querySelectorAll('[data-sim-input]').forEach(button => button.addEventListener('click',() => {
      const name=button.dataset.simInput;
      sendSimulatorInput({name,value:!latest.data?.simInputs?.values[name]});
    }));
  }
  document.querySelectorAll('[data-sim-input]').forEach(button => {
    const value=info?.values[button.dataset.simInput];
    button.disabled=!allowed; button.classList.toggle('on',value===true);
    button.querySelector('b').textContent=value === undefined ? '—' : value ? 'ON → OFF' : 'OFF → ON';
  });
  document.querySelectorAll('[data-encoder]').forEach(button => {button.disabled=!allowed});
  [1,2,3].forEach(gateId => {
    const input = $(`encoder${gateId}`);
    const helper = $(`encoderCount${gateId}`);
    const percent = Number(input?.value);
    if (helper) helper.textContent = Number.isInteger(percent) && percent >= 0 && percent <= 100
      ? `akan dikirim count ${encoderPercentToCount(gateId, percent)}`
      : 'isi 0–100%';
  });
  text('simInputStatus', !snapshot.connected ? 'OFFLINE — menunggu simulator Schneider.' : !info?.compatible ? 'Proyek belum cocok. Buka AWGC_SIM_INPUTS_ONLY.smbp dan RUN; tidak ada write input ke REV3.' : 'Input aktif: write Modbus diverifikasi langsung dari simulator Schneider.');
  const required=['commissioning','safety','overload1','overload2','overload3','run'];
  const missing=required.filter(name => !info?.values[name]);
  text('rev3Blockers', !info?.compatible ? 'Menunggu profil SIM INPUTS.' : missing.length ? 'Belum ON: '+missing.map(name=>snapshot.simulatorInputMeta[name].label).join(' · ') : 'Izin umum aktif. AUTO harus ON untuk mengikuti target.');
  text('simOutputStatus',info?.compatible ? info.outputs.map(g=>`G${g.id}: OPEN=${Number(g.open)} CLOSE=${Number(g.close)}`).join(' | ')+' (output virtual)' : 'Output virtual belum tersedia.');
  text('inputInstructions','Latihan: Commissioning, Safety, OL G1/G2/G3, AUTO dan ENABLE → ON. SET target pintu; kirim posisi rotary 0–100% untuk feedback encoder. SCADA mengubah persen menjadi Gray-code count encoder. STOP: ENABLE → OFF. Water level tetap dari Modbus Schneider, bukan angka buatan JavaScript.');
}

async function sendSimulatorInput(body) {
  if (!controlToken) { $('authDialog').showModal(); return; }
  try {
    const response=await fetch('/api/schneider-inputs',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${controlToken}`},body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
    const result=await response.json();
    if (!response.ok) {if(response.status===401) controlToken=''; throw new Error(result.error)}
    toast('Input terbaca balik dari simulator Schneider'); await refresh();
  } catch(error) {toast(error.message,true)}
}

async function sendRev3Control(body) {
  if (!latest?.connected || !latest.writeEnabled || !latest.rev3ControlEnabled || latest.simulatorInputPanelEnabled || !latest.data?.rev3?.compatible) {
    return toast('Kontrol REV3 terkunci. Periksa koneksi, profil BEFORE_SIM_INPUTS dan status izin tulis.', true);
  }
  if (!controlToken) { $('authDialog').showModal(); return; }
  const action = body.name === 'run' ? (body.value ? 'ENABLE %M6=0' : 'STOP SCADA %M6=1') : `Commissioning %M5=${Number(body.value)}`;
  try {
    const response = await fetch('/api/rev3-controls', {
      method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${controlToken}`},
      body:JSON.stringify(body), signal:AbortSignal.timeout(6000)
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      if (response.status === 401) { controlToken = ''; if (latest) render(latest); }
      throw new Error(result.error || 'Perintah ditolak; periksa token, profil dan koneksi PLC.');
    }
    toast(`${action} ${result.verified ? 'terverifikasi baca-balik' : 'terkirim; verifikasi status PLC'}. Proteksi fisik tetap berlaku.`);
    await refresh();
  } catch(error) { toast(`${action}: ${controlError(error)}`, true); }
}

function controlError(error) {
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError) {
    return 'Koneksi terputus atau waktu tunggu habis; hasil perintah belum pasti. Periksa baca-balik PLC sebelum mengulang.';
  }
  return error.message || 'Perintah gagal. Periksa token, profil dan koneksi PLC.';
}

async function setTarget(gateId) {
  const simulation = latest?.simulationControlEnabled === true;
  if (!simulation && !controlToken) {
    $('authDialog').showModal();
    return;
  }
  const input = $(`target${gateId}`);
  const targetPct = Number(input.value);
  if (input.value.trim() === '' || !Number.isInteger(targetPct) || targetPct < 0 || targetPct > 100) return toast('Target harus bilangan bulat 0–100', true);
  input.dataset.pending = 'true';
  try {
    const response = await fetch(`/api/${simulation ? 'simulation/' : ''}gates/${gateId}/target`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(simulation ? { 'X-SCADA-Simulation': 'local-only' } : { Authorization: `Bearer ${controlToken}` }) },
      body: JSON.stringify({ targetPct }), signal: AbortSignal.timeout(6000)
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { controlToken = ''; if (latest) render(latest); }
      throw new Error(result.error || 'Perintah ditolak');
    }
    input.dataset.dirty = 'false';
    toast(`${simulation ? 'Simulasi: ' : ''}target pintu ${gateId} = ${targetPct}% ${result.verified ? 'terverifikasi di register' : 'terkirim'}${result.motionInhibited ? '; izin gerak PLC belum aktif' : ''}${simulation ? '' : '; posisi aktual tetap membutuhkan feedback encoder'}`);
    await refresh();
  } catch (error) { toast(controlError(error), true); }
  finally { input.dataset.pending = 'false'; }
}

function toast(message, error = false) {
  const element = $('toast'); element.textContent = message; element.className = `show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = ''; }, error ? 8000 : 5000);
}

function drawTrend() {
  const canvas = $('trend');
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth; const height = canvas.clientHeight;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) { canvas.width = width * ratio; canvas.height = height * ratio; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#213640'; ctx.lineWidth = 1;
  for (let y = 0; y <= 100; y += 25) { const py = 12 + (100 - y) / 100 * (height - 28); ctx.beginPath(); ctx.moveTo(34, py); ctx.lineTo(width - 10, py); ctx.stroke(); ctx.fillStyle = '#6d838d'; ctx.font = '9px Consolas'; ctx.fillText(String(y), 8, py + 3); }
  colors.forEach((color, series) => { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); history.forEach((row, index) => { const x = 34 + index / 89 * (width - 44); const value = Number.isFinite(row[series]) ? row[series] : 0; const y = 12 + (100 - value) / 100 * (height - 28); index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); });
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(4000) }); if (!response.ok) throw new Error('Server error'); render(await response.json()); }
  catch { if (latest) render({ ...latest, connected: false, alarms: [{code:'SERVER_OFFLINE',severity:'critical',message:'Dashboard tidak dapat menghubungi server'}] }); }
  finally { refreshing = false; }
}

async function loadTags() {
  if (!tagsLoaded) {
    const tags = await fetch('/api/tags').then((r) => r.json());
    $('tagTable').innerHTML = Object.entries(tags).map(([name, tag]) => `<div class="tag-row"><b>${safe(name)}</b><span>${safe(tag.iecType)}</span><span>${safe(tag.plc)}</span><span>${safe(tag.modbus)}</span><span>${safe(tag.access)}</span></div>`).join('');
    tagsLoaded = true;
  }
  $('tagTable').hidden = !$('tagTable').hidden;
  text('toggleTags', $('tagTable').hidden ? 'TAMPILKAN' : 'SEMBUNYIKAN');
}

$('toggleTags').addEventListener('click', loadTags);
document.querySelectorAll('[data-encoder]').forEach(button=>button.addEventListener('click',()=>{
  const gateId=Number(button.dataset.encoder), raw=$(`encoder${gateId}`).value, percent=Number(raw);
  if(!raw.trim() || !Number.isInteger(percent) || percent<0 || percent>100) return toast('Posisi rotary harus integer 0–100%',true);
  const count = encoderPercentToCount(gateId, percent);
  sendSimulatorInput({kind:'encoder',gateId,count});
}));
[1,2,3].forEach(gateId => $(`encoder${gateId}`).addEventListener('input', () => {
  const raw = $(`encoder${gateId}`).value;
  const percent = Number(raw);
  text(`encoderCount${gateId}`, raw.trim() && Number.isInteger(percent) && percent >= 0 && percent <= 100 ? `akan dikirim count ${encoderPercentToCount(gateId, percent)}` : 'isi 0–100%');
}));
$('confirmCommissioning').addEventListener('click', event => {
  event.preventDefault();
  if (!$('commissioningChecked').checked) return toast('Verifikasi sumber koneksi dan kondisi commissioning, lalu centang konfirmasi.', true);
  $('commissioningDialog').close('confirm');
  sendRev3Control({name:'commissioning',value:true,confirmed:true});
});
$('controlSession').addEventListener('click', () => {
  if (controlToken) { controlToken = ''; if (latest) render(latest); }
  else $('authDialog').showModal();
});
$('saveToken').addEventListener('click', (event) => { const value = $('tokenInput').value.trim(); if (value.length < 20) { event.preventDefault(); return toast('Token minimal 20 karakter', true); } controlToken = value; $('tokenInput').value = ''; if (latest) render(latest); });
setInterval(() => text('clock', new Date().toLocaleTimeString('id-ID')), 1000);
setInterval(refresh, 1000);
window.addEventListener('resize', drawTrend);
refresh();
