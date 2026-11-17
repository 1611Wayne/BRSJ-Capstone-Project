import { manilaDate } from '@/lib/workflow';

export const MAX_FILES_PER_PART = 100;
export const MAX_BYTES_PER_PART = 100_000_000;
export const MAX_VALID_ID_BYTES = 5 * 1024 * 1024;

export const EXPORT_BUCKETS = ['application-documents', 'receipt-photos', 'valid-ids'] as const;
export type ExportBucket = typeof EXPORT_BUCKETS[number];
export type ExportFileType = 'Application document' | 'Receipt photo' | 'Valid ID';

export type ExportCandidate = {
  bucket: ExportBucket;
  path: string;
  createdAt: string;
  sizeLimit: number;
};

export type MonthlyExportFile = ExportCandidate & {
  reference: string;
  fileType: ExportFileType;
  createdDate: string;
};

export function manilaMonthRange(month: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error('Month must use YYYY-MM format.');
  const year = Number(match[1]);
  if (year < 1 || year > 9998) throw new Error('Month year is out of range.');

  const localMidnightUtc = (monthIndex: number) => {
    const date = new Date(0);
    date.setUTCFullYear(year, monthIndex, 1);
    date.setUTCHours(-8, 0, 0, 0);
    return date.toISOString();
  };
  const monthIndex = Number(match[2]) - 1;
  return {
    from: localMidnightUtc(monthIndex),
    until: localMidnightUtc(monthIndex + 1),
  };
}

export function isInManilaMonth(timestamp: string, range: { from: string; until: string }) {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value >= Date.parse(range.from) && value < Date.parse(range.until);
}

export function mapStoragePath(
  bucket: ExportBucket,
  path: string,
  applicationReferences: ReadonlyMap<number, string>,
): { reference: string; fileType: ExportFileType } | undefined {
  if (path.length > 1024 || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
  const parts = path.split('/');
  if (parts.length !== 2 || parts.some(part => !part || part === '.' || part === '..')) return undefined;

  if (bucket === 'valid-ids') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[0])) return undefined;
    return { reference: '', fileType: 'Valid ID' };
  }

  if (!/^[1-9]\d*$/.test(parts[0])) return undefined;
  const reference = applicationReferences.get(Number(parts[0]));
  if (!reference) return undefined;
  return {
    reference,
    fileType: bucket === 'receipt-photos' ? 'Receipt photo' : 'Application document',
  };
}

export function buildMonthlyManifest(
  month: string,
  candidates: ExportCandidate[],
  applicationReferences: ReadonlyMap<number, string>,
): MonthlyExportFile[] {
  const range = manilaMonthRange(month);
  const files: MonthlyExportFile[] = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(Date.parse(candidate.createdAt))) throw new Error('A file has no valid export date.');
    if (!isInManilaMonth(candidate.createdAt, range)) continue;
    if (!Number.isSafeInteger(candidate.sizeLimit) || candidate.sizeLimit <= 0 || candidate.sizeLimit > MAX_BYTES_PER_PART) {
      throw new Error('A file has an invalid size for export.');
    }
    const mapped = mapStoragePath(candidate.bucket, candidate.path, applicationReferences);
    if (!mapped) throw new Error('A file path could not be mapped to its record.');
    files.push({ ...candidate, ...mapped, createdDate: manilaDate(candidate.createdAt) });
  }
  return files.sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt) || a.bucket.localeCompare(b.bucket) || a.path.localeCompare(b.path));
}

export function splitMonthlyExportParts(files: MonthlyExportFile[]) {
  const parts: MonthlyExportFile[][] = [];
  let current: MonthlyExportFile[] = [];
  let currentBytes = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.sizeLimit) || file.sizeLimit <= 0 || file.sizeLimit > MAX_BYTES_PER_PART) {
      throw new Error('A file exceeds the per-part size limit.');
    }
    if (current.length && (current.length >= MAX_FILES_PER_PART || currentBytes + file.sizeLimit > MAX_BYTES_PER_PART)) {
      parts.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.sizeLimit;
  }
  if (current.length) parts.push(current);
  return parts;
}

export function canExportMonthlyFiles(role: unknown): role is 'staff' | 'admin' {
  return role === 'staff' || role === 'admin';
}
