-- Record WHO confirmed a release at the counter
-- Generated 2026-10-16. Depends on 20260922000000_init_schema.sql (receipt_confirmations, profiles).
-- Context: ../../../CHANGES.md ("D6 answered by the user" entry) and ../../SCHEMA_MAP.md.
--
-- WHY: the printed, stamped original of a clearance is released at the monitoring office (the digital
-- copy is only a backup). So Staff confirm the release for the Applicant at the counter, and the
-- frontend now records which Staff member did it (ReceiptConfirmation.confirmedBy). NULL means the
-- Applicant confirmed receipt themselves online.
--
-- RE-RUNNABLE ON PURPOSE (add column if not exists). Not yet run on the live project: it is part 4 of
-- run-on-supabase/2_run_migrations.sql, which can safely be run again after parts 1-3.

alter table public.receipt_confirmations
  add column if not exists confirmed_by uuid references public.profiles(id) on delete restrict;

comment on column public.receipt_confirmations.confirmed_by is
  'The Staff member who recorded the release of the printed original at the counter. NULL = the Applicant confirmed receipt themselves.';
