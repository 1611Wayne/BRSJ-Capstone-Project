-- Migration 19: close the direct-write back doors (DB-6 part 2) (IN PROGRESS, 2026-11-12).
--
-- Every change to a request now goes through the app's server, which runs the shared rules (lib/workflow.ts) and writes
-- the audit log, using the server key (that key is not bound by these rules). Some access rules from migrations 4 and
-- 10 still let a SIGNED-IN person write directly with the public key (for example from the browser's developer tools),
-- skipping those checks and the audit log. The app itself never writes these rows that way (checked 2026-11-12):
--
--  1. applications: "residents file own, staff and admin file for anyone" (insert) and "residents update own draft,
--     staff and admin update any" (update). Staff could change any request's status or fees directly. Dropped.
--  2. application_documents: "owner adds / changes / removes documents of their own draft". A resident could add,
--     change or remove unreviewed document rows of their own draft without the server's file checks (type, size,
--     the file really being in storage); marking a document Verified was already refused. Dropped.
--  3. profiles: "residents update own profile, admin updates any". Registration (lib/supabase/register.ts) still needs
--     a new resident to fill in their own address, mobile number and ID file right after signing up, so this is
--     NARROWED: a person may only fill in those three when they are still empty. Everything else (name, email, status,
--     consent, a changed address or number) goes through the server: Profile page (app/api/profile; a new number only
--     after a text code), Admin User Management, Walk-in. The role guard from migration 4 stays.
--
-- Reading is unchanged. Marking one's own notices read (migration 10) is unchanged. File uploads (storage, migration 11)
-- are unchanged. Re-runnable.

-- 1. applications
drop policy if exists "residents file own, staff and admin file for anyone" on public.applications;
drop policy if exists "residents update own draft, staff and admin update any" on public.applications;

-- 2. application_documents
drop policy if exists "owner adds documents to their own draft" on public.application_documents;
drop policy if exists "owner changes documents of their own draft" on public.application_documents;
drop policy if exists "owner removes documents from their own draft" on public.application_documents;

-- 3. profiles: own row only, only three columns, and only to fill them in.
drop policy if exists "residents update own profile, admin updates any" on public.profiles;
drop policy if exists "people fill in their own profile" on public.profiles;
create policy "people fill in their own profile"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

revoke update on public.profiles from anon, authenticated;
grant update (address, contact_number, valid_id_path) on public.profiles to authenticated;

create or replace function public.profiles_fill_in_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only when a signed-in person changes their OWN row with the public key. The server key has no auth.uid().
  if auth.uid() is not null and old.id = auth.uid() then
    if (coalesce(old.address, '') <> '' and new.address is distinct from old.address)
       or (old.contact_number is not null and new.contact_number is distinct from old.contact_number)
       or (old.valid_id_path is not null and new.valid_id_path is distinct from old.valid_id_path) then
      raise exception 'Change your profile on the Profile page.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_fill_in_only on public.profiles;
create trigger profiles_fill_in_only
  before update on public.profiles
  for each row execute function public.profiles_fill_in_only();

comment on policy "people fill in their own profile" on public.profiles is
  'Registration only: a new resident fills in their own blank address, mobile number and ID file (column grants + trigger profiles_fill_in_only). Every other profile change goes through the server (migration 19).';
