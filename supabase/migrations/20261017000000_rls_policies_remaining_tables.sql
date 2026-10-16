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
