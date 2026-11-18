# Monthly export and backup procedure

**To be tested by the Supabase owner before relying on this procedure.**

Checked against Supabase CLI 3.2.0 (`npx --yes supabase --version`). Before the first dump, run `supabase db dump --help` on your own machine and use the flags printed by your installed version.

## Monthly Staff/Admin report and file export

1. In the Staff or Admin portal, open **Reports → Monthly Collection Report** and choose the month.
2. Use **Export** to save the collection report CSV.
3. Use **Download uploaded files ZIP** to download the month's uploaded files. If the browser downloads several numbered parts, keep every part; each contains its own `manifest.csv`.
4. Confirm the CSV and every ZIP part downloaded successfully. Keep them on the office computer and a second drive.

The CSV, ZIPs, database dumps, and uploaded files contain personal data, including government IDs and receipts, and must be kept in accordance with RA 10173 on an encrypted or access-controlled drive. Do not email them or commit them to Git. Storage files are not included in a database dump; the monthly file ZIP is a separate export.

The export uses database pointers rather than listing every Storage folder: listing per application folder would take about 1,000 Storage calls for 500 applications, plus up to 500 valid-ID folders. The route makes two paginated database reads at that scale (applications and profiles), then one signed-URL request per non-empty bucket in each part. Application documents use `uploaded_at` (fallback: application `date_requested`); receipt photos use payment `submitted_at` (fallback: receipt `recorded_at`); valid IDs use profile `created_at`. These timestamps are proxies, not Storage object `created_at`; unpointed replaced or abandoned objects are not included.

## Monthly database export (Admin) — the regular backup

1. In the Admin portal, open **Reports** and use **Download database export (ZIP)** on the **Database Export** card.
2. The file is `san-jose-database-YYYY-MM-DD.zip`: one JSON file per table (all 25 tables), `auth_users.json` (the
   sign-in accounts, without passwords), `manifest.json` (rows and SHA-256 per file) and a `README.txt`.
3. Keep it together with the month's report CSV and files ZIP, on the office computer and the second drive.

Only Admin can make it, and every export is written to the Audit Trail (`database_exported`) before any data is sent.
Uploaded files are not in it (they are in the files ZIP above), and neither are passwords: after a restore from this
export, people set a new password with "Forgot password?".

**Restore test.** The project's restore test (`restore_test.mjs` in the team's local QA folder) rebuilds the database
from the migrations on a scratch copy, loads an export ZIP, and checks every checksum, every row count, every link
between tables, that new reference numbers continue, and that the audit log still refuses edits. It was run on the
first real export (2026-11-18): 5,619 rows, 46 links, all checks passed. Run it again on an export after any new
migration.

## Full database dump (optional, Supabase project owner)

The Admin export above is the monthly backup. A full `pg_dump` copy is optional, for example before a large change or
at handover; it needs the Supabase command line and Docker or the PostgreSQL client tools, and the database password.

Run after the month's records are ready for backup, using the approved Supabase account and project. Authenticate and select/link the intended project using the owner's normal secure CLI process; do not put credentials in this guide, in command history, or in the repository. `--remote` targets the linked project (or a remote target supported by the installed CLI).

From a secure working folder on the office computer, create separate schema and data SQL files. These commands use only `supabase db dump` flags confirmed by `npx --yes supabase db dump --help`:

```powershell
npx --yes supabase db dump --remote --file "san-jose-YYYY-MM-schema.sql"
npx --yes supabase db dump --remote --data-only --file "san-jose-YYYY-MM-data.sql"
```

Replace `YYYY-MM` with the month being backed up. Do not put either file in the repository. Keep both files together and copy them to the second drive.

### Check and test the dump

1. Confirm both commands exit successfully and both output files exist and are non-empty. Record each file's size and SHA-256 hash; after copying, compare the second-drive copies' sizes and hashes with the office-computer originals.
2. Restore both files, in schema-then-data order, into a disposable local scratch PostgreSQL/Supabase database that is not connected to the hosted project. Supply its connection string through the owner's secure local environment; do not print or save it in this repository.

   ```powershell
   psql "$env:DB10_SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f ".\san-jose-YYYY-MM-schema.sql"
   psql "$env:DB10_SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f ".\san-jose-YYYY-MM-data.sql"
   ```

3. Treat any restore error as a failed backup. Verify that expected application tables and representative records are present in the scratch database, and compare the restored record counts with the owner's approved source checks for the same backup time. Record the test result and date without recording credentials or resident details. Re-create the scratch database before a later restore test so existing objects cannot hide omissions.
4. Only after a successful check, retain the two dump files on the office computer and second drive under the office's access-control and retention rules. This guide does not prescribe a retention period.

## Removing exported files (retention rule, 2026-11-18)

**Rule** (decided by the team for SE-6): uploaded files are kept for their month plus a 14-day grace period for the
backup. From the 15th of the next month, the files of **finished** requests (Closed - Cleared, Rejected, Void) can be
removed from Supabase Storage. **Valid IDs are never removed** (they prove identity, for example when a representative
comes), files of requests still in progress stay until those requests are finished, and **the records always stay**
(QR verification, reports and audit history keep working; an opened file then says it was removed after the monthly
export and is kept in that month's files ZIP).

Nothing is removed unless, after the month ended, **both** backups were downloaded: every part of the month's files ZIP
and a database export. If files were added after the files ZIP was downloaded, it must be downloaded again.

- **By hand:** Admin → Reports → **Remove Exported Files**: choose the month, **Preview** (what would be removed, what
  stays, which backup is missing), tick that the backups are saved, then **Remove**.
- **Automatically:** once the app is on Vercel, `vercel.json` runs `/api/cron/file-cleanup` every day at 02:00 Manila
  time. Set the environment variable `CRON_SECRET` in Vercel (a long random value; Vercel sends it with each run). It
  removes only months that pass every check above; a month still missing a backup is left alone.

Every removal writes a `files_removed` entry in the Audit Trail listing every removed file, before anything is deleted.
Replaced documents and abandoned drafts that no record points to are not removed by this (not built).
