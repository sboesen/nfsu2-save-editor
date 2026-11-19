// NFSU2 profile save format, from the clean-room description in
// th0mk/nfsu2-web (MIT) web/src/app/profile.ts and the OpenUG2 SPEC §3.2-3.5.
//
//   0  "20CM"   4 u32 size   8 u32 sizeA=8   12 u32 sizeB=54930
//   16 checksum(A)  20 checksum(B)  24 checksum(bytes 0..23)
//   28 block A: u32 version 0x10D, u32 payload size 54930
//   36 block B: the payload
//
// Payload offsets (add 36 for file offsets):
//   1156   20 custom cars, 1072 bytes each (type hash at +28)
//   22596  5 career cars, 2034 bytes each (type hash at +28, owned at +1073)
//   32770  6 preset cars, 1076 bytes each (type hash at +28)
//   39230  stage 0 race hashes (3)
//   39487  stage 1 race hashes (5)
//   39744  stage 2 race hashes (18)
//   40001  stage 3 race hashes
//   40258  stage 4 race hashes
//   40515  stage 5 race hashes
//   41301  u32 event-list count; 41305 event list (8-byte records:
//          +0 race/showcase hash, +4 flags, +6 = 1 when won)
//   50599  career block: 19 records of 20 bytes.  The first is a header
//          (+4 a CAREER_SLOT_n handle, +8 an unknown handle, +12 a value
//          that is 4 in these saves, +16 flags); the rest hold race
//          results/times.  The CAREER_SLOT_n handle names the car the
//          career drives.
//   50979  u32 difficulty (0 easy, 1 medium, 2 hard)
//   50987  u8 autosave, 50988 u8 save prompt
//   53761  name, 32 bytes NUL-padded
// and the bank at file 0xA16A (payload 41286).
//
// GARAGE.DAT beside the profile: 32-byte head ("N2GA", version, a
// fingerprint, the drive/quick-race/stand-in handles), then 20 records
// of 2034 bytes in the modded game (5 in nfsu2-web's own format), the
// same career-car records as the profile's 5.
//
// The checksum is CRC-32/BZIP2 over D[0..n-5] XOR the big-endian u32 in
// D[n-4..n-1]; stored little-endian.

export const FILE_SIZE = 54966;
export const PAYLOAD = 54930;
export const VERSION = 0x10D;
export const B = 36;

export const NAME = 0xD225;          // file offset; 32-byte field
export const MONEY = 0xA16A;         // file offset; u32 bank
export const STATS = 0xD155;         // 16 unmapped i32 values
export const AUTOSAVE = B + 50987;
export const PROMPT = B + 50988;
export const DIFFICULTY = B + 50979;

export const CAREER = 50599;
export const CAREER_CURRENT_CAR = CAREER + 4;
export const CAREER_UNKNOWN_HANDLE = CAREER + 8;
export const CAREER_STAGE_VALUE = CAREER + 12;
export const CAREER_REC_SIZE = 20;
export const CAREER_RECORDS = 19;

export const EVENTS_COUNT = 41301;
export const EVENTS = 41305;
export const EVENTS_MAX = 384;

export const GARAGE_MAGIC = 0x4147324E; // "N2GA"
export const GARAGE_HEAD = 32;
export const GARAGE_REC = 2034;
export const GARAGE_MAX = 20;

export const CAREER_SLOT_BASE = 0x319A8CA1; // CAREER_SLOT_0

const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();

/** The game's checksum of a block (SPEC §3.4); 0 below 4 bytes. */
export function checksum(d) {
  if (d.length < 4) return 0;
  let r = ~((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
  for (let i = 4; i < d.length; i++) r = (((r << 8) | d[i]) ^ CRC_T[r >>> 24]) >>> 0;
  return ~r >>> 0;
}

const view = buf => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

/** Make the three checksums again, in place (block A, block B, then the header over 0..23). */
export function seal(buf) {
  const dv = view(buf);
  dv.setUint32(16, checksum(buf.subarray(28, B)), true);
  dv.setUint32(20, checksum(buf.subarray(B)), true);
  dv.setUint32(24, checksum(buf.subarray(0, 24)), true);
  return buf;
}

/** Whether the file's stored checksums hold. */
export function isSealed(buf) {
  if (buf.length !== FILE_SIZE) return false;
  const dv = view(buf);
  return dv.getUint32(16, true) === checksum(buf.subarray(28, B)) &&
    dv.getUint32(20, true) === checksum(buf.subarray(B)) &&
    dv.getUint32(24, true) === checksum(buf.subarray(0, 24));
}

/** Why a file is not a profile of this version (empty when it is); sealed is separate. */
export function checkShape(buf) {
  const errors = [];
  if (buf.length < 4 || String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== '20CM')
    errors.push('This is not an NFSU2 profile: it does not start with "20CM".');
  if (buf.length !== FILE_SIZE)
    errors.push(`Expected a ${FILE_SIZE.toLocaleString()} byte profile, got ${buf.length.toLocaleString()} bytes.`);
  if (buf.length >= 36) {
    const dv = view(buf);
    if (dv.getUint32(4, true) !== buf.length) errors.push('The size in the header does not match the file.');
    if (dv.getUint32(8, true) !== 8) errors.push('Unexpected block A size.');
    if (dv.getUint32(12, true) !== PAYLOAD) errors.push('Unexpected block B size.');
    if (dv.getUint32(28, true) !== VERSION) errors.push(`Saved by another version of the game (0x${dv.getUint32(28, true).toString(16)}, expected 0x10D).`);
    if (dv.getUint32(32, true) !== PAYLOAD) errors.push('Unexpected payload size.');
  }
  return errors;
}

/** Shape errors, plus a warning when the checksums are stale (edited elsewhere). */
export function inspect(buf) {
  const errors = checkShape(buf);
  if (errors.length) return { errors, sealed: false };
  return { errors, sealed: isSealed(buf) };
}

export function readName(buf) {
  let s = '';
  for (let i = 0; i < 32 && NAME + i < buf.length; i++) {
    const c = buf[NAME + i];
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export function readMoney(buf) { return view(buf).getUint32(MONEY, true); }
export function writeMoney(buf, n) {
  view(buf).setUint32(MONEY, Math.max(0, Math.min(0xFFFFFFFF, Math.trunc(n))) >>> 0, true);
}

export function readSaveMode(buf) {
  const a = buf[AUTOSAVE], p = buf[PROMPT];
  return a === 1 ? 'autosave' : p === 1 ? 'prompt' : 'off';
}
export function writeSaveMode(buf, mode) {
  buf[AUTOSAVE] = mode === 'autosave' ? 1 : 0;
  buf[PROMPT] = mode === 'autosave' || mode === 'prompt' ? 1 : 0;
}

export function readDifficulty(buf) {
  const n = view(buf).getUint32(DIFFICULTY, true);
  return n === 2 ? 'hard' : n === 1 ? 'medium' : 'easy';
}
export function writeDifficulty(buf, d) {
  view(buf).setUint32(DIFFICULTY, d === 'hard' ? 2 : d === 'medium' ? 1 : 0, true);
}

// ------------------------------------------------------------------ unlocks --
// [file offset, length] runs of unlock bitfield bytes, from NFSU2 Profile
// Creator 1.1's data resources.  A byte is a bitmask (0xFF = all 8 unlocked).
// The runs repeat every 0x7F2 bytes; 0x5B00 is the first stage's block.
export const UNLOCK_RUNS = {
  body: [[23763,20],[23791,8],[24075,100],[24207,48],[24327,28],[24359,8],[24371,8],[25797,20],[25825,8],[26109,100],[26241,48],[26361,28],[26393,8],[26405,8],[27831,20],[27859,8],[28143,100],[28275,48],[28395,28],[28427,8],[28439,8],[29865,20],[29893,8],[30177,100],[30309,48],[30429,28],[30461,8],[30473,8],[31899,20],[31927,8],[32211,100],[32343,48],[32463,28],[32495,8],[32507,8]],
  graphics: [[23871,112],[25905,112],[27939,112],[29973,112],[32007,112]],
  perf: [[24055,8],[26089,8],[28123,8],[30157,8],[32191,8]],
  special: [[23799,16],[23819,4],[23827,12],[23847,8],[24175,32],[24651,8],[25833,16],[25853,4],[25861,12],[25881,8],[26209,32],[26685,8],[27867,16],[27887,4],[27895,12],[27915,8],[28243,32],[28719,8],[29901,16],[29921,4],[29929,12],[29949,8],[30277,32],[30753,8],[31935,16],[31955,4],[31963,12],[31983,8],[32311,32],[32787,8]],
};

export const UNLOCK_NAMES = {
  body: 'Body parts, incl. widebody',
  graphics: 'Graphics: vinyls, decals, paint',
  perf: 'Performance',
  special: 'Specialties: neon, audio, doors',
};

const stageOf = o => Math.floor((o - 0x5B00) / 0x7F2);

export function unlockBytes(cat, stage) {
  const out = [];
  for (const [o, n] of UNLOCK_RUNS[cat])
    if (stage == null || stageOf(o) === stage)
      for (let i = 0; i < n; i++) out.push(o + i);
  return out;
}

export function unlockStage(buf, cat, stage) {
  for (const o of unlockBytes(cat, stage)) buf[o] = 0xFF;
}

export function unlockAll(buf) {
  for (const cat of Object.keys(UNLOCK_RUNS)) unlockStage(buf, cat, null);
}

const popcount = b => {
  let c = 0;
  while (b) { c += b & 1; b >>= 1; }
  return c;
};

/** Percent of bits set in a category's stage (0..4), or all stages when stage is null. */
export function unlockPercent(buf, cat, stage) {
  const bytes = unlockBytes(cat, stage);
  const set = bytes.reduce((a, o) => a + popcount(buf[o]), 0);
  return Math.round(100 * set / (bytes.length * 8));
}

// --------------------------------------------------------------------- cars --
export function bStringHash(s) {
  let h = 0xFFFFFFFF;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h;
}

const STOCK_PLAYER = ['PEUGOT','FOCUS','COROLLA','240SX','MIATA','CIVIC','PEUGOT106','CORSA','HUMMER','NAVIGATOR','ESCALADE','TIBURON','SENTRA','CELICA','IS300','SUPRA','GOLF','A3','RSX','ECLIPSE','TT','RX8','350Z','G35','3000GT','GTO','MUSTANGGT','SKYLINE','LANCEREVO8','RX7','IMPREZAWRX'];
const STOCK_TRAFFIC = ['TAXI','4DR_SEDAN02','AMBULANCE','TAXI02','PANELVAN','COUPE','FIRETRUCK','PARCELVAN','PICKUP','4DR_SEDAN','BUS','SUV','MINIVAN','HATCHBACK','HATCHBACK02'];
const MOD_CAR_TYPES = `200SXS14A
300ZX
959
996
ACCORD
BB6
BMW850
BOXSTER986
CELICAT205
CHARGER
CIVICEG
CIVICEK9
COBRA
CORVETTEC5
CRXDS
CRXSIR
E36
ECLIPSE03
ELISE
ESCORT
EVO9IX
FAIRZ
FTOGPR
G55
GS300
GT86ZN
GTI3
IF
IMPALA
IMPREZA
INFIFX45
INTEGRA
LANCER
LANCEREVO4
LEONCP
LFA
M3GTR
MERC560SE
MR2AW1
MRS
NEON
NEONC
NSX
NSX91
R33
S2000
SAVANNA
SC300Z30
SILVIA
SUPRAGA70
VIPER`.split('\n');

export const CAR_TYPES = [...STOCK_PLAYER, ...STOCK_TRAFFIC, ...MOD_CAR_TYPES];
const STOCK_GAME_HASHES = new Set([...STOCK_PLAYER, ...STOCK_TRAFFIC].map(bStringHash));
const CAR_HASHES = new Map(CAR_TYPES.map(n => [bStringHash(n), n]));
export const carName = hash => CAR_HASHES.get(hash >>> 0) ?? null;
export const isStockCar = hash => STOCK_GAME_HASHES.has(hash >>> 0);
export const isModCar = name => !STOCK_GAME_HASHES.has(bStringHash(name));

/** Career, customized and preset cars stored in the profile (read-only view). */
export function readCars(buf) {
  const dv = view(buf);
  const typeAt = o => {
    const h = dv.getUint32(B + o + 28, true);
    return { hash: h, name: h ? carName(h) : null, stock: h ? isStockCar(h) : false };
  };
  const career = [];
  for (let i = 0; i < 5; i++) {
    const o = 22596 + i * 2034;
    career.push({ slot: i + 1, ...typeAt(o), owned: buf[B + o + 1073] !== 0 });
  }
  const custom = [];
  for (let i = 0; i < 20; i++) custom.push({ slot: i + 1, ...typeAt(1156 + i * 1072) });
  const preset = [];
  for (let i = 0; i < 6; i++) preset.push({ slot: i + 1, ...typeAt(32770 + i * 1076) });
  return { career, custom, preset };
}

/** The type hash of a career car (file offset), for an optional future edit. */
export function careerCarHash(buf, slot) { return view(buf).getUint32(B + 22596 + slot * 2034 + 28, true); }
export function writeCareerCarHash(buf, slot, name) {
  view(buf).setUint32(B + 22596 + slot * 2034 + 28, name ? bStringHash(name) : 0, true);
}

// --------------------------------------------------------------------- races --
// Race and showcase names from GLOBAL/GLOBALB.BUN's string pool; the game's
// event hashes are bStringHash() of these names.
const RACE_NAMES = `DDAY_EVENT_A
DDAY_EVENT_B
S2_CIRCUIT_2
S2_CIRCUIT_3
S2_CIRCUIT_4
S2_CIRCUIT_5
S2_DRAG_2
S2_DRIFT_2
S2_DRIFT_3
S2_DRIFT_4
S2_H_CIRCUIT_6
S2_H_DRAG_3
S2_H_SPRINT_5
S2_H_STREET_5
S2_SPON_CIRCUIT_1
S2_SPON_CIRCUIT_2
S2_SPON_CIRCUIT_3
S2_SPON_DRAG_1
S2_SPON_DRAG_2
S2_SPON_DRAG_3
S2_SPON_DRIFT_1
S2_SPON_DRIFT_2
S2_SPON_DRIFT_3
S2_SPON_SPRINT_1
S2_SPON_STREET_1
S2_SPRINT_2
S2_SPRINT_3
S2_SPRINT_4
S2_STREET_2
S2_STREET_3
S2_STREET_4
S2_SUV_1
S2_SUV_2
S2_SUV_3
S2_URL_1
S2_URL_2
S2_URL_3
S3_CIRCUIT_10
S3_CIRCUIT_11
S3_CIRCUIT_12
S3_CIRCUIT_7
S3_CIRCUIT_8
S3_CIRCUIT_9
S3_DRAG_4
S3_DRAG_5
S3_DRAG_7
S3_DRIFT_10
S3_DRIFT_5
S3_DRIFT_6
S3_DRIFT_7
S3_DRIFT_9
S3_H_CIRCUIT_13
S3_H_DRAG_6
S3_H_DRAG_8
S3_H_DRIFT_11
S3_H_DRIFT_8
S3_H_SPRINT_10
S3_H_STREET_10
S3_H_STREET_7
S3_SPON_CIRCUIT_4
S3_SPON_DRAG_4
S3_SPON_DRAG_5
S3_SPON_DRAG_6
S3_SPON_DRIFT_4
S3_SPON_DRIFT_5
S3_SPON_DRIFT_6
S3_SPON_SPRINT_4
S3_SPON_STREET_1
S3_SPON_STREET_2
S3_SPON_STREET_3
S3_SPRINT_6
S3_SPRINT_7
S3_SPRINT_8
S3_SPRINT_9
S3_STREET_6
S3_STREET_8
S3_STREET_9
S3_SUV_1
S3_SUV_2
S3_SUV_3
S3_URL_4
S3_URL_5
S3_URL_6
S3_URL_7
S3_URL_8
S4_CIRCUIT_15
S4_CIRCUIT_16
S4_CIRCUIT_17
S4_CIRCUIT_18
S4_CIRCUIT_19
S4_CIRCUIT_20
S4_CIRCUIT_21
S4_CIRCUIT_22
S4_DRAG_10
S4_DRAG_11
S4_DRAG_12
S4_DRAG_13
S4_DRAG_14
S4_DRAG_16
S4_DRAG_9
S4_DRIFT_12
S4_DRIFT_14
S4_DRIFT_15
S4_DRIFT_16
S4_H_CIRCUIT_14
S4_H_CIRCUIT_23
S4_H_DRAG_15
S4_H_DRAG_17
S4_H_DRIFT_13
S4_H_DRIFT_17
S4_H_SPRINT_13
S4_H_SPRINT_19
S4_H_STREET_13
S4_H_STREET_17
S4_SPON_CIRCUIT_5
S4_SPON_CIRCUIT_6
S4_SPON_CIRCUIT_7
S4_SPON_DRAG_7
S4_SPON_DRAG_8
S4_SPON_DRAG_9
S4_SPON_DRIFT_7
S4_SPON_SPRINT_5
S4_SPON_STREET_5
S4_SPON_STREET_6
S4_SPON_STREET_7
S4_SPRINT_11
S4_SPRINT_12
S4_SPRINT_14
S4_SPRINT_15
S4_SPRINT_16
S4_SPRINT_17
S4_SPRINT_18
S4_STREET_11
S4_STREET_12
S4_STREET_14
S4_STREET_15
S4_STREET_16
S4_SUV_1
S4_SUV_2
S4_SUV_3
S4_URL_1
S4_URL_2
S4_URL_3
S4_URL_4
S4_URL_5
S4_URL_6
S4_URL_7
S5_CIRCUIT_24
S5_CIRCUIT_25
S5_CIRCUIT_26
S5_CIRCUIT_27
S5_CIRCUIT_28
S5_CIRCUIT_29
S5_CIRCUIT_30
S5_CIRCUIT_31
S5_CIRCUIT_33
S5_CIRCUIT_34
S5_CIRCUIT_36
S5_DRAG_18
S5_DRAG_19
S5_DRAG_20
S5_DRAG_22
S5_DRAG_23
S5_DRIFT_18
S5_DRIFT_19
S5_DRIFT_21
S5_DRIFT_22
S5_DRIFT_23
S5_H_CIRCUIT_32
S5_H_CIRCUIT_35
S5_H_DRAG_21
S5_H_DRAG_24
S5_H_DRIFT_20
S5_H_DRIFT_24
S5_H_SPRINT_20
S5_H_SPRINT_28
S5_H_STREET_20
S5_H_STREET_26
S5_SPON_CIRCUIT_10
S5_SPON_CIRCUIT_8
S5_SPON_CIRCUIT_9
S5_SPON_DRAG_10
S5_SPON_DRIFT_10
S5_SPON_DRIFT_8
S5_SPON_DRIFT_9
S5_SPON_SPRINT_6
S5_SPON_STREET_10
S5_SPON_STREET_8
S5_SPON_STREET_9
S5_SPRINT_21
S5_SPRINT_22
S5_SPRINT_23
S5_SPRINT_24
S5_SPRINT_25
S5_SPRINT_26
S5_SPRINT_27
S5_STREET_18
S5_STREET_19
S5_STREET_21
S5_STREET_22
S5_STREET_23
S5_STREET_24
S5_STREET_25
S5_SUV_1
S5_SUV_2
S5_SUV_3
S5_SUV_4
S5_URL_1
S5_URL_2
S5_URL_3
S5_URL_4
S5_URL_5
S5_URL_6
S5_URL_7
S5_URL_8
S5_URL_9
STAGE_0_CIRCUIT_0
STAGE_0_CIRCUIT_1
STAGE_0_SPRINT_0
STAGE_1_CIRCUIT_1
STAGE_1_DRAG_1
STAGE_1_DRIFT_1
STAGE_1_SHORT_1
STAGE_1_SPRINT_1
STAGE_2_DVD_1
STAGE_2_SHOW_1
STAGE_2_SHOW_1_PICTURE
STAGE_2_SHOW_2
STAGE_2_SHOW_2_PICTURE
STAGE_2_VISUAL_1
STAGE_3_DVD_1
STAGE_3_DVD_2
STAGE_3_PERF_1
STAGE_3_SHOW_1
STAGE_3_SHOW_1_PICTURE
STAGE_3_SHOW_2
STAGE_3_SHOW_2_PICTURE
STAGE_3_SHOW_3
STAGE_3_SHOW_3_PICTURE
STAGE_3_SHOW_4
STAGE_3_SHOW_4_PICTURE
STAGE_3_VISUAL_2
STAGE_4_DVD_1
STAGE_4_DVD_2
STAGE_4_DVD_3
STAGE_4_PERF_2
STAGE_4_SHOW_1
STAGE_4_SHOW_1_PICTURE
STAGE_4_SHOW_2
STAGE_4_SHOW_2_PICTURE
STAGE_4_SHOW_3
STAGE_4_SHOW_3_PICTURE
STAGE_4_SHOW_4
STAGE_4_SHOW_4_PICTURE
STAGE_4_SHOW_5
STAGE_4_SHOW_5_PICTURE
STAGE_4_SHOW_6
STAGE_4_SHOW_6_PICTURE
STAGE_4_VISUAL_3
STAGE_4_VISUAL_4
STAGE_5_DVD_1
STAGE_5_DVD_2
STAGE_5_DVD_3
STAGE_5_DVD_4
STAGE_5_PERF_3
STAGE_5_SHOW_1
STAGE_5_SHOW_1_PICTURE
STAGE_5_SHOW_2
STAGE_5_SHOW_2_PICTURE
STAGE_5_SHOW_3
STAGE_5_SHOW_3_PICTURE
STAGE_5_SHOW_4
STAGE_5_SHOW_4_PICTURE
STAGE_5_SHOW_5
STAGE_5_SHOW_5_PICTURE
STAGE_5_SHOW_6
STAGE_5_SHOW_6_PICTURE
STAGE_5_SHOW_7
STAGE_5_SHOW_7_PICTURE
STAGE_5_SHOW_8
STAGE_5_SHOW_8_PICTURE
STAGE_5_VISUAL_5`.split('\n');

const RACE_HASHES = new Map(RACE_NAMES.map(n => [bStringHash(n), n]));
export const raceName = hash => RACE_HASHES.get(hash >>> 0) ?? null;
export const RACE_LIST = RACE_NAMES;

/** Stage, type and kind of a race/showcase name, for display. */
export function raceInfo(name) {
  if (!name) return null;
  if (name.startsWith('DDAY_'))
    return { stage: null, type: 'D-Day event', kind: 'special', hidden: false, sponsor: false, showcase: false };
  let m = name.match(/^STAGE_(\d)_(.+)$/);
  if (m) {
    const stage = +m[1], rest = m[2];
    if (rest.startsWith('DVD')) return { stage, type: 'DVD cover shoot', kind: 'showcase', hidden: false, sponsor: false, showcase: true };
    if (rest.startsWith('SHOW')) return { stage, type: 'Cover shoot', kind: 'showcase', hidden: false, sponsor: false, showcase: true };
    if (rest.startsWith('VISUAL')) return { stage, type: 'Unique visual part', kind: 'other', hidden: false, sponsor: false, showcase: false };
    if (rest.startsWith('PERF')) return { stage, type: 'Unique performance part', kind: 'other', hidden: false, sponsor: false, showcase: false };
    return { stage, type: rest.replace(/_\d+$/, '').replace(/_/g, ' ').toLowerCase(), kind: 'race', hidden: false, sponsor: false, showcase: false };
  }
  m = name.match(/^S(\d)_(.+)$/);
  if (m) {
    const stage = +m[1];
    let rest = m[2], hidden = false, sponsor = false;
    if (rest.startsWith('H_')) { hidden = true; rest = rest.slice(2); }
    if (rest.startsWith('SPON_')) { sponsor = true; rest = rest.slice(5); }
    return { stage, type: rest.replace(/_\d+$/, '').replace(/_/g, ' ').toLowerCase(), kind: 'race', hidden, sponsor, showcase: false };
  }
  return { stage: null, type: 'unknown', kind: 'unknown', hidden: false, sponsor: false, showcase: false };
}

// ------------------------------------------------------------------- career --
export function handleSlot(handle) {
  const n = (handle >>> 0) - CAREER_SLOT_BASE;
  return n >= 0 && n <= 9 ? n : null;
}

export function careerCarName(buf, slot) {
  if (slot == null || slot >= 5) return null;
  const h = view(buf).getUint32(B + 22596 + slot * 2034 + 28, true);
  return h ? carName(h) : null;
}

export function readCareer(buf) {
  const dv = view(buf);
  const currentHandle = dv.getUint32(B + CAREER_CURRENT_CAR, true);
  const slot = handleSlot(currentHandle);
  const records = [];
  for (let i = 0; i < CAREER_RECORDS; i++) {
    const o = B + CAREER + i * CAREER_REC_SIZE;
    records.push({
      index: i,
      words: [0, 4, 8, 12, 16].map(k => dv.getUint32(o + k, true)),
    });
  }
  return {
    currentHandle,
    currentSlot: slot,
    currentCar: careerCarName(buf, slot),
    unknownHandle: dv.getUint32(B + CAREER_UNKNOWN_HANDLE, true),
    stageValue: dv.getUint32(B + CAREER_STAGE_VALUE, true),
    records,
  };
}

export function writeCareerStage(buf, value) {
  view(buf).setUint32(B + CAREER_STAGE_VALUE, Math.max(0, Math.min(0xFFFFFFFF, Math.trunc(value))) >>> 0, true);
}

// ------------------------------------------------------------------- events --
export function readEvents(buf) {
  const dv = view(buf);
  const count = Math.min(dv.getUint32(B + EVENTS_COUNT, true), EVENTS_MAX);
  const records = [];
  for (let i = 0; i < count; i++) {
    const o = B + EVENTS + i * 8;
    const hash = dv.getUint32(o, true);
    const flags = dv.getUint32(o + 4, true);
    const won = buf[o + 6] === 1;
    const name = raceName(hash);
    records.push({ index: i, offset: o, hash, flags, won, name, info: name ? raceInfo(name) : null });
  }
  return { count, records };
}

export function eventIndex(buf, hash) {
  const dv = view(buf);
  const count = Math.min(dv.getUint32(B + EVENTS_COUNT, true), EVENTS_MAX);
  for (let i = 0; i < count; i++) {
    const o = B + EVENTS + i * 8;
    if (dv.getUint32(o, true) === (hash >>> 0)) return i;
  }
  return -1;
}

export function isEventWon(buf, hash) {
  const i = eventIndex(buf, hash);
  return i >= 0 && buf[B + EVENTS + i * 8 + 6] === 1;
}

export function setEventWon(buf, hash, won) {
  const dv = view(buf);
  let i = eventIndex(buf, hash);
  if (i < 0) {
    if (!won) return false;
    const count = Math.min(dv.getUint32(B + EVENTS_COUNT, true), EVENTS_MAX);
    if (count >= EVENTS_MAX) return false;
    i = count;
    dv.setUint32(B + EVENTS_COUNT, count + 1, true);
    const o = B + EVENTS + i * 8;
    dv.setUint32(o, hash >>> 0, true);
    dv.setUint32(o + 4, 0x00010001, true); // byte +6 = 1 (won)
  }
  const o = B + EVENTS + i * 8;
  buf[o + 6] = won ? 1 : 0;
  return true;
}

/** Set every existing event to won, then add any known race/showcase that is not in the list. */
export function markAllEventsWon(buf) {
  let changed = 0, added = 0;
  for (const r of readEvents(buf).records) {
    if (!r.won) { buf[B + EVENTS + r.index * 8 + 6] = 1; changed++; }
  }
  for (const name of RACE_NAMES) {
    const h = bStringHash(name);
    if (eventIndex(buf, h) < 0) {
      if (setEventWon(buf, h, true)) added++;
      else break;
    }
  }
  return { changed, added };
}

export function markUniquePartsWon(buf) {
  let changed = 0;
  for (const name of ['S5_URL_9', 'S5_CIRCUIT_36', 'STAGE_5_VISUAL_5', 'STAGE_5_PERF_3']) {
    const h = bStringHash(name);
    if (!isEventWon(buf, h) && setEventWon(buf, h, true)) changed++;
  }
  return changed;
}

/** Every known event won, plus the career block's stage value set to 5 (career done). */
export function markCareerComplete(buf) {
  const all = markAllEventsWon(buf);
  writeCareerStage(buf, 5);
  return all;
}

export function uniquePartsStatus(buf) {
  const caleb = isEventWon(buf, bStringHash('S5_URL_9')) || isEventWon(buf, bStringHash('S5_CIRCUIT_36'));
  return {
    // runtime/uniques.c: once Caleb is beaten the unique visual parts are in
    // every car's shops; the stage 5 visual star is the outrun reward itself.
    caleb,
    visual: caleb,
    visualStar: isEventWon(buf, bStringHash('STAGE_5_VISUAL_5')),
    perf: isEventWon(buf, bStringHash('STAGE_5_PERF_3')),
  };
}

/** The highest stage with a won event, or null. */
export function careerStageGuess(buf) {
  let max = -1;
  for (const r of readEvents(buf).records) {
    if (!r.won || !r.info || r.info.stage == null) continue;
    if (r.info.stage > max) max = r.info.stage;
  }
  return max < 0 ? null : Math.min(max, 5);
}

// -------------------------------------------------------------------- garage --
export function checkGarage(buf) {
  const errors = [];
  if (buf.length < GARAGE_HEAD) { errors.push('Not a GARAGE.DAT: too short.'); return errors; }
  const dv = view(buf);
  if (dv.getUint32(0, true) !== GARAGE_MAGIC) errors.push('Not a GARAGE.DAT: no "N2GA" header.');
  if ((buf.length - GARAGE_HEAD) % GARAGE_REC !== 0) errors.push('Unexpected GARAGE.DAT size.');
  const n = Math.floor((buf.length - GARAGE_HEAD) / GARAGE_REC);
  if (n < 1 || n > GARAGE_MAX) errors.push(`Unexpected number of garage slots (${n}).`);
  return errors;
}

export function readGarage(buf) {
  const dv = view(buf);
  const n = Math.floor((buf.length - GARAGE_HEAD) / GARAGE_REC);
  const header = {
    magic: dv.getUint32(0, true),
    version: dv.getUint32(4, true),
    fpLo: dv.getUint32(8, true),
    fpHi: dv.getUint32(12, true),
    drive: dv.getUint32(16, true),
    qr: dv.getUint32(20, true),
    stand: dv.getUint32(24, true),
    extra: dv.getUint32(28, true),
  };
  const records = [];
  for (let i = 0; i < n; i++) {
    const o = GARAGE_HEAD + i * GARAGE_REC;
    const h = dv.getUint32(o + 28, true);
    records.push({
      slot: i,
      handle: dv.getUint32(o + 4, true),
      hash: h,
      name: h ? carName(h) : null,
      stock: h ? isStockCar(h) : false,
      owned: buf[o + 1073] !== 0,
    });
  }
  return { header, records };
}

/** Resolve a GARAGE.DAT header handle to a garage record or a profile career car. */
export function garageHandleInfo(g, handle, profile) {
  if (!handle) return null;
  const rec = g.records.find(r => r.handle === (handle >>> 0));
  if (rec) return { kind: 'garage', slot: rec.slot, name: rec.name };
  const s = handleSlot(handle);
  if (s != null && s < 5)
    return { kind: 'profile', slot: s, name: profile && profile.length === FILE_SIZE ? careerCarName(profile, s) : null };
  return { kind: 'unknown', slot: null, name: null };
}

export function writeGarageCar(buf, slot, name) {
  const o = GARAGE_HEAD + slot * GARAGE_REC + 28;
  if (slot < 0 || o + 4 > buf.length) return false;
  view(buf).setUint32(o, name ? bStringHash(name) : 0, true);
  return true;
}

export function writeGarageOwned(buf, slot, owned) {
  const o = GARAGE_HEAD + slot * GARAGE_REC + 1073;
  if (slot < 0 || o >= buf.length) return false;
  buf[o] = owned ? 1 : 0;
  return true;
}

export function garageValid(buf) { return checkGarage(buf).length === 0; }

// -------------------------------------------------------------------- stats --
export function readStats(buf) {
  const dv = view(buf);
  const out = [];
  for (let i = 0; i < 16; i++) {
    const o = STATS + i * 4;
    out.push({ offset: o, int: dv.getInt32(o, true), float: dv.getFloat32(o, true) });
  }
  return out;
}
export function writeStat(buf, index, n) {
  view(buf).setInt32(STATS + index * 4, Math.trunc(n) | 0, true);
}

// ---------------------------------------------------------------------- raw --
export const RAW_SIZE = { i32: 4, u32: 4, u16: 2, u8: 1, f32: 4 };

export function readRaw(buf, o, t) {
  const dv = view(buf);
  return { i32: () => dv.getInt32(o, true), u32: () => dv.getUint32(o, true), u16: () => dv.getUint16(o, true), u8: () => dv.getUint8(o), f32: () => dv.getFloat32(o, true) }[t]();
}

export function writeRaw(buf, o, t, v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return false;
  const dv = view(buf);
  switch (t) {
    case 'i32': dv.setInt32(o, Math.trunc(n) | 0, true); break;
    case 'u32': dv.setUint32(o, Math.trunc(n) >>> 0, true); break;
    case 'u16': dv.setUint16(o, Math.trunc(n) & 0xffff, true); break;
    case 'u8': dv.setUint8(o, Math.trunc(n) & 0xff); break;
    case 'f32': dv.setFloat32(o, n, true); break;
    default: return false;
  }
  return true;
}

export function rawValid(buf, o, t) {
  return Number.isInteger(o) && o >= 0x24 && o + RAW_SIZE[t] <= buf.length;
}
