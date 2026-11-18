// Server side only in practice (it is handed the server-key client); no secrets of its own, so tests can load it.
import { MAX_BYTES_PER_PART, MAX_VALID_ID_BYTES, type ExportCandidate } from '@/lib/monthlyFileExport';
import type { supabaseAdmin } from '@/lib/supabase/server';

// Every uploaded file the database points to, dated the same way for the monthly files export (Angelo, DB-10) and the
// clean-up after it (migration 26): documents by upload time (else the request date), receipt photos by payment
// submission (else when the receipt was recorded), valid IDs by account creation. Each record also says which row it
// belongs to, the request's status and whether the file was already removed from Storage.
export type FileRecord = ExportCandidate & {
  table: 'application_documents' | 'official_receipts' | 'profiles';
  rowId: number | string;
  status: string | null;          // the request's status (null for valid IDs)
  removedAt: string | null;       // set once the file was removed after the monthly export
};
type RelatedOne<T> = T | T[] | null | undefined;
type ApplicationRow = {
  id: number; reference_no: string; date_requested: string | null; status: string;
  application_documents?: { id: number; storage_path: string | null; file_size: number | null; uploaded_at: string | null; file_removed_at: string | null }[] | null;
  official_receipts?: RelatedOne<{ id: number; receipt_photo_path: string | null; receipt_photo_size: number | null; recorded_at: string | null; receipt_photo_removed_at: string | null }>;
  payment_verifications?: RelatedOne<{ submitted_at: string | null }>;
};
const PAGE_SIZE = 1000;
const one = <T,>(value: RelatedOne<T>): T | undefined => Array.isArray(value) ? value[0] : value ?? undefined;

export async function loadFileRecords(db: ReturnType<typeof supabaseAdmin>) {
  const applications: ApplicationRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db.from('applications')
      .select('id, reference_no, date_requested, status, application_documents(id, storage_path, file_size, uploaded_at, file_removed_at), official_receipts(id, receipt_photo_path, receipt_photo_size, recorded_at, receipt_photo_removed_at), payment_verifications(submitted_at)')
      .order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error('Could not read application file references.');
    const page = (data ?? []) as ApplicationRow[];
    applications.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const applicationReferences = new Map(applications.map(row => [row.id, row.reference_no]));
  const records: FileRecord[] = [];
  for (const application of applications) {
    for (const document of application.application_documents ?? []) {
      if (!document.storage_path) continue;
      records.push({ bucket: 'application-documents', path: document.storage_path, createdAt: document.uploaded_at || application.date_requested || '',
        sizeLimit: document.file_size ?? MAX_BYTES_PER_PART, table: 'application_documents', rowId: document.id, status: application.status, removedAt: document.file_removed_at });
    }
    const receipt = one(application.official_receipts);
    if (receipt?.receipt_photo_path) {
      records.push({ bucket: 'receipt-photos', path: receipt.receipt_photo_path, createdAt: one(application.payment_verifications)?.submitted_at || receipt.recorded_at || '',
        sizeLimit: receipt.receipt_photo_size ?? MAX_BYTES_PER_PART, table: 'official_receipts', rowId: receipt.id, status: application.status, removedAt: receipt.receipt_photo_removed_at });
    }
  }
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db.from('profiles').select('id, valid_id_path, created_at')
      .not('valid_id_path', 'is', null).order('created_at', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error('Could not read valid ID references.');
    for (const profile of data ?? []) records.push({ bucket: 'valid-ids', path: profile.valid_id_path, createdAt: profile.created_at,
      sizeLimit: MAX_VALID_ID_BYTES, table: 'profiles', rowId: profile.id, status: null, removedAt: null });
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { records, applicationReferences };
}
