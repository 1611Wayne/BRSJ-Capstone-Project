-- Migration 22: Staff and Admin open files only through the server, so every opening is logged (SE-4) (IN PROGRESS, 2026-11-13).
-- Asked for in Angelo's PR #8 ("Not in this PR"). RUN IT ONLY AFTER PR #8 IS IN THE CODE EVERYONE RUNS: older code
-- opens files from the browser, and with this migration Staff previews in that older code stop working.
--
-- WHY: since PR #8, a Staff or Admin file opening goes through app/api/files/signed-url, which writes a file_view entry in
-- the audit log first and gives out a 5-minute link only if that entry was saved. But the storage read rules from
-- migration 7 (20261017010000) still let a signed-in Staff or Admin ask Supabase for a link directly, with the public key
-- and their own login (for example from the browser's developer tools), which skips the log.
--
-- WHAT CHANGES (the three private buckets valid-ids, application-documents, receipt-photos):
--   READ   before: the owner, Staff and Admin.   after: the owner only (a resident's own ID folder, or their own request).
--          Staff and Admin read through the server (it uses the server key, which these rules do not apply to).
--   UPLOAD unchanged (owner while the request is open for it; Staff and Admin for walk-ins). Uploads never overwrite
--          (upsert false), so they need no read rule.
-- Nothing in the app reads files with a Staff or Admin login after PR #8: the server routes that list, copy or sign
-- files (signed-url, applications, workflow, residents, profile/complete) all use the server key.
--
-- ALSO: an index for the "was this already logged in the last 5 minutes?" look-up that runs on every file and record
-- opening (by person, action and request, newest first), so it stays quick as the audit log grows. An index does not
-- change any entry, so it is allowed on the append-only log (migration 20).
--
-- RE-RUNNABLE, and safe when the whole run kit is pasted again: part 7 re-creates the old read rules, and this part
-- (which runs after it) removes them again. There are still 6 storage rules afterwards (3 read, 3 upload).

-- ---------------------------------------------------------------------------
-- The old read rules (owner + Staff + Admin) go.
-- ---------------------------------------------------------------------------
drop policy if exists "storage: valid-ids read own folder, staff and admin read all" on storage.objects;
drop policy if exists "storage: application-documents read own application, staff and admin read all" on storage.objects;
drop policy if exists "storage: receipt-photos read own application, staff and admin read all" on storage.objects;

-- ---------------------------------------------------------------------------
-- The new read rules: the owner only (Staff and Admin read through the server). Names stay under 63 characters.
-- ---------------------------------------------------------------------------
drop policy if exists "storage: valid-ids read own folder only" on storage.objects;
create policy "storage: valid-ids read own folder only"
on storage.objects for select to authenticated
using (
  bucket_id = 'valid-ids'
  and public.storage_owner_folder(name) = auth.uid()::text
);

drop policy if exists "storage: application-documents read own application only" on storage.objects;
create policy "storage: application-documents read own application only"
on storage.objects for select to authenticated
using (
  bucket_id = 'application-documents'
  and public.owns_application(public.storage_application_id(name))
);

drop policy if exists "storage: receipt-photos read own application only" on storage.objects;
create policy "storage: receipt-photos read own application only"
on storage.objects for select to authenticated
using (
  bucket_id = 'receipt-photos'
  and public.owns_application(public.storage_application_id(name))
);

-- ---------------------------------------------------------------------------
-- The look-up index for the 5-minute "count once" rule (lib/server/persist.ts, logSensitiveView).
-- ---------------------------------------------------------------------------
create index if not exists audit_logs_view_lookup_idx
  on public.audit_logs (user_id, action, application_id, created_at desc);
