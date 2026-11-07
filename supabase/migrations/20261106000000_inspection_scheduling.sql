-- FT-9. Apply after the existing backend migrations; do not modify already-applied migration files.
-- Scheduling is optional. Existing inspection results remain unchanged.
begin;

alter table public.inspection_reports
  add column if not exists scheduled_at timestamptz;

comment on column public.inspection_reports.scheduled_at is
  'Planned inspection appointment. Staff enter Manila local time; stored as an absolute timestamp.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inspection_reports'::regclass
      and conname = 'inspection_schedule_requires_inspector'
  ) then
    alter table public.inspection_reports add constraint inspection_schedule_requires_inspector
      check (scheduled_at is null or length(btrim(inspector_name)) > 0);
  end if;
end;
$$;

create index if not exists inspection_reports_pending_schedule_idx
  on public.inspection_reports (scheduled_at)
  where status = 'Pending' and scheduled_at is not null;

commit;
