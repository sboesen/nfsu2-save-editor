import {
  FILE_SIZE, NAME, MONEY, AUTOSAVE, PROMPT, DIFFICULTY,
  checksum, seal, isSealed, checkShape, inspect,
  readName, readMoney, writeMoney,
  readSaveMode, writeSaveMode, readDifficulty, writeDifficulty,
  UNLOCK_RUNS, UNLOCK_NAMES, unlockBytes, unlockStage, unlockAll, unlockPercent,
  readCars, carName,
  readStats, writeStat,
  readRaw, writeRaw, rawValid, RAW_SIZE,
} from './profile.js';

const $ = id => document.getElementById(id);
const drop = $('drop'), fileIn = $('file');

let orig = null, buf = null, fileName = 'profile';

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
  const data = new Uint8Array(await file.arrayBuffer());
  const errors = checkShape(data);
  if (errors.length) {
    status($('loadStatus'), errors.join(' '), 'bad');
    $('editor').hidden = true;
    return;
  }
  const sealed = isSealed(data);
  orig = data; buf = data.slice(); fileName = file.name || 'profile';
  status($('loadStatus'),
    `Loaded ${fileName} (${data.length.toLocaleString()} bytes). ` +
    (sealed ? 'Checksums are valid.' : 'Checksums are stale (edited elsewhere); they will be made again when you save.'),
    sealed ? 'ok' : 'warn');
  $('editor').hidden = false;
  render();
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
    const name = type.name ? type.name : type.hash ? `unknown (0x${type.hash.toString(16)})` : '—';
    return `<tr><td>${label} ${slot}</td><td class="mono">${name}</td></tr>`;
  };
  for (const x of c.career) tb.insertAdjacentHTML('beforeend', row('Career car', x.slot, x));
  const custom = c.custom.filter(x => x.hash);
  for (const x of custom) tb.insertAdjacentHTML('beforeend', row('Customized car', x.slot, x));
  for (const x of c.preset) tb.insertAdjacentHTML('beforeend', row('Preset car', x.slot, x));
}

function fmtFloat(f) {
  return Number.isFinite(f) && Math.abs(f) < 1e12 && (f === 0 || Math.abs(f) > 1e-6) ? +f.toPrecision(7) : '—';
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
$('revert').addEventListener('click', () => { buf = orig.slice(); render(); });

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
