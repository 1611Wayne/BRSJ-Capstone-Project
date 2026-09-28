-- San Jose Clearance Portal — initial schema
-- Generated 2026-09-22, from Entity-Relationship Diagram.png (Capstone root),
-- cross-checked against Application Workflow Flowchart.png and the frontend's
-- types/index.ts (Capstone-frontend) and Session 1's rules.ts (Capstone-backend).
-- Context and the six architecture decisions this implements: ../../../CHANGES.md
-- ("Architecture pivot" section).
--
-- STATUS: written, NOT yet run against a live database. No psql/Supabase CLI was
-- available to test-execute this — it has been hand-checked against known Postgres/
-- Supabase patterns, not verified live. Run it in the Supabase SQL Editor (see
-- ../../README.md) and report back anything that errors.
--
-- WHERE THIS DEVIATES FROM THE ERD SCREENSHOT (everything else matches it exactly):
--   1. clearance_types gains short_name, description, icon, active — the ERD only
--      showed id/name, but this presentational data already exists, hard-coded, in
--      the frontend's clearanceTypes.ts. Per the "nothing hard-coded, must stay
--      replaceable" rule, it belongs in a table, not frontend source.
--   2. fee_schedules.business_category_id / classification_id are NULLABLE. Only
--      Business Clearance has categories/classifications; the prototype used ''
--      (empty string) as a "not applicable" sentinel for the other 12 clearance
--      types, which doesn't translate to a foreign key. NULL is the FK equivalent.
--      The uniqueness constraint below uses NULLS NOT DISTINCT (Postgres 15+, which
--      Supabase runs) so two "not applicable" rows for the same effective date are
--      still caught as a real duplicate, not silently allowed past.
--   3. applications has no separate `source` column. The ERD didn't show one, and
--      the same information already exists as staff_encoder_id IS NOT NULL
--      (Online vs Assisted/Walk-in) — storing it twice invites the two going out of
--      sync, so it's derived instead.
--   4. clearances.revised_from is a plain `date`, not a foreign key. It holds the
--      *original issue date* text used in "REVISED - Original on [date]", per the
--      frontend's Clearance type and lib/downloads.ts — not a link to another row.
--   5. official_receipts.or_number and applications.reference_no have NO format
--      CHECK constraint, even though both follow a pattern today (TR-YYYY-#####
--      and SJ-YYYY-######). This is deliberate: the paper calls the OR format
--      "configurable", and Session 1's CHANGES.md already flags both formats as
--      hard-coded values that need to move out of code. Enforcing a fixed pattern
--      in the database would work against that. Format validation belongs in the
--      application layer, where it can change without a migration.
--   6. All serial primary keys use bigserial, not serial (Postgres int4 overflows
--      at ~2.1 billion; bigserial doesn't, at negligible cost). No behavior change.
--   7. Enum-like columns (role, status, application_type, etc.) use CHECK
--      constraints listing literal values, not native Postgres ENUM types — CHECK
--      constraints can be altered with a plain ALTER TABLE; ENUM types cannot
--      easily drop or reorder values later. Values match Capstone-frontend's
--      types/index.ts exactly, to minimize drift when the frontend is wired up.
--   8. Row Level Security is enabled on every table below with NO policies yet.
--      With RLS on and no policies, Supabase denies all access via the API by
--      default — safe, not an oversight. The plan (decision 5 in CHANGES.md) has
--      the app talk to Supabase from Next.js server routes using the service-role
--      key, which bypasses RLS by design, so this isn't blocking anything yet.
--      Per-role policies (a resident can only see their own applications, etc.)
--      are their own reviewable step — deliberately not decided here.

-- ============================================================================
-- Extensions & helpers
-- ============================================================================

-- Not used by any statement below yet (profiles.id comes from auth.users, not
-- gen_random_uuid()) — enabled ahead of time since it's harmless, idempotent,
-- and near-certain to be wanted once real application code starts adding rows.
create extension if not exists pgcrypto;

-- Reusable trigger: stamps updated_at = now() on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Lookup tables
-- ============================================================================

create table public.clearance_types (
  id serial primary key,
  name text not null unique,
  short_name text not null,      -- deviation 1: not in the ERD screenshot
  description text not null default '',
  icon text not null default '', -- lucide-react icon name, matches the frontend
  active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.clearance_types is 'The 13 clearance types. Deactivate via active=false rather than deleting one that is already referenced by applications.';

create table public.business_categories (
  id serial primary key,
  name text not null unique,
  active boolean not null default true
);

create table public.business_classifications (
  id serial primary key,
  category_id integer not null references public.business_categories(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  unique (category_id, name)
);

-- ============================================================================
-- profiles — extends Supabase's own auth.users (phone/OTP identity lives there)
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  email text,                          -- optional contact info; NOT the login identity
  contact_number text unique,          -- kept in sync with auth.users.phone by the trigger below
  address text not null default '',
  role text not null default 'resident' check (role in ('resident', 'staff', 'admin')),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  valid_id_path text,                  -- Supabase Storage object path for the uploaded ID
  privacy_consent_at timestamptz,      -- null until the app records explicit consent
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per auth.users row. role defaults to resident because self-service SMS OTP sign-up is the resident path; staff/admin accounts are created through an admin-only server action that promotes role after creation — this table alone does not grant staff/admin access.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row the moment someone completes SMS OTP sign-up.
-- Standard Supabase pattern: a trigger on auth.users (a schema we don't own)
-- calling a SECURITY DEFINER function so it can write to public.profiles
-- despite RLS being enabled there.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, email, contact_number, privacy_consent_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    new.email,
    new.phone,
    case when (new.raw_user_meta_data ->> 'privacy_consent')::boolean is true then now() else null end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Fee schedules — versioned; a "change" is a new row, old ones are kept
-- ============================================================================

create table public.fee_schedules (
  id serial primary key,
  clearance_type_id integer not null references public.clearance_types(id) on delete restrict,
  business_category_id integer references public.business_categories(id) on delete restrict,       -- deviation 2: nullable
  classification_id integer references public.business_classifications(id) on delete restrict,      -- deviation 2: nullable
  effective_date date not null,
  ordinance_reference text not null,
  reason_notes text not null default '',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique nulls not distinct (clearance_type_id, business_category_id, classification_id, effective_date)
);
comment on table public.fee_schedules is 'Append-only version history. The row with the latest effective_date <= today, for a given (clearance_type, category, classification), is the active one — chosen in application code, not here.';

create table public.fee_schedule_items (
  id serial primary key,
  fee_schedule_id integer not null references public.fee_schedules(id) on delete cascade,
  component_name text not null,   -- e.g. "Base Fee", "Inspection Fee", "Plate", "Sticker"
  amount numeric(10, 2) not null check (amount >= 0)
);

-- ============================================================================
-- Applications and everything attached to one
-- ============================================================================

create table public.applications (
  id bigserial primary key,
  reference_no text not null unique,   -- format SJ-YYYY-######; NOT enforced here, see deviation 5
  resident_id uuid not null references public.profiles(id) on delete restrict,
  clearance_type_id integer not null references public.clearance_types(id) on delete restrict,
  applicant_name text not null,
  address text not null,
  contact_number text not null,
  purpose text not null default '',
  business_name text not null default '',
  business_location text not null default '',
  date_initial_operation date,
  application_type text not null default 'New Application' check (application_type in ('New Application', 'Renewal')),
  ownership_type text not null default 'Owner' check (ownership_type in ('Owner', 'Renter', 'Occupant')),
  property_owner_name text not null default '',
  business_contact text not null default '',
  staff_encoder_id uuid references public.profiles(id) on delete restrict,  -- set only when staff processed this; NULL = resident applied online (deviation 3)
  status text not null default 'Draft' check (status in (
    'Draft', 'Pending Assessment', 'Awaiting OR', 'Ready for Download',
    'Closed - Cleared', 'Under Review', 'Void'
  )),
  certified boolean not null default false,
  date_requested timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.applications is 'source (Online vs Assisted/Walk-in) is derived as staff_encoder_id IS NOT NULL, not stored — see deviation 3.';

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

create table public.application_documents (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  requirement_name text not null,       -- e.g. "Valid ID of Owner"
  storage_path text not null,           -- Supabase Storage object path
  original_filename text not null,
  mime_type text not null,
  file_size integer not null check (file_size > 0 and file_size <= 5 * 1024 * 1024),
  verification_status text not null default 'Missing' check (verification_status in ('Verified', 'Missing', 'Needs Replacement')),
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz
);

create table public.assessments (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  business_category_id integer references public.business_categories(id) on delete restrict,
  classification_id integer references public.business_classifications(id) on delete restrict,
  fee_schedule_id integer not null references public.fee_schedules(id) on delete restrict,
  assessed_by uuid not null references public.profiles(id) on delete restrict,
  assessed_at timestamptz not null default now(),
  total_amount numeric(10, 2) not null check (total_amount >= 0),
  unique (application_id)   -- one active assessment per application, matching the prototype's 1:1 model
);

create table public.assessment_items (
  id bigserial primary key,
  assessment_id bigint not null references public.assessments(id) on delete cascade,
  fee_component_name text not null,
  amount numeric(10, 2) not null check (amount >= 0),
  ordinance_reference text
);
comment on table public.assessment_items is 'A snapshot copy of fee_schedule_items at assessment time (the flowchart''s SnapshotItems step) — so a later fee_schedules change never rewrites history.';

create table public.official_receipts (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  or_number text not null unique,   -- unique across ALL applications, not just this one; format NOT enforced here, see deviation 5
  or_date date not null,
  amount_paid numeric(10, 2) not null check (amount_paid >= 0),
  encoded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (application_id)
);

create table public.clearances (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  issue_date date not null,
  generated_at timestamptz not null default now(),
  pdf_storage_path text,
  qr_token text unique,             -- the token/reference the public /verify page looks up
  revised_from date,                -- original issue date text, not a foreign key — see deviation 4
  downloaded_at timestamptz,
  unique (application_id)
);

create table public.receipt_confirmations (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  ip_address text,
  unique (application_id)
);

create table public.feedback (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  resident_id uuid not null references public.profiles(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  submitted_at timestamptz not null default now(),
  unique (application_id)   -- one feedback submission per application
);

create table public.inspection_reports (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  status text not null default 'Pending' check (status in ('Pending', 'Completed')),
  inspector_name text not null default '',
  date_inspected date,
  remarks text not null default '',
  saved_by uuid not null references public.profiles(id) on delete restrict,
  saved_at timestamptz not null default now(),
  unique (application_id)   -- latest save overwrites, matching the prototype; a full history table is a future option, not this one
);

create table public.application_status_history (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create table public.transaction_reversions (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('Edit Fields', 'Void Transaction', 'Mark Under Review')),
  reason text not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Audit log — append-only, many rows per application, system-authored rows allowed
-- ============================================================================

create table public.audit_logs (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,  -- null = system-authored (e.g. before any actor exists)
  role text,
  action text not null,
  application_id bigint references public.applications(id) on delete set null,
  reference_no text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  ip_address text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Indexes (beyond the unique constraints already declared above)
-- ============================================================================

create index applications_resident_id_idx on public.applications (resident_id);
create index applications_status_idx on public.applications (status);
create index applications_clearance_type_id_idx on public.applications (clearance_type_id);
create index application_documents_application_id_idx on public.application_documents (application_id);
create index fee_schedules_lookup_idx on public.fee_schedules (clearance_type_id, business_category_id, classification_id, effective_date desc);
create index audit_logs_application_id_idx on public.audit_logs (application_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index business_classifications_category_id_idx on public.business_classifications (category_id);

-- ============================================================================
-- Row Level Security — enabled everywhere, no policies yet (see note 8 above)
-- ============================================================================

alter table public.clearance_types enable row level security;
alter table public.business_categories enable row level security;
alter table public.business_classifications enable row level security;
alter table public.profiles enable row level security;
alter table public.fee_schedules enable row level security;
alter table public.fee_schedule_items enable row level security;
alter table public.applications enable row level security;
alter table public.application_documents enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_items enable row level security;
alter table public.official_receipts enable row level security;
alter table public.clearances enable row level security;
alter table public.receipt_confirmations enable row level security;
alter table public.feedback enable row level security;
alter table public.inspection_reports enable row level security;
alter table public.application_status_history enable row level security;
alter table public.transaction_reversions enable row level security;
alter table public.audit_logs enable row level security;
