import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { supabaseForRequest } from '@/lib/supabase/session';

export const dynamic = 'force-dynamic';

// POST /api/account/signed-in: the Login page (and the reset-link page) calls this right after a successful sign-in, so
// the Audit Trail shows sign-ins (DB-7; the Audit Trail mock-up 3.3.3.26 lists "user authentications").
// One entry per REAL Supabase sign-in: the entry carries Supabase's own sign-in time, and a second call for the same
// sign-in adds nothing, so calling this by hand cannot pad the log. How the person signed in comes from Supabase's own
// record in the session (the "amr" claim), not from the browser.
const HOW: Record<string, string> = { password: 'email and password', otp: 'text code', sms: 'text code', recovery: 'reset link', magiclink: 'email link' };
const FRESH_MINUTES = 5;

export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  const supabase = supabaseForRequest();
  const { data: { user } } = await supabase.auth.getUser();
  const signedInAt = user?.last_sign_in_at ?? '';
  if (!user || !(Date.now() - Date.parse(signedInAt) < FRESH_MINUTES * 60_000)) return NextResponse.json({ logged: false });

  const db = supabaseAdmin();
  const { data: last } = await db.from('audit_logs').select('new_value').eq('user_id', me.user.id).like('action', 'Signed in%').order('id', { ascending: false }).limit(1).maybeSingle();
  if ((last?.new_value as { signedInAt?: string } | null)?.signedInAt === signedInAt) return NextResponse.json({ logged: false });

  const { data: claims } = await supabase.auth.getClaims();
  const amr = (claims?.claims as { amr?: { method?: string }[] } | undefined)?.amr ?? [];
  const method = amr.map(a => a.method ?? '').find(m => HOW[m]) ?? '';
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
  const { error } = await db.from('audit_logs').insert({
    user_id: me.user.id, role: me.user.role, action: 'Signed in' + (HOW[method] ? ` (${HOW[method]})` : ''), application_id: null, reference_no: null,
    new_value: { account: me.user.id, signedInAt, method: method || 'unknown' }, ip_address: ip,
  });
  if (error) return NextResponse.json({ error: 'The sign-in was not logged: ' + error.message }, { status: 500 });
  return NextResponse.json({ logged: true });
}
