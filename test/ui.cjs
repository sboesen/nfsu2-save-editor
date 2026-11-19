const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.NFSU2_SAVES || path.join(process.env.HOME, 'Downloads', 'nfsu2-saves-2026-11-18_202337');
const yourgod = path.join(dir, 'NFS Underground 2', 'YourGod', 'YourGod');
const modded = path.join(dir, 'NFS Underground 2', 'modded', 'modded');
const shortFile = '/tmp/nfsu2-short-profile';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
};

(async () => {
  fs.writeFileSync(shortFile, fs.readFileSync(yourgod).subarray(0, 100));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(process.env.NFSU2_URL || 'http://127.0.0.1:8799/', { waitUntil: 'networkidle' });

  // A truncated file must be refused.
  await page.setInputFiles('#file', shortFile);
  await page.waitForTimeout(300);
  check('short file refused', (await page.textContent('#loadStatus')).includes('Expected'), await page.textContent('#loadStatus'));
  check('editor hidden after bad file', await page.isHidden('#editor'));

  // Load a real profile.
  await page.setInputFiles('#file', yourgod);
  await page.waitForSelector('#editor:not([hidden])');
  check('name read', await page.inputValue('#name') === 'YourGod', await page.inputValue('#name'));
  check('cash read', await page.inputValue('#cash') === '300000', await page.inputValue('#cash'));
  check('save mode read', await page.inputValue('#saveMode') === 'autosave');
  check('difficulty read', await page.inputValue('#difficulty') === 'hard');
  check('load status says valid', (await page.textContent('#loadStatus')).includes('Checksums are valid'));
  const carsText = await page.textContent('#cars');
  check('career car PEUGOT106', carsText.includes('PEUGOT106'), carsText.slice(0, 200));
  check('career car SKYLINE', carsText.includes('SKYLINE'));

  // Change cash and difficulty, unlock everything, save.
  await page.click('[data-cash="999999999"]');
  await page.selectOption('#difficulty', 'medium');
  await page.click('#unlockAll');
  check('unlock all shows 100%', (await page.textContent('#unlocks')).includes('Unlocked'));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#save'),
  ]);
  check('download name', download.suggestedFilename() === 'YourGod', download.suggestedFilename());
  const savedPath = await download.path();
  const saved = new Uint8Array(fs.readFileSync(savedPath));
  const P = await import('file://' + path.resolve(__dirname, '../site/profile.js'));
  check('saved size', saved.length === P.FILE_SIZE, saved.length);
  check('saved shape', P.checkShape(saved).length === 0, P.checkShape(saved).join('; '));
  check('saved sealed', P.isSealed(saved));
  check('saved money', P.readMoney(saved) === 999999999, P.readMoney(saved));
  check('saved difficulty', P.readDifficulty(saved) === 'medium', P.readDifficulty(saved));
  let all100 = true;
  for (const cat of Object.keys(P.UNLOCK_RUNS))
    for (let s = 0; s < 5; s++) if (P.unlockPercent(saved, cat, s) !== 100) all100 = false;
  check('saved unlocks all 100%', all100);
  check('save status mentions checksums', (await page.textContent('#saveStatus')).includes('checksums made again'));

  // Revert, reload the modded profile, and check its cars and save mode.
  await page.click('#revert');
  await page.setInputFiles('#file', modded);
  await page.waitForTimeout(300);
  check('modded save mode', await page.inputValue('#saveMode') === 'prompt');
  check('modded difficulty', await page.inputValue('#difficulty') === 'easy');
  check('modded cash', await page.inputValue('#cash') === '99617720', await page.inputValue('#cash'));
  const moddedCars = await page.textContent('#cars');
  check('modded career GTO', moddedCars.includes('GTO'), moddedCars.slice(0, 200));
  check('modded career IMPREZAWRX', moddedCars.includes('IMPREZAWRX'));

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall UI tests passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
