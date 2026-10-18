import 'server-only';
import { NextResponse } from 'next/server';
import type { User } from '@/types';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { supabaseForRequest } from '@/lib/supabase/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export type CurrentUser = User & { role: 'resident' | 'staff' | 'admin' };

// Who is making this request, from the session cookie, with the role and status the DATABASE gives them.
// Returns a ready error response instead when nobody is signed in or the account is inactive.
export async function currentUser(): Promise<{ user: CurrentUser } | { error: NextResponse }> {
  if (!useSupabaseAuth) return { error: NextResponse.json({ error: 'Real sign-in is not switched on.' }, { status: 404 }) };
  const { data: { user } } = await supabaseForRequest().auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 }) };
  const { data: p } = await supabaseAdmin().from('profiles')
    .select('id, first_name, last_name, email, contact_number, address, role, status, created_at').eq('id', user.id).single();
  if (!p) return { error: NextResponse.json({ error: 'Your account has no profile yet. Ask the barangay office.' }, { status: 404 }) };
  if (p.status !== 'Active') return { error: NextResponse.json({ error: 'This account is inactive. Ask the barangay office.' }, { status: 403 }) };
  return { user: { id: p.id, firstName: p.first_name, lastName: p.last_name, email: p.email ?? '', password: '', role: p.role, status: p.status, createdAt: p.created_at, contact: p.contact_number ?? '', address: p.address ?? '' } };
}
