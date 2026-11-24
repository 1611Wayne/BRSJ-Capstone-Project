// FT-15 (Treasury and barangay samples, 2026-11-24): Staff type the OR number as on the Treasury receipt ("NO. RZL
// 26662152"); it is saved as the number only. An optional Plate No. for Business and TODA. The clearance PDF shows, at the
// bottom right as on the barangay's own clearance: O.R. NO., Amount, Plate No., Date Issued and Place Issued (blank),
// with no CTC lines and no thumb-mark box.
const path = require('path');
const FE = path.resolve(__dirname, '..') + '/';
require(FE + 'tests/register-ts.cjs');
const assert = require('node:assert/strict');
const fs = require('fs');
const { transition } = require(FE + 'lib/workflow.ts');
const { mockApplications } = require(FE + 'data/mockApplications.ts');
const { mockUsers } = require(FE + 'data/mockUsers.ts');
const { mockFeeSchedules } = require(FE + 'data/mockFeeSchedules.ts');
const { chromium } = require('playwright');
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge', BASE = process.env.E2E_BASE || 'http://localhost:3100', KEY = 'san-jose-prototype-v2';
const at = '2026-09-07T02:30:12.000Z', ref = 'SJ-2026-000123';
const photo = { requirement: 'Official Receipt', name: 'or.jpg', size: 1000, type: 'image/jpeg', status: 'Pending Review' };
const as = (s, id) => ({ ...s, currentUserId: id });
const fresh = structuredClone({ users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: 'staff-maria' });
const assessed = transition(fresh, { type: 'assess', reference: ref, category: 'Sari-Sari Store', classification: 'Medium' }, at);
const resident = assessed.applications.find(a => a.reference === ref).residentId;
const checking = as(transition(as(assessed, resident), { type: 'receiptPhoto', reference: ref, photo }, at), 'staff-maria');
let checks = 0; const check = (name, ok, detail = '') => { assert.ok(ok, name + (detail ? ' -> ' + detail : '')); checks++; console.log('PASS ' + name); };
(async () => {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
  try {
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [KEY, JSON.stringify(checking)]);
    const saved = () => page.evaluate(k => JSON.parse(sessionStorage.getItem(k)), KEY);
    await page.goto(BASE + '/staff/applications/' + ref);
    const or = page.getByLabel(/Official Receipt \(OR\) Number/);
    await or.waitFor();
    await or.fill('2666215');
    check('a number that is not 8 digits yet is flagged while typing', await page.getByText('That is not 8 digits yet.').count() === 1);
    await or.fill('NO. RZL 26662152');
    check('typing it as printed ("NO. RZL 26662152") shows what will be saved', await page.getByText('Saved as 26662152.').count() === 1);
    await page.getByLabel(/^OR Date/).fill('2026-09-06');
    await page.getByLabel(/^Amount Paid/).fill('500');
    const plate = page.getByLabel(/^Plate No\./);
    check('a Business Clearance has an optional Plate No. box', await plate.count() === 1);
    await plate.fill('SJ-0042');
    await page.getByRole('button', { name: 'Verify Payment', exact: true }).click();
    await page.getByText('OR Number:').waitFor({ timeout: 10000 });
    const a = (await saved()).applications.find(x => x.reference === ref);
    check('saved as the number only, with the plate, and the clearance is ready', a.receipt.orNumber === '26662152' && a.plateNumber === 'SJ-0042' && a.status === 'Ready for Download', JSON.stringify([a.receipt.orNumber, a.plateNumber, a.status]));

    // The Applicant downloads the clearance; read the bottom block from the PDF.
    await page.evaluate(([k, id]) => { const s = JSON.parse(sessionStorage.getItem(k)); s.currentUserId = id; sessionStorage.setItem(k, JSON.stringify(s)); }, [KEY, resident]);
    await page.goto(BASE + '/resident/apply/ready?ref=' + ref);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download Clearance PDF/ }).click();
    const pdf = fs.readFileSync(await (await pending).path(), 'latin1');
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'shots', 'ft15-clearance.pdf'), pdf, 'latin1');
    const has = t => pdf.includes('(' + t + ')');
    check('PDF: O.R. NO. : 26662152', has('O.R. NO. :') && has('26662152'));
    check('PDF: Amount: Php 500.00', has('Amount:') && has('Php 500.00'));
    check('PDF: Plate No. : SJ-0042', has('Plate No. :') && has('SJ-0042'));
    check('PDF: Date Issued and Place Issued (left blank to fill in)', has('Date Issued:') && has('Place Issued:'));
    check('PDF: no CTC lines and no thumb-mark box', !has('CTC No.:') && !has('Thumb mark') && !has('Issued at:'));
    check('PDF: the block is on the right (labels at x = 330)', /330 \d+(\.\d+)? Td \(O\.R\. NO\. :\)/.test(pdf));
    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally { await browser.close(); }
  console.log(`\n${checks}/${checks} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', e.message); process.exitCode = 1; });
