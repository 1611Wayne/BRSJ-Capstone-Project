// FT-7: rating distribution and common comment words on the Admin dashboard.
require('../tests/register-ts.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { mockApplications } = require('../data/mockApplications.ts');
const { mockUsers } = require('../data/mockUsers.ts');
const { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const KEY = 'san-jose-prototype-v2', BASE = process.env.E2E_BASE || 'http://localhost:3100';
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
const entries = [
 [5, 'Fast, fast service! Ang staff ay helpful po.'],
 [4, 'Helpful staff and clear instructions.'],
 [3, 'Fast service.'],
 [2, ''],
 [1, 'Slow service; slow queue.'],
 [5, 'Clear instructions.'],
];
const seed = { users: mockUsers, applications: mockApplications.map((a,i) => ({ ...a, status: 'Closed - Cleared', feedback: { rating: entries[i][0], comment: entries[i][1], submittedAt: '2026-09-06T10:36:00+08:00' } })), schedules: mockFeeSchedules, audits: [], notifications: [], currentUserId: 'admin' };
let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); checks++; console.log('PASS ' + name); };
(async () => {
 const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([key,value]) => { if (!sessionStorage.getItem(key)) sessionStorage.setItem(key,value); }, [KEY, JSON.stringify(seed)]);
  await page.goto(BASE + '/admin/dashboard');
  const section = page.getByRole('region', { name: 'Customer Feedback Summary', exact: true });
  await section.waitFor();
  check('feedback total includes a rating without a comment', (await section.innerText()).includes('6 feedback responses') && (await section.innerText()).includes('5 with comments'));
  for (const rating of [5,4,3,2,1]) {
   const count = rating === 5 ? 2 : 1;
   check(`${rating}-star count is correct`, await section.getByRole('listitem', { name: `${rating} ${rating === 1 ? 'star' : 'stars'}: ${count} ${count === 1 ? 'response' : 'responses'}`, exact: true }).count() === 1);
  }
  const words = await section.locator('tbody tr').allTextContents();
  check('frequent words ignore case and punctuation and count repeated words', words[0].trim() === 'fast3' && words[1].trim() === 'service3');
  check('English and Filipino connecting words are excluded', words.every(row => !/^(ang|ay|po|and)\d+$/.test(row.trim())));
  check('existing average rating remains correct', (await page.locator('body').innerText()).includes('3.3/5'));
  fs.mkdirSync(path.join(__dirname,'shots'), { recursive: true });
  await section.screenshot({ path: path.join(__dirname,'shots','ft7-feedback-summary.png') });

  // Follow new data on reload; these changes affect only this isolated test tab.
  await page.evaluate(key => {
   const state = JSON.parse(sessionStorage.getItem(key));
   state.applications = state.applications.map(a => ({ ...a, feedback: undefined }));
   sessionStorage.setItem(key, JSON.stringify(state));
  }, KEY);
  await page.reload();
  await section.getByText('No feedback submitted yet.', { exact: true }).waitFor();
  check('empty feedback shows zero for every rating and an explicit empty state', await section.getByRole('listitem', { name: /: 0 responses$/ }).count() === 5 && (await section.innerText()).includes('No words to summarize yet.'));
  await page.evaluate(key => {
   const state = JSON.parse(sessionStorage.getItem(key));
   state.applications[0].feedback = { rating: 4, comment: '', submittedAt: new Date().toISOString() };
   sessionStorage.setItem(key, JSON.stringify(state));
  }, KEY);
  await page.reload();
  await section.getByText(/1 feedback response/).waitFor();
  check('a rating-only response updates counts without inventing comment words', (await section.innerText()).includes('0 with comments') && await section.getByRole('listitem', { name: '4 stars: 1 response', exact: true }).count() === 1 && (await section.innerText()).includes('No words to summarize yet.'));
  await page.setViewportSize({ width: 390, height: 844 });
  check('feedback summary fits a mobile viewport', await section.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth));
  await page.evaluate(key => { const state = JSON.parse(sessionStorage.getItem(key)); state.currentUserId = 'staff-maria'; sessionStorage.setItem(key,JSON.stringify(state)); }, KEY);
  await page.goto(BASE + '/staff/dashboard');
  await page.getByRole('heading', { name: 'Staff Dashboard', exact: true }).waitFor();
  check('feedback summary is shown only on the Admin dashboard', await page.getByRole('region', { name: 'Customer Feedback Summary', exact: true }).count() === 0);
  check('no browser errors', errors.length === 0);
  console.log(`\n${checks}/${checks} checks passed`);
 } finally { await browser.close(); }
})().catch(error => { console.error('SCRIPT ERROR', error); process.exitCode = 1; });
