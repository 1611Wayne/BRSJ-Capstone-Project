import { NextResponse } from 'next/server';
import type { Application, ApplicationInput, PortalState, UploadedDocument } from '@/types';
import { requirements, transition } from '@/lib/workflow';
import { supabaseAdmin } from '@/lib/supabase/server';
import { currentUser } from '@/lib/server/currentUser';
import { APPLICATION_SELECT, applicantColumns, toApplication } from '@/lib/server/applicationRows';

export const dynamic = 'force-dynamic';
const BUCKET = 'application-documents';

// GET /api/applications: an Applicant gets their own requests (drafts included); Staff and Admin get every submitted
// request (never other people's drafts). If ?reference=... is given, fetches that specific request for authorized users.
export async function GET(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  const { searchParams } = new URL(request.url);
  const reference = searchParams.get('reference');
  if (reference) {
    let query = supabaseAdmin().from('applications').select(APPLICATION_SELECT).eq('reference_no', reference);
    if (me.user.role === 'resident') query = query.eq('resident_id', me.user.id);
    const { data, error } = await query.maybeSingle();
    if (error) return NextResponse.json({ error: 'Could not load the request: ' + error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    return NextResponse.json({ application: toApplication(data) });
  }
  let query = supabaseAdmin().from('applications').select(APPLICATION_SELECT).order('created_at', { ascending: false });
  query = me.user.role === 'resident' ? query.eq('resident_id', me.user.id) : query.neq('status', 'Draft');
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Could not load your requests: ' + error.message }, { status: 500 });
  return NextResponse.json({ applications: (data ?? []).map(toApplication) });
}

// step 'create': the first, internal half of a brand-new request (it only makes the empty Draft row so the files have a
// folder); it is not logged, and it is accepted only without a reference. The save that follows is logged.
type Body = { reference?: string; draft: boolean; step?: 'create'; application: ApplicationInput; documents: (Pick<UploadedDocument, 'requirement' | 'name' | 'size' | 'type'> & { path: string })[] };

// POST /api/applications: an Applicant creates or updates their own DRAFT, or submits it.
// Staff can also create or submit a walk-in application on behalf of a resident.
// The same rules as the prototype run here (lib/workflow.ts), then the server writes the application, its documents,
// the status history and the audit log. A new request is always created as a Draft first, because its files are
// uploaded into a folder named after its database id; the browser then uploads them and posts again to submit.
export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  const actor = me.user;
  if (actor.role !== 'resident' && actor.role !== 'staff' && actor.role !== 'admin') {
    return NextResponse.json({ error: 'You are not authorized to create applications.' }, { status: 403 });
  }
  let body: Body; try { body = await request.json(); } catch { return NextResponse.json({ error: 'The request could not be read.' }, { status: 400 }); }
  const db = supabaseAdmin(), now = new Date().toISOString();

  const isStaff = actor.role === 'staff' || actor.role === 'admin';
  let residentId = actor.id;
  if (isStaff) {
    if (!body.application?.residentId) {
      return NextResponse.json({ error: 'A resident must be selected for walk-in applications.' }, { status: 400 });
    }
    residentId = body.application.residentId;
    const { data: resProfile, error: resError } = await db.from('profiles').select('id, role, status').eq('id', residentId).maybeSingle();
    if (resError || !resProfile) {
      return NextResponse.json({ error: 'The selected resident profile could not be found.' }, { status: 404 });
    }
    if (resProfile.status !== 'Active') {
      return NextResponse.json({ error: 'The selected resident account is inactive.' }, { status: 400 });
    }
  }

  const source = isStaff ? 'Assisted / Walk-in' : 'Online';
  const staffEncoderName = isStaff ? [actor.firstName, actor.lastName].filter(Boolean).join(' ') || 'Staff' : undefined;
  const input: ApplicationInput = {
    ...body.application,
    residentId,
    source,
    staffEncoder: staffEncoderName,
  };

  const { data: type } = await db.from('clearance_types').select('id').eq('name', input.clearanceType).eq('active', true).maybeSingle();
  if (!type) return NextResponse.json({ error: 'Choose a supported clearance type.' }, { status: 400 });

  // The existing request, if any: it must be for this resident and still a Draft.
  let previous: Row | null = null;
  if (body.step === 'create' && body.reference) return NextResponse.json({ error: 'Only a new request uses the create step.' }, { status: 400 });
  if (body.reference) {
    const { data } = await db.from('applications').select(APPLICATION_SELECT).eq('reference_no', body.reference).maybeSingle();
    if (!data) return NextResponse.json({ error: 'This request does not exist.' }, { status: 404 });
    if (actor.role === 'resident' && data.resident_id !== actor.id) return NextResponse.json({ error: 'This request belongs to another resident.' }, { status: 403 });
    if (isStaff && data.resident_id !== residentId) return NextResponse.json({ error: 'This request belongs to another resident.' }, { status: 403 });
    if (data.status !== 'Draft') return NextResponse.json({ error: 'Only drafts can be edited.' }, { status: 409 });
    previous = data;
  } else if (body.step !== 'create') {
    return NextResponse.json({ error: 'A new request starts with the create step.' }, { status: 400 });
  } else if (!body.draft) {
    return NextResponse.json({ error: 'Save the request as a draft first.' }, { status: 400 });
  }

  // Keep only documents for the current requirements, and check them with the prototype's own rules.
  const needed = new Set(requirements(input).map(r => r.name));
  const docs = (body.documents ?? []).filter(d => needed.has(d.requirement));
  const check: PortalState = { users: [actor], applications: previous ? [toApplication(previous)] : [], schedules: [], audits: [], notifications: [], currentUserId: actor.id };
  try {
    transition(check, { type: 'saveApplication', reference: body.reference, draft: body.draft, application: { ...input, documents: docs.map(d => ({ ...d, status: 'Pending Review' as const })) } }, now);
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  // Create the draft row (the database gives it its reference number), or update the existing one.
  let appId: number, reference: string;
  if (previous) {
    appId = previous.id; reference = previous.reference_no;
    const { error } = await db.from('applications').update({
      ...applicantColumns(input, type.id),
      ...(isStaff ? { staff_encoder_id: actor.id, source: 'Assisted / Walk-in' } : {}),
    }).eq('id', appId);
    if (error) return NextResponse.json({ error: 'Could not save: ' + error.message }, { status: 500 });
  } else {
    const { data, error } = await db.from('applications')
      .insert({
        ...applicantColumns(input, type.id),
        resident_id: residentId,
        source,
        staff_encoder_id: isStaff ? actor.id : null,
        status: 'Draft',
        date_requested: now,
      })
      .select('id, reference_no').single();
    if (error || !data) return NextResponse.json({ error: 'Could not create the request: ' + (error?.message ?? 'no row') }, { status: 500 });
    appId = data.id; reference = data.reference_no;
  }

  // Files: each must be in this request's own folder and really uploaded; the stored size and type are used.
  if (docs.length) {
    const { data: objects, error } = await db.storage.from(BUCKET).list(String(appId), { limit: 1000 });
    if (error) return NextResponse.json({ error: 'Could not check the uploaded files: ' + error.message }, { status: 500 });
    const byName = new Map((objects ?? []).map(o => [o.name, o]));
    const rows = [];
    for (const d of docs) {
      const [folder, file] = d.path.split('/');
      const object = folder === String(appId) ? byName.get(file) : undefined;
      if (!object || d.path.split('/').length !== 2) return NextResponse.json({ error: `The file for "${d.requirement}" was not uploaded. Please choose it again.` }, { status: 400 });
      const size = Number(object.metadata?.size ?? d.size), mime = String(object.metadata?.mimetype ?? d.type);
      if (size <= 0 || size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'application/pdf'].includes(mime)) return NextResponse.json({ error: `The file for "${d.requirement}" must be a JPG, PNG or PDF of at most 5 MB.` }, { status: 400 });
      rows.push({ application_id: appId, requirement_name: d.requirement, storage_path: d.path, original_filename: d.name, mime_type: mime, file_size: size, verification_status: 'Pending Review', note: null, reviewed_by: null, reviewed_at: null });
    }
    const { error: upsertError } = await db.from('application_documents').upsert(rows, { onConflict: 'application_id,requirement_name' });
    if (upsertError) return NextResponse.json({ error: 'Could not save the documents: ' + upsertError.message }, { status: 500 });
  }
  // A draft can drop a document (for example after changing the clearance type or ownership).
  const keep = docs.map(d => d.requirement);
  let remove = db.from('application_documents').delete().eq('application_id', appId);
  if (keep.length) remove = remove.not('requirement_name', 'in', `(${keep.map(k => `"${k.replace(/"/g, '""')}"`).join(',')})`);
  const { error: removeError } = await remove;
  if (removeError) return NextResponse.json({ error: 'Could not update the documents: ' + removeError.message }, { status: 500 });

  // Submit: status, the request time, the status history and the audit log.
  const oldStatus = previous?.status ?? null, newStatus = body.draft ? 'Draft' : 'Pending Assessment';
  if (!body.draft) {
    const { error } = await db.from('applications').update({ status: newStatus, date_requested: now }).eq('id', appId).eq('status', 'Draft');
    if (error) return NextResponse.json({ error: 'Could not submit: ' + error.message }, { status: 500 });
    await db.from('application_status_history').insert({ application_id: appId, old_status: 'Draft', new_status: newStatus, changed_by: actor.id });
  }
  if (body.step !== 'create') {
    // The first logged entry of a request shows no old status (it is new); decided here, never by the browser.
    const { count } = await db.from('audit_logs').select('id', { count: 'exact', head: true }).eq('application_id', appId);
    await db.from('audit_logs').insert({ user_id: actor.id, role: actor.role, action: body.draft ? 'Draft saved' : 'Application submitted', application_id: appId, reference_no: reference, old_value: count ? oldStatus : null, new_value: newStatus });
  }

  const { data: saved, error: readError } = await db.from('applications').select(APPLICATION_SELECT).eq('id', appId).single();
  if (readError || !saved) return NextResponse.json({ error: 'Saved, but could not read it back.' }, { status: 500 });
  return NextResponse.json({ application: toApplication(saved) satisfies Application });
}

type Row = Record<string, any>;
