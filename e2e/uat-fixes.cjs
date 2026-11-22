// Fixes from the UAT notes of 2026-11-23 (sample mode): no floating Logout on phones (Logout stays in the menu drawer);
// the top-bar search shows on phones and finds EVERY request (Rejected / Void and old dates too); the public pages show
// "My Dashboard" to someone signed in (the ? icon no longer looks like a logout); the Admin feedback tables fit a phone.
// (Logout signing out only this browser, and the "Checking that you are not a robot…" button, need real sign-in:
// QA/live/repro_two_browsers.cjs checks them on the live site.)
require('../tests/register-ts.cjs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mockApplications } = require('../data/mockApplications.ts'), { mockUsers } = require('../data/mockUsers.ts'), { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const KEY = 'san-jose-prototype-v2', BASE = process.env.E2E_BASE || 'http://localhost:3100', CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
const old = { ...mockApplications[0], reference: 'SJ-2024-000777', applicant: 'Rosario Old Rejected', status: 'Rejected', dateRequested: '2024-03-01T08:00:00+08:00', rejection: { reason: 'Test', rejectedBy: 'Maria Staff', timestamp: '2024-03-02T08:00:00+08:00' }, assessment: undefined, receipt: undefined, clearance: undefined, confirmation: undefined, feedback: undefined };
const seed = id => ({ users: mockUsers, applications: [...mockApplications, old], schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: id });
let checks = 0; const check = (name, ok, detail = '') => { assert.ok(ok, name + (detail ? ' -> ' + detail : '')); checks++; console.log('PASS ' + name); };
(async () => {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
  try {
    const open = async (id, viewport) => { const p = await (await browser.newContext({ viewport })).newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message)); await p.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [KEY, JSON.stringify(seed(id))]); return { p, errors }; };
    const phone = { width: 390, height: 844 };

    // Staff on a phone.
    const { p: s, errors: se } = await open('staff-maria', phone);
    await s.goto(BASE + '/staff/dashboard'); await s.getByRole('button', { name: 'Open navigation' }).waitFor();
    check('phone: no floating Logout button on the screen', await s.locator('.mobile-logout').count() === 0 && await s.getByRole('button', { name: /^Logout$/ }).filter({ visible: true }).count() === 0);
    await s.getByRole('button', { name: 'Open navigation' }).click();
    check('phone: Logout is in the menu drawer', await s.locator('aside').getByRole('button', { name: /Logout/ }).isVisible());
    await s.locator('aside').getByRole('button', { name: 'Close navigation' }).click();
    const search = s.getByRole('searchbox', { name: 'Search all requests' }).or(s.getByLabel('Search all requests'));
    check('phone: the top-bar search is visible', await search.first().isVisible());
    await search.first().fill('Rosario Old'); await search.first().press('Enter');
    await s.waitForURL('**/staff/applications?q=*');
    await s.getByText('SJ-2024-000777').first().waitFor({ timeout: 10000 }).catch(() => {});
    check('the top-bar search finds a Rejected request from 2024 (all statuses, any date)', await s.getByText('SJ-2024-000777').count() > 0);
    check('...because the list opened with Rejected / Void included', await s.getByLabel('Include Rejected and Void').isChecked());
    check('phone: the page does not scroll sideways', await s.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await s.goto(BASE + '/staff/applications'); await s.getByLabel('Include Rejected and Void').waitFor();
    check('opening the queue normally still hides Rejected / Void', !(await s.getByLabel('Include Rejected and Void').isChecked()) && await s.getByText('SJ-2024-000777').count() === 0);

    // The ? icon and the public pages.
    await s.goto(BASE + '/information'); await s.getByRole('link', { name: 'My Dashboard' }).waitFor({ timeout: 10000 });
    check('signed in: the public page shows My Dashboard, not Login / Register', await s.getByRole('link', { name: 'Login', exact: true }).count() === 0 && await s.getByRole('link', { name: 'Register', exact: true }).count() === 0);
    await s.getByRole('link', { name: 'My Dashboard' }).click(); await s.waitForURL('**/staff/dashboard');
    check('...and My Dashboard goes back to the Staff dashboard', new URL(s.url()).pathname === '/staff/dashboard');
    const { p: pub } = await open(null, phone);
    await pub.goto(BASE + '/information');
    check('signed out: Login and Register as before', await pub.getByRole('link', { name: 'Login', exact: true }).count() === 1 && await pub.getByRole('link', { name: 'My Dashboard' }).count() === 0);

    // Admin dashboard feedback tables on a phone.
    const { p: a, errors: ae } = await open('admin', phone);
    await a.goto(BASE + '/admin/dashboard'); await a.getByRole('region', { name: 'Monthly Feedback Trend' }).waitFor({ timeout: 15000 });
    check('phone: the Admin dashboard does not scroll sideways', await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await a.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));
    for (const name of ['Average Rating by Clearance Type', 'Monthly Feedback Trend']) {
      const box = await a.getByRole('region', { name }).boundingBox();
      check(`phone: "${name}" fits the screen (its table scrolls inside it)`, box && box.x >= 0 && box.x + box.width <= phone.width + 1, JSON.stringify(box));
    }
    check('no page errors', se.length === 0 && ae.length === 0, [...se, ...ae].join(' | '));
  } finally { await browser.close(); }
  console.log(`\n${checks}/${checks} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', e.message); process.exitCode = 1; });
