// The Applicant in-app notifications: sidebar badge, What's new card, inbox, read state, privacy between users.
// Needs: the app running (npm run build, then npx next start -p 3100) and Playwright installed (see e2e/README.md).
// Real-browser check of the Applicant's in-app notifications: sidebar badge, "What's new" card, inbox, read state, privacy between users.
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
const fresh = () => structuredClone({ users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: 'staff-maria' });
const as = (s, id) => ({ ...s, currentUserId: id });
const T = (s, id, cmd, when = at) => transition(as(s, id), cmd, when);
const first = mockApplications.find(a => a.reference === ref).documents[0].requirement;

// A: Staff flag one document with a note
const stateA = as(T(fresh(), 'staff-maria', { type: 'review', reference: ref, documents: mockApplications.find(a => a.reference === ref).documents.map((d, i) => i === 0 ? { ...d, status: 'Needs Replacement', note: 'The photo is too blurry to read.' } : d) }), 'resident-maria');

// B: a whole journey, five notices for Maria
let b = fresh();
b = T(b, 'staff-maria', { type: 'reject', reference: ref, reason: 'The name does not match the ID.' }, '2026-09-07T01:00:00.000Z');
b = T(b, 'resident-maria', { type: 'requestCorrection', reference: ref, message: 'Please fix my name.' }, '2026-09-07T01:10:00.000Z');
b = T(b, 'staff-maria', { type: 'resolveCorrection', reference: ref, note: 'Fixed.' }, '2026-09-07T01:20:00.000Z');
b = T(b, 'staff-maria', { type: 'assess', reference: ref, category: 'Sari-Sari Store', classification: 'Medium' }, '2026-09-07T01:30:00.000Z');
b = T(b, 'resident-maria', { type: 'receiptPhoto', reference: ref, photo }, '2026-09-07T01:40:00.000Z');
b = T(b, 'staff-maria', { type: 'returnPayment', reference: ref, reason: 'The OR number is cut off.' }, '2026-09-07T01:50:00.000Z');
b = T(b, 'resident-maria', { type: 'receiptPhoto', reference: ref, photo }, '2026-09-07T02:00:00.000Z');
b = T(b, 'staff-maria', { type: 'verifyPayment', reference: ref, orNumber: '123456', orDate: '2026-09-06', amountPaid: 600 }, '2026-09-07T02:10:00.000Z');
const stateB = as(b, 'resident-maria');

const results = [], errors = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); };
const shot = (page, n) => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png'), fullPage: true });
const setUser = (page, id) => page.evaluate(([k, id]) => { const s = JSON.parse(sessionStorage.getItem(k)); s.currentUserId = id; sessionStorage.setItem(k, JSON.stringify(s)); }, [KEY, id]);

(async () => {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
  const open = async (state) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [KEY, JSON.stringify(state)]);
    return page;
  };
  const nav = (page) => page.locator('nav[aria-label="resident navigation"]');

  // ===== A: one new notice (a flagged document, with the Staff note) =====
  let page = await open(stateA);
  await page.goto(BASE + '/resident/dashboard');
  await page.waitForSelector('h1:has-text("Welcome back")');
  check('the sidebar has a Notifications item with an unread badge of 1', (await nav(page).innerText()).includes('Notifications') && await page.locator('[aria-label="1 unread"]').count() === 1);
  let card = page.locator('section[aria-label="What\'s new"]');
  check('the dashboard shows a "What\'s new (1)" card with the plain-language notice', await card.count() === 1 && (await card.innerText()).includes('Please upload a new copy of ' + first + '. Staff note: The photo is too blurry to read.'));
  await shot(page, 'notify-1-dashboard');
  await page.goto(BASE + '/resident/notifications');
  await page.waitForSelector('h1:has-text("Notifications")');
  let body = await page.locator('main').innerText();
  check('the inbox lists it, marked New, with a link to the application', body.includes('Staff note: The photo is too blurry') && /\bNew\b/.test(body) && await page.locator('a:has-text("Open application")').count() === 1);
  await shot(page, 'notify-2-inbox');
  await page.goto(BASE + '/resident/dashboard');
  await page.waitForSelector('h1:has-text("Welcome back")');
  check('after opening the inbox, the badge and the "What\'s new" card are gone', await page.locator('[aria-label$="unread"]').count() === 0 && await page.locator('section[aria-label="What\'s new"]').count() === 0);
  await page.goto(BASE + '/resident/notifications');
  await page.waitForSelector('h1:has-text("Notifications")');
  body = await page.locator('main').innerText();
  check('the notice is still in the inbox, no longer marked New', body.includes('Please upload a new copy') && !/\bNew\b/.test(body));

  // other people see nothing
  await setUser(page, 'resident-juan');
  await page.goto(BASE + '/resident/notifications');
  await page.waitForSelector('h1:has-text("Notifications")');
  check('another Applicant sees an empty inbox (not Maria\'s notice)', (await page.locator('main').innerText()).includes('No notifications yet') && !(await page.locator('main').innerText()).includes('blurry'));
  await setUser(page, 'staff-maria');
  await page.goto(BASE + '/staff/dashboard');
  await page.waitForSelector('nav');
  check('Staff have no Notifications item (Applicants only, for now)', !(await page.locator('nav').first().innerText()).includes('Notifications'));
  await page.context().close();

  // ===== B: a whole journey =====
  page = await open(stateB);
  await page.goto(BASE + '/resident/dashboard');
  await page.waitForSelector('h1:has-text("Welcome back")');
  check('five unread notices show as a badge of 5', await page.locator('[aria-label="5 unread"]').count() === 1);
  card = page.locator('section[aria-label="What\'s new"]');
  const cardText = await card.innerText();
  check('the card shows the three newest and a "See all 5" link', /See all 5 notifications/.test(cardText) && cardText.includes('Your clearance is ready') && cardText.includes('upload your receipt again') && cardText.includes('Your assessment is ready'));
  await shot(page, 'notify-3-dashboard-journey');
  await page.click('text=See all 5 notifications');
  await page.waitForSelector('h1:has-text("Notifications")');
  const items = await page.locator('main ul > li').allInnerTexts();
  check('the inbox lists all five, newest first', items.length === 5 && /Your clearance is ready/.test(items[0]) && /upload your receipt again/.test(items[1]) && /assessment is ready/.test(items[2]) && /made the correction/.test(items[3]) && /was returned/.test(items[4]), items.map(t => t.replace(/\s+/g, ' ').slice(0, 40)).join(' | '));
  check('each is marked New on the first visit', items.every(t => /\bNew\b/.test(t)));
  check('the assessment notice has the fee and says where to pay', items[2].includes('₱600.00') && items[2].includes('Municipal Treasury'));
  check('the clearance notice says to claim the stamped original at the monitoring office', items[0].includes('monitoring office') && items[0].includes('backup'));
  await shot(page, 'notify-4-inbox-journey');
  await page.click('main ul > li:first-child a:has-text("Open application")');
  await page.waitForSelector('h1:has-text("Application Details")');
  check('"Open application" goes to that application', page.url().endsWith('/resident/applications/' + ref));

  check('no page errors or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', e.message.split('\n').slice(0, 6).join('\n')); process.exit(2); });
