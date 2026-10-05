const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const baseURL = process.env.CAPTURE_URL || 'http://localhost:3000';
// Wait this many seconds on each page before taking its screenshot.
const screenshotDelaySeconds = 5;
// Extra wait after the first page opens, before its screenshot.
const firstScreenshotExtraDelaySeconds = 7;
const output = path.join(__dirname, 'screenshots');
const captures = [], failures = [];

function routes(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return routes(path.join(directory, entry.name), `${prefix}/${entry.name}`);
    return entry.name === 'page.tsx' ? [prefix || '/'] : [];
  });
}

async function capture(page, route, role) {
  const filename = `${role}-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'homepage'}.png`;
  try {
    const response = await page.goto(new URL(route, baseURL).href);
    if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
    if (captures.length === 0) {
      console.log(`Waiting ${firstScreenshotExtraDelaySeconds} extra seconds for the first screenshot...`);
      await page.waitForTimeout(firstScreenshotExtraDelaySeconds * 1000);
    }
    await page.locator('h1').first().waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(screenshotDelaySeconds * 1000);
    if (new URL(page.url()).pathname !== new URL(route, baseURL).pathname) throw new Error(`Redirected to ${page.url()}`);
    await page.screenshot({ path: path.join(output, filename), fullPage: true, animations: 'disabled' });
    captures.push({ role, route, filename });
    console.log(`Saved ${filename}`);
  } catch (error) {
    failures.push({ role, route, error: error.message });
    console.error(`Failed ${route}: ${error.message}`);
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const allRoutes = routes(path.join(__dirname, 'app'));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const account of [
      { role: 'public' },
      { role: 'resident', email: 'maria@example.com', password: 'resident123' },
      { role: 'staff', email: 'staff@san-jose.gov', password: 'staff123' },
      { role: 'admin', email: 'admin@san-jose.gov', password: 'admin123' },
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      try {
        let records = [];
        if (account.email) {
          await page.goto(new URL('/login', baseURL).href);
          await page.locator('input[name="email"]').fill(account.email);
          await page.locator('input[name="password"]').fill(account.password);
          await page.getByRole('button', { name: 'Login', exact: true }).click();
          await page.waitForURL(`**/${account.role}/dashboard`);
          const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('san-jose-prototype-v2')));
          records = state.applications.filter(a => account.role !== 'resident' || a.residentId === state.currentUserId);
        }
        const selected = allRoutes.filter(route => account.role === 'public'
          ? !/^\/(resident|staff|admin)(\/|$)/.test(route)
          : route.startsWith(`/${account.role}/`));
        for (const route of selected) {
          if (route.includes('[reference]')) {
            await capture(page, route.replace('[reference]', 'SJ-2026-000125'), account.role);
          } else if (route.includes('[id]')) {
            const applicable = route.includes('/assessment/') ? records.filter(a => a.status === 'Pending Assessment') : records;
            for (const record of applicable) await capture(page, route.replace('[id]', record.reference), account.role);
          } else {
            await capture(page, route, account.role);
            if (/\/(pre-assessment|or|ready|or-entry)$/.test(route)) {
              const ready = route.endsWith('/ready');
              for (const record of records.filter(a => ready
                ? ['Ready for Download', 'Closed - Cleared'].includes(a.status)
                : a.status === 'Awaiting OR')) {
                await capture(page, `${route}?ref=${record.reference}`, account.role);
              }
            }
          }
        }
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'capture-report.json'), JSON.stringify({ captures, failures }, null, 2));
  }
  console.log(`\nFinished: ${captures.length} screenshots saved to ${output}. ${failures.length} failures.`);
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(`Capture stopped: ${error.message}\nMake sure npm.cmd run dev is running and Chromium is installed.`);
  process.exitCode = 1;
});
