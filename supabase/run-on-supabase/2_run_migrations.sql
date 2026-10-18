-- STEP 2 of 3. THE MIGRATIONS. Paste ALL of this into the Supabase SQL Editor and click Run.
-- Generated 2026-10-18 from the nine migration files below, unchanged except that migration 6 was made re-runnable.
-- If you already ran an earlier version of this script, run this one again: it is safe. Part 9 (SAMPLE fee schedules) is new.
-- Parts 6 and 7 are the security rules: who may read each table, and three private file buckets (IDs, documents, receipts).
-- Run it as the default role (postgres). The editor may warn about "destructive operations" because the script drops and
-- re-creates some CHECK rules: that is expected, confirm it.
--
-- It is safe to run twice: every statement is "if not exists" / "drop ... if exists" first. If it shows an error, nothing
-- is lost: copy the exact error text to me and do not edit the script.
--
-- WHAT IT DOES: 13 -> 9 clearance types (the 4 wrong ones are deactivated, not deleted); the Ambulant / Lessor column;
-- then the sync with the frontend (statuses Rejected and For Checking, employees, rejection, receipt photo, payment
-- check, demo simulation, and more); then one column recording which Staff member confirmed a release at the counter;
-- then the in-app notices table; then the row-level security rules for every remaining table; then the three private
-- Storage buckets with their upload and read rules; then the request reference numbers (SJ-YYYY-######) made by the database; then SAMPLE fee schedules
-- (the prototype's illustrative fees, clearly marked, NOT the approved Revenue Code) so Staff can test assessments.
-- See SCHEMA_MAP.md for the full list.
-- Afterwards, run STEP 3 (3_after_check.sql).

-- ==========================================================================
-- PART 1 OF 9: 20261005000000_correct_clearance_types.sql
-- ==========================================================================
-- Correct the clearance_types catalog: 13 -> 9, confirmed with the real client
-- Generated 2026-10-05. Depends on 20260923010000_seed_clearance_types.sql.
-- Context: ../../../../CHANGES.md, "Frontend: branch divergence reconciled,
-- clearance types corrected 13->9" entry for this date.
--
-- WHY: the 13 names seeded on 2026-09-23 came from the paper's own Scope
-- (Ch. 1.4), on the assumption that the paper's list was accurate. It wasn't.
-- The user went to the Barangay San Jose office and asked staff directly what
-- clearance types are actually issued there: only 9 are real. Ambulant and
-- Lessor (Paupahan) are folded into Business Clearance (not separate types);
-- Film Shooting and Products Promo Clearance don't exist at this barangay at
-- all. This is real-world ground truth from the actual client superseding a
-- number the paper happened to state — exactly the kind of correction the
-- architecture was deliberately left provisional for.
--
-- WHY DEACTIVATE, NOT DELETE: this table's own comment (migration 1) already
-- says "Deactivate via active=false rather than deleting one that is already
-- referenced by applications" — the `active` column exists for precisely this
-- situation. No real applications reference these four rows yet (nothing has
-- been seeded there), so a hard delete would technically succeed today, but
-- deactivating is the documented convention, keeps the audit trail if a row
-- was ever touched by mistake, and won't need revisiting once real
-- applications data exists (a later delete would fail outright: `applications
-- .clearance_type_id references clearance_types(id) on delete restrict`).
--
-- NOT DONE HERE, ON PURPOSE: nothing in application code has been built yet
-- that reads clearance_types from Supabase (the frontend prototype still uses
-- its own hardcoded list, not this table) — so there's no query to add an
-- `active = true` filter to yet. Whoever wires the real application form to
-- this table should filter on `active` then, not before.

update public.clearance_types
set description = 'For local businesses including stores, Ambulant vendors, and Lessors (Paupahan).'
where name = 'Business Clearance';

update public.clearance_types
set active = false
where name in (
  'Ambulant Clearance',
  'Lessor (Paupahan) Clearance',
  'Film Shooting Clearance',
  'Products Promo Clearance'
);

-- ==========================================================================
-- PART 2 OF 9: 20261006000000_add_business_subcategory.sql
-- ==========================================================================
-- Add the Applicant's optional Ambulant / Lessor indication to applications
-- Generated 2026-10-06. Depends on 20260922000000_init_schema.sql.
-- Context: ../../../CHANGES.md, "Leader's push 1a584fd checked; D1 resolved..." entry,
-- decision D8.
--
-- WHY: the barangay office's own notes say Ambulant and Lessor are not separate
-- clearances ("SAKOP NG BUSINESS CLEARANCE YANG OPTIONS NA IYAN" — they are options
-- covered by Business Clearance). The agreed design (decision D8, 2026-10-06) is
-- that the Applicant may INDICATE which one applies when filing a Business
-- Clearance, and Staff make the FINAL determination of the Business Category and
-- Classification at assessment. The frontend already saves the indication
-- (applications.businessSubcategory); this gives it a home in the database.
--
-- WHAT THIS DOES NOT TOUCH: the Staff-decided category and classification. Those
-- stay on the assessment (assessments.business_category_id / classification_id),
-- because they are Staff's decision, not the Applicant's. This column is only the
-- Applicant's stated hint; nothing in fee calculation should read it directly.
--
-- NOT ENFORCED HERE, ON PURPOSE: that the indication is only used on Business
-- Clearance applications. A CHECK cannot look up the clearance type in another
-- table, and the frontend already clears the value for every other type; if a
-- database-level guarantee is ever wanted, it needs a trigger, not a CHECK.
--
-- NOT RUN YET: like 20261005000000_correct_clearance_types.sql, this has to be
-- pasted into the Supabase SQL Editor and confirmed. Re-runnable (add column if not exists),
-- changed 2026-10-16 before it was ever run, so that the combined run kit is safe to repeat.

alter table public.applications
  add column if not exists business_subcategory text
  check (business_subcategory in ('Ambulant', 'Lessor (Paupahan)'));

comment on column public.applications.business_subcategory is
  'Optional. What the Applicant indicated at intake for a Business Clearance: Ambulant or Lessor (Paupahan); NULL = Business Clearance only. A hint for Staff, not the final classification — that is decided at assessment.';

-- ==========================================================================
-- PART 3 OF 9: 20261006010000_sync_schema_with_frontend.sql
-- ==========================================================================
-- Sync the database with everything the frontend prototype has built since 2026-09-23
-- Generated 2026-10-06. Depends on ALL of the earlier migrations, in particular
-- 20261006000000_add_business_subcategory.sql (which adds applications.business_subcategory;
-- this file does not repeat it).
-- Context: ../../../CHANGES.md ("Schema sync" entry, 2026-10-06) and ../../SCHEMA_MAP.md, which
-- lists every frontend field and where it lives in the database.
--
-- STATUS: written and EXECUTED against a real Postgres engine (PGlite, Postgres 18) on top of the six
-- earlier migrations, with 96 checks on the constraints below, and run twice to prove it can be
-- re-run. NOT yet run against the live Supabase project: paste it into the SQL Editor after the two
-- earlier unrun migrations (20261005000000 and 20261006000000).
--
-- WHY THIS EXISTS: the frontend moved on from the schema (the leader's payment-check flow, rejection,
-- document review states, employees, correction requests, document replacement). Without this, the
-- database would refuse the frontend's own data (for example the statuses `Rejected` and
-- `For Checking`). Nothing here is wired to the frontend yet; it only makes the schema able to hold
-- what the frontend already produces.
--
-- RE-RUNNABLE ON PURPOSE: every statement is "if not exists" / "drop ... if exists" first, so a run
-- that stops halfway can simply be run again.
--
-- THE JUDGMENT CALLS (flagged so they are easy to veto before running):
--   1. OFFICIAL RECEIPTS NOW HOLD THE UPLOAD, AND THE OR NUMBER CAN BE EMPTY AT FIRST. Decision D1: the
--      Applicant uploads the OR image only; Staff type the OR number while verifying. So a row now exists
--      from the upload onward, and or_number / or_date / amount_paid are nullable. The OR number stays
--      UNIQUE across all applications (Postgres lets many rows be NULL, so photo-only rows do not clash).
--      A row must be real evidence: a photo or an OR number. The older typed-details path still fits.
--      The OR number lives ONLY here. The frontend also copies it into paymentVerification.orNumber; in the
--      database that copy is not stored, because two homes could not be made unique together.
--   2. payment_verifications IS A NEW TABLE for the "For Checking" state (Pending / Verified / Needs
--      Correction, who and when, the reason a payment was returned). One row per application = the CURRENT
--      state; a resubmission resets it to Pending. History is in audit_logs, as in the frontend.
--   3. simulated_payments IS A NEW TABLE for the demo online-payment simulation. Decision D5 (what a
--      simulation may produce) is still open; this only mirrors what the frontend does today. Drop this
--      table if the simulation is removed. Its reference must start with SIM-, so it can never be
--      mistaken for an official OR number.
--   4. applications GETS A `source` COLUMN AGAIN. The first schema derived it from staff_encoder_id IS NOT
--      NULL (its deviation 3). Since then the frontend sets staffEncoder on EVERY assessment, so that
--      derivation would label every assessed online application "Assisted / Walk-in". Rule from now on:
--      staff_encoder_id = the Staff who encoded a walk-in; the Staff who assessed is assessments.assessed_by.
--   5. application_documents CAN HOLD A "MISSING" PLACEHOLDER WITH NO FILE. When Staff correct an entry so
--      that another document becomes required (Renter needs a lease, Renewal needs the old clearance), the
--      frontend adds that document as Missing so it can be uploaded. File columns are therefore nullable
--      only for that case (a check keeps every other row complete). One row per requirement per application
--      is now enforced, because replacing a document looks it up by requirement name.
--   6. assessment_items.scheduled_amount (optional) keeps the fee schedule's own figure next to the amount
--      Staff charged, so an adjusted fee can be reported (decision D9 is still open). Not in the frontend's
--      data model today; NULL means "not recorded".
--   7. audit_logs.reversion mirrors the frontend's AuditLog.reversion flag.
--
-- NOT DONE HERE, ON PURPOSE:
--   * Row Level Security POLICIES for the two new tables and the other tables that still have none. RLS is
--     on (deny everything via the API) for every table, as before.
--   * Storage buckets for documents and receipt photos. This only stores the object paths.
--   * Anything about what an audit_logs value looks like. The frontend writes plain text AND JSON text into
--     its old/new values; audit_logs.old_value/new_value are jsonb. Whoever wires audit logging must store
--     plain text as a JSON string. See SCHEMA_MAP.md, "Wiring notes".

-- ============================================================================
-- applications: statuses, employees, rejection, source
-- ============================================================================

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check check (status in (
  'Draft', 'Pending Assessment', 'Awaiting OR', 'For Checking', 'Ready for Download',
  'Closed - Cleared', 'Under Review', 'Void', 'Rejected'
));

alter table public.applications
  add column if not exists has_employees boolean,                       -- NULL = not stated
  add column if not exists employee_count integer,
  add column if not exists rejection_reason text,
  add column if not exists rejected_by uuid references public.profiles(id) on delete restrict,
  add column if not exists rejected_at timestamptz,
  add column if not exists source text not null default 'Online';       -- judgment call 4

alter table public.applications drop constraint if exists applications_employee_count_check;
alter table public.applications add constraint applications_employee_count_check
  check (employee_count is null or employee_count > 0);

alter table public.applications drop constraint if exists applications_source_check;
alter table public.applications add constraint applications_source_check
  check (source in ('Online', 'Assisted / Walk-in'));

-- A walk-in must name the Staff who encoded it. The reverse is not required: staff_encoder_id may be set
-- on an online application, and `source` still says Online.
alter table public.applications drop constraint if exists applications_walk_in_has_encoder_check;
alter table public.applications add constraint applications_walk_in_has_encoder_check
  check (source = 'Online' or staff_encoder_id is not null);

-- The rejection is all-or-nothing, and a Rejected application must carry one. It is cleared when Staff
-- resolve the Applicant's correction request and the application reopens (the audit log keeps the history).
-- It is NOT required to be empty when the status is not Rejected: an Admin "Mark Under Review" reversion
-- leaves it in place in the frontend.
alter table public.applications drop constraint if exists applications_rejection_complete_check;
alter table public.applications add constraint applications_rejection_complete_check check (
  (rejection_reason is null) = (rejected_by is null) and (rejection_reason is null) = (rejected_at is null)
);
alter table public.applications drop constraint if exists applications_rejection_reason_not_blank_check;
alter table public.applications add constraint applications_rejection_reason_not_blank_check
  check (rejection_reason is null or btrim(rejection_reason) <> '');
alter table public.applications drop constraint if exists applications_rejected_has_reason_check;
alter table public.applications add constraint applications_rejected_has_reason_check
  check (status <> 'Rejected' or rejection_reason is not null);

comment on column public.applications.source is
  'Online or Assisted / Walk-in. Stored, not derived from staff_encoder_id: the frontend records the assessing Staff there too (assessments.assessed_by is the assessor).';
comment on column public.applications.staff_encoder_id is
  'The Staff who encoded a walk-in application. NULL for online applications. The Staff who assessed is assessments.assessed_by, not this column.';
comment on column public.applications.has_employees is
  'Business Clearance only. NULL = the Applicant did not say.';
comment on column public.applications.rejection_reason is
  'Why Staff rejected the request. A rejected request is returned to the Applicant, who sends a correction request; resolving it reopens the application and clears the three rejection columns.';

-- ============================================================================
-- application_documents: Pending Review, Staff reason, file-less Missing placeholder
-- ============================================================================

alter table public.application_documents drop constraint if exists application_documents_verification_status_check;
alter table public.application_documents add constraint application_documents_verification_status_check
  check (verification_status in ('Pending Review', 'Verified', 'Missing', 'Needs Replacement'));
-- A newly submitted document waits for Staff. (The old default, Missing, made a row that has a file look absent.)
alter table public.application_documents alter column verification_status set default 'Pending Review';

alter table public.application_documents
  alter column storage_path drop not null,
  alter column original_filename drop not null,
  alter column mime_type drop not null,
  alter column file_size drop not null;
alter table public.application_documents add column if not exists note text;

-- Every row is either a complete uploaded file, or a Missing placeholder with no file at all.
alter table public.application_documents drop constraint if exists application_documents_file_or_placeholder_check;
alter table public.application_documents add constraint application_documents_file_or_placeholder_check check (
  (storage_path is not null and original_filename is not null and mime_type is not null and file_size is not null)
  or (storage_path is null and original_filename is null and mime_type is null and file_size is null and verification_status = 'Missing')
);
-- Staff's optional short reason for flagging a document (the frontend keeps it to 200 characters).
alter table public.application_documents drop constraint if exists application_documents_note_check;
alter table public.application_documents add constraint application_documents_note_check
  check (note is null or (btrim(note) <> '' and char_length(note) <= 200));
-- Replacing a document finds it by requirement name, so there can be only one per requirement.
alter table public.application_documents drop constraint if exists application_documents_one_per_requirement;
alter table public.application_documents add constraint application_documents_one_per_requirement
  unique (application_id, requirement_name);

comment on column public.application_documents.note is
  'Optional reason Staff gave when marking the document Missing or Needs Replacement; shown to the Applicant. Cleared when the document is verified or replaced.';
comment on table public.application_documents is
  'A file the Applicant (or Staff for them) uploaded, or a Missing placeholder with no file (added when a correction makes another document required). Replacing a document updates this row: new file, status Pending Review, note cleared. Who replaced it is in audit_logs.';

-- ============================================================================
-- official_receipts: now holds the uploaded receipt photo; the OR number can be filled in later
-- ============================================================================

alter table public.official_receipts
  alter column or_number drop not null,
  alter column or_date drop not null,
  alter column amount_paid drop not null;

alter table public.official_receipts
  add column if not exists receipt_photo_path text,
  add column if not exists receipt_photo_filename text,
  add column if not exists receipt_photo_mime_type text,
  add column if not exists receipt_photo_size integer;

alter table public.official_receipts drop constraint if exists official_receipts_or_number_not_blank_check;
alter table public.official_receipts add constraint official_receipts_or_number_not_blank_check
  check (or_number is null or btrim(or_number) <> '');

-- The photo is all-or-nothing, and within the 5 MB limit the frontend uses.
alter table public.official_receipts drop constraint if exists official_receipts_photo_complete_check;
alter table public.official_receipts add constraint official_receipts_photo_complete_check check (
  (receipt_photo_path is null and receipt_photo_filename is null and receipt_photo_mime_type is null and receipt_photo_size is null)
  or (receipt_photo_path is not null and receipt_photo_filename is not null and receipt_photo_mime_type is not null
      and receipt_photo_size between 1 and 5 * 1024 * 1024)
);
-- The date and the amount only exist together (the typed-details path); the photo-only path has neither.
alter table public.official_receipts drop constraint if exists official_receipts_date_and_amount_together_check;
alter table public.official_receipts add constraint official_receipts_date_and_amount_together_check
  check ((or_date is null) = (amount_paid is null));
-- A row has to be evidence: a photo, or an OR number.
alter table public.official_receipts drop constraint if exists official_receipts_has_evidence_check;
alter table public.official_receipts add constraint official_receipts_has_evidence_check
  check (receipt_photo_path is not null or or_number is not null);

comment on table public.official_receipts is
  'Payment evidence for an application, one row each. Created when the Applicant uploads the OR image (decision D1) or when OR details are typed; Staff fill in or_number while verifying. or_number is unique across ALL applications and is the only place an OR number is stored. A simulated payment is a different table (simulated_payments), not a row here.';
comment on column public.official_receipts.encoded_by is
  'Whoever created this row: the Applicant who uploaded the image, or the Staff who submitted or typed it.';

-- ============================================================================
-- payment_verifications: the "For Checking" state (judgment call 2)
-- ============================================================================

create table if not exists public.payment_verifications (
  id bigserial primary key,
  application_id bigint not null unique references public.applications(id) on delete cascade,
  status text not null default 'Pending' check (status in ('Pending', 'Verified', 'Needs Correction')),
  submitted_at timestamptz not null default now(),
  checked_by uuid references public.profiles(id) on delete restrict,
  checked_at timestamptz,
  notes text,   -- the reason a payment was returned for correction
  check (status = 'Pending' or (checked_by is not null and checked_at is not null)),
  check (status <> 'Needs Correction' or (notes is not null and btrim(notes) <> ''))
);
comment on table public.payment_verifications is
  'Current state of Staff''s check of the payment evidence. Pending when the Applicant submits (application status For Checking); Verified, or Needs Correction with a reason (the application goes back to Awaiting OR). A resubmission resets the row to Pending and clears checked_by / checked_at / notes. A Verified non-simulated payment should have official_receipts.or_number set; the database cannot check that across tables, so application code must.';
alter table public.payment_verifications enable row level security;

-- ============================================================================
-- simulated_payments: the demo online-payment simulation (judgment call 3)
-- ============================================================================

create table if not exists public.simulated_payments (
  id bigserial primary key,
  application_id bigint not null unique references public.applications(id) on delete cascade,
  method text not null check (method in ('GCash', 'Bank Transfer', 'Maya', 'Other')),
  reference_number text not null unique check (reference_number like 'SIM-%'),
  amount numeric(10, 2) not null check (amount >= 0),
  paid_at timestamptz not null default now(),
  note text not null default 'SIMULATION - not an official Treasury payment'
);
comment on table public.simulated_payments is
  'DEMO ONLY. The simulated online payment. Not a real payment and not an OR. Removed again when Staff return the payment. Decision D5 (what a simulation may release) is open; drop this table if the simulation is removed. Never counted in collection reports.';
alter table public.simulated_payments enable row level security;

-- ============================================================================
-- assessment_items, audit_logs, correction_requests
-- ============================================================================

alter table public.assessment_items add column if not exists scheduled_amount numeric(10, 2);   -- judgment call 6
alter table public.assessment_items drop constraint if exists assessment_items_scheduled_amount_check;
alter table public.assessment_items add constraint assessment_items_scheduled_amount_check
  check (scheduled_amount is null or scheduled_amount >= 0);
comment on column public.assessment_items.scheduled_amount is
  'The fee schedule''s own amount for this component when it was assessed. amount is what Staff charged; they differ when Staff adjusted it (decision D9). NULL = not recorded.';

alter table public.audit_logs add column if not exists reversion boolean not null default false;   -- judgment call 7

-- The frontend limits a correction request to 500 characters and Staff's resolution note to 300.
alter table public.correction_requests drop constraint if exists correction_requests_message_length_check;
alter table public.correction_requests add constraint correction_requests_message_length_check
  check (char_length(message) <= 500);
alter table public.correction_requests drop constraint if exists correction_requests_resolution_note_check;
alter table public.correction_requests add constraint correction_requests_resolution_note_check
  check (resolution_note is null or char_length(resolution_note) <= 300);
comment on column public.correction_requests.resident_id is
  'The Applicant who sent the request (the frontend''s requestedBy). The Staff who resolved it is resolved_by.';

-- ==========================================================================
-- PART 4 OF 9: 20261016000000_receipt_confirmed_by.sql
-- ==========================================================================
-- Record WHO confirmed a release at the counter
-- Generated 2026-10-16. Depends on 20260922000000_init_schema.sql (receipt_confirmations, profiles).
-- Context: ../../../CHANGES.md ("D6 answered by the user" entry) and ../../SCHEMA_MAP.md.
--
-- WHY: the printed, stamped original of a clearance is released at the monitoring office (the digital
-- copy is only a backup). So Staff confirm the release for the Applicant at the counter, and the
-- frontend now records which Staff member did it (ReceiptConfirmation.confirmedBy). NULL means the
-- Applicant confirmed receipt themselves online.
--
-- RE-RUNNABLE ON PURPOSE (add column if not exists). Not yet run on the live project: it is part 4 of
-- run-on-supabase/2_run_migrations.sql, which can safely be run again after parts 1-3.

alter table public.receipt_confirmations
  add column if not exists confirmed_by uuid references public.profiles(id) on delete restrict;

comment on column public.receipt_confirmations.confirmed_by is
  'The Staff member who recorded the release of the printed original at the counter. NULL = the Applicant confirmed receipt themselves.';

-- ==========================================================================
-- PART 5 OF 9: 20261016010000_notifications.sql
-- ==========================================================================
-- In-app notifications for Applicants
-- Generated 2026-10-16. Depends on 20260922000000_init_schema.sql (profiles, applications).
-- Context: ../../../CHANGES.md ("In-app notifications" entry) and ../../SCHEMA_MAP.md.
--
-- WHAT: one row per notice shown to an Applicant in the portal: documents that need replacing, an application
-- returned, a correction made, the assessment ready (the fee and what to do next), a payment returned, the
-- clearance ready. The event names are the six values below and are the same ones the frontend uses
-- (AppNotification.event). SMS is not part of this: if text messages are added later, they can send the same events.
--
-- dedupe_key: while a notice is still UNREAD, a second notice with the same key replaces it instead of adding another
-- (for example a flagged document gets Staff's note added to the same notice). The partial unique index below is that
-- rule. Once the Applicant has read it (read_at is set), a new notice with the same key is allowed.
--
-- NOT DONE HERE: row level security POLICIES. RLS is on, so the table is deny-all through the API until policies exist:
-- an Applicant must read and mark read only their own rows (user_id = auth.uid()); only the server writes them.
--
-- RE-RUNNABLE ON PURPOSE: create ... if not exists. Not yet run on the live project: part 5 of
-- run-on-supabase/2_run_migrations.sql.

create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  application_id bigint references public.applications(id) on delete cascade,
  event text not null check (event in (
    'documents_flagged', 'application_returned', 'correction_resolved',
    'assessment_ready', 'payment_returned', 'clearance_ready'
  )),
  message text not null check (btrim(message) <> ''),
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id) where read_at is null;
create unique index if not exists notifications_one_unread_per_key
  on public.notifications (user_id, dedupe_key) where read_at is null and dedupe_key is not null;

alter table public.notifications enable row level security;

comment on table public.notifications is
  'In-app notices for an Applicant (not SMS). Written by the server when Staff act on the Applicant''s application; the Applicant reads them and marks them read. An unread notice with the same dedupe_key is updated instead of repeated.';

-- ==========================================================================
-- PART 6 OF 9: 20261017000000_rls_policies_remaining_tables.sql
-- ==========================================================================
-- RLS policies for the remaining tables (everything except profiles and applications, which have their own
-- policies in 20260923020000). Generated 2026-10-17. Depends on all earlier migrations.
--
-- THE RULE THIS FILE FOLLOWS (deny by default, then open only what is needed):
--   * READING is scoped. An Applicant reads only rows that belong to their own application (or their own
--     notifications). Staff and Admin read what their screens need. Nobody who is signed out reads anything.
--   * WRITING through the user's own session is almost entirely closed. The workflow writes (assessment, payment
--     check, clearance, confirmation, history, audit, notices) are done by the Next.js server routes with the
--     service-role key, which bypasses RLS and is where the status rules and the audit log live. If the browser
--     could write these tables directly it could skip the audit log and the status rules, so no policy allows it.
--   * The only user-session writes opened here are the two the Applicant needs before the server is involved:
--     the files of their OWN DRAFT (application_documents) and marking their OWN notices read (notifications).
--
-- DELIBERATELY NOT DONE (and why):
--   * The existing policies on applications (20260923020000) let Staff and Admin update any application directly
--     from a user session. That migration is already run, so it is not edited here. It is the one place where a
--     user-session write can skip the audit log; it should be reviewed when the frontend is connected.
--   * No delete policy anywhere except an Applicant removing a file from their own draft: Void is a status.
--   * audit_logs is not made immutable by a trigger here (its application_id uses ON DELETE SET NULL, so a blunt
--     "no updates" trigger would break cascades). That is a separate, listed follow-up.
--
-- RE-RUNNABLE ON PURPOSE: every policy is "drop policy if exists" then create; functions are create or replace.

-- ============================================================================
-- Helpers. SECURITY DEFINER so they can read applications whatever the caller's RLS is (no recursion);
-- they only ever answer about the CALLING user, so they leak nothing about other people's rows.
-- ============================================================================

-- True when the caller may see this application: its owner, or Staff / Admin.
create or replace function public.can_read_application(app_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select a.resident_id = auth.uid() or public.requester_role() in ('staff', 'admin')
       from public.applications a where a.id = app_id),
    false);
$$;

-- True when the caller is the Applicant who owns this application.
create or replace function public.owns_application(app_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.applications a where a.id = app_id and a.resident_id = auth.uid());
$$;

-- The status of an application, but only if the caller may see it (otherwise null).
-- Used so a policy can say "the owner may upload while it is still a Draft" without exposing other people's statuses.
create or replace function public.application_status_for_caller(app_id bigint)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select a.status from public.applications a
  where a.id = app_id and (a.resident_id = auth.uid() or public.requester_role() in ('staff', 'admin'));
$$;

-- Supabase grants new functions to anon explicitly (not only through PUBLIC), so anon is named here too.
revoke all on function public.can_read_application(bigint) from public, anon;
revoke all on function public.owns_application(bigint) from public, anon;
revoke all on function public.application_status_for_caller(bigint) from public, anon;
grant execute on function public.can_read_application(bigint) to authenticated, service_role;
grant execute on function public.owns_application(bigint) to authenticated, service_role;
grant execute on function public.application_status_for_caller(bigint) to authenticated, service_role;

-- ============================================================================
-- Reference lists: every signed-in user may read; nobody changes them from a user session.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['clearance_types', 'business_categories', 'business_classifications'] loop
    execute format('drop policy if exists "signed-in users read this list" on public.%I', t);
    execute format('create policy "signed-in users read this list" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Fee schedules: Staff and Admin (the assessment looks them up). Applicants see the fees on their own
-- assessment (assessment_items), not the whole Revenue Code table.
do $$
declare t text;
begin
  foreach t in array array['fee_schedules', 'fee_schedule_items'] loop
    execute format('drop policy if exists "staff and admin read fee schedules" on public.%I', t);
    execute format('create policy "staff and admin read fee schedules" on public.%I for select to authenticated using (public.requester_role() in (''staff'', ''admin''))', t);
  end loop;
end $$;

-- ============================================================================
-- Rows that belong to one application: the owner, Staff and Admin read them.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'assessments', 'official_receipts', 'payment_verifications', 'simulated_payments', 'clearances',
    'receipt_confirmations', 'feedback', 'correction_requests', 'application_status_history'
  ] loop
    execute format('drop policy if exists "owner, staff and admin read this application''s rows" on public.%I', t);
    execute format('create policy "owner, staff and admin read this application''s rows" on public.%I for select to authenticated using (public.can_read_application(application_id))', t);
  end loop;
end $$;

-- assessment_items hang off an assessment, not directly off the application.
drop policy if exists "owner, staff and admin read assessment items" on public.assessment_items;
create policy "owner, staff and admin read assessment items"
on public.assessment_items for select to authenticated
using (public.can_read_application((select a.application_id from public.assessments a where a.id = assessment_id)));

-- Inspection reports are internal to the department.
drop policy if exists "staff and admin read inspection reports" on public.inspection_reports;
create policy "staff and admin read inspection reports"
on public.inspection_reports for select to authenticated
using (public.requester_role() in ('staff', 'admin'));

-- Reversions are an Admin matter (the Reversion Audit Report).
drop policy if exists "admin reads reversions" on public.transaction_reversions;
create policy "admin reads reversions"
on public.transaction_reversions for select to authenticated
using (public.requester_role() = 'admin');

-- The audit log: Staff and Admin read; nobody writes it from a user session (the server does).
drop policy if exists "staff and admin read the audit log" on public.audit_logs;
create policy "staff and admin read the audit log"
on public.audit_logs for select to authenticated
using (public.requester_role() in ('staff', 'admin'));

-- ============================================================================
-- application_documents: read like the rows above. The Applicant may add, replace and remove files of their OWN
-- DRAFT only. Once submitted, every change is a workflow step (the server writes it and the audit log).
-- ============================================================================

drop policy if exists "owner, staff and admin read documents" on public.application_documents;
create policy "owner, staff and admin read documents"
on public.application_documents for select to authenticated
using (public.can_read_application(application_id));

-- A draft document can only be a freshly uploaded one (or an empty placeholder): never already verified, no reviewer,
-- no Staff note. This is what stops an Applicant marking their own document Verified.
drop policy if exists "owner adds documents to their own draft" on public.application_documents;
create policy "owner adds documents to their own draft"
on public.application_documents for insert to authenticated
with check (
  public.owns_application(application_id)
  and public.application_status_for_caller(application_id) = 'Draft'
  and verification_status in ('Pending Review', 'Missing')
  and reviewed_by is null and reviewed_at is null and note is null
);

drop policy if exists "owner changes documents of their own draft" on public.application_documents;
create policy "owner changes documents of their own draft"
on public.application_documents for update to authenticated
using (public.owns_application(application_id) and public.application_status_for_caller(application_id) = 'Draft')
with check (
  public.owns_application(application_id)
  and public.application_status_for_caller(application_id) = 'Draft'
  and verification_status in ('Pending Review', 'Missing')
  and reviewed_by is null and reviewed_at is null and note is null
);

drop policy if exists "owner removes documents from their own draft" on public.application_documents;
create policy "owner removes documents from their own draft"
on public.application_documents for delete to authenticated
using (public.owns_application(application_id) and public.application_status_for_caller(application_id) = 'Draft');

-- ============================================================================
-- notifications: an Applicant reads their own and may mark them read; the server writes them.
-- ============================================================================

drop policy if exists "applicants read their own notifications" on public.notifications;
create policy "applicants read their own notifications"
on public.notifications for select to authenticated
using (user_id = auth.uid());

drop policy if exists "applicants mark their own notifications read" on public.notifications;
create policy "applicants mark their own notifications read"
on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- A policy cannot say "only the read_at column may change", so a trigger does. It only restricts a USER session
-- (auth.uid() is not null); the server (service role, auth.uid() is null) still updates the message of an unread
-- notice when the same event repeats. A notice can be marked read, never made unread again.
create or replace function public.notifications_owner_only_marks_read()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    if new.user_id is distinct from old.user_id
       or new.application_id is distinct from old.application_id
       or new.event is distinct from old.event
       or new.message is distinct from old.message
       or new.dedupe_key is distinct from old.dedupe_key
       or new.created_at is distinct from old.created_at then
      raise exception 'A notification can only be marked as read.';
    end if;
    if old.read_at is not null and new.read_at is distinct from old.read_at then
      raise exception 'A notification that was read cannot be changed.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_owner_only_marks_read on public.notifications;
create trigger notifications_owner_only_marks_read
  before update on public.notifications
  for each row execute function public.notifications_owner_only_marks_read();

-- ==========================================================================
-- PART 7 OF 9: 20261017010000_storage_buckets_and_policies.sql
-- ==========================================================================
-- Storage: three PRIVATE buckets and who may read and upload into each. Generated 2026-10-17.
-- Depends on 20261017000000_rls_policies_remaining_tables.sql (the helper functions).
--
-- WHAT IS STORED WHERE (the database keeps only the object path; see SCHEMA_MAP.md):
--   valid-ids              profiles.valid_id_path                    path  <profile uuid>/<file>
--   application-documents  application_documents.storage_path        path  <application id>/<file>
--   receipt-photos         official_receipts.receipt_photo_path      path  <application id>/<file>
-- The first folder of the path is what the rules look at. Use a NEW file name for every upload (for example
-- a timestamp prefix): objects cannot be overwritten or deleted from a user session, so a replaced document or
-- receipt keeps its earlier file (that is the evidence trail; clean-up is a server job).
--
-- WHY PRIVATE: IDs and Treasury receipts are personal data (the Data Privacy Act treats government-issued
-- identifiers as sensitive personal information). A private bucket has no public URL; a file is opened only through a
-- short-lived signed link that the server (or a signed-in user the rules allow) asks for.
--
-- WHO MAY READ
--   valid-ids              the owner of that folder; Staff and Admin
--   application-documents  the owner of that application; Staff and Admin
--   receipt-photos         the owner of that application; Staff and Admin
-- WHO MAY UPLOAD (INSERT only; there is no update or delete policy, so objects are write-once)
--   valid-ids              the owner into their own folder; Staff and Admin (a walk-in Applicant's ID)
--   application-documents  the owner while the application is a Draft, Pending Assessment or Under Review
--                          (the statuses in which the workflow lets a document be added or replaced); Staff and Admin
--   receipt-photos         the owner while the application is Awaiting OR (where the receipt is uploaded, or uploaded
--                          again after Staff returned it); Staff and Admin (an Applicant who cannot upload)
-- Uploading a file does not change any record: the server still writes the database row, the status and the audit log.
--
-- LIMITS (also checked by the app): 5 MB per file; PDF, JPG or PNG only.
--
-- RE-RUNNABLE ON PURPOSE: buckets are upserted and every policy is "drop policy if exists" then create.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('valid-ids',             'valid-ids',             false, 5242880, array['application/pdf', 'image/jpeg', 'image/png']),
  ('application-documents', 'application-documents', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png']),
  ('receipt-photos',        'receipt-photos',        false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The application id in a path like "123/file.jpg": the first folder, only if it is a plain number and the
-- object really is inside a folder. Anything else gives null, which no policy accepts (no cast errors).
create or replace function public.storage_application_id(object_name text)
returns bigint
language sql
immutable
as $$
  select case
    when position('/' in object_name) > 1 and split_part(object_name, '/', 1) ~ '^[0-9]{1,18}$'
    then split_part(object_name, '/', 1)::bigint
  end;
$$;

-- The owner folder of a path like "<uuid>/file.png": the first folder as text, only if the object is inside a folder.
create or replace function public.storage_owner_folder(object_name text)
returns text
language sql
immutable
as $$
  select case when position('/' in object_name) > 1 then split_part(object_name, '/', 1) end;
$$;

grant execute on function public.storage_application_id(text) to authenticated, service_role;
grant execute on function public.storage_owner_folder(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- valid-ids
-- ---------------------------------------------------------------------------
drop policy if exists "storage: valid-ids read own folder, staff and admin read all" on storage.objects;
create policy "storage: valid-ids read own folder, staff and admin read all"
on storage.objects for select to authenticated
using (
  bucket_id = 'valid-ids'
  and (public.storage_owner_folder(name) = auth.uid()::text or public.requester_role() in ('staff', 'admin'))
);

drop policy if exists "storage: valid-ids upload into own folder, staff and admin anywhere" on storage.objects;
create policy "storage: valid-ids upload into own folder, staff and admin anywhere"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'valid-ids'
  and public.storage_owner_folder(name) is not null
  and (public.storage_owner_folder(name) = auth.uid()::text or public.requester_role() in ('staff', 'admin'))
);

-- ---------------------------------------------------------------------------
-- application-documents
-- ---------------------------------------------------------------------------
drop policy if exists "storage: application-documents read own application, staff and admin read all" on storage.objects;
create policy "storage: application-documents read own application, staff and admin read all"
on storage.objects for select to authenticated
using (
  bucket_id = 'application-documents'
  and public.can_read_application(public.storage_application_id(name))
);

drop policy if exists "storage: application-documents upload while the request is open for documents" on storage.objects;
create policy "storage: application-documents upload while the request is open for documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'application-documents'
  and public.storage_application_id(name) is not null
  and (
    (public.requester_role() in ('staff', 'admin') and public.application_status_for_caller(public.storage_application_id(name)) is not null)
    or (public.owns_application(public.storage_application_id(name))
        and public.application_status_for_caller(public.storage_application_id(name)) in ('Draft', 'Pending Assessment', 'Under Review'))
  )
);

-- ---------------------------------------------------------------------------
-- receipt-photos
-- ---------------------------------------------------------------------------
drop policy if exists "storage: receipt-photos read own application, staff and admin read all" on storage.objects;
create policy "storage: receipt-photos read own application, staff and admin read all"
on storage.objects for select to authenticated
using (
  bucket_id = 'receipt-photos'
  and public.can_read_application(public.storage_application_id(name))
);

drop policy if exists "storage: receipt-photos upload while the request awaits the receipt" on storage.objects;
create policy "storage: receipt-photos upload while the request awaits the receipt"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'receipt-photos'
  and public.storage_application_id(name) is not null
  and (
    (public.requester_role() in ('staff', 'admin') and public.application_status_for_caller(public.storage_application_id(name)) is not null)
    or (public.owns_application(public.storage_application_id(name))
        and public.application_status_for_caller(public.storage_application_id(name)) = 'Awaiting OR')
  )
);

-- ==========================================================================
-- PART 8 OF 9: 20261018000000_reference_numbers.sql
-- ==========================================================================
-- Request reference numbers made by the database: SJ-YYYY-######, one counter per year (Manila time), starting at 1.
-- Generated 2026-10-18. Depends on 20261017000000_rls_policies_remaining_tables.sql.
--
-- WHY: the prototype made the next number in the browser ("highest number + 1"). With several people applying at the
-- same moment, two of them would get the same number. Here every new application takes the next value inside one
-- INSERT ... ON CONFLICT statement, which Postgres runs one at a time per year row, so numbers never repeat.
-- A failed or cancelled insert can leave a gap (a number nobody has); that is normal and harmless.
--
-- HOW IT IS USED: applications.reference_no now defaults to public.next_reference_no(), so an insert that leaves the
-- column out gets the next number. The year rolls over by itself (a new row in reference_counters).
--
-- RE-RUNNABLE ON PURPOSE: create ... if not exists, create or replace, and an idempotent default.

create table if not exists public.reference_counters (
  year integer primary key check (year between 2000 and 2999),
  last_value integer not null check (last_value > 0)
);
alter table public.reference_counters enable row level security;
-- Nobody reads or writes it through the API; only next_reference_no() (SECURITY DEFINER) touches it.
-- An explicit "nobody" policy says so on purpose (every table has at least one policy; after-check 17).
drop policy if exists "nobody uses the counters directly" on public.reference_counters;
create policy "nobody uses the counters directly" on public.reference_counters for select to authenticated using (false);
comment on table public.reference_counters is 'Last request reference number used per year (Manila time). Written only by next_reference_no().';

create or replace function public.next_reference_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer := extract(year from (now() at time zone 'Asia/Manila'))::integer;
  n integer;
begin
  insert into public.reference_counters as c (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into n;
  if n > 999999 then
    raise exception 'Reference numbers for % are used up (999999).', y;
  end if;
  return 'SJ-' || y::text || '-' || lpad(n::text, 6, '0');
end;
$$;

-- Callable by signed-in users (an Applicant's own draft insert uses the default) and the server; not by anonymous visitors.
revoke all on function public.next_reference_no() from public, anon;
grant execute on function public.next_reference_no() to authenticated, service_role;

alter table public.applications alter column reference_no set default public.next_reference_no();

-- ==========================================================================
-- PART 9 OF 9: 20261018010000_sample_fee_schedules.sql
-- ==========================================================================
-- SAMPLE fee data so Staff can test the assessment end to end. Generated 2026-10-18 from the prototype's own data
-- (data/revenueCodeData.ts and data/mockFeeSchedules.ts), so the numbers are exactly the ones the prototype shows.
-- Depends on 20261018000000_reference_numbers.sql.
--
-- *** THESE ARE NOT THE APPROVED REVENUE CODE AMOUNTS. *** Every schedule says so in ordinance_reference and
-- reason_notes. When the barangay gives the approved Revenue Code, add the real schedules as NEW rows with a later
-- effective_date (the newest effective schedule wins, older rows stay as history), or remove these sample rows before
-- any real request is assessed with them. This is on the "remove or replace before handover" list in CHANGES.md.
--
-- WHAT IT ADDS: 7 business categories, 13 classifications, 23 fee schedules (one per clearance type,
-- category and classification, effective 2026-01-01) with 6 fee lines each, in the prototype's order:
-- <clearance type> fee, Plate, Inspection Fee, Sticker, Penalty, No. of Employee.
-- Non-business clearance types have no category or classification (both NULL), as in the prototype.
--
-- ALSO: fee_schedules.created_by may now be NULL, meaning "loaded by the system" (no person made this schedule);
-- every schedule made by an Admin still records who made it.
--
-- RE-RUNNABLE ON PURPOSE: categories, classifications and schedules are inserted only if missing, and a schedule's
-- lines only when that schedule has none.

alter table public.fee_schedules alter column created_by drop not null;
comment on column public.fee_schedules.created_by is 'The Admin who made this schedule; NULL = loaded by the system (sample or imported data).';

insert into public.business_categories (name) values
  ('Sari-Sari Store'),
  ('Bakery'),
  ('Beauty Parlor / Salon'),
  ('Carinderia'),
  ('Lessor'),
  ('Ambulant / Mobile Vendor'),
  ('Bank')
on conflict (name) do nothing;

insert into public.business_classifications (category_id, name)
select c.id, v.name
from (values
  ('Sari-Sari Store', 'Small'),
  ('Sari-Sari Store', 'Medium'),
  ('Sari-Sari Store', 'Large'),
  ('Bakery', 'Small'),
  ('Bakery', 'Medium'),
  ('Bakery', 'Large'),
  ('Beauty Parlor / Salon', 'Small'),
  ('Beauty Parlor / Salon', 'Large'),
  ('Carinderia', 'Small'),
  ('Carinderia', 'Large'),
  ('Lessor', '1–4 Units'),
  ('Lessor', '5–8 Units'),
  ('Lessor', '9+ Units')
) as v(category, name)
join public.business_categories c on c.name = v.category
on conflict (category_id, name) do nothing;

do $$
declare
  r record;
  sched_id integer;
  i integer;
begin
  for r in
    select * from (values
  ('Business Clearance', 'Sari-Sari Store', 'Small', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[100.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Sari-Sari Store', 'Medium', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[300.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Sari-Sari Store', 'Large', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Bakery', 'Small', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Bakery', 'Medium', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[750.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Bakery', 'Large', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1000.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Beauty Parlor / Salon', 'Small', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Beauty Parlor / Salon', 'Large', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1000.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Carinderia', 'Small', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Carinderia', 'Large', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1000.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Lessor', '1–4 Units', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1000.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Lessor', '5–8 Units', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Lessor', '9+ Units', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[2500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Ambulant / Mobile Vendor', null, '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[250.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Bank', null, '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[2500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Building Clearance', null, null, '2026-01-01', array['Building Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Electrical Clearance', null, null, '2026-01-01', array['Electrical Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[350.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Fencing Clearance', null, null, '2026-01-01', array['Fencing Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Excavation Clearance', null, null, '2026-01-01', array['Excavation Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Lot Survey Clearance', null, null, '2026-01-01', array['Lot Survey Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Water/MWSS Clearance', null, null, '2026-01-01', array['Water/MWSS Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('PODA Clearance', null, null, '2026-01-01', array['PODA Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('TODA Clearance', null, null, '2026-01-01', array['TODA Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[])
    ) as v(clearance_type, category, classification, effective_date, names, amounts)
  loop
    select s.id into sched_id
    from public.fee_schedules s
    join public.clearance_types t on t.id = s.clearance_type_id and t.name = r.clearance_type
    left join public.business_categories c on c.id = s.business_category_id
    left join public.business_classifications k on k.id = s.classification_id
    where s.effective_date = r.effective_date::date
      and c.name is not distinct from r.category
      and k.name is not distinct from r.classification;

    if sched_id is null then
      insert into public.fee_schedules (clearance_type_id, business_category_id, classification_id, effective_date, ordinance_reference, reason_notes, created_by)
      select t.id, c.id, k.id, r.effective_date::date,
             'SAMPLE Revenue Code schedule (illustrative, NOT the approved Revenue Code)',
             'SAMPLE fees copied from the prototype for testing; replace with the approved Revenue Code before real use.',
             null
      from public.clearance_types t
      left join public.business_categories c on c.name = r.category
      left join public.business_classifications k on k.category_id = c.id and k.name = r.classification
      where t.name = r.clearance_type
      returning id into sched_id;
    end if;

    if sched_id is null then
      raise exception 'Sample fee schedule could not be created for % / % / %', r.clearance_type, r.category, r.classification;
    end if;

    if not exists (select 1 from public.fee_schedule_items where fee_schedule_id = sched_id) then
      for i in 1 .. array_length(r.names, 1) loop
        insert into public.fee_schedule_items (fee_schedule_id, component_name, amount)
        values (sched_id, r.names[i], r.amounts[i]);
      end loop;
    end if;
  end loop;
end $$;
