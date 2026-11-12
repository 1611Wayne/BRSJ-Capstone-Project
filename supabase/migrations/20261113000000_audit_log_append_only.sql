-- Migration 20: the audit log can only grow (DB-7) (IN PROGRESS, 2026-11-13).
--
-- The paper calls the Audit Trail "immutable" (3.3.1 item 8, 3.3.1.1, 3.3.2 item 7, 3.3.2.1, 3.3.2.2). Nobody can write
-- the log with the public key (no write rule since migration 10), but the server key could still change or delete
-- entries. This trigger refuses that for EVERY role, the server key included:
--   - DELETE of an entry: refused.
--   - UPDATE of an entry: refused, except the two changes the database itself makes when a request or an account is
--     deleted (audit_logs.application_id and audit_logs.user_id are ON DELETE SET NULL, migration 1): clearing those
--     links, with every other column unchanged, is allowed, so deleting test data or an account still works.
--   - TRUNCATE (emptying the table): refused.
-- Adding entries is unchanged.
--
-- Handover clean-up (DB-12): the test data's own log entries can only be removed by the database owner in the SQL
-- Editor, deliberately and visibly:
--   alter table public.audit_logs disable trigger audit_logs_append_only;
--   alter table public.audit_logs disable trigger audit_logs_no_truncate;
--   ... delete the test entries ...
--   alter table public.audit_logs enable trigger audit_logs_append_only;
--   alter table public.audit_logs enable trigger audit_logs_no_truncate;
--
-- Re-runnable.

create or replace function public.audit_logs_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'The audit log cannot be changed: entries cannot be deleted.';
  end if;
  -- UPDATE: only the database's own link clearing when a request or account is deleted.
  if (new.application_id is null or new.application_id is not distinct from old.application_id)
     and (new.user_id is null or new.user_id is not distinct from old.user_id)
     and (new.application_id is distinct from old.application_id or new.user_id is distinct from old.user_id)
     and (to_jsonb(new) - 'application_id' - 'user_id') = (to_jsonb(old) - 'application_id' - 'user_id') then
    return new;
  end if;
  raise exception 'The audit log cannot be changed: entries cannot be edited.';
end;
$$;

drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_append_only();

create or replace function public.audit_logs_no_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The audit log cannot be changed: it cannot be emptied.';
end;
$$;

drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function public.audit_logs_no_truncate();

comment on table public.audit_logs is
  'Append-only audit trail (migration 20): entries can be added, never edited or deleted, by any role including the server key. The only allowed change is the database clearing application_id or user_id when that request or account is deleted.';
