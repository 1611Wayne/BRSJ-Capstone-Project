-- STEP 3 of 3. READ-ONLY. Paste into the Supabase SQL Editor and run, after step 2.
-- It returns one table. The LAST row says ALL CHECKS PASSED, or lists how many failed.
-- If any row shows ok = false, send me the whole table.

with c as (
  select 1 as n, 'clearance types active = 9' as item, (select count(*) from public.clearance_types where active)::text as actual, '9' as expected
  union all select 2, 'clearance types inactive = 4', (select count(*) from public.clearance_types where not active)::text, '4'
  union all select 3, 'new table payment_verifications', (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'payment_verifications')::text, '1'
  union all select 4, 'new table simulated_payments', (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'simulated_payments')::text, '1'
  union all select 5, 'applications: 7 new columns (subcategory, employees x2, rejection x3, source)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'applications'
       and column_name in ('business_subcategory', 'has_employees', 'employee_count', 'rejection_reason', 'rejected_by', 'rejected_at', 'source'))::text, '7'
  union all select 6, 'application_documents.note exists', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'application_documents' and column_name = 'note')::text, '1'
  union all select 7, 'official_receipts: 4 receipt-photo columns',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'official_receipts' and column_name like 'receipt_photo_%')::text, '4'
  union all select 8, 'official_receipts.or_number may be empty (nullable)', (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'official_receipts' and column_name = 'or_number'), 'YES'
  union all select 9, 'assessment_items.scheduled_amount exists', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'assessment_items' and column_name = 'scheduled_amount')::text, '1'
  union all select 10, 'audit_logs.reversion exists', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'reversion')::text, '1'
  union all select 11, 'status list accepts Rejected and For Checking',
    (select (pg_get_constraintdef(oid) like '%Rejected%' and pg_get_constraintdef(oid) like '%For Checking%')::text from pg_constraint where conname = 'applications_status_check' and conrelid = 'public.applications'::regclass), 'true'
  union all select 12, 'document status list accepts Pending Review',
    (select (pg_get_constraintdef(oid) like '%Pending Review%')::text from pg_constraint where conname = 'application_documents_verification_status_check' and conrelid = 'public.application_documents'::regclass), 'true'
  union all select 13, 'one document per requirement per application', (select count(*) from pg_constraint where conname = 'application_documents_one_per_requirement')::text, '1'
  union all select 14, 'tables WITHOUT row level security (must be 0)', (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity)::text, '0'
  union all select 15, 'receipt_confirmations.confirmed_by exists (who confirmed a release)', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'receipt_confirmations' and column_name = 'confirmed_by')::text, '1'
  union all select 16, 'new table notifications (in-app notices for Applicants)', (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'notifications')::text, '1'
  union all select 17, 'tables with row level security but NO policy (must be 0)', (select count(*) from pg_tables t where t.schemaname = 'public' and t.rowsecurity and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename))::text, '0'
  union all select 18, 'storage: 3 PRIVATE buckets (valid-ids, application-documents, receipt-photos)', (select count(*) from storage.buckets where id in ('valid-ids', 'application-documents', 'receipt-photos') and not public)::text, '3'
  union all select 19, 'storage: 6 rules on uploaded files (read and upload for each bucket)', (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'storage: %')::text, '6'
  union all select 20, 'new applications get their reference number from the database', (select (pg_get_expr(d.adbin, d.adrelid) like '%next_reference_no()%')::text from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum where d.adrelid = 'public.applications'::regclass and a.attname = 'reference_no'), 'true'
  union all select 21, 'SAMPLE fee schedules loaded (23 schedules, 138 fee lines)', (select (count(distinct f.id) || ' / ' || count(i.id)) from public.fee_schedules f join public.fee_schedule_items i on i.fee_schedule_id = f.id where f.ordinance_reference like 'SAMPLE%'), '23 / 138'
)
select n, item, expected, actual, (expected = actual) as ok from c
union all
select 99, 'RESULT', 'all ok', case when (select count(*) from c where expected <> actual) = 0 then 'ALL CHECKS PASSED' else (select count(*) from c where expected <> actual)::text || ' CHECK(S) FAILED' end,
       (select count(*) from c where expected <> actual) = 0
order by n;
