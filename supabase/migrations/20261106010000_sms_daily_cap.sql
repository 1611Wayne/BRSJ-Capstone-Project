-- Migration 15: a daily cap on sign-in texts (IN PROGRESS, 2026-11-06).
--
-- Every sign-in code costs Semaphore credit. Supabase's own limit (75 texts per hour for the whole project) still
-- allows 1,800 a day, more than the account's balance. The Send SMS hook (supabase/functions/send-sms-hook) is the one
-- place every text passes, even when someone calls Supabase directly with the public key, so it asks this function
-- before each send:
--   'number'  : that phone already got its daily share of codes (stops flooding a stranger's phone);
--   'project' : the whole project reached its daily cap (stops a bot draining the balance);
--   'ok'      : the send is recorded and may go ahead.
-- The caps are passed in by the hook, so changing them needs no migration. Rows older than two days are deleted on
-- every call: the log only ever holds the phone numbers it needs for counting.
--
-- Re-runnable.

create table if not exists public.sms_sends (
  id bigserial primary key,
  phone text not null,            -- as Supabase gives it to the hook, e.g. 639171234567
  sent_at timestamptz not null default now()
);
create index if not exists sms_sends_phone_sent_at on public.sms_sends (phone, sent_at);
create index if not exists sms_sends_sent_at on public.sms_sends (sent_at);

alter table public.sms_sends enable row level security;
-- Nobody reads or writes it through the API; only claim_sms_send() (SECURITY DEFINER) touches it.
-- An explicit "nobody" policy says so on purpose (every table has at least one policy; after-check 17).
drop policy if exists "nobody uses the sms log directly" on public.sms_sends;
create policy "nobody uses the sms log directly" on public.sms_sends for select to authenticated using (false);
comment on table public.sms_sends is 'Sign-in texts sent in the last two days, for the daily caps. Written only by claim_sms_send().';

create or replace function public.claim_sms_send(p_phone text, per_number integer, per_day integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n_number integer;
  n_all integer;
begin
  -- One check at a time, so two codes asked for at the same moment cannot both slip under a cap.
  perform pg_advisory_xact_lock(hashtext('public.sms_sends'));
  delete from public.sms_sends where sent_at < now() - interval '2 days';
  select count(*) into n_number from public.sms_sends where phone = p_phone and sent_at > now() - interval '24 hours';
  if n_number >= per_number then return 'number'; end if;
  select count(*) into n_all from public.sms_sends where sent_at > now() - interval '24 hours';
  if n_all >= per_day then return 'project'; end if;
  insert into public.sms_sends (phone) values (p_phone);
  return 'ok';
end;
$$;

-- Only the server (the hook, with the service key) may call it.
revoke all on function public.claim_sms_send(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_sms_send(text, integer, integer) to service_role;
