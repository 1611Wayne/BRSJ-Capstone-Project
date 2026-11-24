// UAT notes (2026-11-24): the property clearances (Building, Electrical, Fencing, Excavation, Lot Survey, Water/MWSS)
// ask only Name, Residential Address, Location, Remarks (Residential or Commercial) and Purpose, as printed on the
// clearance; Location can be "-SAME AS ABOVE-" with one tick; the second document is the "Proof of Ownership".
// Business keeps its business details. The clearance PDF prints the property's Location and the Remarks.
const path = require('path');
const FE = path.resolve(__dirname, '..') + '/';
require(FE + 'tests/register-ts.cjs');
const assert = require('node:assert/strict');
const fs = require('fs');
const { mockApplications } = require(FE + 'data/mockApplications.ts');
const { mockUsers } = require(FE + 'data/mockUsers.ts');
const { mockFeeSchedules } = require(FE + 'data/mockFeeSchedules.ts');
const { chromium } = require('playwright');
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge', BASE = process.env.E2E_BASE || 'http://localhost:3100', KEY = 'san-jose-prototype-v2';
const ready = mockApplications.find(a => a.reference === 'SJ-2026-000125');
const building = { ...ready, reference: 'SJ-2026-000777', clearanceType: 'Building Clearance', businessName: '', businessLocation: 'Lot 5, Purok 2, San Jose', propertyUse: 'Commercial' };
const toda = { ...ready, reference: 'SJ-2026-000778', clearanceType: 'TODA Clearance', businessName: '', businessLocation: '', vehicleType: 'Tricycle', registrationNumber: 'REG-12345', plateNumber: 'ABC 123', bodyNumber: 'TD-042', purpose: '' };
const seed = { users: mockUsers, applications: [...mockApplications, building, toda], schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: ready.residentId };
const PROPERTY = ['Building Clearance', 'Electrical Clearance', 'Fencing Clearance', 'Excavation Clearance', 'Lot Survey Clearance', 'Water/MWSS Clearance'];
let checks = 0; const check = (name, ok, detail = '') => { assert.ok(ok, name + (detail ? ' -> ' + detail : '')); checks++; console.log('PASS ' + name); };
(async () => {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
  try {
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [KEY, JSON.stringify(seed)]);
    const labels = async () => (await page.locator('form .field-label, form legend').allInnerTexts()).map(s => s.trim());
    const type = page.getByLabel(/^Clearance Type/);

    await page.goto(BASE + '/resident/apply?type=building'); await page.getByText('Building Clearance Details').waitFor();
    check('Section 1 says "Residential Address"', (await labels()).some(x => /^Residential Address/.test(x)));
    const extras = /Name of Business|Name of Owner|Date of Initial Operation|Application Type|Do you have employees|^Ownership/;
    for (const t of PROPERTY) {
      await type.selectOption(t);
      const l = await labels();
      check(`${t}: only Location and Remarks here (no business name, date of operation, New/Renewal, contact, employees, ownership)`, l.some(x => /^Location/.test(x)) && l.some(x => /^Remarks/.test(x)) && !l.some(x => extras.test(x)) && l.filter(x => /Contact Number/.test(x)).length === 1, l.join(' | '));
    }
    await type.selectOption('Building Clearance');
    check('Remarks offers Residential and Commercial, and is required', await page.getByLabel('Residential', { exact: true }).count() === 1 && await page.getByLabel('Commercial', { exact: true }).count() === 1 && await page.getByLabel('Residential', { exact: true }).evaluate(el => el.required));
    const loc = page.getByLabel(/^Location/);
    await page.getByLabel('Same as my residential address').check();
    check('"Same as my residential address" fills in -SAME AS ABOVE-', await loc.inputValue() === '-SAME AS ABOVE-');
    await page.getByLabel('Same as my residential address').uncheck();
    check('...and unticking clears it', await loc.inputValue() === '');
    check('the second document is "Proof of Ownership"', await page.getByText('Proof of Ownership').count() > 0 && await page.getByText('Supporting Property').count() === 0);

    // TODA and PODA: the vehicle, no location (UAT notes 2026-11-24).
    await type.selectOption('TODA Clearance');
    let lv = await labels();
    check('TODA: Name / Operator, and the vehicle: Type, Registration No., Plate No., Body Number, New/Renewal', lv.some(x => /^Name \/ Operator/.test(x)) && ['Type of Vehicle', 'Registration No.', 'Plate No.', 'Body Number', 'Application Type'].every(n => lv.some(x => x.startsWith(n))), lv.join(' | '));
    check('TODA: no Location, Remarks or business details; Purpose optional', !lv.some(x => /^(Location|Remarks|Name of Business|Date of Initial Operation|Do you have employees|Ownership)/.test(x)) && lv.some(x => /Purpose of Clearance \(optional\)/.test(x)));
    check('TODA: documents are the OR/CR of the vehicle and a valid ID', await page.getByText('OR/CR of the Vehicle').count() > 0 && await page.getByText('Proof of Ownership').count() === 0);
    await type.selectOption('PODA Clearance');
    lv = await labels();
    check('PODA: Type of Vehicle and Body Number only (no registration, plate or New/Renewal)', ['Type of Vehicle', 'Body Number'].every(n => lv.some(x => x.startsWith(n))) && !lv.some(x => /^(Registration No\.|Plate No\.|Application Type|Location|Remarks)/.test(x)), lv.join(' | '));
    check('PODA: documents are the certification from the association and a valid ID', await page.getByText('Certification from the Association').count() > 0);

    await type.selectOption('Business Clearance');
    const lb = await labels();
    check('Business: "Location" plus its business details as before, no Remarks', lb.some(x => /^Location/.test(x)) && lb.some(x => /^Name of Business/.test(x)) && lb.some(x => /^Date of Initial Operation/.test(x)) && !lb.some(x => /^Remarks/.test(x)));

    await page.goto(BASE + '/resident/apply/ready?ref=' + building.reference);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download Clearance PDF/ }).click();
    const pdf = fs.readFileSync(await (await pending).path(), 'latin1');
    const has = t => pdf.includes('(' + t + ')');
    check('PDF: Location is the property, not "Same as above"', has('Lot 5, Purok 2, San Jose') && !has('Same as above'));
    check('PDF: Remarks: Commercial; no separate owner row', has('Remarks') && has('Commercial') && !has('Name of Owner'));
    await page.goto(BASE + '/resident/apply/ready?ref=' + toda.reference);
    const pending2 = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download Clearance PDF/ }).click();
    const tpdf = fs.readFileSync(await (await pending2).path(), 'latin1'), thas = t => tpdf.includes('(' + t + ')');
    check('TODA PDF: Name / Operator, Type of Vehicle, Registration No., Plate No., Body Number; no Location or Remarks', thas('Name / Operator') && thas('Tricycle') && thas('Registration No.') && thas('REG-12345') && thas('Plate No.') && thas('ABC 123') && thas('Body Number') && thas('TD-042') && !thas('Location') && !thas('Remarks'));
    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally { await browser.close(); }
  console.log(`\n${checks}/${checks} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', e.message); process.exitCode = 1; });
