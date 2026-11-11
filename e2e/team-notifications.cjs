// FT-10: shared inboxes, role-specific links, unread persistence and recipient privacy.
require('../tests/register-ts.cjs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { transition } = require('../lib/workflow.ts');
const { mockApplications } = require('../data/mockApplications.ts');
const { mockUsers } = require('../data/mockUsers.ts');
const { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const BASE = process.env.E2E_BASE || 'http://localhost:3100', CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
const KEY = 'san-jose-prototype-v2', ref = 'SJ-2026-000123', at = '2026-11-11T01:00:00.000Z';
let seed = structuredClone({ users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: 'resident-maria' });
const act = (id, command, minute) => { seed = transition({ ...seed, currentUserId: id }, command, at.replace('01:00:', `01:${String(minute).padStart(2, '0')}:`)); };
act('resident-maria', { type: 'saveApplication', application: seed.applications[0], draft: false }, 0);
act('resident-maria', { type: 'requestCorrection', reference: ref, message: 'FT-10 test correction' }, 1);
act('staff-maria', { type: 'resolveCorrection', reference: ref, note: 'Checked' }, 2);
act('staff-maria', { type: 'assess', reference: ref, category: 'Sari-Sari Store', classification: 'Medium' }, 3);
act('resident-maria', { type: 'receiptPhoto', reference: ref, photo: { requirement: 'OR', name: 'receipt.jpg', type: 'image/jpeg', size: 100, status: 'Pending Review' } }, 4);
act('staff-maria', { type: 'verifyPayment', reference: ref, orNumber: 'FT10-123', orDate: '2026-09-06', amountPaid: 600 }, 5);
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log('PASS ' + name); };
(async () => {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, value); }, [KEY, JSON.stringify(seed)]);
    const switchUser = async id => page.evaluate(([key, id]) => { const s = JSON.parse(sessionStorage.getItem(key)); s.currentUserId = id; sessionStorage.setItem(key, JSON.stringify(s)); }, [KEY, id]);
    await page.goto(`${BASE}/staff/dashboard`);
    await page.getByRole('navigation', { name: 'staff navigation' }).waitFor();
    for (const [role, id] of [['staff', 'staff-maria'], ['admin', 'admin']]) {
      await switchUser(id);
      await page.goto(`${BASE}/${role}/dashboard`);
      const nav = page.getByRole('navigation', { name: `${role} navigation` });
      await nav.waitFor();
      check(`${role} has an inbox and unread badge`, await nav.getByRole('link', { name: /Notifications/ }).count() === 1 && await nav.getByLabel('4 unread', { exact: true }).count() === 1);
      const card = page.getByRole('region', { name: "What's new" });
      await card.waitFor();
      check(`${role} dashboard previews three newest notices`, (await card.innerText()).includes('See all 4 notifications') && (await card.innerText()).includes('official stamp'));
      await card.getByRole('link').click();
      await page.getByRole('heading', { name: 'Notifications', exact: true }).waitFor();
      const items = page.locator('main ul > li');
      await page.waitForFunction(key => JSON.parse(sessionStorage.getItem(key)).notifications.filter(n => n.userId === JSON.parse(sessionStorage.getItem(key)).currentUserId).every(n => n.readAt), KEY);
      check(`${role} inbox lists all four team events`, await items.count() === 4 && (await items.allInnerTexts()).every(t => /New/.test(t)));
      check(`${role} sees no Applicant-only wording`, !(await page.locator('main').innerText()).includes('Your assessment is ready'));
      check(`${role} links stay in its own portal`, (await items.locator('a').evaluateAll(links => links.map(a => a.getAttribute('href')))).every(href => href.startsWith(`/${role}/applications/`)));
      if (role === 'staff') check('reading Staff inbox leaves Admin notices unread', await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).notifications.filter(n => n.userId === 'admin').every(n => !n.readAt), KEY));
      await items.first().getByRole('link').click();
      await page.getByRole('heading', { name: 'Application Details', exact: true }).waitFor();
      check(`${role} opens the correct transaction`, page.url().endsWith(`/${role}/applications/${ref}`));
      await page.goto(`${BASE}/${role}/notifications`);
      await page.getByRole('heading', { name: 'Notifications', exact: true }).waitFor();
      check(`${role} read history survives reload`, await page.locator('main ul > li').count() === 4 && !(await page.locator('main ul').innerText()).includes('New\n'));
      check(`${role} unread badge clears`, await page.getByRole('navigation', { name: `${role} navigation` }).locator('[aria-label$=" unread"]').count() === 0);
    }
    await switchUser('resident-maria');
    await page.goto(`${BASE}/resident/notifications`);
    await page.getByRole('heading', { name: 'Notifications', exact: true }).waitFor();
    check('Applicant inbox retains only Applicant notices', await page.locator('main ul > li').count() === 3 && !(await page.locator('main').innerText()).includes('New application'));
    await switchUser('staff-pedro');
    await page.goto(`${BASE}/staff/notifications`);
    await page.getByRole('heading', { name: 'Notifications', exact: true }).waitFor();
    check('another Staff member has independent unread history', await page.locator('main ul > li').count() === 4 && (await page.locator('main ul > li').allInnerTexts()).every(t => /New/.test(t)));
    await page.setViewportSize({ width: 390, height: 844 });
    check('mobile inbox has no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check('no browser errors', errors.length === 0);
  } finally { await browser.close(); }
  console.log(`\n${checks}/${checks} checks passed`);
})().catch(e => { console.error('SCRIPT ERROR', e.stack); process.exit(1); });
