import { NextResponse } from 'next/server';
import type { Command } from '@/lib/workflow';
import { transition } from '@/lib/workflow';
import type { PortalState } from '@/types';
import { supabaseAdmin } from '@/lib/supabase/server';
import { currentUser } from '@/lib/server/currentUser';
import { APPLICATION_SELECT, applicantColumns, toApplication } from '@/lib/server/applicationRows';
import { loadFeeSchedules } from '@/lib/server/feeSchedules';
import { loadUnreadNotifications, persistAudits, persistNotifications } from '@/lib/server/persist';

export const dynamic = 'force-dynamic';

// The workflow steps the database can already save. Each one runs the prototype's own rules (lib/workflow.ts) as the
// signed-in person, on the request as it is in the database, and then saves exactly what changed.
const SUPPORTED = new Set<Command['type']>(['review', 'assess', 'reject', 'requestCorrection', 'editApplication', 'resolveCorrection', 'replaceDocument']);
const BUCKET = 'application-documents';
const fail = (message: string, status = 500) => NextResponse.json({ error: message }, { status });

// POST /api/workflow  { command }: one workflow step on one request.
export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  let command: Command;
  try { ({ command } = await request.json()); } catch { return fail('The request could not be read.', 400); }
  if (!command || !SUPPORTED.has(command.type) || !('reference' in command)) return fail('This action is not connected to the database yet.', 400);

  const db = supabaseAdmin(), now = new Date().toISOString();
  const { data: row } = await db.from('applications').select(APPLICATION_SELECT).eq('reference_no', command.reference).maybeSingle();
  if (!row) return fail('This request was not found.', 404);
  if (me.user.role === 'resident' && row.resident_id !== me.user.id) return fail('This request belongs to another resident.', 403);

  const before = toApplication(row);
  const schedules = command.type === 'assess' ? await loadFeeSchedules(db, before.clearanceType).catch(() => null) : [];
  if (!schedules) return fail('Could not load the fee schedules.');
  const unread = await loadUnreadNotifications(db, row.resident_id, row.id, row.reference_no);
  const state: PortalState = { users: [me.user], applications: [before], schedules, audits: [], notifications: unread, currentUserId: me.user.id };
  let next: PortalState;
  try { next = transition(state, command, now); } catch (e) { return fail((e as Error).message, 400); }
  const after = next.applications[0];

  if (command.type === 'review') {
    for (const d of after.documents) {
      const old = before.documents.find(x => x.requirement === d.requirement);
      if (old && old.status === d.status && (old.note ?? '') === (d.note ?? '')) continue;
      const { error } = await db.from('application_documents')
        .update({ verification_status: d.status, note: d.note ?? null, reviewed_by: me.user.id, reviewed_at: now })
        .eq('application_id', row.id).eq('requirement_name', d.requirement);
      if (error) return fail('Could not save the review: ' + error.message);
    }
  }

  if (command.type === 'assess' && after.assessment) {
    // The schedule the rules picked; its database id is the prototype schedule id. Amounts may be Staff-adjusted.
    const schedule = schedules.find(s => s.id === after.assessment!.scheduleId)!;
    const { data: saved, error } = await db.from('assessments').upsert({
      application_id: row.id, business_category_id: schedule.categoryId, classification_id: schedule.classificationId,
      fee_schedule_id: Number(schedule.id), assessed_by: me.user.id, assessed_at: now, total_amount: after.assessment.total,
    }, { onConflict: 'application_id' }).select('id').single();
    if (error || !saved) return fail('Could not save the assessment: ' + (error?.message ?? 'no row'));
    await db.from('assessment_items').delete().eq('assessment_id', saved.id);
    const { error: itemsError } = await db.from('assessment_items').insert(after.assessment.items.map((item, i) => ({
      assessment_id: saved.id, fee_component_name: item.name, amount: item.amount,
      scheduled_amount: schedule.items[i]?.amount ?? null, ordinance_reference: schedule.ordinance,
    })));
    if (itemsError) return fail('Could not save the fee lines: ' + itemsError.message);
  }

  if (command.type === 'requestCorrection') {
    const added = (after.corrections ?? []).filter(c => !(before.corrections ?? []).some(b => b.id === c.id));
    for (const c of added) {
      const { error } = await db.from('correction_requests').insert({ application_id: row.id, resident_id: me.user.id, message: c.message });
      if (error) return fail('Could not save the correction request: ' + error.message);
    }
  }

  if (command.type === 'editApplication') {
    const { error } = await db.from('applications').update(applicantColumns(after, row.clearance_type_id)).eq('id', row.id);
    if (error) return fail('Could not save the corrected entries: ' + error.message);
    // A change such as Renter or Renewal makes another document required: a Missing placeholder with no file.
    const added = after.documents.filter(d => !before.documents.some(b => b.requirement === d.requirement));
    if (added.length) {
      const { error: docError } = await db.from('application_documents').insert(added.map(d => ({
        application_id: row.id, requirement_name: d.requirement, verification_status: 'Missing', note: d.note ?? null,
        storage_path: null, original_filename: null, mime_type: null, file_size: null,
      })));
      if (docError) return fail('Could not add the newly required document: ' + docError.message);
    }
  }

  if (command.type === 'resolveCorrection') {
    const resolved = (after.corrections ?? []).find(c => c.status === 'Resolved' && (before.corrections ?? []).some(b => b.id === c.id && b.status === 'Open'));
    const { error } = await db.from('correction_requests')
      .update({ status: 'Resolved', resolved_by: me.user.id, resolved_at: now, resolution_note: resolved?.resolutionNote ?? null })
      .eq('application_id', row.id).eq('status', 'Open');
    if (error) return fail('Could not resolve the correction request: ' + error.message);
  }

  if (command.type === 'replaceDocument') {
    // The browser uploaded the new file into this request's own folder first; check it really is there.
    const d = after.documents.find(x => x.requirement === command.document.requirement)!;
    const [folder, file, ...rest] = (command.document.path ?? '').split('/');
    if (folder !== String(row.id) || !file || rest.length) return fail('The new file was not uploaded. Please choose it again.', 400);
    const { data: objects } = await db.storage.from(BUCKET).list(String(row.id), { limit: 1000 });
    const object = (objects ?? []).find(o => o.name === file);
    if (!object) return fail('The new file was not uploaded. Please choose it again.', 400);
    const size = Number(object.metadata?.size ?? d.size), mime = String(object.metadata?.mimetype ?? d.type);
    if (size <= 0 || size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'application/pdf'].includes(mime)) return fail('Upload a valid file in JPG, PNG, or PDF, up to 5 MB.', 400);
    const { error } = await db.from('application_documents').update({
      storage_path: command.document.path, original_filename: d.name, mime_type: mime, file_size: size, verification_status: 'Pending Review',
      note: null, reviewed_by: null, reviewed_at: null, uploaded_at: now,
    }).eq('application_id', row.id).eq('requirement_name', d.requirement);
    if (error) return fail('Could not save the new file: ' + error.message);
  }

  // Status (and, for a rejection, the reason and who rejected), with the status history.
  if (after.status !== before.status) {
    const changes: Record<string, unknown> = { status: after.status };
    if (command.type === 'reject') Object.assign(changes, { rejection_reason: after.rejection!.reason, rejected_by: me.user.id, rejected_at: now });
    // Resolving the Applicant's correction reopens a rejected request: the rejection is cleared (the audit log keeps it).
    if (before.status === 'Rejected' && !after.rejection) Object.assign(changes, { rejection_reason: null, rejected_by: null, rejected_at: null });
    const { error } = await db.from('applications').update(changes).eq('id', row.id).eq('status', before.status);
    if (error) return fail('Could not save the new status: ' + error.message);
    await db.from('application_status_history').insert({ application_id: row.id, old_status: before.status, new_status: after.status, changed_by: me.user.id });
  }

  try {
    await persistAudits(db, next.audits, me.user, row.id);
    await persistNotifications(db, unread, next.notifications.filter(n => n.reference === row.reference_no && n.userId === row.resident_id), row.id);
  } catch (e) { return fail((e as Error).message); }

  const { data: saved } = await db.from('applications').select(APPLICATION_SELECT).eq('id', row.id).single();
  if (!saved) return fail('Saved, but could not read it back.');
  return NextResponse.json({ application: toApplication(saved) });
}
