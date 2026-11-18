-- Migration 26: mark uploaded files that were removed from Storage after the monthly export (DB-10 clean-up, 2026-11-18).
-- Retention rule (the user, for SE-6): uploaded files are kept per month, with 14 days' grace after the month for the
-- backup; then the files of FINISHED requests (Closed - Cleared, Rejected, Void) are removed from Storage, once that
-- month's files ZIP and a database export were downloaded after the month ended. Valid IDs are never removed (they
-- prove identity, for example when a representative comes). The RECORDS always stay; only the file goes, and these
-- columns say when, so the app shows "removed after the monthly export" instead of a broken link, and the monthly
-- files export skips it.
-- The removal itself is done by the server (app/api/admin/file-cleanup by Admin, app/api/cron/file-cleanup daily once
-- deployed), which writes a "files_removed" audit entry listing every path before deleting anything.
-- Re-runnable.

alter table public.application_documents add column if not exists file_removed_at timestamptz;
alter table public.official_receipts add column if not exists receipt_photo_removed_at timestamptz;

comment on column public.application_documents.file_removed_at is
  'When the file was removed from Storage after the monthly export (DB-10, migration 26); NULL = still stored. The record stays.';
comment on column public.official_receipts.receipt_photo_removed_at is
  'When the receipt photo was removed from Storage after the monthly export (DB-10, migration 26); NULL = still stored. The record stays.';
