import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { supabaseForRequest } from '@/lib/supabase/session';
import { mobileForms } from '@/lib/phone';

export const dynamic = 'force-dynamic';

// Residents' own Profile page (decided 2026-11-12):
//  - the address they change themselves;
//  - a new mobile number only after a text code to THAT number confirms it (it is also their "Text me a code" sign-in
//    number, so a typo would lock them out);
//  - name and email are not changed here: the barangay office (Admin, User Management) changes them, because the name
//    is checked against their ID and the email is their sign-in (Supabase's own email cannot confirm a new address).
// Every change is audited.
//
// POST /api/profile { action: 'address', address }          saves the address
// POST /api/profile { action: 'checkMobile', mobile }       before the code is sent: is the number valid and free?
// POST /api/profile { action: 'mobileConfirmed' }           after the code: copies the confirmed sign-in number to the profile

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function numberTakenBy(db: SupabaseClient, forms: NonNullable<ReturnType<typeof mobileForms>>, self: string) {
  const { data } = await db.from('profiles').select('id').in('contact_number', [forms.local, forms.international, forms.stored]).neq('id', self).limit(1).maybeSingle();
  return !!data;
}

export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  if (me.user.role !== 'resident') return fail('Only residents change their own profile here.', 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  const db = supabaseAdmin();
  const audit = (action: string, oldValue: unknown, newValue: unknown) => db.from('audit_logs').insert({ user_id: me.user.id, role: 'resident', action, application_id: null, reference_no: null, old_value: oldValue, new_value: newValue });

  if (action === 'address') {
    const address = String(body?.address ?? '').trim().slice(0, 300);
    if (!address) return fail('Enter your complete address.');
    if (address === me.user.address) return NextResponse.json({ user: me.user });
    const { error } = await db.from('profiles').update({ address }).eq('id', me.user.id);
    if (error) return fail('Your address was not saved: ' + error.message, 500);
    await audit('Profile updated by the resident (address)', { account: me.user.id, address: me.user.address }, { account: me.user.id, address });
    return NextResponse.json({ user: { ...me.user, address } });
  }

  if (action === 'checkMobile') {
    const forms = mobileForms(String(body?.mobile ?? ''));
    if (!forms) return fail('Enter a mobile number like 09171234567.');
    if (forms.local === me.user.contact) return fail('This is already your mobile number.');
    if (await numberTakenBy(db, forms, me.user.id)) return fail('This mobile number is already on another account. If it is yours, ask the barangay office.', 409);
    return NextResponse.json({ phone: forms.international });
  }

  if (action === 'mobileConfirmed') {
    // The browser has just confirmed the code (Supabase "phone change"); the sign-in now carries the new number.
    const { data: { user } } = await supabaseForRequest().auth.getUser();
    const forms = mobileForms(user?.phone ?? '');
    if (!user || !forms) return fail('The new number is not confirmed yet. Enter the code we sent.');
    if (forms.local === me.user.contact) return NextResponse.json({ user: me.user });
    if (await numberTakenBy(db, forms, me.user.id)) return fail('This mobile number is already on another account. Ask the barangay office.', 409);
    const { error } = await db.from('profiles').update({ contact_number: forms.local }).eq('id', me.user.id);
    if (error) return fail('Your new number was confirmed, but the profile was not updated: ' + error.message, 500);
    await audit('Mobile number changed by the resident (confirmed by text code)', { account: me.user.id, contact: me.user.contact }, { account: me.user.id, contact: forms.local });
    return NextResponse.json({ user: { ...me.user, contact: forms.local } });
  }

  return fail('Unknown profile action.');
}
