import { NextResponse } from 'next/server';
import { canExportMonthlyFiles, buildMonthlyManifest, EXPORT_BUCKETS, isAllowedMonthlyExportMonth, splitMonthlyExportParts, type ExportCandidate } from '@/lib/monthlyFileExport';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { loadFileRecords } from '@/lib/server/monthlyFiles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SIGNED_URL_SECONDS = 600;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

type SignedUrlRow = { path: string; signedUrl: string | null; error?: string | null };

// The file list comes from lib/server/monthlyFiles.ts (shared with the clean-up); files already removed after an earlier
// export (migration 26) are left out, since they are no longer in Storage.
async function loadCandidates(db: ReturnType<typeof supabaseAdmin>) {
  const { records, applicationReferences } = await loadFileRecords(db);
  const candidates: ExportCandidate[] = records.filter(r => !r.removedAt).map(({ bucket, path, createdAt, sizeLimit }) => ({ bucket, path, createdAt, sizeLimit }));
  return { candidates, applicationReferences };
}

async function signedUrlsForPart(
  db: ReturnType<typeof supabaseAdmin>,
  files: ReturnType<typeof splitMonthlyExportParts>[number],
) {
  const urls = new Map<string, string>();
  for (const bucket of EXPORT_BUCKETS) {
    const group = files.filter(file => file.bucket === bucket);
    if (!group.length) continue;
    const paths = group.map(file => file.path);
    const { data, error } = await db.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error || !data || data.length !== paths.length) return undefined;
    for (let i = 0; i < data.length; i++) {
      const signed = data[i] as SignedUrlRow;
      if (!signed.signedUrl || signed.error) return undefined;
      urls.set(JSON.stringify([bucket, paths[i]]), signed.signedUrl);
    }
  }
  return urls;
}

export async function POST(request: Request) {
  const me = await currentUser();
  if ('error' in me) return me.error;
  if (!canExportMonthlyFiles(me.user.role)) return fail('Only Staff and Admin can export uploaded files.', 403);

  let body: { month?: unknown; part?: unknown };
  try { body = await request.json(); } catch { return fail('The export request could not be read.'); }
  if (typeof body.month !== 'string' || !Number.isSafeInteger(body.part) || Number(body.part) < 1) {
    return fail('Choose a valid month and export part.');
  }
  const month = body.month, partNumber = Number(body.part);
  if (!isAllowedMonthlyExportMonth(month)) return fail('Choose a month from 2025-01 through the current Manila month.');

  const db = supabaseAdmin();
  let candidates: ExportCandidate[], applicationReferences: Map<number, string>;
  try {
    ({ candidates, applicationReferences } = await loadCandidates(db));
  } catch (error) {
    return fail((error as Error).message, 503);
  }

  let files: ReturnType<typeof buildMonthlyManifest>, parts: ReturnType<typeof splitMonthlyExportParts>;
  try {
    files = buildMonthlyManifest(month, candidates, applicationReferences);
    parts = splitMonthlyExportParts(files);
  } catch {
    return fail('The monthly file list could not be safely prepared.', 503);
  }
  if (!parts.length) {
    return NextResponse.json({ month, part: 0, parts: 0, file_count: 0, files: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (partNumber > parts.length) return fail('That export part is no longer available. Reload the month and try again.', 404);
  const selected = parts[partNumber - 1];

  let auditError: unknown;
  try {
    ({ error: auditError } = await db.from('audit_logs').insert({
      user_id: me.user.id,
      role: me.user.role,
      action: 'files_exported',
      application_id: null,
      reference_no: null,
      old_value: null,
      new_value: { month, part: partNumber, parts: parts.length, file_count: selected.length },
      reason: null,
      reversion: false,
    }));
  } catch {
    return fail('The export could not be recorded. No download was started.', 503);
  }
  if (auditError) return fail('The export could not be recorded. No download was started.', 503);

  let urls: Map<string, string> | undefined;
  try {
    urls = await signedUrlsForPart(db, selected);
  } catch {
    return fail('Could not prepare every file URL for this part. No download was started.', 503);
  }
  if (!urls) return fail('Could not prepare every file URL for this part. No download was started.', 503);

  return NextResponse.json({
    month,
    part: partNumber,
    parts: parts.length,
    file_count: selected.length,
    files: selected.map(file => ({
      bucket: file.bucket,
      path: file.path,
      reference: file.reference,
      fileType: file.fileType,
      createdDate: file.createdDate,
      signedUrl: urls.get(JSON.stringify([file.bucket, file.path])),
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
