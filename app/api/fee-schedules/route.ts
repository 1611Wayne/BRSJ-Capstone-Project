import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { loadFeeSchedules } from '@/lib/server/feeSchedules';

export const dynamic = 'force-dynamic';

// GET /api/fee-schedules: every fee schedule from the database, for Staff assessment and Admin corrections, so the
// screens pick schedules by their database id (the sample schedules' ids mean nothing to the server).
export async function GET() {
  const me = await currentUser(); if ('error' in me) return me.error;
  if (me.user.role === 'resident') return NextResponse.json({ error: 'Only Staff and Admin can read the fee schedules here.' }, { status: 403 });
  try {
    const schedules = (await loadFeeSchedules(supabaseAdmin())).map(({ categoryId: _c, classificationId: _k, ...s }) => s);
    return NextResponse.json({ schedules });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
