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
//   50979  u32 difficulty (0 easy, 1 medium, 2 hard)
//   50987  u8 autosave, 50988 u8 save prompt
//   53761  name, 32 bytes NUL-padded
// and the bank at file 0xA16A (payload 41286).
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
export const CAR_TYPES = ['PEUGOT','FOCUS','COROLLA','240SX','MIATA','CIVIC','PEUGOT106','CORSA','HUMMER','NAVIGATOR','ESCALADE','TIBURON','SENTRA','CELICA','IS300','SUPRA','GOLF','A3','RSX','ECLIPSE','TT','RX8','350Z','G35','3000GT','GTO','MUSTANGGT','SKYLINE','LANCEREVO8','RX7','IMPREZAWRX'];

export function bStringHash(s) {
  let h = 0xFFFFFFFF;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h;
}

const CAR_HASHES = new Map(CAR_TYPES.map(n => [bStringHash(n), n]));
export const carName = hash => CAR_HASHES.get(hash >>> 0) ?? null;

/** Career, customized and preset cars stored in the profile (read-only view). */
export function readCars(buf) {
  const dv = view(buf);
  const typeAt = o => {
    const h = dv.getUint32(B + o + 28, true);
    return { hash: h, name: h ? carName(h) : null };
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
