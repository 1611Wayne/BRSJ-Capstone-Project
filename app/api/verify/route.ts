import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabase/server';
import { BUSINESS_SEARCH_LIMIT, businessSearchPattern, validBusinessSearch } from '@/lib/businessVerification';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
// Exact name only: escaped LIKE wildcards cannot turn this into a public directory.
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('businessName') || '';
  if (!validBusinessSearch(name)) return NextResponse.json({ error: 'Enter the full business name (2–160 characters).' }, { status: 400, headers });
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Search is unavailable. Please try again later.' }, { status: 503, headers });
  try {
    const { data, error } = await supabaseAdmin().from('applications')
      .select('reference_no,business_name,status,clearance_types!inner(name),clearances!inner(issue_date,revised_from),official_receipts!inner(or_number),simulated_payments(reference_number)')
      .ilike('business_name', businessSearchPattern(name)).eq('clearance_types.name', 'Business Clearance')
      .in('status', ['Ready for Download', 'Closed - Cleared', 'Void', 'Under Review'])
      .is('simulated_payments', null)
      .order('reference_no', { ascending: false }).limit(BUSINESS_SEARCH_LIMIT);
    if (error) throw error;
    const one = (v: any) => Array.isArray(v) ? v[0] : v;
    const results = (data || []).filter((r: any) =>
      r.business_name?.toLowerCase() === name.trim().toLowerCase() &&
      one(r.clearance_types)?.name === 'Business Clearance' && one(r.clearances)?.issue_date &&
      one(r.official_receipts)?.or_number && !one(r.simulated_payments) &&
      ['Ready for Download', 'Closed - Cleared', 'Void', 'Under Review'].includes(r.status))
      .map((r: any) => ({ businessName: r.business_name, reference: r.reference_no, clearanceType: 'Business Clearance',
        issueDate: one(r.clearances).issue_date,
        status: r.status === 'Void' ? 'Void' : r.status === 'Under Review' ? 'Under Review' : one(r.clearances).revised_from ? 'Revised' : 'Valid' }));
    return NextResponse.json({ results }, { headers });
  } catch {
    return NextResponse.json({ error: 'Search is unavailable. Please try again later.' }, { status: 503, headers });
  }
}
