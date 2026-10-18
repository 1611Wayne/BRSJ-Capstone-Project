-- Request reference numbers made by the database: SJ-YYYY-######, one counter per year (Manila time), starting at 1.
-- Generated 2026-10-18. Depends on 20261017000000_rls_policies_remaining_tables.sql.
--
-- WHY: the prototype made the next number in the browser ("highest number + 1"). With several people applying at the
-- same moment, two of them would get the same number. Here every new application takes the next value inside one
-- INSERT ... ON CONFLICT statement, which Postgres runs one at a time per year row, so numbers never repeat.
-- A failed or cancelled insert can leave a gap (a number nobody has); that is normal and harmless.
--
-- HOW IT IS USED: applications.reference_no now defaults to public.next_reference_no(), so an insert that leaves the
-- column out gets the next number. The year rolls over by itself (a new row in reference_counters).
--
-- RE-RUNNABLE ON PURPOSE: create ... if not exists, create or replace, and an idempotent default.

create table if not exists public.reference_counters (
  year integer primary key check (year between 2000 and 2999),
  last_value integer not null check (last_value > 0)
);
alter table public.reference_counters enable row level security;
-- Nobody reads or writes it through the API; only next_reference_no() (SECURITY DEFINER) touches it.
-- An explicit "nobody" policy says so on purpose (every table has at least one policy; after-check 17).
drop policy if exists "nobody uses the counters directly" on public.reference_counters;
create policy "nobody uses the counters directly" on public.reference_counters for select to authenticated using (false);
comment on table public.reference_counters is 'Last request reference number used per year (Manila time). Written only by next_reference_no().';

create or replace function public.next_reference_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer := extract(year from (now() at time zone 'Asia/Manila'))::integer;
  n integer;
begin
  insert into public.reference_counters as c (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into n;
  if n > 999999 then
    raise exception 'Reference numbers for % are used up (999999).', y;
  end if;
  return 'SJ-' || y::text || '-' || lpad(n::text, 6, '0');
end;
$$;

-- Callable by signed-in users (an Applicant's own draft insert uses the default) and the server; not by anonymous visitors.
revoke all on function public.next_reference_no() from public, anon;
grant execute on function public.next_reference_no() to authenticated, service_role;

alter table public.applications alter column reference_no set default public.next_reference_no();
