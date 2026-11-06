import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { supabaseForRequest } from '@/lib/supabase/session';
import { mobileForms } from '@/lib/phone';

export const dynamic = 'force-dynamic';

// POST /api/profile/complete: a resident who signed up with a text code finishes registering (the same facts the
// Register page asks for): name, address, an optional email, a valid ID and privacy consent. The ID was uploaded by the
// browser into the person's own folder of the private valid-ids bucket; it is checked here. The mobile number is taken
// from the sign-in itself and saved in the 09XXXXXXXXX form the rest of the app uses.
export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  if (me.user.role !== 'resident') return NextResponse.json({ error: 'Only residents complete their registration here.' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'The request could not be read.' }, { status: 400 }); }
  const text = (key: string) => String(body[key] ?? '').trim();
  const firstName = text('firstName'), lastName = text('lastName'), address = text('address'), email = text('email').toLowerCase(), validIdPath = text('validIdPath');
  if (!firstName || !lastName || !address) return NextResponse.json({ error: 'Enter your first name, last name and full address.' }, { status: 400 });
  if (body.privacyConsent !== true) return NextResponse.json({ error: 'Please agree to the Privacy Notice to continue.' }, { status: 400 });
  const db = supabaseAdmin();
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email address, or leave it empty.' }, { status: 400 });
    const { data: taken } = await db.from('profiles').select('id').eq('email', email).neq('id', me.user.id).limit(1);
    if (taken?.length) return NextResponse.json({ error: 'This email is already used by another account.' }, { status: 409 });
  }
  const { data: profile } = await db.from('profiles').select('valid_id_path, privacy_consent_at, contact_number').eq('id', me.user.id).single();
  let idPath = profile?.valid_id_path ?? null;
  if (validIdPath) {
    const [folder, file, ...rest] = validIdPath.split('/');
    const { data: objects } = folder === me.user.id && file && !rest.length ? await db.storage.from('valid-ids').list(folder, { search: file, limit: 10 }) : { data: [] };
    const object = (objects ?? []).find(o => o.name === file);
    const size = Number(object?.metadata?.size ?? 0), mime = String(object?.metadata?.mimetype ?? '');
    if (!object || size <= 0 || size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'application/pdf'].includes(mime)) return NextResponse.json({ error: 'Your ID was not uploaded. Please choose the file again.' }, { status: 400 });
    idPath = validIdPath;
  }
  if (!idPath) return NextResponse.json({ error: 'Upload a photo or PDF of a valid ID.' }, { status: 400 });

  // The number this person signed in with, in the app's own form (unless another account already has it).
  const { data: { user: authUser } } = await supabaseForRequest().auth.getUser();
  const forms = mobileForms(authUser?.phone ? '+' + authUser.phone : profile?.contact_number ?? '');
  const changes: Record<string, unknown> = { first_name: firstName, last_name: lastName, address, valid_id_path: idPath,
    privacy_consent_at: profile?.privacy_consent_at ?? new Date().toISOString(), ...(email ? { email } : {}) };
  if (forms && profile?.contact_number !== forms.local) {
    const { data: other } = await db.from('profiles').select('id').in('contact_number', [forms.local, forms.international, forms.stored]).neq('id', me.user.id).limit(1);
    if (!other?.length) changes.contact_number = forms.local;
  }
  const { error } = await db.from('profiles').update(changes).eq('id', me.user.id);
  if (error) return NextResponse.json({ error: 'Your details could not be saved: ' + error.message }, { status: 500 });
  await db.from('audit_logs').insert({ user_id: me.user.id, role: 'resident', action: 'Registration completed after signing in by text', reference_no: null, application_id: null,
    new_value: { name: `${firstName} ${lastName}`, privacy_consent: 'Given on the Complete Registration page', email: email || null } });
  return NextResponse.json({ ok: true });
}
