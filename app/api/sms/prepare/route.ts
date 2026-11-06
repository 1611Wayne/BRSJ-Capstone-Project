import { NextResponse } from 'next/server';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabase/server';
import { mobileForms } from '@/lib/phone';

export const dynamic = 'force-dynamic';

// POST /api/sms/prepare { mobile }: runs just before the browser asks Supabase to text a sign-in code.
// One number, one account (decided 2026-11-06): when the number is already on an account (registered with email, or a
// walk-in resident Staff registered), it is put on that account's sign-in so the code opens THAT account rather than
// creating a second one. Only the account whose own profile has the number is touched, and the code still goes only to
// that phone. The answer is the same whether or not an account exists, so nobody can probe which numbers are registered.
export async function POST(request: Request) {
  if (!useSupabaseAuth || !supabaseConfigured()) return NextResponse.json({ error: 'Sign-in by text is not switched on.' }, { status: 404 });
  let mobile = '';
  try { mobile = String((await request.json()).mobile ?? ''); } catch { /* answered below */ }
  const forms = mobileForms(mobile);
  if (!forms) return NextResponse.json({ error: 'Enter a mobile number like 09171234567.' }, { status: 400 });
  const db = supabaseAdmin();
  const { data: owners, error } = await db.from('profiles').select('id').in('contact_number', [forms.local, forms.international, forms.stored]);
  if (error) return NextResponse.json({ error: 'Could not check the number. Please try again.' }, { status: 500 });
  const linked = 'This number is on more than one account. Please ask the barangay office to fix it.';
  if ((owners ?? []).length > 1) return NextResponse.json({ error: linked }, { status: 409 });
  if (owners?.length === 1) {
    const { data } = await db.auth.admin.getUserById(owners[0].id);
    if (data.user && data.user.phone !== forms.stored) {
      const { error: linkError } = await db.auth.admin.updateUserById(owners[0].id, { phone: forms.international, phone_confirm: true });
      if (linkError) return NextResponse.json({ error: linked }, { status: 409 });
    }
  }
  return NextResponse.json({ phone: forms.international });
}
