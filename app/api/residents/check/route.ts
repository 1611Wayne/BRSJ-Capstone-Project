import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { loadAccountCheck } from '@/lib/server/accountChecks';
import { isRealAccount } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

// DB-11 account checks (migration 21): GET /api/residents/check?id=… shows whether a resident's ID was checked and
// whether the account is flagged as spam. POST { residentId, action, reason } changes that:
//   'verify'  Staff or Admin confirm the resident's ID (once; it lifts the one-open-request limit)
//   'flag'    Staff or Admin flag the account as spam, with a reason (it stops new submissions)
//   'unflag'  Admin clears the flag
// Only resident accounts; every change is audited.
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function staffOrAdmin() {
  const me = await currentUser(); if ('error' in me) return me;
  if (me.user.role !== 'staff' && me.user.role !== 'admin') return { error: fail('Only Staff and Admin can check accounts.', 403) };
  return me;
}

export async function GET(request: Request) {
  const me = await staffOrAdmin(); if ('error' in me) return me.error;
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!isRealAccount(id)) return fail('Resident not found.', 404);
  try {
    const check = await loadAccountCheck(supabaseAdmin(), id);
    return check ? NextResponse.json({ check }) : fail('Resident not found.', 404);
  } catch (e) { return fail((e as Error).message, 500); }
}

export async function POST(request: Request) {
  const me = await staffOrAdmin(); if ('error' in me) return me.error;
  const body = await request.json().catch(() => null) as { residentId?: unknown; action?: unknown; reason?: unknown } | null;
  const residentId = String(body?.residentId ?? ''), action = String(body?.action ?? ''), reason = String(body?.reason ?? '').trim().slice(0, 300);
  if (!isRealAccount(residentId)) return fail('Resident not found.', 404);
  if (!['verify', 'flag', 'unflag'].includes(action)) return fail('Unknown account action.');
  if (action === 'unflag' && me.user.role !== 'admin') return fail('Only Admin can clear a spam flag.', 403);
  if (action === 'flag' && !reason) return fail('Give a reason for the spam flag.');

  const db = supabaseAdmin(), now = new Date().toISOString();
  const { data: person } = await db.from('profiles').select('id, role').eq('id', residentId).maybeSingle();
  if (!person || person.role !== 'resident') return fail('Only resident accounts are checked here.', 404);
  const changes = action === 'verify' ? { id_verified_at: now, id_verified_by: me.user.id }
    : action === 'flag' ? { spam_flagged_at: now, spam_flagged_by: me.user.id, spam_reason: reason }
    : { spam_flagged_at: null, spam_flagged_by: null, spam_reason: null };
  const { error } = await db.from('profiles').update(changes).eq('id', residentId);
  if (error) return fail((/column/i.test(error.message) ? 'The account checks are not set up yet: run migration 21 on Supabase. ' : 'Not saved: ') + error.message, 500);
  const label = action === 'verify' ? 'Resident ID checked by Staff' : action === 'flag' ? 'Account flagged as spam' : 'Spam flag cleared';
  await db.from('audit_logs').insert({ user_id: me.user.id, role: me.user.role, action: label, application_id: null, reference_no: null, new_value: { account: residentId }, reason: reason || null });
  try { return NextResponse.json({ check: await loadAccountCheck(db, residentId) }); } catch (e) { return fail((e as Error).message, 500); }
}
