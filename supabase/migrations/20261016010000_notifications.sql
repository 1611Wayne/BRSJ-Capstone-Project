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
