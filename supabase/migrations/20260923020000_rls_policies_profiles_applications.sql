-- RLS policies: profiles and applications
-- Generated 2026-09-23. Depends on 20260922000000_init_schema.sql.
-- Context: ../../../CHANGES.md, "RLS policies" entry for this date.
--
-- SCOPE: only these two tables, on purpose — the two most obviously
-- ownership-scoped ones. Confirmed hierarchy: a resident sees/touches only
-- their own rows; staff can see broadly (to do their job) but doesn't get
-- blanket write access to other people's accounts; admin sees and manages
-- everything except other admin accounts (matches the prototype's existing
-- rule that admin accounts are handled outside the normal management path).
-- The remaining 17 tables are a deliberate follow-up, not an oversight.
--
-- WHAT RLS IS ACTUALLY FOR HERE: per the architecture decision, Next.js
-- server routes do most of their work using Supabase's service-role key,
-- which BYPASSES RLS entirely — none of this runs on that path. What it
-- protects against: a bug that accidentally uses the anon key instead, any
-- future feature that has the browser talk to Supabase directly (e.g.
-- realtime subscriptions), and leaving government data sitting behind
-- RLS-enabled-but-empty tables indefinitely, which Supabase's own dashboard
-- flags as a warning.
--
-- WHAT THESE POLICIES DELIBERATELY DO NOT DO: enforce the full application
-- workflow — which status can move to which, who can run which step of
-- assessment/OR/reversion. That stays in application code, same reasoning as
-- why OR-number-format checking isn't a database constraint either (see
-- migration 1's header). These policies answer two narrower, still-real
-- questions: "does this row belong to you," and two specific, high-value
-- guardrails (below) worth catching even at this layer.
--
-- TWO REAL GAPS FOUND AND CLOSED WHILE WRITING THIS — worth understanding,
-- not just trusting, since both were caught only by tracing through an
-- actual attack attempt, not by reading the SQL and assuming it was fine:
--   1. First draft let a resident updating their OWN profile slip a new
--      role value through, because the "am I allowed to touch this row"
--      check and "is the result acceptable" check used the same loose OR
--      condition. Fixed by moving role-change protection into its own
--      trigger (below), which sees the real before/after row directly
--      instead of trying to re-derive it inside a policy expression.
--   2. First draft let a resident updating their OWN draft application slip
--      a new STATUS through — e.g. jumping straight to 'Closed - Cleared'
--      in the same update that's supposed to just be editing a draft.
--      Fixed by restricting what status a resident's own update may result
--      in to exactly the two legitimate values (still Draft, or submitting
--      to Pending Assessment).
-- Neither gap would have been directly usable by a normal user through the
-- app's own UI — both require someone with a valid session making a raw API
-- call. Still worth closing, since that's exactly the kind of access RLS
-- exists to cover once the anon key or a user-context client is in the
-- picture at all.
--
-- NOT covered, deliberately, to keep this pass finite: column-level
-- protection beyond role (on profiles) and status (on applications) — e.g.
-- nothing stops a resident's own update from setting staff_encoder_id to an
-- arbitrary UUID, if they already knew one to use. Left alone because it
-- requires already knowing another user's UUID (not something the app
-- exposes), and because this is a defense-in-depth layer behind server-side
-- code that does the real checking, not the primary access control.

-- Looks up the CALLING user's role (resident/staff/admin) from profiles.
-- SECURITY DEFINER so it can read profiles despite RLS being enabled there —
-- without this, a policy on profiles that calls this function would need to
-- read profiles to evaluate itself (the classic RLS recursion trap).
-- Named requester_role(), not current_role(), to avoid confusion with
-- Postgres's own built-in CURRENT_ROLE, which is a different, unrelated
-- concept (the database login role, not our resident/staff/admin column).
create or replace function public.requester_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ============================================================================
-- profiles
-- ============================================================================

create policy "residents read own, staff and admin read all profiles"
on public.profiles for select
using (id = auth.uid() or public.requester_role() in ('staff', 'admin'));

create policy "residents update own profile, admin updates any"
on public.profiles for update
using (id = auth.uid() or public.requester_role() = 'admin')
with check (id = auth.uid() or public.requester_role() = 'admin');

-- Role protection lives here, not in the policy above — a trigger sees the
-- real OLD and NEW row directly, which avoids the self-referential-subquery
-- ambiguity that trying to compare old-vs-new role inside a WITH CHECK
-- expression would introduce.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
as $$
begin
  -- Touching another admin's row at all (any field) is blocked outright —
  -- matches the prototype's existing rule that admin accounts are managed
  -- outside this normal path. An admin editing their OWN row is fine.
  if old.role = 'admin' and old.id <> auth.uid() then
    raise exception 'Admin accounts cannot be changed here.';
  end if;

  if new.role is distinct from old.role then
    if public.requester_role() <> 'admin' then
      raise exception 'Only an admin can change a profile''s role.';
    end if;
    if new.role = 'admin' then
      raise exception 'Admin accounts cannot be created here.';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- No INSERT policy: the only sanctioned way a profile row is created is the
-- auto-profile trigger from migration 1, which runs as SECURITY DEFINER and
-- bypasses RLS — direct inserts through the API stay blocked for everyone.
-- No DELETE policy: nothing in this project ever hard-deletes a profile.

-- ============================================================================
-- applications
-- ============================================================================

create policy "residents read own, staff and admin read all applications"
on public.applications for select
using (resident_id = auth.uid() or public.requester_role() in ('staff', 'admin'));

-- A resident files their own, starting as Draft or going straight to
-- Pending Assessment, and can't claim to already have a staff encoder.
-- Staff/admin can file on a resident's behalf (the walk-in flow) with no
-- extra restriction — matches the prototype's existing rule.
create policy "residents file own, staff and admin file for anyone"
on public.applications for insert
with check (
  (resident_id = auth.uid() and status in ('Draft', 'Pending Assessment') and staff_encoder_id is null)
  or public.requester_role() in ('staff', 'admin')
);

-- A resident may only touch a row that is currently their own AND still a
-- Draft, and the result of that update must still be their own row, in
-- exactly Draft (still editing) or Pending Assessment (submitting it) —
-- nothing else. Staff/admin can update any application row; the detailed
-- rules for which specific transition is allowed when (assessment, OR
-- entry, reversion, etc.) are NOT enforced here — that stays in application
-- code, same as always.
create policy "residents update own draft, staff and admin update any"
on public.applications for update
using (
  (resident_id = auth.uid() and status = 'Draft')
  or public.requester_role() in ('staff', 'admin')
)
with check (
  (resident_id = auth.uid() and status in ('Draft', 'Pending Assessment'))
  or public.requester_role() in ('staff', 'admin')
);

-- No DELETE policy on applications either — nothing in this project deletes
-- an application; Void is a status, not a deletion (see migration 2's note
-- on why an auto-purge "trash bin" was decided against).
