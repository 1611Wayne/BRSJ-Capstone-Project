-- Migration 18: several fee schedule versions on the same effective date (IN PROGRESS, 2026-11-12).
--
-- Admin Fee Configuration now saves on the database (app/api/fee-schedules). Every save is a NEW version (the table is
-- append-only history, migration 1). Migration 1 allowed only one version per clearance type, category, classification
-- and effective date, so an Admin who saved a fee and then fixed a typo the same day would be refused. This removes that
-- one-per-day rule. The app already picks the version with the latest effective date, and among versions with the same
-- date the one saved last (activeSchedule in lib/workflow.ts), so the newest save wins and the older one stays as history.
--
-- An index on the same columns keeps the "which version is active" look-up fast.
--
-- Re-runnable.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.fee_schedules'::regclass and contype = 'u'
  loop
    execute format('alter table public.fee_schedules drop constraint %I', c.conname);
  end loop;
end $$;

create index if not exists fee_schedules_lookup_idx
  on public.fee_schedules (clearance_type_id, business_category_id, classification_id, effective_date desc, created_at desc);

comment on table public.fee_schedules is
  'Append-only version history. The row with the latest effective_date <= today (and, on the same date, the latest created_at), for a given (clearance_type, category, classification), is the active one — chosen in application code, not here. Several versions may share an effective date (migration 18).';
