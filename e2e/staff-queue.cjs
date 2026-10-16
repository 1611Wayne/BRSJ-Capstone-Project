// The Staff queue and dashboard: the renamed upload screen, the Rejected and Correction Requests tabs, the open-correction count.
// Needs: the app running (npm run build, then npx next start -p 3100) and Playwright installed (see e2e/README.md).
const path = require('path');
const FE = path.resolve(__dirname, '..') + '/';
require(FE + 'tests/register-ts.cjs');
const { transition } = require(FE + 'lib/workflow.ts');
const { mockApplications } = require(FE + 'data/mockApplications.ts');
const { mockUsers } = require(FE + 'data/mockUsers.ts');
const { mockFeeSchedules } = require(FE + 'data/mockFeeSchedules.ts');
const { chromium } = require('playwright');
const fsx = require('fs');
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
const BASE_URL = process.env.E2E_BASE || 'http://localhost:3100';
fsx.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });

const at = '2026-09-07T02:30:12.000Z', ref = 'SJ-2026-000123', waiting = 'SJ-2026-000126', KEY = 'san-jose-prototype-v2';
let s = structuredClone({ users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: 'staff-maria' });
s = transition(s, { type: 'reject', reference: ref, reason: 'The name does not match the ID.' }, at);
s = transition({ ...s, currentUserId: 'resident-maria' }, { type: 'requestCorrection', reference: ref, message: 'Please fix my name.' }, at);
s = { ...s, currentUserId: 'staff-maria' };

const results = [], errors = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); };
(async () => {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [KEY, JSON.stringify(s)]);

  await page.goto(BASE_URL + '/staff/dashboard');
  await page.waitForSelector('h1:has-text("Staff Dashboard")');
  const card = await page.locator('xpath=//*[contains(text(),"Open Correction Requests")]/ancestor::div[1]').first().innerText();
  check('the Staff dashboard has an "Open Correction Requests" card showing 1', /\b1\b/.test(card), card.replace(/\s+/g, ' '));
  const nav = await page.locator('nav').first().innerText();
  check('the sidebar says "Upload Receipt for Applicant", not "Assist OR Entry"', nav.includes('Upload Receipt for Applicant') && !nav.includes('Assist OR Entry'));

  await page.goto(BASE_URL + '/staff/applications');
  await page.waitForSelector('table');
  const all = await page.locator('tbody tr').count();
  check('the queue has a "Correction Requests (1)" tab and a "Rejected" tab', await page.locator('button:has-text("Correction Requests (1)")').count() === 1 && await page.locator('button:text-is("Rejected")').count() === 1);
  await page.click('button:has-text("Correction Requests (1)")');
  let rows = await page.locator('tbody tr').allInnerTexts();
  check('the Correction Requests tab lists only the request with an open correction', rows.length === 1 && rows[0].includes(ref), rows.map(r => r.replace(/\s+/g, ' ').slice(0, 60)).join(' | '));
  check('its action says "Review Correction"', rows[0].includes('Review Correction'));
  await page.click('button:text-is("Rejected")');
  rows = await page.locator('tbody tr').allInnerTexts();
  check('the Rejected tab lists the rejected request', rows.length === 1 && rows[0].includes(ref) && rows[0].includes('Rejected'));
  await page.click('button:text-is("Awaiting OR")');
  rows = await page.locator('tbody tr').allInnerTexts();
  const mine = rows.find(r => r.includes(waiting)) || '';
  check('a request waiting for its receipt shows "Upload Receipt for Applicant"', mine.includes('Upload Receipt for Applicant'), mine.replace(/\s+/g, ' ').slice(0, 90));
  await page.click('button:text-is("All Applications")');
  check('"All Applications" still lists everything', (await page.locator('tbody tr').count()) === all);

  await page.goto(BASE_URL + '/staff/or-entry?ref=' + waiting);
  await page.waitForSelector('h1');
  check('the upload page is titled "Upload Receipt for Applicant"', (await page.locator('h1').first().innerText()).includes('Upload Receipt for Applicant'));

  check('no page errors or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' checks passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', e.message.split('\n').slice(0, 6).join('\n')); process.exit(2); });
