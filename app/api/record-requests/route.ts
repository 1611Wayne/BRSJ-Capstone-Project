import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { listRecordRequests, readRecordRequest, RECORD_REQUEST_SELECT, toRecordRequest } from '@/lib/server/recordRequests';
import { APPLICATION_SELECT, toApplication } from '@/lib/server/applicationRows';
import { persistAudits } from '@/lib/server/persist';
import { personalRecordSummary, validRecordRequestId } from '@/lib/personalRecords';
import { transition, type Command } from '@/lib/workflow';
import type { Application, PortalState } from '@/types';

export const dynamic = 'force-dynamic';
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  if (!['resident', 'staff', 'admin'].includes(me.user.role)) return fail('Not authorized.', 403);
  const db = supabaseAdmin(), copyId = new URL(request.url).searchParams.get('copy');
  try {
    if (copyId !== null) {
      if (me.user.role !== 'resident') return fail('Only the Applicant can download their own records summary.', 403);
      if (!validRecordRequestId(copyId)) return fail('Records request not found.', 404);
      const record = await readRecordRequest(db, me.user, copyId);
      if (!record) return fail('Records request not found.', 404);
      if (record.status !== 'Answered' || !record.includeSummary) return fail('A summary is not available for this request. Check the office response.', 409);
      const applications: Application[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.from('applications').select(APPLICATION_SELECT).eq('resident_id', me.user.id).order('id').range(offset, offset + 999);
        if (error) return fail('Your records summary could not be prepared. Please contact the Monitoring Office.', 500);
        applications.push(...(data ?? []).map(row => toApplication(row)));
        if ((data?.length ?? 0) < 1000) break;
      }
      const summary = personalRecordSummary(me.user, applications, record, new Date().toISOString());
      const { error } = await db.from('audit_logs').insert({ user_id: me.user.id, role: me.user.role, action: 'Personal records summary downloaded', reference_no: 'RR-' + copyId, application_id: null });
      if (error) return fail('Your download could not be recorded. Please try again.', 500);
      return new Response(JSON.stringify(summary, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="records-summary-${copyId}.json"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    return NextResponse.json({ requests: await listRecordRequests(db, me.user) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail((e as Error).message, 503); }
}

export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  const body = await request.json().catch(() => null);
  if (!body || !validRecordRequestId(body.id)) return fail('The records request could not be read.');
  if (!['request', 'answer'].includes(body.action)) return fail('Unknown records request action.');
  if (body.action === 'request' && me.user.role !== 'resident') return fail('Only an Applicant can request their own records.', 403);
  if (body.action === 'answer' && me.user.role !== 'staff' && me.user.role !== 'admin') return fail('Only Staff or Admin can answer records requests.', 403);
  const db = supabaseAdmin(), now = new Date().toISOString();
  try {
    const previous = body.action === 'answer' ? await readRecordRequest(db, me.user, body.id) : null;
    if (body.action === 'answer' && !previous) return fail('Records request not found.', 404);
    if (previous?.status === 'Answered') return fail('This request has already been answered. Refresh the list.', 409);
    const command: Command = body.action === 'request' ? { type: 'requestRecords', id: body.id, message: body.message }
      : { type: 'answerRecords', id: body.id, response: body.response, includeSummary: body.includeSummary };
    const state: PortalState = { users: [me.user], applications: [], schedules: [], audits: [], notifications: [], recordRequests: previous ? [previous] : [], currentUserId: me.user.id };
    let next: PortalState;
    try { next = transition(state, command, now); } catch (e) { return fail((e as Error).message); }
    const record = next.recordRequests![0];
    if (body.action === 'request') {
      const { error } = await db.from('personal_record_requests').insert({ id: record.id, resident_id: me.user.id, request_text: record.message, requested_at: now, status: 'Pending', include_summary: false });
      if (error) return fail(error.code === '23505' ? 'This request has already been submitted. Refresh the list.' : 'Your request could not be saved. Please contact the Monitoring Office.', error.code === '23505' ? 409 : 503);
    } else {
      // Compare-and-set: another officer cannot silently overwrite a response that was just sent.
      const { data, error } = await db.from('personal_record_requests').update({ status: 'Answered', response_text: record.response, responded_at: now, responded_by: me.user.id, include_summary: record.includeSummary })
        .eq('id', record.id).eq('status', 'Pending').select(RECORD_REQUEST_SELECT).maybeSingle();
      if (error) return fail('The response could not be saved. Please try again.', 500);
      if (!data) return fail('This request has already changed. Refresh the list.', 409);
      next.recordRequests = [toRecordRequest(data)];
    }
    try { await persistAudits(db, next.audits, me.user, null); }
    catch { return fail('Saved, but the audit entry could not be recorded. Refresh to check the request, then contact the Monitoring Office.', 500); }
    return NextResponse.json({ request: next.recordRequests![0] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail((e as Error).message, 503); }
}
