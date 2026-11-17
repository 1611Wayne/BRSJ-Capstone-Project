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

## Monthly database dump (Supabase project owner)

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

## Not built yet

No automatic deletion or cleanup job is included. Any deletion of exported-month files, replaced documents, or abandoned-draft files waits for the retention decision (SE-6). Preserve records required for QR verification, annual reports, and National Archives rules; do not delete files until that retention policy is approved and the export/restore process has been tested.
