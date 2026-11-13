# Browser checks (end to end)

These drive the real app in a real browser (checks that the unit tests in `tests/` cannot do): they put the app in a known state, open the
pages, click the buttons and read what is on screen. They are the checks that were run by hand during development, kept so the team can re-run them.

| File | What it checks |
|---|---|
| `reports-and-timer.cjs` | Staff verify a receipt photo (OR number, OR date, Amount Paid), then the detail page, the Daily OR Summary and the admin dashboard |
| `release-and-return.cjs` | Staff return a payment to the Applicant; Staff print the clearance for the stamp and confirm the release; the Applicant's claim-and-backup notice |
| `notifications.cjs` | The Applicant's in-app notifications: sidebar badge, "What's new" card, inbox, read state, privacy between users |
| `team-notifications.cjs` | Staff/Admin submission, correction, payment and release inboxes, role links, badges, read persistence, privacy and mobile layout |
| `verify-page.cjs` | The public verification page finds a clearance released through the receipt-photo flow |
| `staff-queue.cjs` | The Staff queue and dashboard: the renamed upload screen, the Rejected and Correction Requests tabs, the open-correction count |
| `spam-handling.cjs` | Spam rejection explanations, Staff/Admin default visibility, explicit status filters, open corrections and Applicant access |
| `admin-reversion.cjs` | Void entries excluded from daily rows and CSV; Admin clearance type and fee corrections, audit snapshots, and Staff reassessment |
| `feedback-summary.cjs` | Admin feedback counts for all star ratings, common comment words, empty and rating-only feedback, mobile layout, and Staff visibility |
| `transaction-log.cjs` | Document review times, full transaction history after reload, Admin reversion history, and monthly reversion counts by Admin in Manila time |
| `monthly-collections.cjs` | Monthly and daily collection breakdowns by subcategory and New/Renewal, saved fee components, exclusions, Manila issuance dates, peak days, CSV, and print |
| `inspection-scheduling.cjs` | Staff scheduling, rescheduling, clearing and completing inspections, upcoming/overdue lists, assessment gating, reload persistence, and internal visibility |

## How to run

1. Build and start the app (leave it running): `npm run build` then `npx next start -p 3100`.
   These checks test the **prototype** (sample data in the browser). If your `.env.local` switches on real sign-in (`NEXT_PUBLIC_AUTH_MODE=supabase`), build with it switched off for these checks, because Next.js writes that setting into the build: `NEXT_PUBLIC_AUTH_MODE= npm run build` and `NEXT_PUBLIC_AUTH_MODE= npx next start -p 3100` (in Git Bash; in PowerShell set `$env:NEXT_PUBLIC_AUTH_MODE=""` first). In real mode the public verification page asks the database, so the sample clearance is (correctly) not found.
2. Make sure the dependencies are installed: `npm install`. The project already lists `@playwright/test`, which brings the `playwright` package these scripts use. The scripts open the Edge that comes with Windows (see E2E_CHANNEL below), so no browser download is needed.
3. In another terminal: `node e2e/run-all.cjs` (all of them) or `node e2e/notifications.cjs` (one).

Settings (environment variables): `E2E_BASE` is the app address (default `http://localhost:3100`); `E2E_CHANNEL` is the browser (default `msedge`, the Edge that comes with Windows; use `chrome` for Chrome, or an empty value to use Playwright's own Chromium after `npx playwright install chromium`).

Each script prints PASS or FAIL for every check, then "N/N checks passed", and exits with 0 only if all passed. Screenshots go to `e2e/shots/` (not committed).

## Notes

- The checks build their starting state with the app's own rules (`lib/workflow.ts`), so they stay correct when the rules change; when a screen's wording changes, update the matching text in the script.
- They use the production build (`next start`), not `next dev`.
- They do not touch Supabase: the prototype keeps its data in the browser tab.
