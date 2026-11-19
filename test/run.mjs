import fs from 'node:fs';
import path from 'node:path';
import {
  FILE_SIZE, checksum, seal, isSealed, checkShape, inspect,
  readName, readMoney, writeMoney, readSaveMode, writeSaveMode,
  readDifficulty, writeDifficulty, unlockAll, unlockPercent, readCars,
  readStats, readRaw, writeRaw, UNLOCK_RUNS,
} from '../site/profile.js';

const dir = process.env.NFSU2_SAVES || path.join(process.env.HOME, 'Downloads', 'nfsu2-saves-2026-11-18_202337');
const files = {
  YourGod: path.join(dir, 'NFS Underground 2', 'YourGod', 'YourGod'),
  modded: path.join(dir, 'NFS Underground 2', 'modded', 'modded'),
};

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

for (const [label, p] of Object.entries(files)) {
  const f = new Uint8Array(fs.readFileSync(p));
  check(`${label}: size`, f.length === FILE_SIZE, f.length);
  check(`${label}: shape`, checkShape(f).length === 0, checkShape(f).join('; '));
  check(`${label}: sealed`, isSealed(f));
  check(`${label}: inspect`, inspect(f).sealed && inspect(f).errors.length === 0);
  check(`${label}: name`, readName(f) === label, readName(f));
  check(`${label}: checksum A`, checksum(f.subarray(28, 36)) === new DataView(f.buffer).getUint32(16, true));
  check(`${label}: checksum B`, checksum(f.subarray(36)) === new DataView(f.buffer).getUint32(20, true));
  check(`${label}: checksum header`, checksum(f.subarray(0, 24)) === new DataView(f.buffer).getUint32(24, true));
}

// Known values from the two real profiles.
const y = new Uint8Array(fs.readFileSync(files.YourGod));
const m = new Uint8Array(fs.readFileSync(files.modded));
check('YourGod money', readMoney(y) === 300000, readMoney(y));
check('modded money', readMoney(m) === 99617720, readMoney(m));
check('YourGod save mode', readSaveMode(y) === 'autosave', readSaveMode(y));
check('modded save mode', readSaveMode(m) === 'prompt', readSaveMode(m));
check('YourGod difficulty', readDifficulty(y) === 'hard', readDifficulty(y));
check('modded difficulty', readDifficulty(m) === 'easy', readDifficulty(m));

const yc = readCars(y).career.map(c => c.name);
check('YourGod career cars', JSON.stringify(yc) === JSON.stringify(['PEUGOT106','ESCALADE','TT','LANCEREVO8','SKYLINE']), JSON.stringify(yc));
const mc = readCars(m).career.map(c => c.name);
check('modded career cars', JSON.stringify(mc) === JSON.stringify(['GTO','G35','IMPREZAWRX','350Z','SKYLINE']), JSON.stringify(mc));
check('modded custom cars', readCars(m).custom.filter(c => c.name).length === 6);
check('preset cars', readCars(y).preset.filter(c => c.name).length === 6);

// Editing + sealing.
const edited = y.slice();
writeMoney(edited, 123456789);
check('edited not sealed', !isSealed(edited));
seal(edited);
check('edited sealed', isSealed(edited));
check('edited money', readMoney(edited) === 123456789);
check('edited still shape', checkShape(edited).length === 0);

const all = y.slice();
unlockAll(all);
for (const cat of Object.keys(UNLOCK_RUNS))
  for (let s = 0; s < 5; s++)
    check(`unlockAll ${cat} stage ${s + 1}`, unlockPercent(all, cat, s) === 100, unlockPercent(all, cat, s));
seal(all);
check('unlockAll sealed', isSealed(all));

// Save mode / difficulty round-trips.
const sm = y.slice();
writeSaveMode(sm, 'off');
check('save mode off', readSaveMode(sm) === 'off');
writeSaveMode(sm, 'prompt');
check('save mode prompt', readSaveMode(sm) === 'prompt');
writeSaveMode(sm, 'autosave');
check('save mode autosave', readSaveMode(sm) === 'autosave');
writeDifficulty(sm, 'medium');
check('difficulty medium', readDifficulty(sm) === 'medium');

// Stats and raw helpers.
const st = readStats(y);
check('stats count', st.length === 16);
check('stats first offset', st[0].offset === 0xD155);
check('stats first float', st[0].float === 3745492.5, st[0].float);
const raw = y.slice();
check('raw money u32', readRaw(raw, 0xA16A, 'u32') === 300000);
writeRaw(raw, 0xA16A, 'u32', 42);
check('raw write', readRaw(raw, 0xA16A, 'u32') === 42);

// A truncated file must be rejected without throwing.
const short = y.slice(0, 100);
check('short rejected', checkShape(short).length > 0);

console.log(failures ? `\n${failures} failure(s)` : '\nall tests passed');
process.exit(failures ? 1 : 0);
