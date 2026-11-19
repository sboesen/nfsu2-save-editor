# NFSU2 Save Editor

A browser-only editor for Need for Speed: Underground 2 profile saves
(`NFS Underground 2/<NAME>/<NAME>`, 54,966 bytes, `20CM` header).

It edits:

- cash (the bank at `0xA16A`)
- unlock bitfields for body parts, graphics, performance and specialties
  (the same runs as the 2005 NFSU2 Profile Creator)
- Save mode (Autosave / Prompt / Off)
- career difficulty
- the 16 unmapped values at `0xD155`
- any raw value by offset

and shows the career, customized and preset cars stored in the profile.

On save it writes the profile's three checksums again — block A, block B, and
the header over bytes 0..23 — exactly as the game does, so the file is accepted
as a normal save. The file never leaves the browser.

## Format and checksum sources

The layout and checksum are the clean-room description used by
[th0mk/nfsu2-web](https://github.com/th0mk/nfsu2-web) (MIT), itself based on
[TalhaMudo/NFSU2Recomp](https://github.com/TalhaMudo/NFSU2Recomp), and the
OpenUG2 spec (`docs/cleanroom-settings/SPEC.md` §3.2–3.5). The checksum is
CRC-32/BZIP2 over `D[0..n-5]` XOR the big-endian u32 in `D[n-4..n-1]`, stored
little-endian. The unlock runs come from NFSU2 Profile Creator 1.1's data
resources.

This is a fan project, not affiliated with or endorsed by Electronic Arts.

## Layout

```
site/index.html     the page
site/style.css
site/app.js         UI
site/profile.js     pure format logic (parsing, validation, checksum, sealing)
test/run.mjs        format tests against real profiles
test/ui.cjs         Playwright test of the page (load, edit, save, verify)
```

## Tests

```bash
node test/run.mjs
NODE_PATH=/path/to/playwright/node_modules node test/ui.cjs   # page served on :8799
```

`test/run.mjs` checks both real profiles in
`~/Downloads/nfsu2-saves-2026-11-18_202337` by default; override with
`NFSU2_SAVES=<dir>`.
