// Waiting times (extra, agreed 2026-11-14): the "Waiting" column, the "Waiting over 24 hours" dashboard card and the
// filtered, longest-waiting-first list it opens, for Staff and Admin. Residents see no waiting column.
// Needs: the app running (npm run build, then npx next start -p 3100) and Playwright installed (see e2e/README.md).
const path = require('path');
const FE = path.resolve(__dirname, '..') + '/';
require(FE + 'tests/register-ts.cjs');
const { mockApplications } = require(FE + 'data/mockApplications.ts');
const { mockUsers } = require(FE + 'data/mockUsers.ts');
const { mockFeeSchedules } = require(FE + 'data/mockFeeSchedules.ts');
const { staffOverdue, waiting } = require(FE + 'lib/waiting.ts');
const { chromium } = require('playwright');
const fsx = require('fs');
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
const BASE_URL = process.env.E2E_BASE || 'http://localhost:3100';
const KEY = 'san-jose-prototype-v2';
fsx.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });

// The sample requests are from September, so the open ones have waited for weeks. One of them is made fresh:
// SJ-2026-000126 had its payment sent 2 hours ago, so it waits on Staff but is not over the limit.
const fresh = 'SJ-2026-000126', H = 3_600_000, now = Date.now();
let s = structuredClone({ users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: 'staff-maria' });
s.applications = s.applications.map(a => a.reference === fresh ? { ...a, status: 'For Checking', paymentVerification: { status: 'Pending', submittedAt: new Date(now - 2 * H).toISOString() } } : a);
const open = s.applications.filter(a => a.status !== 'Draft');
const overdue = open.filter(a => staffOverdue(a, now));
const longest = [...overdue].sort((x, y) => waiting(y, now).hours - waiting(x, now).hours)[0];
const applicantSide = open.find(a => waiting(a, now)?.on === 'Applicant');

const results = [], errors = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); };
(async () => {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [KEY, JSON.stringify(s)]);

  await page.goto(BASE_URL + '/staff/dashboard');
  await page.waitForSelector('h1:has-text("Staff Dashboard")');
  const card = page.getByRole('link', { name: /Waiting over 24 hours/ });
  await card.waitFor();
  await page.waitForFunction(() => !/…/.test(document.querySelector('a[aria-label^="Waiting over 24 hours"]')?.getAttribute('aria-label') || '…'));
  const label = await card.getAttribute('aria-label');
  check(`the Staff dashboard has a "Waiting over 24 hours" card showing ${overdue.length}`, label.includes(`: ${overdue.length} request`), label);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'waiting-dashboard.png'), fullPage: false });

  await card.click();
  await page.waitForURL(u => u.pathname === '/staff/applications' && u.search.includes('waiting=overdue'));
  await page.waitForSelector('text=Showing requests waiting on Staff for over 24 hours');
  check('the card opens the Staff list filtered to those requests, with a notice saying so', true);
  await page.waitForFunction(n => document.querySelectorAll('tbody tr').length === n, Math.min(overdue.length, 6));
  const rows = await page.locator('tbody tr').allInnerTexts();
  check('only the requests waiting on Staff past the limit are listed', rows.length === Math.min(overdue.length, 6) && rows.every(r => /on Staff · over 24h/.test(r)), rows.map(r => r.replace(/\s+/g, ' ').slice(0, 90)).join(' | '));
  check('they are sorted longest waiting first', rows[0].includes(longest.reference), longest.reference);
  check('the sort menu shows "Longest waiting first"', await page.getByLabel('Sort').inputValue() === 'waiting');
  await page.screenshot({ path: path.join(__dirname, 'shots', 'waiting-list.png'), fullPage: false });

  await page.getByRole('button', { name: 'Show all requests' }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Showing requests waiting on Staff'));
  const header = await page.locator('thead').innerText();
  check('the list has a "Waiting" column', /Waiting/.test(header));
  const freshRow = await page.locator('tbody tr', { hasText: fresh }).innerText().catch(() => '');
  check('a request whose payment came in 2 hours ago shows "2 hours, on Staff", not highlighted', /2 hours\s*on Staff/.test(freshRow) && !/over 24h/.test(freshRow), freshRow.replace(/\s+/g, ' '));
  if (applicantSide) {
    const row = await page.locator('tbody tr', { hasText: applicantSide.reference }).innerText().catch(() => '');
    check('a request waiting for the Applicant to pay says "on Applicant"', /on Applicant/.test(row), row.replace(/\s+/g, ' '));
  }

  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [KEY, JSON.stringify({ ...s, currentUserId: s.users.find(u => u.role === 'admin').id })]);
  await page.goto(BASE_URL + '/admin/dashboard');
  const adminCard = page.getByRole('link', { name: /Waiting over 24 hours/ });
  await adminCard.waitFor();
  check('Admin has the card too, opening the Transactions list filtered', (await adminCard.getAttribute('href')) === '/admin/transactions?waiting=overdue');

  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [KEY, JSON.stringify({ ...s, currentUserId: 'resident-maria' })]);
  await page.goto(BASE_URL + '/resident/applications');
  await page.waitForSelector('table');
  check('residents see no "Waiting" column and no card', !/Waiting/.test(await page.locator('thead').innerText()));

  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.log('SCRIPT ERROR ' + e.message); process.exit(1); });
