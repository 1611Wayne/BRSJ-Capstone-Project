-- Storage: three PRIVATE buckets and who may read and upload into each. Generated 2026-10-17.
-- Depends on 20261017000000_rls_policies_remaining_tables.sql (the helper functions).
--
-- WHAT IS STORED WHERE (the database keeps only the object path; see SCHEMA_MAP.md):
--   valid-ids              profiles.valid_id_path                    path  <profile uuid>/<file>
--   application-documents  application_documents.storage_path        path  <application id>/<file>
--   receipt-photos         official_receipts.receipt_photo_path      path  <application id>/<file>
-- The first folder of the path is what the rules look at. Use a NEW file name for every upload (for example
-- a timestamp prefix): objects cannot be overwritten or deleted from a user session, so a replaced document or
-- receipt keeps its earlier file (that is the evidence trail; clean-up is a server job).
--
-- WHY PRIVATE: IDs and Treasury receipts are personal data (the Data Privacy Act treats government-issued
-- identifiers as sensitive personal information). A private bucket has no public URL; a file is opened only through a
-- short-lived signed link that the server (or a signed-in user the rules allow) asks for.
--
-- WHO MAY READ
--   valid-ids              the owner of that folder; Staff and Admin
--   application-documents  the owner of that application; Staff and Admin
--   receipt-photos         the owner of that application; Staff and Admin
-- WHO MAY UPLOAD (INSERT only; there is no update or delete policy, so objects are write-once)
--   valid-ids              the owner into their own folder; Staff and Admin (a walk-in Applicant's ID)
--   application-documents  the owner while the application is a Draft, Pending Assessment or Under Review
--                          (the statuses in which the workflow lets a document be added or replaced); Staff and Admin
--   receipt-photos         the owner while the application is Awaiting OR (where the receipt is uploaded, or uploaded
--                          again after Staff returned it); Staff and Admin (an Applicant who cannot upload)
-- Uploading a file does not change any record: the server still writes the database row, the status and the audit log.
--
-- LIMITS (also checked by the app): 5 MB per file; PDF, JPG or PNG only.
--
-- RE-RUNNABLE ON PURPOSE: buckets are upserted and every policy is "drop policy if exists" then create.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('valid-ids',             'valid-ids',             false, 5242880, array['application/pdf', 'image/jpeg', 'image/png']),
  ('application-documents', 'application-documents', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png']),
  ('receipt-photos',        'receipt-photos',        false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The application id in a path like "123/file.jpg": the first folder, only if it is a plain number and the
-- object really is inside a folder. Anything else gives null, which no policy accepts (no cast errors).
create or replace function public.storage_application_id(object_name text)
returns bigint
language sql
immutable
as $$
  select case
    when position('/' in object_name) > 1 and split_part(object_name, '/', 1) ~ '^[0-9]{1,18}$'
    then split_part(object_name, '/', 1)::bigint
  end;
$$;

-- The owner folder of a path like "<uuid>/file.png": the first folder as text, only if the object is inside a folder.
create or replace function public.storage_owner_folder(object_name text)
returns text
language sql
immutable
as $$
  select case when position('/' in object_name) > 1 then split_part(object_name, '/', 1) end;
$$;

grant execute on function public.storage_application_id(text) to authenticated, service_role;
grant execute on function public.storage_owner_folder(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- valid-ids
-- ---------------------------------------------------------------------------
drop policy if exists "storage: valid-ids read own folder, staff and admin read all" on storage.objects;
create policy "storage: valid-ids read own folder, staff and admin read all"
on storage.objects for select to authenticated
using (
  bucket_id = 'valid-ids'
  and (public.storage_owner_folder(name) = auth.uid()::text or public.requester_role() in ('staff', 'admin'))
);

drop policy if exists "storage: valid-ids upload into own folder, staff and admin anywhere" on storage.objects;
create policy "storage: valid-ids upload into own folder, staff and admin anywhere"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'valid-ids'
  and public.storage_owner_folder(name) is not null
  and (public.storage_owner_folder(name) = auth.uid()::text or public.requester_role() in ('staff', 'admin'))
);

-- ---------------------------------------------------------------------------
-- application-documents
-- ---------------------------------------------------------------------------
drop policy if exists "storage: application-documents read own application, staff and admin read all" on storage.objects;
create policy "storage: application-documents read own application, staff and admin read all"
on storage.objects for select to authenticated
using (
  bucket_id = 'application-documents'
  and public.can_read_application(public.storage_application_id(name))
);

drop policy if exists "storage: application-documents upload while the request is open for documents" on storage.objects;
create policy "storage: application-documents upload while the request is open for documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'application-documents'
  and public.storage_application_id(name) is not null
  and (
    (public.requester_role() in ('staff', 'admin') and public.application_status_for_caller(public.storage_application_id(name)) is not null)
    or (public.owns_application(public.storage_application_id(name))
        and public.application_status_for_caller(public.storage_application_id(name)) in ('Draft', 'Pending Assessment', 'Under Review'))
  )
);

-- ---------------------------------------------------------------------------
-- receipt-photos
-- ---------------------------------------------------------------------------
drop policy if exists "storage: receipt-photos read own application, staff and admin read all" on storage.objects;
create policy "storage: receipt-photos read own application, staff and admin read all"
on storage.objects for select to authenticated
using (
  bucket_id = 'receipt-photos'
  and public.can_read_application(public.storage_application_id(name))
);

drop policy if exists "storage: receipt-photos upload while the request awaits the receipt" on storage.objects;
create policy "storage: receipt-photos upload while the request awaits the receipt"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'receipt-photos'
  and public.storage_application_id(name) is not null
  and (
    (public.requester_role() in ('staff', 'admin') and public.application_status_for_caller(public.storage_application_id(name)) is not null)
    or (public.owns_application(public.storage_application_id(name))
        and public.application_status_for_caller(public.storage_application_id(name)) = 'Awaiting OR')
  )
);
