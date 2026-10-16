// Staff verify a receipt photo (OR number, OR date, Amount Paid), then the detail page, the Daily OR Summary and the admin dashboard.
// Needs: the app running (npm run build, then npx next start -p 3100) and Playwright installed (see e2e/README.md).
// Real-browser check of the D1-flow report fix: Staff verify a receipt photo through the actual form (OR number + OR date),
// then the detail page, the Daily OR Summary and the admin dashboard show it correctly.
const path = require('path');
const FE = path.resolve(__dirname, '..') + '/';
require(FE + 'tests/register-ts.cjs');
const { transition } = require(FE + 'lib/workflow.ts');
const { mockApplications } = require(FE + 'data/mockApplications.ts');
const { mockUsers } = require(FE + 'data/mockUsers.ts');
const { mockFeeSchedules } = require(FE + 'data/mockFeeSchedules.ts');
const { chromium } = require('playwright');
const fsx = require('fs');
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge'; // '' = Playwright's own Chromium; 'chrome' = installed Chrome
const BASE_URL = process.env.E2E_BASE || 'http://localhost:3100';
fsx.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });

const at = '2026-09-07T02:30:12.000Z', ref = 'SJ-2026-000123', KEY = 'san-jose-prototype-v2';
let s = structuredClone({ users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], currentUserId: 'staff-maria' });
s = transition(s, { type: 'assess', reference: ref, category: 'Sari-Sari Store', classification: 'Medium' }, at);
s = transition({ ...s, currentUserId: 'resident-maria' }, { type: 'receiptPhoto', reference: ref, photo: { requirement: 'Official Receipt', name: 'or.jpg', size: 1000, type: 'image/jpeg', status: 'Pending Review' } }, at);
s = { ...s, currentUserId: 'staff-maria' };

const results = []; const errors = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); };
const shot = (page, n) => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png'), fullPage: true });

(async () => {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [KEY, JSON.stringify(s)]);

  // 1. Staff verify through the real form
  await page.goto(BASE_URL + '/staff/applications/' + ref);
  await page.waitForSelector('h2:has-text("Payment Verification")');
  const num = page.locator('input[placeholder^="Enter the OR number"]');
  const date = page.locator('form input[type=date]');
  const btn = page.locator('button:has-text("Verify Payment")');
  check('form shows an OR Date field for the receipt-photo flow', await date.count() === 1);
  check('Verify is disabled until both OR number and OR date are filled', await btn.isDisabled());
  await num.fill('123456');
  check('still disabled with only the OR number', await btn.isDisabled());
  await date.fill('2026-09-06');
  const amount = page.locator('form input[type=number]');
  check('form shows an Amount Paid field', await amount.count() === 1);
  check('still disabled without the amount', await btn.isDisabled());
  await amount.fill('599');
  check('enabled once number, date and amount are filled', await btn.isEnabled());
  await btn.click();
  await page.waitForSelector('[role=alert]');
  check('a receipt that shows another amount is refused with a plain message', (await page.locator('[role=alert]').first().innerText()).includes('Amount Paid must match the assessed amount'));
  check('and the request is still For Checking (nothing was released)', !(await page.locator('body').innerText()).includes('Checked by Maria Staff'));
  await amount.fill('600');
  await shot(page, 'report-1-staff-verify-form');
  await btn.click();
  await page.waitForSelector('text=Checked by Maria Staff');
  let body = await page.locator('body').innerText();
  check('verified: OR number shown, status Ready for Download', body.includes('OR Number: 123456') && /Ready for Download/.test(body));
  check('the OR date field is gone after verification', await page.locator('form input[type=date]').count() === 0);

  // 2. Detail page: processing table
  check('Service Processing shows the new milestone rows', ['OR Verification Time', 'Total Processing Duration (MM:SS)', 'Payment Check Turnaround (MM:SS)', 'SLA Status (demo)'].every(t => body.includes(t)));
  check('Total Processing Duration is "—" until the Applicant confirms receipt', /Total Processing Duration \(MM:SS\)\s*—/.test(body));
  check('Payment Check Turnaround has a value (upload to verification)', /Payment Check Turnaround \(MM:SS\)\s*\d+:\d\d/.test(body));
  await shot(page, 'report-2-detail');

  // 3. Admin: Daily OR Summary
  await page.evaluate(([k]) => { const st = JSON.parse(sessionStorage.getItem(k)); st.currentUserId = 'admin'; sessionStorage.setItem(k, JSON.stringify(st)); }, [KEY]);
  await page.goto(BASE_URL + '/admin/reports/daily-or');
  await page.waitForSelector('h1:has-text("Daily OR Summary")');
  body = await page.locator('main, body').first().innerText();
  const headers = await page.locator('table th').allInnerTexts();
  check('Daily OR Summary columns follow the manuscript', ['OR Number', 'OR Date', 'Amount Paid', 'Clearance Generated', 'Processing Staff'].every(h => headers.some(x => x.includes(h))), headers.join(' | '));
  const row = page.locator('tr', { hasText: ref });
  const rowText = await row.count() ? await row.first().innerText() : '';
  check('the payment is listed on today (the day Staff verified), with OR number, OR date, amount and Staff', /123456/.test(rowText) && /2026-09-06/.test(rowText) && /600\.00/.test(rowText) && /Maria Staff/.test(rowText), rowText.replace(/\s+/g, ' ').slice(0, 140));
  await shot(page, 'report-3-daily-or');

  // 4. Admin dashboard cards
  await page.goto(BASE_URL + '/admin/dashboard');
  await page.waitForSelector('text=Requests Within SLA');
  body = await page.locator('body').innerText();
  check('dashboard shows Average Processing Time in MM:SS (sample closed requests: 2h35m = 155:00)', /Average Processing Time\s*\n?\s*155:00/.test(body) || body.includes('155:00'));
  check('dashboard SLA card measures the payment check and the caption says the target is a demo', /Requests Within SLA/.test(body) && /demo target of 60 seconds; no SLA has been approved/.test(body));
  check('chart title is in minutes', body.includes('Avg. Processing Time (minutes)'));
  await shot(page, 'report-4-dashboard');

  // 5. Monthly report page still loads
  await page.goto(BASE_URL + '/admin/reports/monthly-collection');
  await page.waitForSelector('h1:has-text("Monthly Collection Report")');
  check('Monthly Collection page loads', true);

  check('no page errors or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', e.message.split('\n').slice(0, 6).join('\n')); process.exit(2); });
