import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { logSensitiveView } from '@/lib/server/persist';
import { supabaseAdmin } from '@/lib/supabase/server';
import { coalesceInFlight } from '@/lib/inFlightRequests';

export const dynamic = 'force-dynamic';
type RouteResult = { status: number; body: Record<string, unknown> };
const inFlightRecordViews = new Map<string, Promise<RouteResult>>();

export async function POST(_request: Request, { params }: { params: { reference: string } }) {
  const me = await currentUser();
  if ('error' in me) return me.error;
  const key = JSON.stringify([me.user.id, 'record_view', params.reference]);
  const response = await coalesceInFlight(inFlightRecordViews, key, async (): Promise<RouteResult> => {
    const isStaff = me.user.role === 'staff' || me.user.role === 'admin';
    const { data: application, error } = await supabaseAdmin().from('applications')
      .select('id, resident_id, status, staff_encoder_id, reference_no')
      .eq('reference_no', params.reference).maybeSingle();
    if (error) return { status: 500, body: { error: 'Could not verify access to this request.' } };
    if (!application || (isStaff && application.status === 'Draft' && !application.staff_encoder_id)) {
      return { status: 404, body: { error: 'Request not found.' } };
    }
    if (!isStaff && (me.user.role !== 'resident' || application.resident_id !== me.user.id)) {
      return { status: 403, body: { error: 'This request is not available to your account.' } };
    }
    if (!isStaff) return { status: 200, body: { success: true, logged: false } };

    try {
      const logged = await logSensitiveView(supabaseAdmin(), {
        action: 'record_view',
        actor: me.user,
        applicationId: application.id,
        reference: application.reference_no,
      });
      return { status: 200, body: { success: true, logged } };
    } catch (error) {
      return { status: 500, body: { error: (error as Error).message } };
    }
  });
  return NextResponse.json(response.body, { status: response.status });
}
