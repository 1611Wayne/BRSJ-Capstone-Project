import 'server-only';
import type { supabaseAdmin } from '@/lib/supabase/server';
import { planCleanup } from '@/lib/fileCleanup';
import { loadFileRecords, type FileRecord } from '@/lib/server/monthlyFiles';
import { today } from '@/lib/workflow';

type Db = ReturnType<typeof supabaseAdmin>;
type Actor = { id: string | null; role: string; trigger: 'manual' | 'automatic' };
const BATCH = 100;

async function context(db: Db) {
  const { records } = await loadFileRecords(db);
  const { data: audits, error } = await db.from('audit_logs').select('action, created_at, new_value').in('action', ['files_exported', 'database_exported']);
  if (error) throw new Error('Could not read the export history.');
  return { records, audits: (audits ?? []) as { action: string; created_at: string; new_value: Record<string, unknown> | null }[] };
}

// What removing a month's files would do (nothing is changed).
export async function previewCleanup(db: Db, month: string) {
  const { records, audits } = await context(db);
  return summary(planCleanup(month, records, audits, today()));
}
export function summary(plan: ReturnType<typeof planCleanup>) {
  return { month: plan.month, due: plan.due, blockers: plan.blockers, toRemove: plan.remove.length, keptOpen: plan.keptOpen, keptIds: plan.keptIds,
    alreadyRemoved: plan.alreadyRemoved, filesExported: plan.filesExported, databaseExport: plan.databaseExport };
}

// Removes the month's removable files: checks everything again, writes ONE "files_removed" audit entry listing every
// path BEFORE deleting, then deletes from Storage in batches and marks each row only after its file is gone (so a
// failure part-way can simply be run again). `expected` (from the preview the Admin saw) guards against changes.
export async function removeMonthFiles(db: Db, month: string, actor: Actor, expected?: number) {
  const { records, audits } = await context(db);
  const plan = planCleanup(month, records, audits, today());
  if (plan.blockers.length) return { ok: false as const, status: 409, error: plan.blockers.join(' '), summary: summary(plan) };
  if (expected !== undefined && expected !== plan.remove.length) return { ok: false as const, status: 409, error: 'The files changed since the preview. Preview again.', summary: summary(plan) };
  if (!plan.remove.length) return { ok: true as const, removed: 0, failed: 0, summary: summary(plan) };
  const { error: auditError } = await db.from('audit_logs').insert({
    user_id: actor.id, role: actor.role, action: 'files_removed', application_id: null, reference_no: null, old_value: null,
    new_value: { month, trigger: actor.trigger, files: plan.remove.length, keptOpen: plan.keptOpen, keptIds: plan.keptIds, paths: plan.remove.map(f => `${f.bucket}/${f.path}`) },
    reason: `Monthly clean-up after the files ZIP and the database export (kept ${plan.keptOpen} file(s) of unfinished requests and ${plan.keptIds} valid ID(s)).`, reversion: false,
  });
  if (auditError) return { ok: false as const, status: 503, error: 'The removal could not be recorded. Nothing was removed.', summary: summary(plan) };
  let removed = 0, failed = 0;
  for (const bucket of ['application-documents', 'receipt-photos']) {
    const group = plan.remove.filter(f => f.bucket === bucket) as FileRecord[];
    for (let i = 0; i < group.length; i += BATCH) {
      const batch = group.slice(i, i + BATCH);
      const { data, error } = await db.storage.from(bucket).remove(batch.map(f => f.path));
      // Storage answers with the objects it deleted; a path that was already gone is not listed but is gone all the same.
      if (error) { failed += batch.length; continue; }
      const gone = new Set((data ?? []).map(o => o.name));
      const done = batch.filter(f => gone.has(f.path) || !gone.size);
      const at = new Date().toISOString();
      const ids = done.map(f => f.rowId);
      const mark = bucket === 'application-documents'
        ? await db.from('application_documents').update({ file_removed_at: at }).in('id', ids)
        : await db.from('official_receipts').update({ receipt_photo_removed_at: at }).in('id', ids);
      if (mark.error) failed += done.length; else removed += done.length;
      failed += batch.length - done.length;
    }
  }
  return { ok: true as const, removed, failed, summary: summary(plan) };
}

// The daily automatic run (app/api/cron/file-cleanup): every month whose grace period is over and whose backups were
// downloaded gets its finished requests' files removed; a month still missing a backup is left alone and reported.
export async function runAutomaticCleanup(db: Db) {
  const { dueMonths } = await import('@/lib/fileCleanup');
  const { records, audits } = await context(db);
  const results: { month: string; removed: number; failed: number; waitingFor?: string }[] = [];
  for (const month of dueMonths(today())) {
    const plan = planCleanup(month, records, audits, today());
    if (!plan.remove.length) continue;
    if (plan.blockers.length) { results.push({ month, removed: 0, failed: 0, waitingFor: plan.blockers.join(' ') }); continue; }
    const done = await removeMonthFiles(db, month, { id: null, role: 'system', trigger: 'automatic' });
    results.push({ month, removed: done.ok ? done.removed : 0, failed: done.ok ? done.failed : plan.remove.length, ...(done.ok ? {} : { waitingFor: done.error }) });
  }
  return results;
}
