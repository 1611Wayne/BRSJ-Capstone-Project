// DB-10: what the monthly database export contains (Admin, app/api/admin/database-export). Every table in the public
// schema (migrations 1 to 25), read in pages with the server key, one JSON file each, plus the sign-in accounts
// (without passwords: Supabase keeps those and never hands them out) and a manifest with each file's row count and
// SHA-256, so a restore can prove nothing is missing or changed. Uploaded files are NOT in it: they go in Angelo's
// monthly files ZIP (lib/monthlyFileExport.ts).
export const EXPORT_FORMAT = 1;
export const EXPORT_TABLES: { table: string; order: string }[] = [
  { table: 'clearance_types', order: 'id' },
  { table: 'business_categories', order: 'id' },
  { table: 'business_classifications', order: 'id' },
  { table: 'profiles', order: 'id' },
  { table: 'fee_schedules', order: 'id' },
  { table: 'fee_schedule_items', order: 'id' },
  { table: 'reference_counters', order: 'year' },
  { table: 'applications', order: 'id' },
  { table: 'application_documents', order: 'id' },
  { table: 'application_status_history', order: 'id' },
  { table: 'correction_requests', order: 'id' },
  { table: 'inspection_reports', order: 'id' },
  { table: 'assessments', order: 'id' },
  { table: 'assessment_items', order: 'id' },
  { table: 'payment_verifications', order: 'id' },
  { table: 'simulated_payments', order: 'id' },
  { table: 'official_receipts', order: 'id' },
  { table: 'clearances', order: 'id' },
  { table: 'receipt_confirmations', order: 'id' },
  { table: 'feedback', order: 'id' },
  { table: 'transaction_reversions', order: 'id' },
  { table: 'notifications', order: 'id' },
  { table: 'personal_record_requests', order: 'id' },
  { table: 'sms_sends', order: 'id' },
  { table: 'audit_logs', order: 'id' },
];
export const AUTH_USERS_FILE = 'auth_users.json';

export type ExportManifest = {
  format: number;
  exportedAt: string;
  exportedBy: string;
  files: { file: string; rows: number; sha256: string }[];
};

export const exportFileName = (manilaDate: string) => `san-jose-database-${manilaDate}.zip`;

export const EXPORT_README = `SAN JOSE CLEARANCE PORTAL - DATABASE EXPORT

This ZIP holds every record of the portal's database on the day in its name: one JSON file per table, the sign-in
accounts (auth_users.json, without passwords), and manifest.json with each file's row count and SHA-256.
Uploaded files (IDs, documents, receipt photos) are in the monthly files ZIP, not here.

IT CONTAINS PERSONAL DATA (RA 10173). Keep it on the office computer and on a second drive that only authorised
staff can open. Do not email it, post it, or put it in a shared folder or on GitHub.

To restore: rebuild the database from the migrations (Capstone-supabase run kit), then load each table's rows in the
order of manifest.json. After a restore, people set new passwords ("Forgot password?"), because passwords are never
exported. The project's restore test loads a ZIP like this one into a scratch database and checks every count,
checksum and link; run it on each new export before relying on it.
`;
