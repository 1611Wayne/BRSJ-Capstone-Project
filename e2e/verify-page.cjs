// The public clearance verification page finds a clearance released through the receipt-photo flow.
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
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge'; // '' = Playwright's own Chromium; 'chrome' = installed Chrome
const BASE_URL = process.env.E2E_BASE || 'http://localhost:3100';
fsx.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
const at = '2026-09-07T02:30:12.000Z', ref = 'SJ-2026-000123', photo = { requirement: 'Official Receipt', name: 'or.jpg', size: 1000, type: 'image/jpeg', status: 'Pending Review' };
let s = structuredClone({ users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: 'staff-maria' });
s = transition(s, { type: 'assess', reference: ref, category: 'Sari-Sari Store', classification: 'Medium' }, at);
s = transition({ ...s, currentUserId: 'resident-maria' }, { type: 'receiptPhoto', reference: ref, photo }, at);
s = transition({ ...s, currentUserId: 'staff-maria' }, { type: 'verifyPayment', reference: ref, orNumber: '123456', orDate: '2026-09-06', amountPaid: 600 }, at);
(async () => {
  const b = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true }); const p = await (await b.newContext()).newPage();
  await p.addInitScript(([k, v]) => sessionStorage.setItem(k, v), ['san-jose-prototype-v2', JSON.stringify({ ...s, currentUserId: null })]);
  await p.goto(BASE_URL + '/verify/' + ref);
  await p.waitForFunction(() => !document.body.innerText.includes('Loading verification record'));
  const ok = /VALID CLEARANCE/i.test(await p.locator('main').innerText());
  console.log(ok ? 'PASS' : 'FAIL', 'public verify page finds a receipt-photo clearance on this build');
  await b.close(); process.exit(ok ? 0 : 1);
})();
