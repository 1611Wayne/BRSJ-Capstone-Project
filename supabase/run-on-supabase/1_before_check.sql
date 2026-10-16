-- STEP 1 of 3. READ-ONLY. Paste into the Supabase SQL Editor and run. It changes nothing.
-- It shows what the database looks like BEFORE the migrations, so you can tell me anything unexpected.
--
-- WHAT YOU SHOULD SEE (one table, 9 rows):
--   rows 1-5  : value 0 for every "rows in ..." line (nothing has been saved yet)
--   row 6     : 13 / 13   (13 active of 13 clearance types: the old list, before the migration makes it 9)
--   rows 7-9  : false     (the new columns and table do not exist yet)
-- If any of that differs, STOP and send me the table before running step 2.

select item, value
from (
  select 1 as n, 'rows in applications' as item, count(*)::text as value from public.applications
  union all select 2, 'rows in application_documents', count(*)::text from public.application_documents
  union all select 3, 'rows in official_receipts', count(*)::text from public.official_receipts
  union all select 4, 'rows in audit_logs', count(*)::text from public.audit_logs
  union all select 5, 'rows in correction_requests', count(*)::text from public.correction_requests
  union all select 6, 'clearance types (active / total)', (count(*) filter (where active))::text || ' / ' || count(*)::text from public.clearance_types
  union all select 7, 'applications.business_subcategory exists (false expected)',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'applications' and column_name = 'business_subcategory')::text
  union all select 8, 'applications.has_employees exists (false expected)',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'applications' and column_name = 'has_employees')::text
  union all select 9, 'payment_verifications table exists (false expected)',
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'payment_verifications')::text
) t
order by n;
