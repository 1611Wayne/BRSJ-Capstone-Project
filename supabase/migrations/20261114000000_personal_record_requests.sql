-- Migration 23: the table behind "ask for a copy of my records" (FT-18, RA 10173 right of access) (IN PROGRESS, 2026-11-14).
-- jayemm01's PR #10 (merged into main 2026-11-13) added the screens and app/api/record-requests, but no table, so on the
-- real project the Records Requests pages say "Records requests are currently unavailable". This creates it exactly as
-- the code reads and writes it (lib/server/recordRequests.ts, app/api/record-requests/route.ts).
--
-- HOW IT IS USED
--   A resident asks (Profile page): the server inserts a Pending row (id = a uuid made by the browser, request_text).
--   Staff or Admin answer (Records Requests page): the server sets Answered, response_text, responded_at, responded_by and
--   include_summary, only if the row is still Pending (compare-and-set, so two officers cannot overwrite each other).
--   With include_summary, the resident can download a summary of their profile and requests (the download is logged).
-- WHO MAY DO WHAT
--   Read: the resident their own requests; Staff and Admin all of them. (The app reads with the server key anyway.)
--   Write: nobody from a user session. Every insert and answer goes through the server (as for applications since
--   migration 19), which checks the rules in lib/workflow.ts and writes the audit entry.
-- Profiles are never hard-deleted; like applications, a request blocks deleting its resident (on delete restrict). The
-- DB-12 test clean-up must delete a test resident's records requests first.
-- Re-runnable.

create table if not exists public.personal_record_requests (
  id uuid primary key,
  resident_id uuid not null,
  request_text text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'Pending',
  response_text text,
  responded_at timestamptz,
  responded_by uuid,
  include_summary boolean not null default false,
  -- The app joins the names through these two constraint names, so they are spelled out.
  constraint personal_record_requests_resident_id_fkey foreign key (resident_id) references public.profiles(id) on delete restrict,
  constraint personal_record_requests_responded_by_fkey foreign key (responded_by) references public.profiles(id) on delete set null,
  constraint personal_record_requests_status_check check (status in ('Pending', 'Answered')),
  constraint personal_record_requests_request_length check (char_length(btrim(request_text)) between 1 and 2000),
  constraint personal_record_requests_response_length check (response_text is null or char_length(btrim(response_text)) between 1 and 4000),
  -- Pending has no answer yet; Answered always has its text and time.
  constraint personal_record_requests_answer_complete check (
    (status = 'Pending' and response_text is null and responded_at is null)
    or (status = 'Answered' and response_text is not null and responded_at is not null)
  )
);

create index if not exists personal_record_requests_resident_idx on public.personal_record_requests (resident_id, requested_at desc);
create index if not exists personal_record_requests_requested_at_idx on public.personal_record_requests (requested_at desc, id);

alter table public.personal_record_requests enable row level security;

drop policy if exists "residents read own records requests, staff and admin read all" on public.personal_record_requests;
create policy "residents read own records requests, staff and admin read all"
on public.personal_record_requests for select to authenticated
using (resident_id = auth.uid() or public.requester_role() in ('staff', 'admin'));

-- No insert, update or delete rule: with row level security on, a user session cannot write. Taking the rights away as
-- well makes that plain (the server key is not affected).
revoke insert, update, delete, truncate on public.personal_record_requests from anon, authenticated;
grant select on public.personal_record_requests to authenticated;
grant all on public.personal_record_requests to service_role;

comment on table public.personal_record_requests is
  'A resident''s request for a copy of the records the barangay holds about them (RA 10173), and the office''s answer (FT-18, migration 23). Written only by the server (app/api/record-requests).';
