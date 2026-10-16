// Staff return a payment to the Applicant; Staff print the clearance for the stamp and confirm the release; the Applicant claim-and-backup notice.
// Needs: the app running (npm run build, then npx next start -p 3100) and Playwright installed (see e2e/README.md).
// Real-browser check of: (1) Staff return a payment to the Applicant, (2) Staff print the clearance for the stamp and confirm the release,
// (3) the Applicant's Ready screen says the stamped original is claimed at the monitoring office and the PDF is a backup.
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

const at = '2026-09-07T02:30:12.000Z', ref = 'SJ-2026-000123', KEY = 'san-jose-prototype-v2', BASE = BASE_URL;
const photo = { requirement: 'Official Receipt', name: 'or.jpg', size: 1000, type: 'image/jpeg', status: 'Pending Review' };
const fresh = () => structuredClone({ users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], currentUserId: 'staff-maria' });
const as = (s, id) => ({ ...s, currentUserId: id });
const assessed = () => transition(fresh(), { type: 'assess', reference: ref, category: 'Sari-Sari Store', classification: 'Medium' }, at);
const checking = () => transition(as(assessed(), 'resident-maria'), { type: 'receiptPhoto', reference: ref, photo }, at);
const ready = () => transition(as(checking(), 'staff-maria'), { type: 'verifyPayment', reference: ref, orNumber: '123456', orDate: '2026-09-06', amountPaid: 600 }, at);

const results = [], errors = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); };
const shot = (page, n) => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png'), fullPage: true });
const lastAudit = (page) => page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)).audits[0].action, KEY);
const setUser = (page, id) => page.evaluate(([k, id]) => { const s = JSON.parse(sessionStorage.getItem(k)); s.currentUserId = id; sessionStorage.setItem(k, JSON.stringify(s)); }, [KEY, id]);

(async () => {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
  const open = async (state) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [KEY, JSON.stringify(state)]);
    return page;
  };

  // ===== 1. Return a payment to the Applicant =====
  let page = await open(as(checking(), 'staff-maria'));
  await page.goto(BASE + '/staff/applications/' + ref);
  await page.waitForSelector('h2:has-text("Payment Verification")');
  const ret = page.locator('button:has-text("Return to Applicant")');
  check('Staff see a "Return to Applicant" button in the payment panel', await ret.count() === 1);
  check('it stays disabled until a reason is typed', await ret.isDisabled());
  await page.fill('textarea[placeholder^="Tell the Applicant"]', 'The OR number is cut off. Please upload a clearer photo.');
  check('enabled once there is a reason', await ret.isEnabled());
  await shot(page, 'release-1-return-form');
  await ret.click();
  await page.waitForSelector('text=Correction needed');
  let body = await page.locator('body').innerText();
  check('the request goes back to Awaiting OR with the reason shown', /Awaiting OR/.test(body) && body.includes('The OR number is cut off'));
  check('the return is in the audit trail', (await lastAudit(page)) === 'Payment returned for correction');
  check('the verify and return forms are gone (nothing left to verify)', await page.locator('button:has-text("Verify Payment")').count() === 0);

  await setUser(page, 'resident-maria');
  await page.goto(BASE + '/resident/applications');
  await page.waitForSelector('table');
  const row = page.locator('tr', { hasText: ref });
  const rowText = (await row.first().innerText()).replace(/\s+/g, ' ');
  check('the Applicant\'s queue says "Upload Receipt Again"', rowText.includes('Upload Receipt Again'), rowText.slice(0, 120));
  check('the old "Enter OR" wording is gone', !rowText.includes('Enter OR'));
  await page.goto(BASE + '/resident/applications/' + ref);
  await page.waitForSelector('text=Correction needed');
  check('the Applicant sees why, in plain words', (await page.locator('body').innerText()).includes('Please resubmit your payment evidence'));
  await page.goto(BASE + '/resident/apply/or?ref=' + ref);
  await page.waitForSelector('h1');
  body = await page.locator('body').innerText();
  check('the Applicant can reach the receipt upload step again', /Pay at Municipal Treasury|Upload Receipt Photo/.test(body));
  await page.context().close();

  // ===== 2. Staff print the clearance for the stamp and confirm the release =====
  page = await open(ready());
  await page.goto(BASE + '/staff/applications');
  await page.waitForSelector('table');
  check('the Staff queue shows "Release Clearance" for a clearance that is ready', (await page.locator('tr', { hasText: ref }).first().innerText()).includes('Release Clearance'));
  await page.goto(BASE + '/staff/applications/' + ref);
  await page.waitForSelector('h2:has-text("Release the printed clearance")');
  body = await page.locator('body').innerText();
  check('the panel explains the stamp and the backup copy', /official stamp/.test(body) && /backup/.test(body));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Print Clearance")')]);
  check('Print Clearance downloads the clearance PDF', dl.suggestedFilename() === ref + '-clearance.pdf', dl.suggestedFilename());
  check('the print is logged in the audit trail', (await lastAudit(page)) === 'Clearance printed by Staff for the official stamp');
  check('printing does not close the request', /Ready for Download/.test(await page.locator('body').innerText()));
  await shot(page, 'release-2-staff-panel');
  await page.click('button:has-text("Confirm Release")');
  await page.waitForSelector('h2:has-text("Clearance released")');
  body = await page.locator('body').innerText();
  check('Confirm Release closes the request (Closed - Cleared)', /Closed - Cleared/.test(body));
  check('it records who handed it over', body.includes('recorded by Staff (Maria Staff) at the counter'));
  check('the release is in the audit trail', (await lastAudit(page)) === 'Release confirmed by Staff for the Applicant');
  check('total processing duration now has a value (submission to confirmation)', /Total Processing Duration \(MM:SS\)\s*\d+:\d\d/.test(body));
  check('a replacement copy can still be printed after release', await page.locator('button:has-text("Print Clearance")').count() === 1);
  await shot(page, 'release-3-after-confirm');
  await page.context().close();

  // ===== 3. The Applicant's Ready screen =====
  page = await open(as(ready(), 'resident-maria'));
  await page.goto(BASE + '/resident/apply/ready?ref=' + ref);
  await page.waitForSelector('text=Clearance Ready for Download');
  body = await page.locator('body').innerText();
  check('the Ready screen says the stamped original is released at the monitoring office', /official stamp, is released at the monitoring office/.test(body));
  check('it tells the Applicant to bring the reference number', body.includes('Bring your Request Reference Number (' + ref + ')'));
  check('it says the PDF is a backup that can be checked by QR', /backup in case the original is lost or damaged/.test(body) && /scanning its QR code/.test(body));
  check('the Confirm Receipt hint says to confirm only after receiving the original', /Confirm only after you have received the printed original/.test(body));
  await shot(page, 'release-4-applicant-ready');

  check('no page errors or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', e.message.split('\n').slice(0, 6).join('\n')); process.exit(2); });
