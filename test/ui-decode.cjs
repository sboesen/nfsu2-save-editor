const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.NFSU2_SAVES || path.join(process.env.HOME, 'Downloads', 'nfsu2-saves-2026-11-18_202337');
const yourgod = path.join(dir, 'NFS Underground 2', 'YourGod', 'YourGod');
const modded = path.join(dir, 'NFS Underground 2', 'modded', 'modded');
const garageFile = path.join(dir, 'NFS Underground 2', 'modded', 'GARAGE.DAT');
const url = process.env.NFSU2_URL || 'http://127.0.0.1:8799/';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(url, { waitUntil: 'networkidle' });

  // --- YourGod: career block and event list ---
  await page.setInputFiles('#file', yourgod);
  await page.waitForSelector('#editor:not([hidden])');
  check('career car SKYLINE', (await page.textContent('#careerCar')).includes('SKYLINE'), await page.textContent('#careerCar'));
  check('career stage 5+', (await page.textContent('#careerStage')).includes('stage 5+'), await page.textContent('#careerStage'));
  check('career block value 4', (await page.textContent('#careerStage')).includes('block value 4'));
  const unique = await page.textContent('#careerUnique');
  check('unique visual unlocked', unique.includes('Unique visual parts (widebody etc.): unlocked'), unique);
  check('unique perf unlocked', unique.includes('Unique performance parts: unlocked'), unique);
  check('Caleb beaten', unique.includes('Caleb / final event: beaten'), unique);

  const s5url = page.locator('#events tr', { hasText: 'S5_URL_9' });
  check('S5_URL_9 row checked', await s5url.locator('input').isChecked());
  const dday = page.locator('#events tr', { hasText: 'DDAY_EVENT_A' });
  check('DDAY_EVENT_A row checked', await dday.locator('input').isChecked());
  check('summary has Stage 5', (await page.textContent('#careerSummary')).includes('Stage 5'), await page.textContent('#careerSummary'));

  await page.click('#markAllWon');
  await page.waitForTimeout(200);
  const boxes = page.locator('#events input[type=checkbox]');
  const total = await boxes.count();
  const checked = await page.locator('#events input[type=checkbox]:checked').count();
  check('markAll checks every row', total === checked, `${checked}/${total}`);
  check('summary shows all races', (await page.textContent('#careerSummary')).includes('Stage 5: races'), await page.textContent('#careerSummary'));

  await page.click('#markCareerComplete');
  await page.waitForTimeout(200);
  check('career block value 5', (await page.textContent('#careerStage')).includes('block value 5'), await page.textContent('#careerStage'));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#save'),
  ]);
  check('profile download name', download.suggestedFilename() === 'YourGod', download.suggestedFilename());
  const saved = new Uint8Array(fs.readFileSync(await download.path()));
  const P = await import('file://' + path.resolve(__dirname, '../site/profile.js'));
  check('saved profile sealed', P.isSealed(saved));
  check('saved career block value 5', P.readCareer(saved).stageValue === 5, P.readCareer(saved).stageValue);
  let allWon = true;
  for (const name of P.RACE_LIST) if (!P.isEventWon(saved, P.bStringHash(name))) allWon = false;
  check('saved every known event won', allWon);
  check('saved unique visual', P.uniquePartsStatus(saved).visual);

  // --- modded: unique parts locked, then mark them ---
  await page.setInputFiles('#file', modded);
  await page.waitForSelector('#editor:not([hidden])');
  check('modded career car GTO', (await page.textContent('#careerCar')).includes('GTO'), await page.textContent('#careerCar'));
  const mu = await page.textContent('#careerUnique');
  check('modded unique visual unlocked by Caleb', mu.includes('Unique visual parts (widebody etc.): unlocked (Caleb beaten)'), mu);
  check('modded stage 5 visual star not won', mu.includes('Stage 5 visual star: not won'), mu);
  await page.click('#markUnique');
  await page.waitForTimeout(200);
  const mu2 = await page.textContent('#careerUnique');
  check('modded stage 5 visual star now won', mu2.includes('Stage 5 visual star: won'), mu2);
  check('modded unique perf now unlocked', mu2.includes('Unique performance parts: unlocked'), mu2);

  const [download2] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#save'),
  ]);
  const saved2 = new Uint8Array(fs.readFileSync(await download2.path()));
  check('modded saved sealed', P.isSealed(saved2));
  check('modded saved unique visual', P.uniquePartsStatus(saved2).visual);
  check('modded saved unique perf', P.uniquePartsStatus(saved2).perf);

  // --- GARAGE.DAT ---
  await page.setInputFiles('#garageFile', garageFile);
  await page.waitForSelector('#garageEditor:not([hidden])');
  const gt = await page.textContent('#garage');
  for (const name of ['MERC560SE', 'LANCEREVO4', 'S2000', 'CORVETTEC5', 'ACCORD', 'CRXSIR'])
    check(`garage shows ${name}`, gt.includes(name), gt.slice(0, 300));
  check('garage header version 2', (await page.textContent('#garageHead')).includes('Version 2'), await page.textContent('#garageHead'));
  check('garage header drive CORVETTEC5', (await page.textContent('#garageHead')).includes('Drive: garage slot 9 (CORVETTEC5)'), await page.textContent('#garageHead'));
  check('garage header qr ACCORD', (await page.textContent('#garageHead')).includes('Quick race: garage slot 10 (ACCORD)'), await page.textContent('#garageHead'));
  check('garage header stand-in GTO', (await page.textContent('#garageHead')).includes('Stand-in: profile slot 1 (GTO)'), await page.textContent('#garageHead'));

  await page.locator('#garage select[data-slot="0"]').selectOption('SKYLINE');
  await page.waitForTimeout(200);
  check('garage change reported', (await page.textContent('#garageSaveStatus')).includes('changed'), await page.textContent('#garageSaveStatus'));

  const [download3] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#garageSave'),
  ]);
  check('garage download name', download3.suggestedFilename() === 'GARAGE.DAT', download3.suggestedFilename());
  const savedGarage = new Uint8Array(fs.readFileSync(await download3.path()));
  check('garage saved shape', P.checkGarage(savedGarage).length === 0, P.checkGarage(savedGarage).join('; '));
  const rg = P.readGarage(savedGarage);
  check('garage saved slot 0 SKYLINE', rg.records[0].name === 'SKYLINE', rg.records[0].name);
  check('garage saved slot 0 owned', rg.records[0].owned === true);

  await page.click('#garageRevert');
  await page.waitForTimeout(200);
  check('garage revert slot 0 MERC560SE', await page.locator('#garage select[data-slot="0"]').inputValue() === 'MERC560SE');

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall decode UI tests passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
