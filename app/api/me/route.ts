import { NextResponse } from 'next/server';
import type { User } from '@/types';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { supabaseForRequest } from '@/lib/supabase/session';

// GET /api/me: the signed-in person's own profile, with the role the DATABASE gives them (resident, staff, admin).
// Read as that user, so the access rules apply: a person can only ever read their own profile here.
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!useSupabaseAuth) return NextResponse.json({ error: 'Real sign-in is not switched on.' }, { status: 404 });
  const supabase = supabaseForRequest();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'You are not signed in.' }, { status: 401 });
  const { data: p, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email, contact_number, address, role, status, created_at, privacy_consent_at')
    .eq('id', user.id)
    .single();
  if (error || !p) return NextResponse.json({ error: 'Your account has no profile yet. Ask the barangay office.' }, { status: 404 });
  if (p.status !== 'Active') return NextResponse.json({ error: 'This account is inactive. Ask the barangay office.' }, { status: 403 });
  const me: User = {
    id: p.id, firstName: p.first_name, lastName: p.last_name, email: p.email ?? user.email ?? '', password: '',
    role: p.role, status: p.status, createdAt: p.created_at, contact: p.contact_number ?? '', address: p.address ?? '',
    ...(p.privacy_consent_at ? { privacyConsentAt: p.privacy_consent_at } : {}),
  };
  return NextResponse.json({ user: me });
}
