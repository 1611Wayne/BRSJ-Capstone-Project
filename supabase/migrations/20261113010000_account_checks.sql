-- Migration 21: account checks before real use (DB-11) (IN PROGRESS, 2026-11-13).
--
-- 1. ID checked: a resident who registered online starts UNCHECKED. Until Staff confirm their ID once (on the
--    assessment page of one of their requests), they can have only one open request (the server checks it,
--    app/api/applications). Walk-in residents are checked at the counter (Staff see the person).
-- 2. Spam flag: Staff (or Admin) can flag an account as spam with a reason; a flagged account cannot submit new requests
--    until Admin clears the flag (or deactivates the account in User Management).
-- Only the server writes these columns: since migration 19 a person can update only their own blank address, mobile
-- number and ID file, so they cannot mark themselves checked or clear a flag.
--
-- Residents who already exist are counted as checked, so nobody is blocked by this change (the test accounts included).
-- Re-runnable.

alter table public.profiles add column if not exists id_verified_at timestamptz;
alter table public.profiles add column if not exists id_verified_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists spam_flagged_at timestamptz;
alter table public.profiles add column if not exists spam_flagged_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists spam_reason text;

do $$
begin
  -- Only on the first run: if no resident is checked yet, every existing resident becomes checked (as of this migration).
  if not exists (select 1 from public.profiles where id_verified_at is not null) then
    update public.profiles set id_verified_at = now() where role = 'resident' and id_verified_at is null;
  end if;
end $$;

comment on column public.profiles.id_verified_at is 'When Staff confirmed this resident''s ID once (null = not checked yet: one open request at a time). Residents who existed before migration 21 were counted as checked.';
comment on column public.profiles.spam_flagged_at is 'When Staff or Admin flagged this account as spam (null = not flagged). A flagged account cannot submit new requests until Admin clears it.';
