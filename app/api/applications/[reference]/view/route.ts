import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { logSensitiveView } from '@/lib/server/persist';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { reference: string } }) {
  const me = await currentUser();
  if ('error' in me) return me.error;
  const isStaff = me.user.role === 'staff' || me.user.role === 'admin';
  const { data: application, error } = await supabaseAdmin().from('applications')
    .select('id, resident_id, status, staff_encoder_id, reference_no')
    .eq('reference_no', params.reference).maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not verify access to this request.' }, { status: 500 });
  if (!application || (isStaff && application.status === 'Draft' && !application.staff_encoder_id)) {
    return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  }
  if (!isStaff && (me.user.role !== 'resident' || application.resident_id !== me.user.id)) {
    return NextResponse.json({ error: 'This request is not available to your account.' }, { status: 403 });
  }
  if (!isStaff) return NextResponse.json({ success: true, logged: false });

  try {
    const logged = await logSensitiveView(supabaseAdmin(), {
      action: 'record_view',
      actor: me.user,
      applicationId: application.id,
      reference: application.reference_no,
    });
    return NextResponse.json({ success: true, logged });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
