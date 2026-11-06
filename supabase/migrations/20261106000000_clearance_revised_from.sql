-- Migration 14: keep a withdrawn clearance's original issue date on the application (IN PROGRESS, 2026-11-06).
--
-- An Admin correction (Transaction Reversion, FT-6) that changes the OR number, the clearance type or the fee
-- assessment withdraws the clearance: its row in public.clearances is removed until Staff verify the payment again.
-- The original issue date must survive that gap, so the new clearance is marked REVISED with it (manuscript: the
-- REVISED watermark with the original date). The frontend field is Application.clearanceRevisedFrom.
--
-- Nullable, no default: existing rows are untouched. Re-runnable.

alter table public.applications add column if not exists clearance_revised_from date;

comment on column public.applications.clearance_revised_from is
  'Original issue date of a clearance withdrawn by an Admin correction; the next clearance is marked REVISED with it.';
