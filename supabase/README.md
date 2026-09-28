# San Jose Clearance Portal — Database

**Status: IN PROGRESS — schema confirmed working 2026-09-23, sender-name approval pending as of 2026-09-28.** This is the Supabase/Vercel side of the project (decided 2026-09-22, replacing the standalone-Express box in the original architecture diagram — server logic goes into Next.js routes instead). All four migrations have been run against a real Supabase project: all 19 tables exist, the auto-profile trigger was tested and works, and RLS is confirmed enabled on every table (policies written for `profiles` and `applications`; the other 17 tables are a deliberate follow-up). The decision log this folder was built from (`CHANGES.md`, `FEATURE_CHECKLIST.md`) lives outside this repo for now — ask whoever pushed this branch for a copy if you need the full history.

This folder was developed as a sibling project (`Capstone-supabase/`) and is merged into this frontend repo's `supabase/` folder on the `supabase-backend` branch so the migrations, the SMS hook function, and the frontend live together going forward. It stays independent of any particular frontend framework choice — it's Supabase project setup, not app code.

**Not included here, on purpose:** the `sms-test/` folder that was used to test the Semaphore wiring end-to-end — both of its scripts had a real Semaphore API key, a real phone number, and the project's anon key filled in locally, so they were kept out of git rather than scrubbed and re-added. See "SMS provider test" below for what those scripts did and how to recreate them if you need to re-test.

## What's here

Two migrations, run in order (each file is numbered so the order is unambiguous):

**`supabase/migrations/20260922000000_init_schema.sql`** — the initial schema: 18 tables matching `Entity-Relationship Diagram.png` (Capstone root), plus:
- `clearance_types` extended with `short_name`, `description`, `icon`, `active` (the ERD only showed `id`/`name`; the rest already exists hard-coded in the frontend and needed a real home per the "nothing hard-coded" rule).
- A trigger that auto-creates a `profiles` row the moment someone finishes SMS OTP sign-up (the standard Supabase pattern for this).
- Row Level Security turned on for every table, no policies yet — this is deliberate, not missing. See the comment block at the top of the SQL file for the full list of every place this deviates from the ERD screenshot and why.

**`supabase/migrations/20260923000000_correction_requests.sql`** — one new table, `correction_requests`, so a resident can flag something wrong on their own submitted application in their own words, for staff to act on. Not part of the ERD screenshot — added after a conversation about what happens when a resident makes a mistake after submitting. See the comment block at the top of that file for the two small judgment calls made in it (one-open-request-at-a-time, and requiring who/when if marked resolved).

**`supabase/migrations/20260923010000_seed_clearance_types.sql`** — loads the 13 clearance types into `clearance_types`. Names come straight from the paper's Scope (Ch. 1.4), not guessed. Deliberately does **not** seed fees, categories, or classifications — the only numbers anywhere in this project for those are explicitly illustrative, not the real Revenue Code, and seeding them risks them being mistaken for real data later.

**`supabase/migrations/20260923020000_rls_policies_profiles_applications.sql`** — real RLS policies for `profiles` and `applications`, the two most ownership-scoped tables (the other 17 are a deliberate follow-up, not an oversight). Confirms: a resident sees/touches only their own rows; staff can see broadly but doesn't get blanket write access to other accounts; admin manages everything except other admin accounts. Two real gaps were found and fixed while writing this — see the comment block at the top of the file, and the explanation the user was walked through in chat.

Read the comment block at the top of each SQL file before running it — they explain every judgment call.

## SMS provider test (not in this repo — recreate locally if you need it)

These two scripts existed in the original `Capstone-supabase/sms-test/` folder and were **not** copied into this repo, because both had a real Semaphore API key, a real phone number, and the project's Supabase anon key filled in directly in the file. Recreate them locally (never commit the filled-in versions) if you need to re-test:

- **`test-semaphore.js`** — a standalone script that sends one real text message through Semaphore's API directly, to prove the provider itself works before it's wired into anything. Does not touch Supabase, Next.js, or this schema at all — on purpose, to isolate "does Semaphore work" from "does the whole OTP flow work" as two separate, smaller questions. Needs a Semaphore account, a little credit, and an API key pasted into the file before running with `node test-semaphore.js`. Request body: form-urlencoded `apikey`, `number` (`09XXXXXXXXX` format), `message`, POSTed to `https://semaphore.co/api/v4/messages`.
- **`test-otp-flow.js`** — the bigger, end-to-end test: calls `POST {SUPABASE_URL}/auth/v1/otp` with `{ phone }` (E.164 format, e.g. `+639...`) using the project's anon/publishable key, waits for you to type in the code from the text you receive, then calls `POST {SUPABASE_URL}/auth/v1/verify` with `{ type: "sms", phone, token }` to complete the sign-in. Only run this after the "Wiring Semaphore into Supabase Auth" section below is done. Never put the service_role/secret key in a script like this — only the anon key, which is designed to be public.

## Wiring Semaphore into Supabase Auth

**Status: written, not yet deployed or tested.** The code is `supabase/functions/send-sms-hook/index.ts`. When Supabase needs to text someone a sign-in code, it calls this function; the function checks the call genuinely came from Supabase (a signature check — the part that stops a stranger who finds the URL from sending texts on your Semaphore credit) and then hands the code to Semaphore.

You'll need: your Semaphore API key (with some credit on the account), and the Supabase project you already have. **Do the Semaphore part first and confirm a text arrives using `sms-test/test-semaphore.js`** before touching any of the steps below — that way, if something fails later, you already know Semaphore itself works. Semaphore's own docs say sending fails with an error if the account has **no registered sender name**, and they don't say whether a brand-new account gets a default one; if the plain test errors about a sender name, that is the thing to sort out with Semaphore first (and it may involve an approval wait, so do it early).

### Steps (all in the Supabase dashboard — no installs)

1. **Create the function.** Left sidebar → **Edge Functions** → **Deploy a new function** → **Via Editor**. Name it `send-sms-hook` (the folder name in this repo). The name only decides the function's web address (`.../functions/v1/<name>`), so any name works as long as the hook URL in step 4 uses the same one — the user's deployed function is actually named `sms-text-handler`, so read `send-sms-hook` as `sms-text-handler` everywhere below (the URL, the logs page). If this is ever deployed from the command line instead, the command must use whichever name the hook URL points at. Delete the sample code in the editor, paste in the entire contents of `supabase/functions/send-sms-hook/index.ts`, and deploy.
2. **Turn off "Verify JWT" for this function.** Open the function's settings/details and switch that option **off**. This one matters: by default, Supabase rejects any call that doesn't carry a logged-in user's token, and Supabase's own hook calls don't carry one — so with it on, every call fails with a `401` before the code even runs. Turning it off is safe *here* because the function does its own, stricter check (the signature). (Source: Supabase's own hook calls send no Authorization header — [Supabase discussion #37717](https://github.com/orgs/supabase/discussions/37717).)
3. **Save your Semaphore key as a secret.** Edge Functions → **Secrets** → add a new secret named `SEMAPHORE_API_KEY`, value = your Semaphore API key. (Secrets are how the function gets the key without it being written in the code. The code only ever contains the secret's *name*, e.g. `Deno.env.get('SEMAPHORE_API_KEY')` — never replace that name with the key itself, or the function will look for a secret named after the key, not find it, and fail with "SEMAPHORE_API_KEY is not set". The same goes for `SEND_SMS_HOOK_SECRET`.)
4. **Point Supabase Auth at the function.** **Authentication** → **Hooks** → **Send SMS**. Choose the HTTPS option and use this URL, with your own project reference in the middle: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-sms-hook`. (Your project reference is the short code in your dashboard's address bar, or under Project Settings → General.) Supabase will then show a **signing secret** starting with `v1,whsec_` — **copy it immediately**, it may only be shown once.
5. **Save that signing secret too.** Back in Edge Functions → Secrets, add another secret named `SEND_SMS_HOOK_SECRET`, value = the whole thing you just copied, including the `v1,whsec_` at the start.
6. **Turn on phone sign-in.** **Authentication** → **Sign In / Providers** (the menu name has changed over time) → **Phone** → enable it. The panel will show Twilio fields, but with the hook enabled a banner says "SMS provider settings are disabled while the SMS hook is enabled" — leave every Twilio field blank (confirmed from a real screenshot, 2026-09-24). **Save the settings** (forgetting to is what caused `phone_provider_disabled` the first time). Leave the code length at 6 and "Enable phone confirmations" on. Consider raising **SMS OTP Expiry** from 60 seconds to around 300 — 60 is easy to miss with a slow text or slow typing.
7. **Run the test.** Open `sms-test/test-otp-flow.js`, fill in the three values at the top (instructions are in the file), then `node test-otp-flow.js` from that folder. A text should arrive; type the code back in.

### If it doesn't work

- **First, read the status number in the error `test-otp-flow.js` prints** ("Unexpected status code returned from hook: ___"). Since the 2026-09-24 revision of the function, each kind of failure has its own number:
  - `401` → **Verify JWT** is still on for this function (step 2). The function's code never ran. Check it again after any redeploy — redeploying can reset it.
  - `403` → the signature check failed: `SEND_SMS_HOOK_SECRET` doesn't match the secret Supabase showed for the hook. Copy it again, whole, including `v1,whsec_`.
  - `502` → the function worked and **Semaphore refused the message**. While the sender name is unapproved, this is the expected result — the reason is in the logs.
  - `500` → a problem on our side: `SEND_SMS_HOOK_SECRET` or `SEMAPHORE_API_KEY` is missing or misspelled (steps 3 and 5), or the function crashed. The logs say which.
  - No error → the text was sent.
- **Then read the function's logs:** Edge Functions → `send-sms-hook` → **Logs**, right after a test run. Every failure now writes its reason there (never the code or the phone number — logs are visible to everyone on the project). Note: the *first* version of the function did not log its reasons at all, so if you deployed that one, re-paste the current `index.ts` and redeploy.
- `Semaphore rejected the request` in the logs → the message after it says why: no approved sender name yet, no credit, a wrong key, or a number Semaphore doesn't accept. Running the plain `test-semaphore.js` from earlier will tell you whether Semaphore itself is the problem.
- Supabase says "rate limit" → it deliberately limits how often it will text the same number; wait a minute and try again. Each attempt also spends real Semaphore credit, so don't loop it.
- `phone_provider_disabled` / "Unsupported phone provider" from `test-otp-flow.js` → Phone sign-in isn't switched on yet (step 6). This is checked before the function is ever called, so it says nothing about the function itself.
- If Supabase says signups aren't allowed → check **Authentication** settings for "Allow new users to sign up".

### Later: the command-line way

Once the project has more than one function, deploying from the command line is the better habit (same idea as moving migrations to the Supabase CLI eventually). On Windows, Supabase's docs list **Scoop** as the supported global install; using `npx supabase ...` from inside a project also works with Node 20+. The deploy command must include the flag: `npx supabase functions deploy send-sms-hook --no-verify-jwt`.

## How to apply it

No Supabase CLI is required for this step.

1. Create a Supabase project at [supabase.com](https://supabase.com) if you haven't already (free tier is fine to start).
2. Open your project → **SQL Editor**.
3. Paste and run each file **in order** — the filenames start with a timestamp specifically so the order is unambiguous: `20260922000000_init_schema.sql`, then `20260923000000_correction_requests.sql`, then `20260923010000_seed_clearance_types.sql`, then `20260923020000_rls_policies_profiles_applications.sql`.
4. Check **Table Editor** — you should see 19 tables listed under "Confirmed working" below, with `clearance_types` now containing 13 rows.
5. If anything errors, the most likely spot in the first file is the `on_auth_user_created` trigger (it's the one part that touches `auth`, a schema Supabase manages, not us) — copy the exact error back and we'll fix it.

Once that works, install the [Supabase CLI](https://supabase.com/docs/guides/cli) and run `supabase link` against this same project so future schema changes go through `supabase/migrations/` as proper version-controlled files instead of one-off pastes into the SQL Editor. Not needed today — just the better long-term habit once there's more than one migration.

## Confirmed working (2026-09-23)

After running both migrations, Table Editor lists all 19 tables: `clearance_types`, `business_categories`, `business_classifications`, `profiles`, `fee_schedules`, `fee_schedule_items`, `applications`, `application_documents`, `assessments`, `assessment_items`, `official_receipts`, `clearances`, `receipt_confirmations`, `feedback`, `inspection_reports`, `application_status_history`, `transaction_reversions`, `audit_logs`, `correction_requests`. Confirmed present, correctly named. ✅

Auto-profile trigger: a test user was added under Authentication → Users with a phone number, and a matching row appeared in `profiles` by itself, with no application code involved. ✅

RLS: Authentication → Policies confirms all 19 tables show RLS enabled, with zero policies on any of them — the expected "deny everything via the API until we decide who can see what" state. ✅

The "Enable automatic RLS" checkbox was also turned on during project creation — a project-level setting that auto-enables RLS on any *future* new table too, on top of what the migrations already do explicitly for these 19. Belt and suspenders, no conflict with the above.

(One small loose end: a test user now sits in Authentication → Users from the trigger check above. Harmless — delete it if you'd rather not see a fake account in there, or leave it, doesn't matter either way.)

## What's deliberately not here yet

- **Fee/category/classification seed data.** Only the 13 clearance type *names* are seeded. Business categories, classifications, and every fee amount stay empty — the only numbers anywhere in this project for those are explicitly illustrative, not the real Revenue Code, and the user does not yet have each type's approved form either. Ask before seeding these; needs real input from the barangay first.
- **RLS policies for the other 17 tables.** `profiles` and `applications` have real policies now. The rest still have RLS enabled with zero policies (deny-by-default) — a deliberate follow-up, not an oversight, since most of application code will talk to Supabase through the service-role key anyway, which bypasses RLS regardless.
- **Supabase Auth phone sign-in is written but not deployed.** The Semaphore Send SMS hook code exists (`supabase/functions/send-sms-hook/index.ts`), along with an end-to-end test script, but nothing has been deployed or run against a real phone yet — see "Wiring Semaphore into Supabase Auth" above.
- **No Next.js app talking to any of this yet.**
- **No duplicate-submission check in the database, on purpose.** Decided this stays entirely in application code: before submitting, warn the resident if something similar looks already in progress, but let them decide — a hard database rule can't reliably tell "accidental duplicate" from "second, genuinely different business," so it isn't one. Whoever builds the submission form needs to add this check; nothing here enforces it.
- **No auto-deletion of voided applications, and none is planned.** Void already never deletes anything — the row and its full history stay forever, which the paper's audit-trail and reversion-report requirements depend on. If staff ever find old voided requests cluttering a list, the fix is a UI filter (hide voided by default), not deletion — worth remembering if that request comes up later so it doesn't get quietly rebuilt as a "trash bin."
- **No check on *when* a correction request can be filed.** `correction_requests` doesn't stop someone filing one against an already-Closed or Void application — that needs the application's current status at insert time, which belongs in application code, not a schema constraint.
