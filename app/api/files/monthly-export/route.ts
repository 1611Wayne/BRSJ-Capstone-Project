import { NextResponse } from 'next/server';
import { canExportMonthlyFiles, buildMonthlyManifest, EXPORT_BUCKETS, isAllowedMonthlyExportMonth, MAX_BYTES_PER_PART, MAX_VALID_ID_BYTES, splitMonthlyExportParts, type ExportCandidate } from '@/lib/monthlyFileExport';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SIGNED_URL_SECONDS = 600;
const PAGE_SIZE = 1000;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

type RelatedOne<T> = T | T[] | null | undefined;
type DocumentRow = { storage_path: string | null; file_size: number | null; uploaded_at: string | null };
type ReceiptRow = { receipt_photo_path: string | null; receipt_photo_size: number | null; recorded_at: string | null };
type VerificationRow = { submitted_at: string | null };
type ApplicationRow = {
  id: number;
  reference_no: string;
  date_requested: string | null;
  application_documents?: DocumentRow[] | null;
  official_receipts?: RelatedOne<ReceiptRow>;
  payment_verifications?: RelatedOne<VerificationRow>;
};
type ProfileRow = { valid_id_path: string; created_at: string };
type SignedUrlRow = { path: string; signedUrl: string | null; error?: string | null };

const one = <T,>(value: RelatedOne<T>): T | undefined => Array.isArray(value) ? value[0] : value ?? undefined;
const many = <T,>(value: T[] | null | undefined): T[] => value ?? [];

async function loadCandidates(db: ReturnType<typeof supabaseAdmin>) {
  const applications: ApplicationRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db.from('applications')
      .select('id, reference_no, date_requested, application_documents(storage_path, file_size, uploaded_at), official_receipts(receipt_photo_path, receipt_photo_size, recorded_at), payment_verifications(submitted_at)')
      .order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error('Could not read application file references.');
    const page = (data ?? []) as ApplicationRow[];
    applications.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const applicationReferences = new Map(applications.map(row => [row.id, row.reference_no]));
  const candidates: ExportCandidate[] = [];
  for (const application of applications) {
    for (const document of many(application.application_documents)) {
      if (!document.storage_path) continue;
      candidates.push({
        bucket: 'application-documents',
        path: document.storage_path,
        createdAt: document.uploaded_at || application.date_requested || '',
        sizeLimit: document.file_size ?? MAX_BYTES_PER_PART,
      });
    }

    const receipt = one(application.official_receipts);
    if (receipt?.receipt_photo_path) {
      candidates.push({
        bucket: 'receipt-photos',
        path: receipt.receipt_photo_path,
        createdAt: one(application.payment_verifications)?.submitted_at || receipt.recorded_at || '',
        sizeLimit: receipt.receipt_photo_size ?? MAX_BYTES_PER_PART,
      });
    }
  }

  const profiles: ProfileRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db.from('profiles').select('valid_id_path, created_at')
      .not('valid_id_path', 'is', null).order('created_at', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error('Could not read valid ID references.');
    const page = (data ?? []) as ProfileRow[];
    profiles.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  for (const profile of profiles) {
    candidates.push({
      bucket: 'valid-ids',
      path: profile.valid_id_path,
      createdAt: profile.created_at,
      sizeLimit: MAX_VALID_ID_BYTES,
    });
  }
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
