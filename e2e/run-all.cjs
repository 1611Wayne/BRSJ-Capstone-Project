// Runs every browser check in this folder against the running app and prints a summary. Exit code 0 = all passed.
const { spawnSync } = require('child_process');
const path = require('path');
const files = ['reports-and-timer.cjs', 'release-and-return.cjs', 'notifications.cjs', 'verify-page.cjs', 'staff-queue.cjs'];
const rows = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const failed = out.split('\n').filter(l => l.startsWith('FAIL') || l.startsWith('SCRIPT ERROR') || l.includes('Playwright is not installed'));
  const m = out.match(/(\d+)\/(\d+) checks passed/) || out.match(/^PASS (.*)$/m);
  rows.push([f, r.status === 0 ? 'PASS' : 'FAIL', m ? (m[2] ? m[1] + '/' + m[2] : '1/1') : 'no result']);
  if (r.status !== 0) { console.log('--- ' + f + ' ---'); console.log(failed.join('\n') || out.slice(-600)); }
}
console.log('\n' + rows.map(([f, st, n]) => st.padEnd(5) + f.padEnd(28) + n).join('\n'));
process.exit(rows.every(r => r[1] === 'PASS') ? 0 : 1);
