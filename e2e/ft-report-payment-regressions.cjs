// FT-5, FT-7, FT-22, FT-24 regressions in an isolated sample-data browser context.
require('../tests/register-ts.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const { mockApplications } = require('../data/mockApplications.ts');
const { mockUsers } = require('../data/mockUsers.ts');
const { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const BASE = process.env.E2E_BASE || 'http://localhost:3100', KEY = 'san-jose-prototype-v2';
const source = mockApplications.find(a => a.receipt && a.clearance);
const issued = { ...source, reference: 'SJ-2026-000117', clearanceType: 'Business Clearance', status: 'Closed - Cleared',
 clearance: { ...source.clearance, generatedAt: '2026-11-16T16:05:00Z' },
 feedback: { rating: 5, comment: 'Helpful service', submittedAt: '2026-09-30T16:00:00Z' } };
const rejected = { ...issued, reference: 'REJECTED-STALE', status: 'Rejected', feedback: { rating: 1, comment: 'Slow service', submittedAt: '2026-12-01T00:00:00+08:00' } };
const simulated = { ...issued, reference: 'SIMULATED-STALE', clearanceType: 'Building Clearance', simulatedPayment: { method: 'GCash', amount: 400, referenceNumber: 'SIM-OLD', paidAt: '2026-11-17T00:00:00+08:00' }, feedback: { rating: 4, comment: '', submittedAt: '2026-12-02T00:00:00+08:00' } };
const payment = { ...mockApplications[1], reference: 'SJ-2026-000124', residentId: 'resident-maria', status: 'Awaiting OR', feedback: undefined };
const log = (id, timestamp) => ({ id, timestamp, user: 'Admin San Jose', role: 'admin', reference: issued.reference, action: 'Edit Fields', reason: id, newValue: JSON.stringify({ clearanceType: 'Business Clearance' }), reversion: true });
const seed = { users: mockUsers, applications: [issued, rejected, simulated, { ...issued, reference: 'VOID-STALE', status: 'Void', feedback: undefined }, payment], schedules: mockFeeSchedules, notifications: [], currentUserId: 'admin',
 audits: [log('midnight-included', '2026-11-16T16:05:00Z'), log('last-second-included', '2026-11-17T15:59:59Z'), log('previous-day-excluded', '2026-11-16T15:59:59Z'), log('next-day-excluded', '2026-11-17T16:00:00Z')] };
let count = 0;
const check = (label, ok) => { assert.ok(ok, label); count++; console.log('PASS ' + label); };
(async () => {
 const channel = process.env.E2E_CHANNEL ?? 'msedge';
 const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([key, state]) => { if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(state)); window.print = () => { window.__printed = true; }; }, [KEY, seed]);
  const csv = async () => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click(); return fs.readFileSync(await (await pending).path(), 'utf8'); };
  const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
  await page.goto(BASE + '/admin/reports/daily-or');
  await page.getByLabel(/^Date/).fill('2026-11-17'); await page.getByRole('button', { name: 'Apply Filter', exact: true }).click();
  check('FT-5 daily rows exclude stale Rejected/Void and simulated receipts', await page.locator('tbody tr').count() === 1 && (await page.locator('tbody').innerText()).includes(issued.reference));
  check('FT-5 daily total counts only the eligible receipt', (await page.locator('body').innerText()).includes('₱' + issued.receipt.amountPaid.toFixed(2)));
  const dailyCsv = await csv();
  check('FT-5 CSV shares eligibility rules', dailyCsv.includes(issued.reference) && !/REJECTED-STALE|VOID-STALE|SIMULATED-STALE/.test(dailyCsv));
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  check('FT-5 print retains the same eligible table', await page.evaluate(() => window.__printed) && await page.locator('tbody tr').count() === 1);
  await page.screenshot({ path: path.join(shots, 'ft5-eligible-or.png'), fullPage: true });

  await page.goto(BASE + '/admin/dashboard');
  const types = page.getByRole('region', { name: 'Average Rating by Clearance Type', exact: true });
  await types.waitFor();
  check('FT-7 averages by clearance type include response counts', (await types.locator('tbody tr').allTextContents()).map(s => s.trim()).join('|') === 'Building Clearance14.0/5|Business Clearance23.0/5');
  const trend = page.getByRole('region', { name: 'Monthly Feedback Trend', exact: true });
  check('FT-7 months use Manila submission dates and show gaps without invented averages', (await trend.locator('tbody tr').allTextContents()).map(s => s.trim()).join('|') === '2026-1015.0/5|2026-110—|2026-1222.5/5');
  await page.getByRole('region', { name: 'Customer Feedback Summary', exact: true }).screenshot({ path: path.join(shots, 'ft7-type-month-summary.png') });

  await page.goto(BASE + '/admin/reports/reversion-audit');
  await page.getByLabel(/^Date Range.*From/).fill('2026-11-17'); await page.getByLabel(/^Date Range.*To/).fill('2026-11-17');
  await page.getByLabel(/^Clearance Type/).selectOption('Business Clearance'); await page.getByRole('button', { name: 'Apply Filter', exact: true }).click();
  const logs = await page.locator('tbody').innerText();
  check('FT-24 includes both ends of a Manila day and excludes adjacent days', await page.locator('tbody tr').count() === 2 && logs.includes('midnight-included') && logs.includes('last-second-included') && !logs.includes('day-excluded'));
  const auditCsv = await csv();
  check('FT-24 CSV uses the Manila date and clearance filters', auditCsv.includes('midnight-included') && auditCsv.includes('last-second-included') && !auditCsv.includes('day-excluded'));
  await page.screenshot({ path: path.join(shots, 'ft24-manila-date-filter.png'), fullPage: true });

  await page.evaluate(key => { const state = JSON.parse(sessionStorage.getItem(key)); state.currentUserId = 'resident-maria'; sessionStorage.setItem(key, JSON.stringify(state)); }, KEY);
  await page.goto(BASE + '/resident/apply/or?ref=' + payment.reference);
  await page.getByRole('button', { name: /Online Payment/ }).click();
  await page.getByRole('button', { name: 'Select Payment Method', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Online Payment Simulation' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  check('FT-22 cancelling before confirmation leaves the request unpaid', await page.evaluate(([key, ref]) => { const a = JSON.parse(sessionStorage.getItem(key)).applications.find(a => a.reference === ref); return a.status === 'Awaiting OR' && !a.simulatedPayment; }, [KEY, payment.reference]));
  await page.getByRole('button', { name: 'Select Payment Method', exact: true }).click();
  await dialog.getByRole('button', { name: 'Proceed with GCash', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Payment', exact: true }).click();
  await dialog.getByRole('heading', { name: 'Payment Recorded', exact: true }).waitFor();
  const recorded = await page.evaluate(([key, ref]) => JSON.parse(sessionStorage.getItem(key)).applications.find(a => a.reference === ref), [KEY, payment.reference]);
  check('FT-22 confirmation survives the For Checking state change and shows its reference', recorded.status === 'For Checking' && (await dialog.innerText()).includes(recorded.simulatedPayment.referenceNumber) && await dialog.getByRole('button', { name: 'Confirm Payment', exact: true }).count() === 0);
  await page.screenshot({ path: path.join(shots, 'ft22-payment-recorded.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Continue to Staff Checking', exact: true }).click();
  await page.waitForURL('**/resident/applications/' + payment.reference);
  await page.reload();
  check('FT-22 Continue opens the saved application and payment survives reload', await page.evaluate(([key, ref]) => JSON.parse(sessionStorage.getItem(key)).applications.find(a => a.reference === ref).simulatedPayment.referenceNumber, [KEY, payment.reference]) === recorded.simulatedPayment.referenceNumber);
  check('no browser errors', errors.length === 0);
 } finally { await browser.close(); }
 console.log(`${count}/${count} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exitCode = 1; });
