// DB-10 clean-up, by hand (Admin > Reports > Remove Exported Files): preview a month, then remove the files of its
// finished requests from Storage once its grace period is over and both backups were downloaded (lib/fileCleanup.ts).
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { previewCleanup, removeMonthFiles } from '@/lib/server/fileCleanup';
import { isAllowedMonthlyExportMonth } from '@/lib/monthlyFileExport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  const me = await currentUser();
  if ('error' in me) return me.error;
  if (me.user.role !== 'admin') return reply({ error: 'Only Admin can remove exported files.' }, 403);
  let body: { month?: unknown; action?: unknown; expected?: unknown };
  try { body = await request.json(); } catch { return reply({ error: 'The request could not be read.' }, 400); }
  if (typeof body.month !== 'string' || !isAllowedMonthlyExportMonth(body.month)) return reply({ error: 'Choose a month from 2025-01 through the current month.' }, 400);
  const db = supabaseAdmin();
  try {
    if (body.action === 'preview') return reply(await previewCleanup(db, body.month));
    if (body.action !== 'remove') return reply({ error: 'Choose preview or remove.' }, 400);
    if (!Number.isSafeInteger(body.expected)) return reply({ error: 'Preview the month first.' }, 400);
    const done = await removeMonthFiles(db, body.month, { id: me.user.id, role: me.user.role, trigger: 'manual' }, Number(body.expected));
    return done.ok ? reply({ removed: done.removed, failed: done.failed, summary: done.summary }) : reply({ error: done.error, summary: done.summary }, done.status);
  } catch (e) {
    return reply({ error: (e as Error).message }, 503);
  }
}
