// D10: an Applicant can send a correction request until the clearance is closed. After payment is verified it goes to an
// Admin, who corrects the entry through the Transaction Reversion; the reissued clearance is marked REVISED.
require('../tests/register-ts.cjs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mockApplications } = require('../data/mockApplications.ts');
const { mockUsers } = require('../data/mockUsers.ts');
const { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const KEY = 'san-jose-prototype-v2';
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
const REF = 'SJ-2026-000125';   // Electrical Clearance, Ready for Download, belongs to resident-maria
const seed = { users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: 'resident-maria' };
let count = 0;
const check = (name, actual) => { assert.ok(actual, name); count++; console.log('PASS ' + name); };
(async () => {
 const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
 try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, value); }, [KEY, JSON.stringify(seed)]);
  const saved = () => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), KEY);
  const as = id => page.evaluate(([key, id]) => { const s = JSON.parse(sessionStorage.getItem(key)); s.currentUserId = id; sessionStorage.setItem(key, JSON.stringify(s)); }, [KEY, id]);
  const text = () => page.locator('body').innerText();

  // The Applicant, on an issued clearance.
  await page.goto(BASE + '/resident/applications/' + REF);
  await page.getByLabel('What needs to be corrected?').waitFor();
  check('D10: the Applicant can still ask on an issued clearance', (await text()).includes('Your clearance is already issued'));
  await page.getByLabel('What needs to be corrected?').fill('The address should be Purok 3, San Jose.');
  await page.getByRole('button', { name: 'Send to the Admin' }).click();
  await page.getByText('Waiting for an Admin').waitFor();
  check('D10: the request waits for an Admin', (await saved()).applications.find(a => a.reference === REF).corrections[0].status === 'Open');

  // Staff see it but cannot act on it.
  await as('staff-maria');
  await page.goto(BASE + '/staff/applications/' + REF);
  await page.getByText('Open request').waitFor();
  check('D10: Staff are told an Admin handles it', (await text()).includes('an Admin handles this correction'));
  check('D10: Staff have no edit or resolve button', await page.getByRole('button', { name: 'Mark as Resolved' }).count() === 0 && await page.getByRole('button', { name: 'Edit application entries' }).count() === 0);

  // The Admin opens the reversion from the request and fixes the address.
  await as('admin');
  await page.goto(BASE + '/admin/applications/' + REF);
  await page.getByRole('link', { name: 'Open Transaction Reversion' }).click();
  await page.getByRole('dialog').waitFor();
  check('D10: the reversion opens on this request and shows the correction request', (await page.getByRole('dialog').innerText()).includes(REF) && (await page.getByRole('dialog').innerText()).includes('Purok 3'));
  check('D10: "resolve the request" is ticked by default', await page.getByLabel(/Resolve the Applicant/).isChecked());
  await page.getByLabel('Complete Address').fill('Purok 3, San Jose, Rodriguez, Rizal');
  await page.getByLabel('Reason for Reversion').fill('Applicant reported a wrong address');
  await page.getByRole('button', { name: 'Confirm Reversion' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const state = await saved(), a = state.applications.find(x => x.reference === REF);
  check('D10: the address is corrected and the clearance is REVISED, still ready', a.address === 'Purok 3, San Jose, Rodriguez, Rizal' && !!a.clearance?.revisedFrom && a.status === 'Ready for Download');
  check('D10: the correction request is resolved', a.corrections[0].status === 'Resolved');
  const audit = state.audits.find(x => x.reference === REF && x.reversion);
  check('D10: the reversion log has the old and new address', JSON.parse(audit.oldValue).address === 'San Jose, Rodriguez, Rizal' && JSON.parse(audit.newValue).address === a.address);

  // The Applicant is told, and can ask again before the clearance is closed.
  await as('resident-maria');
  await page.goto(BASE + '/resident/applications/' + REF);
  await page.getByLabel('What needs to be corrected?').waitFor();
  check('D10: the Applicant is notified about the REVISED copy', state.notifications.some(n => n.userId === 'resident-maria' && n.event === 'correction_resolved' && n.message.includes('REVISED')));
  check('no browser errors', errors.length === 0);
  console.log(`\n${count}/${count} checks passed`);
 } finally { await browser.close(); }
})().catch(error => { console.error('SCRIPT ERROR', error); process.exitCode = 1; });
