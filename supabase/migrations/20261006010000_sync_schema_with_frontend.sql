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
