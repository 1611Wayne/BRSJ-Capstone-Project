// DB-10 clean-up rule (the user, 2026-11-18, for SE-6): uploaded files are kept per month, with 14 days' grace after the
// month for the backup; then the files of FINISHED requests are removed from Storage. The records always stay.
// Shared by the Admin button (app/api/admin/file-cleanup) and the daily automatic run (app/api/cron/file-cleanup).
import { isInManilaMonth, manilaMonthRange } from './monthlyFileExport';

export const FINISHED_STATUSES = ['Closed - Cleared', 'Rejected', 'Void'];
export const GRACE_DAYS = 14;
export const REMOVABLE_BUCKETS = ['application-documents', 'receipt-photos'];   // never valid IDs: they prove identity

type Audit = { action: string; created_at: string; new_value: Record<string, unknown> | null };
export type CleanupFile = { bucket: string; path: string; createdAt: string; status: string | null; removedAt: string | null };

// The month's grace ends 14 days after it does: removal is allowed from the 15th of the next month (Manila).
export function cleanupDueDate(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return `${next}-${String(GRACE_DAYS + 1).padStart(2, '0')}`;
}

// Were the month's backups taken AFTER the month ended (so they hold every file of it)? The files ZIP counts only
// when every part 1..N of one export was downloaded; the database export only needs to be later than the month's end.
export function backupsTaken(month: string, audits: Audit[]) {
  const end = manilaMonthRange(month).until;
  const after = audits.filter(a => a.created_at >= end);
  const sets = new Map<number, Map<number, number>>();   // parts -> (part -> file count)
  for (const a of after) {
    if (a.action !== 'files_exported' || a.new_value?.month !== month) continue;
    const parts = Number(a.new_value.parts), part = Number(a.new_value.part), count = Number(a.new_value.file_count);
    if (!Number.isInteger(parts) || !Number.isInteger(part) || part < 1 || part > parts) continue;
    if (!sets.has(parts)) sets.set(parts, new Map());
    sets.get(parts)!.set(part, count);
  }
  let filesExported: number | null = null;
  for (const [parts, got] of sets) if (got.size === parts) filesExported = Math.max(filesExported ?? 0, [...got.values()].reduce((s, n) => s + n, 0));
  const databaseExport = after.filter(a => a.action === 'database_exported').map(a => a.created_at).sort()[0] ?? null;
  return { filesExported, databaseExport };
}

// What removing a month's files would do, and what stops it. Nothing is removed when there is any blocker.
export function planCleanup(month: string, files: CleanupFile[], audits: Audit[], today: string) {
  const range = manilaMonthRange(month);
  const inMonth = files.filter(f => isInManilaMonth(f.createdAt, range));
  const stored = inMonth.filter(f => !f.removedAt);
  const removable = stored.filter(f => REMOVABLE_BUCKETS.includes(f.bucket) && f.status !== null && FINISHED_STATUSES.includes(f.status));
  const keptOpen = stored.filter(f => REMOVABLE_BUCKETS.includes(f.bucket) && !(f.status !== null && FINISHED_STATUSES.includes(f.status)));
  const keptIds = stored.filter(f => f.bucket === 'valid-ids');
  const due = cleanupDueDate(month);
  const backups = backupsTaken(month, audits);
  const blockers: string[] = [];
  if (today < due) blockers.push(`The 14-day grace period runs until ${due}.`);
  if (backups.filesExported === null) blockers.push(`Download this month's uploaded files ZIP (Monthly Collection Report) after the month ended.`);
  else if (backups.filesExported < stored.length) blockers.push(`Files were added after the files ZIP was downloaded (${backups.filesExported} exported, ${stored.length} now): download the month's files ZIP again.`);
  if (!backups.databaseExport) blockers.push('Download a database export (Reports > Database Export) after the month ended.');
  return { month, due, blockers, remove: removable, keptOpen: keptOpen.length, keptIds: keptIds.length, alreadyRemoved: inMonth.length - stored.length, ...backups };
}

// The months the automatic run looks at: from 2025-01 to the last month whose grace period is over.
export function dueMonths(today: string): string[] {
  const out: string[] = [];
  for (let y = 2025, m = 1; ; m++) {
    if (m > 12) { y++; m = 1; }
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (cleanupDueDate(month) > today) return out;
    out.push(month);
  }
}
