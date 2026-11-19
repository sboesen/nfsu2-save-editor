import fs from 'node:fs';
import path from 'node:path';
import {
  FILE_SIZE, bStringHash, carName, isModCar, isStockCar, raceName, raceInfo,
  readCareer, careerStageGuess, uniquePartsStatus, readEvents, isEventWon,
  markAllEventsWon, markUniquePartsWon, markCareerComplete, seal, isSealed,
  checkShape, checkGarage, readGarage, writeGarageCar, writeGarageOwned, handleSlot, garageHandleInfo,
  RACE_LIST,
} from '../site/profile.js';

const dir = process.env.NFSU2_SAVES || path.join(process.env.HOME, 'Downloads', 'nfsu2-saves-2026-11-18_202337');
const files = {
  YourGod: path.join(dir, 'NFS Underground 2', 'YourGod', 'YourGod'),
  modded: path.join(dir, 'NFS Underground 2', 'modded', 'modded'),
};
const garageFile = path.join(dir, 'NFS Underground 2', 'modded', 'GARAGE.DAT');

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
};

const y = new Uint8Array(fs.readFileSync(files.YourGod));
const m = new Uint8Array(fs.readFileSync(files.modded));

// Career block: current car handle -> CAREER_SLOT_n -> the profile's career car.
const yc = readCareer(y);
check('YourGod current slot', yc.currentSlot === 4, yc.currentSlot);
check('YourGod current car', yc.currentCar === 'SKYLINE', yc.currentCar);
check('YourGod block value', yc.stageValue === 4, yc.stageValue);
check('YourGod block records', yc.records.length === 19);
const mc = readCareer(m);
check('modded current slot', mc.currentSlot === 0, mc.currentSlot);
check('modded current car', mc.currentCar === 'GTO', mc.currentCar);
check('modded block value', mc.stageValue === 4, mc.stageValue);

// Event list: count includes the DDAY_EVENT_A header; won events include the
// stage 5 final events and the unique parts' stars.
const ye = readEvents(y);
check('YourGod event count', ye.count === 305, ye.count);
check('YourGod event records', ye.records.length === 305);
check('YourGod first event DDAY', ye.records[0].name === 'DDAY_EVENT_A', ye.records[0].name);
check('YourGod S5_URL_9 won', isEventWon(y, bStringHash('S5_URL_9')));
check('YourGod S5_CIRCUIT_36 won', isEventWon(y, bStringHash('S5_CIRCUIT_36')));
check('YourGod unique visual won', isEventWon(y, bStringHash('STAGE_5_VISUAL_5')));
check('YourGod unique perf won', isEventWon(y, bStringHash('STAGE_5_PERF_3')));
const me = readEvents(m);
check('modded event count', me.count === 297, me.count);
check('modded S5_URL_9 won', isEventWon(m, bStringHash('S5_URL_9')));
check('modded stage 5 visual star not won', isEventWon(m, bStringHash('STAGE_5_VISUAL_5')) === false);
const mu0 = uniquePartsStatus(m);
check('modded unique visual unlocked by Caleb', mu0.visual === true && mu0.caleb === true, JSON.stringify(mu0));
const mu = m.slice();
markUniquePartsWon(mu);
check('markUnique adds modded visual star', isEventWon(mu, bStringHash('STAGE_5_VISUAL_5')));
check('markUnique adds modded perf', isEventWon(mu, bStringHash('STAGE_5_PERF_3')));

const yu = uniquePartsStatus(y);
check('YourGod unique status', yu.visual && yu.perf && yu.caleb, JSON.stringify(yu));
check('YourGod stage guess', careerStageGuess(y) === 5, careerStageGuess(y));
check('modded stage guess', careerStageGuess(m) === 5, careerStageGuess(m));

// Mark everything won on a copy: every known race/showcase gets won=1, the
// list stays within the game's 384-record cap, and the file reseals.
const all = y.slice();
const res = markAllEventsWon(all);
check('markAll added', res.added >= 0, JSON.stringify(res));
let allWon = true, missing = [];
for (const name of RACE_LIST) {
  if (!isEventWon(all, bStringHash(name))) { allWon = false; missing.push(name); }
}
check('markAll every known event won', allWon, missing.slice(0, 5).join(', '));
check('markAll count cap', readEvents(all).count <= 384, readEvents(all).count);
seal(all);
check('markAll shape', checkShape(all).length === 0);
check('markAll sealed', isSealed(all));
check('markAll unique status', uniquePartsStatus(all).visual && uniquePartsStatus(all).perf && uniquePartsStatus(all).caleb);

const done = y.slice();
markCareerComplete(done);
check('markCareerComplete stage value', readCareer(done).stageValue === 5, readCareer(done).stageValue);
seal(done);
check('markCareerComplete sealed', isSealed(done));

// Mark unique parts on a copy with those events removed?  At least it is a no-op
// on these profiles and does not break the seal.
const uniq = y.slice();
markUniquePartsWon(uniq);
check('markUnique no-op', uniquePartsStatus(uniq).visual && uniquePartsStatus(uniq).perf);

// Race/car name tables.
check('race name S5_URL_9', raceName(bStringHash('S5_URL_9')) === 'S5_URL_9');
check('race info S5_URL_9', raceInfo('S5_URL_9').stage === 5 && raceInfo('S5_URL_9').type === 'url');
check('race info STAGE_5_VISUAL_5', raceInfo('STAGE_5_VISUAL_5').kind === 'other');
check('race info STAGE_2_DVD_1', raceInfo('STAGE_2_DVD_1').showcase === true);
check('car MERC560SE', carName(0xFB706B19) === 'MERC560SE', carName(0xFB706B19));
check('car CRXSIR', carName(0x554CEADA) === 'CRXSIR', carName(0x554CEADA));
check('mod car LANCEREVO4', isModCar('LANCEREVO4'));
check('stock car SKYLINE', !isModCar('SKYLINE') && isStockCar(bStringHash('SKYLINE')));

// GARAGE.DAT: version 2, 20 records, the drive/QR/stand-in handles, and the
// same 2034-byte career-car record layout.
const g = new Uint8Array(fs.readFileSync(garageFile));
check('garage shape', checkGarage(g).length === 0, checkGarage(g).join('; '));
const gr = readGarage(g);
check('garage version', gr.header.version === 2, gr.header.version);
check('garage slots', gr.records.length === 20, gr.records.length);
check('garage drive slot', handleSlot(gr.header.drive) === 8, handleSlot(gr.header.drive));
check('garage qr slot', handleSlot(gr.header.qr) === 9, handleSlot(gr.header.qr));
check('garage stand slot', handleSlot(gr.header.stand) === 0, handleSlot(gr.header.stand));
check('garage extra slot none', gr.header.extra === 0 && handleSlot(gr.header.extra) === null, gr.header.extra);
check('garage drive record', gr.records[3].handle === gr.header.drive && gr.records[3].name === 'CORVETTEC5', gr.records[3].name);
check('garage qr record', gr.records[4].handle === gr.header.qr && gr.records[4].name === 'ACCORD', gr.records[4].name);
const hi = garageHandleInfo(gr, gr.header.stand, m);
check('garage stand-in profile car', hi.kind === 'profile' && hi.slot === 0 && hi.name === 'GTO', JSON.stringify(hi));
const expected = ['MERC560SE','LANCEREVO4','S2000','CORVETTEC5','ACCORD','CRXSIR'];
for (let i = 0; i < expected.length; i++)
  check(`garage car ${i}`, gr.records[i].name === expected[i], gr.records[i].name);
check('garage empty 6', gr.records[6].hash === 0 && !gr.records[6].owned);

const g2 = g.slice();
check('garage write car', writeGarageCar(g2, 0, 'SKYLINE'));
check('garage write owned', writeGarageOwned(g2, 6, true));
const gr2 = readGarage(g2);
check('garage car changed', gr2.records[0].name === 'SKYLINE', gr2.records[0].name);
check('garage owned changed', gr2.records[6].owned === true);
check('garage still valid', checkGarage(g2).length === 0);

const bad = g.slice(0, 100);
check('bad garage rejected', checkGarage(bad).length > 0);

console.log(failures ? `\n${failures} failure(s)` : '\nall decode tests passed');
process.exit(failures ? 1 : 0);
