import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { logSensitiveView } from '@/lib/server/persist';
import { supabaseAdmin } from '@/lib/supabase/server';
import { coalesceInFlight } from '@/lib/inFlightRequests';

export const dynamic = 'force-dynamic';

const BUCKETS = ['application-documents', 'receipt-photos', 'valid-ids'] as const;
type FileBucket = typeof BUCKETS[number];
type RouteResult = { status: number; body: Record<string, unknown> };
const inFlightFileViews = new Map<string, Promise<RouteResult>>();

const result = (status: number, body: RouteResult['body']): RouteResult => ({ status, body });

function validObjectPath(path: unknown): path is string {
  return typeof path === 'string'
    && path.length > 0
    && path.length <= 1024
    && !path.includes('\\')
    && !path.split('/').some(part => !part || part === '.' || part === '..')
    && !/[\u0000-\u001f\u007f]/.test(path);
}

export async function POST(request: Request) {
  const me = await currentUser();
  if ('error' in me) return me.error;
  let body: { bucket?: unknown; path?: unknown; reference?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'The file request could not be read.' }, { status: 400 }); }
  if (!BUCKETS.includes(body.bucket as FileBucket) || !validObjectPath(body.path) || typeof body.reference !== 'string' || !body.reference.trim()) {
    return NextResponse.json({ error: 'The file request is not valid.' }, { status: 400 });
  }
  const bucket = body.bucket as FileBucket, path = body.path, reference = body.reference.trim();
  const key = JSON.stringify([me.user.id, 'file_view', reference, bucket, path]);
  const response = await coalesceInFlight(inFlightFileViews, key, async (): Promise<RouteResult> => {
    const isStaff = me.user.role === 'staff' || me.user.role === 'admin';
    const db = supabaseAdmin();
    const { data: application, error: applicationError } = await db.from('applications')
      .select('id, resident_id, status, staff_encoder_id')
      .eq('reference_no', reference).maybeSingle();
    if (applicationError) return result(500, { error: 'Could not verify the file owner.' });
    if (!application || (isStaff && application.status === 'Draft' && !application.staff_encoder_id)) {
      return result(404, { error: 'The request was not found.' });
    }
    if (!isStaff && (me.user.role !== 'resident' || application.resident_id !== me.user.id)) {
      return result(403, { error: 'This file is not available to your account.' });
    }

    let belongsToApplication = false;
    if (bucket === 'application-documents') {
      const { data, error } = await db.from('application_documents').select('storage_path')
        .eq('application_id', application.id).eq('storage_path', path).maybeSingle();
      if (error) return result(500, { error: 'Could not verify the file path.' });
      belongsToApplication = !!data;
    } else if (bucket === 'receipt-photos') {
      const { data, error } = await db.from('official_receipts').select('receipt_photo_path')
        .eq('application_id', application.id).eq('receipt_photo_path', path).maybeSingle();
      if (error) return result(500, { error: 'Could not verify the file path.' });
      belongsToApplication = !!data;
    } else {
      const { data, error } = await db.from('profiles').select('valid_id_path')
        .eq('id', application.resident_id).eq('valid_id_path', path).maybeSingle();
      if (error) return result(500, { error: 'Could not verify the file path.' });
      belongsToApplication = !!data;
    }
    if (!belongsToApplication) return result(403, { error: 'This file is not attached to the request.' });

    if (isStaff) {
      try {
        await logSensitiveView(db, {
          action: 'file_view',
          actor: me.user,
          applicationId: application.id,
          reference,
          objectPath: path,
        });
      } catch (error) {
        return result(500, { error: (error as Error).message });
      }
    }

    const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return result(500, { error: 'This file could not be opened.' });
    return result(200, { signedUrl: data.signedUrl });
  });
  return NextResponse.json(response.body, { status: response.status });
}
