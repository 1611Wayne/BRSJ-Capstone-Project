// FT-5/FT-6: Admin voiding, clearance type and fee corrections through the real dialog.
require('../tests/register-ts.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { mockApplications } = require('../data/mockApplications.ts');
const { mockUsers } = require('../data/mockUsers.ts');
const { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const KEY = 'san-jose-prototype-v2';
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
const seed = { users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: 'admin' };
let count = 0;
const check = (name, actual) => { assert.ok(actual, name); count++; console.log('PASS ' + name); };
(async () => {
 const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
 try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, value); }, [KEY, JSON.stringify(seed)]);
  const saved = () => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), KEY);
  const row = reference => page.locator('tbody tr').filter({ hasText: reference });
  const open = async reference => {
   await page.goto(BASE + '/admin/transaction-reversion');
   await row(reference).getByRole('button', { name: 'Revert', exact: true }).click();
   await page.getByRole('dialog').waitFor();
  };
  await open('SJ-2026-000119');
  await page.getByLabel('Select Action').selectOption('Void Transaction');
  await page.getByLabel('Reason for Reversion').fill('FT-5 browser check');
  await page.getByRole('button', { name: 'Confirm Reversion' }).click();
  await page.goto(BASE + '/admin/reports/daily-or');
  await page.locator('input[type="date"]').fill('2026-09-06');
  await page.getByRole('button', { name: 'Apply Filter' }).click();
  check('FT-5: void row hidden while two valid entries remain', await row('SJ-2026-000119').count() === 0 && await page.locator('tbody tr').count() === 2);
  check('FT-5: daily recorded amount is 800 pesos', (await page.locator('body').innerText()).includes('800.00'));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const csv = fs.readFileSync(await (await downloadPromise).path(), 'utf8');
  check('FT-5: CSV contains valid entries and excludes the void entry', csv.includes('SJ-2026-000125') && !csv.includes('SJ-2026-000119'));

  await open('SJ-2026-000125');
  check('FT-6: confirmation requires a reason', await page.getByRole('button', { name: 'Confirm Reversion' }).isDisabled());
  await page.getByLabel(/^Clearance Type/).selectOption('Building Clearance');
  check('FT-6: changing type requires a fee assessment', await page.getByLabel('Correct fee assessment').isChecked() && await page.getByLabel('Correct fee assessment').isDisabled());
  await page.getByLabel('Building Clearance amount').fill('575.25');
  await page.getByLabel('Reason for Reversion').fill('Correct clearance type and fee');
  check('FT-6: total updates with corrected fee components', (await page.getByRole('dialog').innerText()).includes('625.25'));
  await page.getByRole('button', { name: 'Confirm Reversion' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  check('FT-6: table shows corrected type and Pending Assessment', (await row('SJ-2026-000125').innerText()).includes('Building Clearance') && (await row('SJ-2026-000125').innerText()).includes('Pending Assessment'));
  let state = await saved(), corrected = state.applications.find(a => a.reference === 'SJ-2026-000125');
  check('FT-6: receipt retained, old release and confirmation revoked', !!corrected.receipt && !corrected.clearance && !corrected.confirmation && corrected.assessment.total === 625.25);
  const audit = state.audits.find(a => a.reference === corrected.reference && a.reversion);
  check('FT-6: audit includes previous and corrected type and fee', JSON.parse(audit.oldValue).clearanceType === 'Electrical Clearance' && JSON.parse(audit.newValue).assessment.total === 625.25);

  // Fee-only correction: the type stays Business Clearance.
  await open('SJ-2026-000117');
  await page.getByLabel('Correct fee assessment').check();
  await page.getByLabel('Business Clearance amount').fill('125');
  await page.getByLabel('Reason for Reversion').fill('Correct fee only');
  await page.getByRole('button', { name: 'Confirm Reversion' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  state = await saved(); const feeOnly = state.applications.find(a => a.reference === 'SJ-2026-000117');
  check('FT-6: fee-only correction keeps the type and returns to assessment', feeOnly.clearanceType === 'Business Clearance' && feeOnly.assessment.total === 425 && feeOnly.status === 'Pending Assessment');

  await page.evaluate(key => { const state = JSON.parse(sessionStorage.getItem(key)); state.currentUserId = 'staff-maria'; sessionStorage.setItem(key, JSON.stringify(state)); }, KEY);
  await page.goto(BASE + '/staff/assessment/SJ-2026-000125');
  await page.getByLabel('Building Clearance amount').waitFor();
  check('FT-6: Staff starts with the corrected amount', await page.getByLabel('Building Clearance amount').inputValue() === '575.25');
  await page.getByRole('button', { name: 'Confirm Assessment', exact: true }).click();
  await page.waitForURL('**/staff/dashboard');
  state = await saved(); corrected = state.applications.find(a => a.reference === 'SJ-2026-000125');
  check('FT-6: Staff confirmation preserves the correction and requires payment', corrected.assessment.total === 625.25 && corrected.status === 'Awaiting OR' && !corrected.clearance);
  check('no browser errors', errors.length === 0);
  console.log(`\n${count}/${count} checks passed`);
 } finally { await browser.close(); }
})().catch(error => { console.error('SCRIPT ERROR', error); process.exitCode = 1; });
