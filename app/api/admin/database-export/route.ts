// DB-10: the monthly database export (the paper's 3.3.2 and 3.7.2: "the database shall be exported regularly" and kept
// on the office computer and a second drive). Admin only. Reads every table with the server key, writes ONE
// "database_exported" audit entry BEFORE any data leaves, and returns a ZIP: a JSON file per table, the sign-in
// accounts without passwords, a manifest (rows and SHA-256 per file) and a README. Uploaded files are in the monthly
// files ZIP instead (app/api/files/monthly-export).
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { zipSync, strToU8 } from 'fflate';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { AUTH_USERS_FILE, EXPORT_FORMAT, EXPORT_README, EXPORT_TABLES, exportFileName, type ExportManifest } from '@/lib/databaseExport';
import { today } from '@/lib/workflow';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const PAGE = 1000;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

async function readTable(db: ReturnType<typeof supabaseAdmin>, table: string, order: string) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select('*').order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function readAccounts(db: ReturnType<typeof supabaseAdmin>) {
  const accounts: unknown[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error('Could not read the sign-in accounts: ' + error.message);
    // Only what is needed to recreate an account; never a password (Supabase does not hand those out anyway).
    accounts.push(...data.users.map(u => ({ id: u.id, email: u.email ?? null, phone: u.phone ?? null, created_at: u.created_at,
      email_confirmed_at: u.email_confirmed_at ?? null, phone_confirmed_at: u.phone_confirmed_at ?? null, last_sign_in_at: u.last_sign_in_at ?? null,
      banned_until: (u as { banned_until?: string }).banned_until ?? null })));
    if (data.users.length < PAGE) return accounts;
  }
}

export async function POST() {
  const me = await currentUser();
  if ('error' in me) return me.error;
  if (me.user.role !== 'admin') return fail('Only Admin can export the database.', 403);
  const db = supabaseAdmin();

  // Log first: if the export cannot be recorded, nothing is handed out.
  const { error: auditError } = await db.from('audit_logs').insert({
    user_id: me.user.id, role: me.user.role, action: 'database_exported', application_id: null, reference_no: null,
    old_value: null, new_value: { format: EXPORT_FORMAT, tables: EXPORT_TABLES.length }, reason: null, reversion: false,
  });
  if (auditError) return fail('The export could not be recorded. Nothing was exported.', 503);

  const files: Record<string, Uint8Array> = {};
  const manifest: ExportManifest = { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), exportedBy: `${me.user.firstName} ${me.user.lastName}`.trim(), files: [] };
  const add = (file: string, rows: unknown[]) => {
    const bytes = strToU8(JSON.stringify(rows, null, 1));
    files[file] = bytes;
    manifest.files.push({ file, rows: rows.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  };
  try {
    for (const { table, order } of EXPORT_TABLES) add(table + '.json', await readTable(db, table, order));
    add(AUTH_USERS_FILE, await readAccounts(db));
  } catch (e) {
    return fail((e as Error).message + ' Nothing was exported; try again.', 503);
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1));
  files['README.txt'] = strToU8(EXPORT_README);
  const zip = zipSync(files, { level: 6 });
  return new NextResponse(Buffer.from(zip), { headers: {
    'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${exportFileName(today())}"`, 'Cache-Control': 'no-store',
  } });
}
