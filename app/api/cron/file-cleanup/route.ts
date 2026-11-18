// DB-10 clean-up, automatic: Vercel Cron calls this once a day (vercel.json) with "Authorization: Bearer <CRON_SECRET>".
// It removes the files of finished requests for every month whose 14-day grace period is over AND whose files ZIP and
// database export were downloaded after the month ended; a month still missing a backup is left alone. Each removal
// writes a "files_removed" audit entry (role "system", trigger "automatic") listing every path before deleting.
// Without CRON_SECRET (local runs, before deployment) it does nothing.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { runAutomaticCleanup } from '@/lib/server/fileCleanup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'The automatic clean-up is not set up (CRON_SECRET).' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  try {
    return NextResponse.json({ ranAt: new Date().toISOString(), months: await runAutomaticCleanup(supabaseAdmin()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
