import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
type Row = Record<string, any>;
const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Row | undefined;

// GET /api/verify/<reference>: the public check behind the clearance's QR code. Anyone may ask, so it answers only what
// the verification page shows (reference, clearance type, issue date, status) and nothing about the person. A request
// counts as a clearance only once Staff verified its payment and the clearance was generated (the prototype's rule).
export async function GET(_request: Request, { params }: { params: { reference: string } }) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Not available.' }, { status: 404 });
  const reference = decodeURIComponent(params.reference ?? '').trim();
  if (!/^SJ-\d{4}-\d{6}$/.test(reference)) return NextResponse.json({ found: false });
  const { data: r } = await supabaseAdmin().from('applications')
    .select('reference_no, status, clearance_types ( name ), clearances ( issue_date, revised_from ), official_receipts ( or_number, receipt_photo_path ), simulated_payments ( reference_number )')
    .eq('reference_no', reference).maybeSingle();
  const c = one(r?.clearances), o = one(r?.official_receipts), sim = one(r?.simulated_payments);
  const evidence = !!(o?.or_number || o?.receipt_photo_path || sim);
  if (!r || !c || !evidence) return NextResponse.json({ found: false });
  const status = r.status === 'Void' ? 'Void' : r.status === 'Under Review' ? 'Under Review' : c.revised_from ? 'Revised' : 'Valid';
  return NextResponse.json({ found: true, reference: r.reference_no, clearanceType: one(r.clearance_types)?.name ?? '', issueDate: c.issue_date, status });
}
