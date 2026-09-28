-- San Jose Clearance Portal — correction requests
-- Generated 2026-09-23. Depends on 20260922000000_init_schema.sql already
-- having been run (references public.applications, public.profiles).
-- Context: ../../../CHANGES.md ("Correction requests" section).
--
-- STATUS: written, NOT yet run against a live database — same caveat as the
-- first migration: no psql/Supabase CLI available here to test-execute it.
--
-- WHAT THIS IS FOR: a resident cannot edit their own application once
-- submitted (only staff, during review, or admin, through the existing
-- reversion tool, can change it). What was missing wasn't a new way to fix
-- things — staff/admin already have that — it was a way for the resident to
-- say "something's wrong, here's what" in their own words. This table is
-- that message, nothing more; staff act on it using tools that already exist.
--
-- TWO THINGS I ADDED ON MY OWN JUDGMENT, NOT EXPLICITLY DISCUSSED — flagging
-- both so they're easy to veto:
--   1. Only one OPEN request per application at a time (the partial unique
--      index below). A resident can't pile up five open requests while
--      staff hasn't looked at the first one; they'd see the existing open
--      one instead. Low-risk since it's scoped to one exact application,
--      not fuzzy text matching like the submission-duplicate problem was.
--   2. If a request is marked Resolved, resolved_by and resolved_at must be
--      set — matching the project's existing habit of always recording who
--      did what (same spirit as transaction_reversions.admin_id).
--
-- NOT enforced here, left for application code: WHEN a resident is allowed
-- to file one (e.g. probably not after the application is already Closed or
-- Void) — that depends on the application's current status, which needs a
-- trigger with a subquery to check inside a plain constraint, more
-- complexity than this step warrants. Application code should guard it.

create table public.correction_requests (
  id bigserial primary key,
  application_id bigint not null references public.applications(id) on delete cascade,
  resident_id uuid not null references public.profiles(id) on delete restrict,
  message text not null check (btrim(message) <> ''),
  status text not null default 'Open' check (status in ('Open', 'Resolved')),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text,
  check (status = 'Open' or (resolved_by is not null and resolved_at is not null))
);
comment on table public.correction_requests is 'A resident-written note attached to their own in-progress application, flagging something wrong. Does not itself change the application — staff/admin still make the actual fix using existing tools, then resolve this.';

create unique index correction_requests_one_open_per_application
  on public.correction_requests (application_id)
  where status = 'Open';

create index correction_requests_application_id_idx on public.correction_requests (application_id);
create index correction_requests_status_idx on public.correction_requests (status);

alter table public.correction_requests enable row level security;
