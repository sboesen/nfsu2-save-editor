# NFSU2 Save Editor

A browser-only editor for Need for Speed: Underground 2 profile saves
(`NFS Underground 2/<NAME>/<NAME>`, 54,966 bytes, `20CM` header).

It edits:

- cash (the bank at `0xA16A`)
- unlock bitfields for body parts, graphics, performance and specialties
  (the same runs as the 2005 NFSU2 Profile Creator)
- the career's won-event list: every race, cover shoot and unique-part reward
  the game has recorded, with a tick per event
- unique visual/performance parts and Caleb (the stage 5 final event)
- Save mode (Autosave / Prompt / Off)
- career difficulty
- the 16 unmapped values at `0xD155`
- any raw value by offset

and shows:

- the career, customized and preset cars stored in the profile
- the current career car (from the `CAREER_SLOT_n` handle in the career block)
- the career stage inferred from the won events
- the event-list records and the raw career block
- the modded game's car names, including cars the stock game does not have
- optional `GARAGE.DAT` editing: the bonus/garage cars, their type and owned
  flag, and the drive/quick-race/stand-in handles

On save it writes the profile's three checksums again — block A, block B, and
the header over bytes 0..23 — exactly as the game does, so the file is accepted
as a normal save. The file never leaves the browser. `GARAGE.DAT` has no
checksum; it is written back unchanged except for the fields you edit.

## Decoded layout

The layout and checksum are the clean-room description used by
[th0mk/nfsu2-web](https://github.com/th0mk/nfsu2-web) (MIT), itself based on
[TalhaMudo/NFSU2Recomp](https://github.com/TalhaMudo/NFSU2Recomp), and the
OpenUG2 spec (`docs/cleanroom-settings/SPEC.md` §3.2–3.5). The checksum is
CRC-32/BZIP2 over `D[0..n-5]` XOR the big-endian u32 in `D[n-4..n-1]`, stored
little-endian. The unlock runs come from NFSU2 Profile Creator 1.1's data
resources.

Payload offsets used here:

- `1156`: 20 customized cars, 1072 bytes each
- `22596`: 5 career cars, 2034 bytes each (type hash at +28, owned at +1073)
- `32770`: 6 preset cars, 1076 bytes each
- `39230` / `39487` / `39744` / `40001` / `40258` / `40515`: the stage 0–5
  race-hash tables
- `41301`: event-list count; `41305`: 8-byte event records
  (`+0` race/showcase hash, `+4` flags, `+6` won byte)
- `50599`: career block, 19 × 20 bytes. The first record is a header:
  `+4` the current car's `CAREER_SLOT_n` handle, `+8` an unknown handle,
  `+12` a value that is 4 in these saves, `+16` flags. The rest look like
  race results/times and are not fully mapped yet.
- `50979`: difficulty; `50987`/`50988`: autosave/prompt; `53761`: name.

`GARAGE.DAT` (beside the profile): 32-byte head `N2GA`, version 2, a
fingerprint, and the drive/quick-race/stand-in handles, then 20 × 2034-byte
career-car records in the modded game (5 records in nfsu2-web's own format).
Each record has its slot handle at `+4`, its type hash at `+28`, and its owned
byte at `+1073`. The header handles resolve to the record with that handle, or
to one of the profile's career slots.

Race and showcase names come from `GLOBAL/GLOBALB.BUN`'s string pool; the
game's event hashes are `bStringHash()` of those names. Mod car names come from
the modded game's `CARS/` folders; the stock player and traffic cars are from
nfsu2-web's `CAR_TYPES`.

This is a fan project, not affiliated with or endorsed by Electronic Arts.

## Layout

```
site/index.html     the page
site/style.css
site/app.js         UI
site/profile.js     pure format logic (parsing, validation, checksum, sealing,
                    career/event/garage decoding)
build/single.mjs    builds the self-contained offline HTML
test/run.mjs        format tests against real profiles
test/decode.mjs     career/event/garage/name-table tests against real saves
test/ui.cjs         Playwright test of the profile editor
test/ui-decode.cjs  Playwright test of career/event/garage editing
```

## Tests

```bash
node test/run.mjs
node test/decode.mjs
NODE_PATH=/path/to/playwright/node_modules node test/ui.cjs
NODE_PATH=/path/to/playwright/node_modules node test/ui-decode.cjs
```

The tests use the real profiles and `GARAGE.DAT` in
`~/Downloads/nfsu2-saves-2026-11-18_202337` by default; override with
`NFSU2_SAVES=<dir>`. The UI tests expect the page served on `:8799`; set
`NFSU2_URL` for another URL (including a `file://` URL for the single-file
build).

## Single-file build

`node build/single.mjs` writes `NFSU2 Save Editor.html`, a self-contained
offline copy with the CSS and both modules inlined. Open it directly in a
browser; no server is needed.
