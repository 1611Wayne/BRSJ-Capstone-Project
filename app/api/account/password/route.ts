import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { supabaseForRequest } from '@/lib/supabase/session';
import { placeholderEmail } from '@/lib/accountEmail';

export const dynamic = 'force-dynamic';

const FRESH_MINUTES = 15;

// POST /api/account/password { password, via }: "Forgot password?" on the Login page. The person has just signed in with
// a text code sent to the mobile number on their account (via 'code'), or with the reset link Supabase emailed them
// (via 'email', the /reset-password page; Supabase's own email, decided 2026-11-12: no outside email service). This
// sets their new password. Only within 15 minutes of that sign-in, so a session left open elsewhere cannot be used to
// take over the account. Audited without the password.
export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  const { data: { user } } = await supabaseForRequest().auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
  const signedInAt = Date.parse(user.last_sign_in_at ?? '');
  if (!(Date.now() - signedInAt < FRESH_MINUTES * 60_000)) return NextResponse.json({ error: 'For your safety, ask for a new code or reset link before changing your password.' }, { status: 403 });
  if (placeholderEmail(user.email)) return NextResponse.json({ error: 'Your account has no email to sign in with, so it signs in with a text code only.' }, { status: 400 });

  const body = await request.json().catch(() => null) as { password?: unknown; via?: unknown } | null;
  const via = body?.via === 'email' ? 'signed in by the emailed reset link' : 'signed in by text code';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (password.length < 8) return NextResponse.json({ error: 'Use at least 8 characters.' }, { status: 400 });
  if (password.length > 72) return NextResponse.json({ error: 'Use at most 72 characters.' }, { status: 400 });

  // Changed AS THE PERSON (their own session), not with the server key: Supabase then keeps this session and signs out
  // only their other ones. With the server key it signs out every session, this one too (auth source,
  // models.UpdatePassword with no session id; found 2026-11-12 by the page guard), leaving them signed out.
  const { error } = await supabaseForRequest().auth.updateUser({ password });
  if (error) return NextResponse.json({ error: /same|different from the old/i.test(error.message) ? 'Choose a password different from your old one.' : 'The password was not changed: ' + error.message }, { status: 400 });
  const db = supabaseAdmin();
  await db.from('audit_logs').insert({ user_id: me.user.id, role: me.user.role, action: `Password changed (forgot password, ${via})`, application_id: null, reference_no: null,
    new_value: { account: me.user.id } });
  return NextResponse.json({ ok: true });
}
