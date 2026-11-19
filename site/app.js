import {
  FILE_SIZE, NAME, MONEY, AUTOSAVE, PROMPT, DIFFICULTY,
  checksum, seal, isSealed, checkShape, inspect,
  readName, readMoney, writeMoney,
  readSaveMode, writeSaveMode, readDifficulty, writeDifficulty,
  UNLOCK_RUNS, UNLOCK_NAMES, unlockBytes, unlockStage, unlockAll, unlockPercent,
  readCars, carName, isStockCar, CAR_TYPES,
  RACE_LIST, bStringHash, raceName, raceInfo,
  readCareer, writeCareerStage, careerStageGuess, uniquePartsStatus,
  readEvents, isEventWon, setEventWon, markAllEventsWon, markUniquePartsWon, markCareerComplete,
  readStats, writeStat,
  readRaw, writeRaw, rawValid, RAW_SIZE,
  checkGarage, readGarage, writeGarageCar, writeGarageOwned, garageHandleInfo,
} from './profile.js';

const $ = id => document.getElementById(id);
const drop = $('drop'), fileIn = $('file');

let orig = null, buf = null, fileName = 'profile';
let gOrig = null, gBuf = null, gFileName = 'GARAGE.DAT';

function status(el, msg, cls) { el.textContent = msg; el.className = 'status ' + (cls || ''); }

drop.addEventListener('click', () => fileIn.click());
drop.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); }
});
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('over');
  if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
});
fileIn.addEventListener('change', () => fileIn.files[0] && load(fileIn.files[0]));

async function load(file) {
  fileIn.value = '';
  const data = new Uint8Array(await file.arrayBuffer());
  const errors = checkShape(data);
  if (errors.length) {
    status($('loadStatus'), errors.join(' '), 'bad');
    $('editor').hidden = true;
    return;
  }
  const sealed = isSealed(data);
  orig = data; buf = data.slice(); fileName = file.name || 'profile';
  resetGarage();
  status($('loadStatus'),
    `Loaded ${fileName} (${data.length.toLocaleString()} bytes). ` +
    (sealed ? 'Checksums are valid.' : 'Checksums are stale (edited elsewhere); they will be made again when you save.'),
    sealed ? 'ok' : 'warn');
  $('editor').hidden = false;
  render();
  renderCareer();
}

function render() {
  if (!buf) return;
  $('name').value = readName(buf);
  $('cash').value = readMoney(buf);
  $('saveMode').value = readSaveMode(buf);
  $('difficulty').value = readDifficulty(buf);

  renderUnlocks();
  renderCars();
  renderStats();
  showRaw();
  showChanges();
}

function renderUnlocks() {
  const tb = $('unlocks').tBodies[0];
  tb.innerHTML = '';
  for (const cat of Object.keys(UNLOCK_RUNS)) {
    const tr = document.createElement('tr');
    let allDone = true;
    const cells = [`<td>${UNLOCK_NAMES[cat]}</td>`];
    for (let s = 0; s < 5; s++) {
      const pct = unlockPercent(buf, cat, s);
      if (pct < 100) allDone = false;
      cells.push(`<td><button data-cat="${cat}" data-stage="${s}" class="${pct === 100 ? 'done' : ''}" ${pct === 100 ? 'disabled' : ''}>${pct === 100 ? 'Unlocked' : pct + '%'}</button></td>`);
    }
    cells.push(`<td><button class="all" data-cat="${cat}" ${allDone ? 'disabled' : ''}>All stages</button></td>`);
    tr.innerHTML = cells.join('');
    tb.appendChild(tr);
  }
  tb.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    unlockStage(buf, b.dataset.cat, b.dataset.stage == null ? null : +b.dataset.stage);
    render();
  }));
}

function renderCars() {
  const c = readCars(buf);
  const tb = $('cars').tBodies[0];
  tb.innerHTML = '';
  const row = (label, slot, type) => {
    const name = type.name ? type.name + (type.stock ? '' : ' (mod)') : type.hash ? `unknown (0x${type.hash.toString(16)})` : '—';
    return `<tr><td>${label} ${slot}</td><td class="mono">${name}</td></tr>`;
  };
  for (const x of c.career) tb.insertAdjacentHTML('beforeend', row('Career car', x.slot, x));
  const custom = c.custom.filter(x => x.hash);
  for (const x of custom) tb.insertAdjacentHTML('beforeend', row('Customized car', x.slot, x));
  for (const x of c.preset) tb.insertAdjacentHTML('beforeend', row('Preset car', x.slot, x));
}

function fmtFloat(f) {
  if (!Number.isFinite(f) || Math.abs(f) >= 1e12) return '—';
  if (f === 0) return '0';
  if (Math.abs(f) < 1e-6) return '—';
  return +f.toPrecision(9);
}

function renderStats() {
  const tb = $('stats').tBodies[0];
  tb.innerHTML = '';
  for (const s of readStats(buf)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mono">0x${s.offset.toString(16).toUpperCase()}</td>
      <td><input type="number" step="1" data-o="${s.offset}" value="${s.int}"></td>
      <td class="mono">${fmtFloat(s.float)}</td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
    writeStat(buf, (inp.dataset.o - 0xD155) / 4, +inp.value);
    render();
  }));
}

// ------------------------------------------------------------------- career --
function renderCareer() {
  if (!buf) return;
  const c = readCareer(buf);
  const u = uniquePartsStatus(buf);
  const stage = careerStageGuess(buf);
  $('careerCar').textContent = c.currentSlot == null
    ? `unknown (handle 0x${c.currentHandle.toString(16)})`
    : c.currentSlot < 5
      ? `${c.currentCar || 'empty'} (career slot ${c.currentSlot + 1})`
      : `slot ${c.currentSlot + 1} (car is in GARAGE.DAT)`;
  $('careerStage').textContent = (stage == null ? 'no won events' : `stage ${stage === 5 ? '5+' : stage}`) + `; block value ${c.stageValue}`;
  $('careerStageValue').value = String(c.stageValue);
  $('careerUnique').innerHTML =
    `Unique visual parts (widebody etc.): <span class="${u.visual ? 'ok' : 'warn'}">${u.visual ? 'unlocked (Caleb beaten)' : 'locked'}</span><br>` +
    `Stage 5 visual star: <span class="${u.visualStar ? 'ok' : 'warn'}">${u.visualStar ? 'won' : 'not won'}</span><br>` +
    `Unique performance parts: <span class="${u.perf ? 'ok' : 'warn'}">${u.perf ? 'unlocked' : 'locked'}</span><br>` +
    `Caleb / final event: <span class="${u.caleb ? 'ok' : 'warn'}">${u.caleb ? 'beaten' : 'not yet'}</span>`;
  renderEvents();
  renderCareerSummary();
  renderCareerBlock(c);
}

function eventRow(name, hash, info, won) {
  const stage = info.stage == null ? 'Special' : (info.stage === 0 ? 'Prologue' : `Stage ${info.stage}`);
  const type = info.type + (info.hidden ? ' (hidden)' : '') + (info.sponsor ? ' (sponsor)' : '') + (info.showcase ? ' (showcase)' : '');
  return `<tr><td>${stage}</td><td>${type}</td><td class="mono">${name}</td><td><input type="checkbox" data-hash="${hash}" ${won ? 'checked' : ''}></td></tr>`;
}

function renderEvents() {
  const ev = readEvents(buf);
  const items = RACE_LIST.map(name => {
    const h = bStringHash(name);
    return { name, hash: h, info: raceInfo(name), won: isEventWon(buf, h) };
  });
  items.sort((a, b) => {
    const sa = a.info.stage == null ? -1 : a.info.stage;
    const sb = b.info.stage == null ? -1 : b.info.stage;
    if (sa !== sb) return sa - sb;
    if (a.info.kind !== b.info.kind) return a.info.kind.localeCompare(b.info.kind);
    return a.name.localeCompare(b.name);
  });
  const rows = items.map(x => eventRow(x.name, x.hash, x.info, x.won));
  for (const r of ev.records) {
    if (r.name) continue;
    rows.push(eventRow(`Unknown (0x${r.hash.toString(16)})`, r.hash, { stage: null, type: 'unknown', hidden: false, sponsor: false, showcase: false }, r.won));
  }
  const tb = $('events').tBodies[0];
  tb.innerHTML = rows.join('');
  tb.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
    const ok = setEventWon(buf, +cb.dataset.hash, cb.checked);
    if (!ok) cb.checked = !cb.checked;
    renderCareerSummary();
    showChanges();
  }));
}

function renderCareerSummary() {
  const ev = readEvents(buf);
  const won = new Set(ev.records.filter(r => r.won && r.name).map(r => r.name));
  const stages = new Map();
  for (const name of RACE_LIST) {
    const info = raceInfo(name);
    const key = info.stage == null ? 'Special' : info.stage;
    const b = stages.get(key) || { races: 0, racesWon: 0, shows: 0, showsWon: 0, other: 0, otherWon: 0 };
    if (info.kind === 'race') { b.races++; if (won.has(name)) b.racesWon++; }
    else if (info.kind === 'showcase') { b.shows++; if (won.has(name)) b.showsWon++; }
    else { b.other++; if (won.has(name)) b.otherWon++; }
    stages.set(key, b);
  }
  const lines = [];
  const keys = [...stages.keys()].sort((a, b) => (a === 'Special' ? -1 : a) - (b === 'Special' ? -1 : b));
  for (const key of keys) {
    const b = stages.get(key);
    const label = key === 'Special' ? 'Special' : (key === 0 ? 'Prologue' : `Stage ${key}`);
    const parts = [];
    if (b.races) parts.push(`races ${b.racesWon}/${b.races}`);
    if (b.shows) parts.push(`shows ${b.showsWon}/${b.shows}`);
    if (b.other) parts.push(`other ${b.otherWon}/${b.other}`);
    lines.push(`${label}: ${parts.join(', ')}`);
  }
  const unknown = ev.records.filter(r => !r.name);
  if (unknown.length) lines.push(`Other records in the list: ${unknown.length}`);
  $('careerSummary').textContent = lines.join(' · ');
}

function renderCareerBlock(c) {
  const tb = $('careerBlock').tBodies[0];
  tb.innerHTML = '';
  const hex = w => '0x' + w.toString(16).padStart(8, '0').toUpperCase();
  c.records.forEach((r, i) => {
    tb.insertAdjacentHTML('beforeend',
      `<tr><td>${i === 0 ? 'Header' : `Record ${i}`}</td>${r.words.map(w => `<td class="mono">${hex(w)}</td>`).join('')}</tr>`);
  });
}

$('careerStageValue').addEventListener('change', e => {
  writeCareerStage(buf, +e.target.value);
  renderCareer();
  showChanges();
});
$('markAllWon').addEventListener('click', () => {
  markAllEventsWon(buf);
  renderCareer();
  showChanges();
});
$('markUnique').addEventListener('click', () => {
  markUniquePartsWon(buf);
  renderCareer();
  showChanges();
});
$('markCareerComplete').addEventListener('click', () => {
  markCareerComplete(buf);
  renderCareer();
  showChanges();
});

// ------------------------------------------------------------------- garage --
const gDrop = $('garageDrop'), gFile = $('garageFile');
gDrop.addEventListener('click', () => gFile.click());
gDrop.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); gFile.click(); }
});
gDrop.addEventListener('dragover', e => { e.preventDefault(); gDrop.classList.add('over'); });
gDrop.addEventListener('dragleave', () => gDrop.classList.remove('over'));
gDrop.addEventListener('drop', e => {
  e.preventDefault(); gDrop.classList.remove('over');
  if (e.dataTransfer.files[0]) loadGarage(e.dataTransfer.files[0]);
});
gFile.addEventListener('change', () => gFile.files[0] && loadGarage(gFile.files[0]));

async function loadGarage(file) {
  gFile.value = '';
  const data = new Uint8Array(await file.arrayBuffer());
  const errors = checkGarage(data);
  if (errors.length) {
    status($('garageStatus'), errors.join(' '), 'bad');
    $('garageEditor').hidden = true;
    return;
  }
  gOrig = data; gBuf = data.slice(); gFileName = file.name || 'GARAGE.DAT';
  status($('garageStatus'), `Loaded ${gFileName} (${data.length.toLocaleString()} bytes).`, 'ok');
  $('garageEditor').hidden = false;
  renderGarage();
  showGarageChanges();
}

function resetGarage() {
  gOrig = gBuf = null; gFileName = 'GARAGE.DAT';
  $('garageEditor').hidden = true;
  status($('garageStatus'), '', '');
  status($('garageSaveStatus'), '', '');
}

function renderGarage() {
  if (!gBuf) return;
  const g = readGarage(gBuf);
  const h = g.header;
  const slotText = handle => {
    const info = garageHandleInfo(g, handle, buf);
    if (!info) return '—';
    if (info.kind === 'garage') return `garage slot ${info.slot + 6}${info.name ? ` (${info.name})` : ''}`;
    if (info.kind === 'profile') return `profile slot ${info.slot + 1}${info.name ? ` (${info.name})` : ''}`;
    return `unknown (0x${handle.toString(16)})`;
  };
  $('garageHead').innerHTML =
    `Version ${h.version}; fingerprint 0x${h.fpHi.toString(16).padStart(8, '0')}${h.fpLo.toString(16).padStart(8, '0')}<br>` +
    `Drive: ${slotText(h.drive)}; Quick race: ${slotText(h.qr)}; Stand-in: ${slotText(h.stand)}; Extra: ${slotText(h.extra)}`;
  const tb = $('garage').tBodies[0];
  tb.innerHTML = '';
  const names = CAR_TYPES.slice().sort();
  for (const r of g.records) {
    const opts = ['—', ...names].map(n => `<option value="${n}" ${n === (r.name || '—') ? 'selected' : ''}>${n}</option>`).join('');
    const unknownOpt = !r.name && r.hash ? `<option value="__unknown" selected>unknown (0x${r.hash.toString(16)})</option>` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.slot + 6}</td><td><select data-slot="${r.slot}">${unknownOpt}${opts}</select></td><td><input type="checkbox" data-owned="${r.slot}" ${r.owned ? 'checked' : ''}></td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => {
    const slot = +sel.dataset.slot;
    const v = sel.value;
    if (v === '__unknown') return;
    writeGarageCar(gBuf, slot, v === '—' ? null : v);
    writeGarageOwned(gBuf, slot, v !== '—');
    renderGarage();
    showGarageChanges();
  }));
  tb.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
    writeGarageOwned(gBuf, +cb.dataset.owned, cb.checked);
    showGarageChanges();
  }));
}

function showGarageChanges() {
  if (!gBuf) return;
  let n = 0;
  for (let i = 0; i < gBuf.length; i++) if (gBuf[i] !== gOrig[i]) n++;
  status($('garageSaveStatus'), n ? `${n.toLocaleString()} byte(s) changed in GARAGE.DAT.` : 'No garage changes yet.', n ? 'warn' : '');
}

$('garageSave').addEventListener('click', () => {
  if (!gBuf) return;
  const blob = new Blob([gBuf], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = gFileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  status($('garageSaveStatus'), `Downloaded ${gFileName}. Replace GARAGE.DAT in the profile's folder.`, 'ok');
});
$('garageRevert').addEventListener('click', () => {
  if (!gOrig) return;
  gBuf = gOrig.slice();
  renderGarage();
  showGarageChanges();
});

// ---------------------------------------------------------------------- raw --
function rawOff() {
  const o = parseInt($('rOff').value.replace(/^0x/i, ''), 16);
  const t = $('rType').value;
  if (!rawValid(buf, o, t)) return null;
  return { o, t };
}

function showRaw() {
  const r = rawOff();
  if (!r) { $('rVal').value = ''; $('hex').textContent = 'Enter a hex offset inside the data area (0x24 or higher).'; return; }
  const v = readRaw(buf, r.o, r.t);
  $('rVal').value = r.t === 'f32' ? fmtFloat(v) : v;
  const start = Math.max(0, (r.o & ~0xf) - 0x10), end = Math.min(buf.length, start + 0x40);
  const lines = [];
  for (let a = start; a < end; a += 16) {
    let hex = '', asc = '';
    for (let i = 0; i < 16 && a + i < end; i++) {
      const p = a + i, b = buf[p], hit = p >= r.o && p < r.o + RAW_SIZE[r.t];
      const h = b.toString(16).padStart(2, '0');
      hex += hit ? '[' + h + ']' : ' ' + h + ' ';
      asc += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
    }
    lines.push(a.toString(16).padStart(6, '0').toUpperCase() + '  ' + hex + '  ' + asc);
  }
  $('hex').textContent = lines.join('\n');
}

$('rRead').addEventListener('click', showRaw);
$('rOff').addEventListener('change', showRaw);
$('rType').addEventListener('change', showRaw);
$('rWrite').addEventListener('click', () => {
  const r = rawOff();
  if (r && writeRaw(buf, r.o, r.t, $('rVal').value)) render();
});

$('cash').addEventListener('change', e => {
  writeMoney(buf, Math.trunc(Number(e.target.value) || 0));
  render();
});
document.querySelectorAll('[data-cash]').forEach(b => b.addEventListener('click', () => {
  writeMoney(buf, +b.dataset.cash);
  render();
}));
$('saveMode').addEventListener('change', e => { writeSaveMode(buf, e.target.value); render(); });
$('difficulty').addEventListener('change', e => { writeDifficulty(buf, e.target.value); render(); });
$('unlockAll').addEventListener('click', () => { unlockAll(buf); render(); });
$('revert').addEventListener('click', () => { buf = orig.slice(); render(); renderCareer(); });

function showChanges() {
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] !== orig[i]) n++;
  status($('saveStatus'),
    n ? `${n.toLocaleString()} byte(s) changed from the loaded file. Saving will reseal the checksums.`
      : 'No changes yet.',
    n ? 'warn' : '');
}

$('save').addEventListener('click', () => {
  if (!buf) return;
  seal(buf);
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  status($('saveStatus'),
    `Downloaded ${fileName} with the checksums made again. Replace the profile file in its folder (back up the original first).`,
    'ok');
});
