import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { logSensitiveView } from '@/lib/server/persist';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const BUCKETS = ['application-documents', 'receipt-photos', 'valid-ids'] as const;
type FileBucket = typeof BUCKETS[number];

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
  const isStaff = me.user.role === 'staff' || me.user.role === 'admin';
  const db = supabaseAdmin();
  const { data: application, error: applicationError } = await db.from('applications')
    .select('id, resident_id, status, staff_encoder_id')
    .eq('reference_no', reference).maybeSingle();
  if (applicationError) return NextResponse.json({ error: 'Could not verify the file owner.' }, { status: 500 });
  if (!application || (isStaff && application.status === 'Draft' && !application.staff_encoder_id)) {
    return NextResponse.json({ error: 'The request was not found.' }, { status: 404 });
  }
  if (!isStaff && (me.user.role !== 'resident' || application.resident_id !== me.user.id)) {
    return NextResponse.json({ error: 'This file is not available to your account.' }, { status: 403 });
  }

  let belongsToApplication = false;
  if (bucket === 'application-documents') {
    const { data, error } = await db.from('application_documents').select('storage_path')
      .eq('application_id', application.id).eq('storage_path', path).maybeSingle();
    if (error) return NextResponse.json({ error: 'Could not verify the file path.' }, { status: 500 });
    belongsToApplication = !!data;
  } else if (bucket === 'receipt-photos') {
    const { data, error } = await db.from('official_receipts').select('receipt_photo_path')
      .eq('application_id', application.id).eq('receipt_photo_path', path).maybeSingle();
    if (error) return NextResponse.json({ error: 'Could not verify the file path.' }, { status: 500 });
    belongsToApplication = !!data;
  } else {
    const { data, error } = await db.from('profiles').select('valid_id_path')
      .eq('id', application.resident_id).eq('valid_id_path', path).maybeSingle();
    if (error) return NextResponse.json({ error: 'Could not verify the file path.' }, { status: 500 });
    belongsToApplication = !!data;
  }
  if (!belongsToApplication) return NextResponse.json({ error: 'This file is not attached to the request.' }, { status: 403 });

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
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'This file could not be opened.' }, { status: 500 });
  return NextResponse.json({ signedUrl: data.signedUrl });
}
