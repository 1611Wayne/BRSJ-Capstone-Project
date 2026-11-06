import { NextResponse } from 'next/server';
import type { Command } from '@/lib/workflow';
import { transition } from '@/lib/workflow';
import type { Assessment, PortalState } from '@/types';
import { supabaseAdmin } from '@/lib/supabase/server';
import { currentUser } from '@/lib/server/currentUser';
import { APPLICATION_SELECT, applicantColumns, toApplication } from '@/lib/server/applicationRows';
import { loadFeeSchedules } from '@/lib/server/feeSchedules';
import { loadUnreadNotifications, persistAudits, persistNotifications } from '@/lib/server/persist';

type Schedule = Awaited<ReturnType<typeof loadFeeSchedules>>[number];

export const dynamic = 'force-dynamic';

// The workflow steps the database can already save. Each one runs the prototype's own rules (lib/workflow.ts) as the
// signed-in person, on the request as it is in the database, and then saves exactly what changed.
const SUPPORTED = new Set<Command['type']>(['review', 'assess', 'reject', 'requestCorrection', 'editApplication', 'resolveCorrection', 'replaceDocument',
  'receiptPhoto', 'onlinePayment', 'verifyPayment', 'returnPayment', 'printClearance', 'download', 'confirm', 'feedback', 'revert']);
const RECEIPTS = 'receipt-photos';

// Checks that a file the browser uploaded is in this request's own folder of a bucket; returns its stored size and type.
async function storedFile(db: ReturnType<typeof supabaseAdmin>, bucket: string, applicationId: number, path?: string) {
  const [folder, file, ...rest] = (path ?? '').split('/');
  if (folder !== String(applicationId) || !file || rest.length) return null;
  const { data: objects } = await db.storage.from(bucket).list(String(applicationId), { limit: 1000 });
  const object = (objects ?? []).find(o => o.name === file);
  if (!object) return null;
  const size = Number(object.metadata?.size ?? 0), mime = String(object.metadata?.mimetype ?? '');
  if (size <= 0 || size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'application/pdf'].includes(mime)) return null;
  return { size, mime };
}
const BUCKET = 'application-documents';
const fail = (message: string, status = 500) => NextResponse.json({ error: message }, { status });
const parsed = (value?: string) => { if (!value) return null; try { return JSON.parse(value); } catch { return value; } };

// Saves an assessment and its fee lines (Staff assessment, or an Admin fee correction). Amounts may be adjusted, so the
// schedule's own amount is kept beside each line.
async function saveAssessment(db: ReturnType<typeof supabaseAdmin>, applicationId: number, assessment: Assessment, schedule: Schedule, by: string, at: string) {
  const { data: saved, error } = await db.from('assessments').upsert({
    application_id: applicationId, business_category_id: schedule.categoryId, classification_id: schedule.classificationId,
    fee_schedule_id: Number(schedule.id), assessed_by: by, assessed_at: at, total_amount: assessment.total,
  }, { onConflict: 'application_id' }).select('id').single();
  if (error || !saved) return 'Could not save the assessment: ' + (error?.message ?? 'no row');
  await db.from('assessment_items').delete().eq('assessment_id', saved.id);
  const { error: itemsError } = await db.from('assessment_items').insert(assessment.items.map((item, i) => ({
    assessment_id: saved.id, fee_component_name: item.name, amount: item.amount,
    scheduled_amount: schedule.items[i]?.amount ?? null, ordinance_reference: schedule.ordinance,
  })));
  return itemsError ? 'Could not save the fee lines: ' + itemsError.message : null;
}

// POST /api/workflow  { command }: one workflow step on one request.
export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  let command: Command;
  try { ({ command } = await request.json()); } catch { return fail('The request could not be read.', 400); }
  if (!command || !SUPPORTED.has(command.type)) return fail('This action is not connected to the database yet.', 400);
  const reference = command.type === 'revert' ? command.data?.reference : 'reference' in command ? command.reference : undefined;
  if (!reference) return fail('This action is not connected to the database yet.', 400);

  const db = supabaseAdmin(), now = new Date().toISOString();
  const { data: row } = await db.from('applications').select(APPLICATION_SELECT).eq('reference_no', reference).maybeSingle();
  if (!row) return fail('This request was not found.', 404);
  if (me.user.role === 'resident' && row.resident_id !== me.user.id) return fail('This request belongs to another resident.', 403);

  const before = toApplication(row);
  // The rules pick fee schedules by their database id: Staff assessment, or an Admin fee correction (maybe for a new type).
  const scheduleType = command.type === 'assess' ? before.clearanceType : command.type === 'revert' && command.data.feeAssessment ? command.data.clearanceType ?? before.clearanceType : undefined;
  const schedules = scheduleType ? await loadFeeSchedules(db, scheduleType).catch(() => null) : [];
  if (!schedules) return fail('Could not load the fee schedules.');
  const unread = await loadUnreadNotifications(db, row.resident_id, row.id, row.reference_no);
  const state: PortalState = { users: [me.user], applications: [before], schedules, audits: [], notifications: unread, currentUserId: me.user.id };
  let next: PortalState;
  try { next = transition(state, command, now); } catch (e) { return fail((e as Error).message, 400); }
  const after = next.applications[0];

  if (command.type === 'review') {
    for (const d of after.documents) {
      const old = before.documents.find(x => x.requirement === d.requirement);
      if (old && old.status === d.status && (old.note ?? '') === (d.note ?? '') && old.reviewedAt === d.reviewedAt) continue;
      const { error } = await db.from('application_documents')
        .update({ verification_status: d.status, note: d.note ?? null, reviewed_by: me.user.id, reviewed_at: now })
        .eq('application_id', row.id).eq('requirement_name', d.requirement);
      if (error) return fail('Could not save the review: ' + error.message);
    }
  }

  if (command.type === 'assess' && after.assessment) {
    // The schedule the rules picked; its database id is the prototype schedule id. Amounts may be Staff-adjusted.
    const schedule = schedules.find(s => s.id === after.assessment!.scheduleId)!;
    const problem = await saveAssessment(db, row.id, after.assessment, schedule, me.user.id, now);
    if (problem) return fail(problem);
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

  // ---- payment evidence: a receipt photo, or the demo online payment (never both; SCHEMA_MAP trap 4)
  if (command.type === 'receiptPhoto') {
    const file = await storedFile(db, RECEIPTS, row.id, command.photo.path);
    if (!file) return fail('The receipt photo was not uploaded. Please choose it again.', 400);
    const { error } = await db.from('official_receipts').upsert({
      application_id: row.id, encoded_by: me.user.id, recorded_at: now, or_number: null, or_date: null, amount_paid: null,
      receipt_photo_path: command.photo.path, receipt_photo_filename: command.photo.name, receipt_photo_mime_type: file.mime, receipt_photo_size: file.size,
    }, { onConflict: 'application_id' });
    if (error) return fail('Could not save the receipt photo: ' + error.message);
    await db.from('simulated_payments').delete().eq('application_id', row.id);
  }
  if (command.type === 'onlinePayment') {
    const sim = after.simulatedPayment!;
    await db.from('official_receipts').delete().eq('application_id', row.id);
    const { error } = await db.from('simulated_payments').upsert({ application_id: row.id, method: sim.method, reference_number: sim.referenceNumber, amount: sim.amount, paid_at: now }, { onConflict: 'application_id' });
    if (error) return fail('Could not save the demo payment: ' + error.message);
  }
  if (command.type === 'receiptPhoto' || command.type === 'onlinePayment') {
    // A new submission (also after a return) resets the Staff check to Pending.
    const { error } = await db.from('payment_verifications').upsert({ application_id: row.id, status: 'Pending', submitted_at: now, checked_by: null, checked_at: null, notes: null }, { onConflict: 'application_id' });
    if (error) return fail('Could not save the payment for checking: ' + error.message);
  }

  // ---- the Staff check
  if (command.type === 'verifyPayment') {
    if (after.receipt && !after.simulatedPayment) {
      // The OR number must be unique across ALL requests; the rules above only saw this one, so the database decides.
      const { data: taken } = await db.from('official_receipts').select('application_id').eq('or_number', after.receipt.orNumber).neq('application_id', row.id).limit(1);
      if (taken?.length) return fail('This OR number is already recorded for another request.', 400);
      const { error } = await db.from('official_receipts').update({ or_number: after.receipt.orNumber, or_date: after.receipt.orDate, amount_paid: after.receipt.amountPaid }).eq('application_id', row.id);
      if (error) return fail(error.code === '23505' ? 'This OR number is already recorded for another request.' : 'Could not save the OR details: ' + error.message, error.code === '23505' ? 400 : 500);
    }
    const { error: vError } = await db.from('payment_verifications').update({ status: 'Verified', checked_by: me.user.id, checked_at: now, notes: null }).eq('application_id', row.id);
    if (vError) return fail('Could not save the payment check: ' + vError.message);
    // After an Admin correction withdrew the clearance, the new one is REVISED and keeps the original issue date.
    const { error: cError } = await db.from('clearances').upsert({ application_id: row.id, issue_date: after.clearance!.issueDate, generated_at: now, downloaded_at: null, revised_from: after.clearance!.revisedFrom ?? null }, { onConflict: 'application_id' });
    if (cError) return fail('Could not create the clearance: ' + cError.message);
  }
  if (command.type === 'returnPayment') {
    const { error } = await db.from('payment_verifications').update({ status: 'Needs Correction', checked_by: me.user.id, checked_at: now, notes: after.paymentVerification!.notes }).eq('application_id', row.id);
    if (error) return fail('Could not return the payment: ' + error.message);
    await db.from('simulated_payments').delete().eq('application_id', row.id);
  }

  // ---- release
  if (command.type === 'download') {
    const { error } = await db.from('clearances').update({ downloaded_at: now }).eq('application_id', row.id);
    if (error) return fail('Could not record the download: ' + error.message);
  }
  if (command.type === 'confirm') {
    // The IP address the confirmation came from (manuscript, Confirm Receipt): the first address Vercel or the proxy reports.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
    const { error } = await db.from('receipt_confirmations').insert({ application_id: row.id, confirmed_at: now, ip_address: ip, confirmed_by: me.user.role === 'staff' ? me.user.id : null });
    if (error) return fail('Could not record the confirmation: ' + error.message);
  }
  if (command.type === 'feedback') {
    const { error } = await db.from('feedback').insert({ application_id: row.id, resident_id: me.user.id, rating: after.feedback!.rating, comment: after.feedback!.comment });
    if (error) return fail('Could not save your feedback: ' + error.message);
  }
  // printClearance changes nothing on the record; its audit entry is written below.

  // ---- Admin correction (Transaction Reversion). Void and Mark Under Review change only the status (saved below).
  // Everything that can refuse is checked first, and nothing is removed until the changes themselves are saved, so a
  // refusal leaves the request as it was.
  if (command.type === 'revert') {
    const edit = command.data.action === 'Edit Fields';
    const changes: Record<string, unknown> = edit ? { applicant_name: after.applicant, business_name: after.businessName,
      business_subcategory: after.businessSubcategory ?? null, clearance_revised_from: after.clearanceRevisedFrom ?? null } : {};
    if (edit && after.clearanceType !== before.clearanceType) {
      const { data: type } = await db.from('clearance_types').select('id').eq('name', after.clearanceType).eq('active', true).maybeSingle();
      if (!type) return fail('Choose a supported clearance type.', 400);
      changes.clearance_type_id = type.id;
    }
    // The OR number must be unique across ALL requests; the rules above only saw this one, so the database decides.
    const newOR = edit && after.receipt && after.receipt.orNumber !== before.receipt?.orNumber ? after.receipt.orNumber : null;
    if (newOR) {
      const { data: taken } = await db.from('official_receipts').select('application_id').eq('or_number', newOR).neq('application_id', row.id).limit(1);
      if (taken?.length) return fail('This OR number is already in use.', 400);
    }
    const newAssessment = edit && after.assessment && JSON.stringify(after.assessment) !== JSON.stringify(before.assessment) ? after.assessment : null;
    const schedule = newAssessment ? schedules.find(s => s.id === newAssessment.scheduleId) : undefined;
    if (newAssessment && !schedule) return fail('Select an effective fee schedule for this clearance type.', 400);

    // The payment check reopens: Pending after a new OR number, Needs Correction after a new fee. A check that is not
    // Pending must name who decided it (a database rule), and here that is the Admin making the correction.
    if (after.paymentVerification && JSON.stringify(after.paymentVerification) !== JSON.stringify(before.paymentVerification)) {
      const v = after.paymentVerification, decided = v.status !== 'Pending';
      const { error } = await db.from('payment_verifications').upsert({ application_id: row.id, status: v.status, submitted_at: v.submittedAt,
        checked_by: decided ? me.user.id : null, checked_at: decided ? now : null, notes: v.notes ?? null }, { onConflict: 'application_id' });
      if (error) return fail('Could not reopen the payment check: ' + error.message);
    }
    if (newOR) {
      const { error } = await db.from('official_receipts').update({ or_number: newOR }).eq('application_id', row.id);
      if (error) return fail(error.code === '23505' ? 'This OR number is already in use.' : 'Could not save the OR number: ' + error.message, error.code === '23505' ? 400 : 500);
    }
    if (edit) {
      const { error } = await db.from('applications').update(changes).eq('id', row.id);
      if (error) return fail('Could not save the correction: ' + error.message);
    }
    if (newAssessment) {
      const problem = await saveAssessment(db, row.id, newAssessment, schedule!, me.user.id, now);
      if (problem) return fail(problem);
    }
    // What the correction withdrew or marked on the release side.
    if (before.clearance && !after.clearance) await db.from('clearances').delete().eq('application_id', row.id);
    else if (after.clearance && (after.clearance.revisedFrom !== before.clearance?.revisedFrom || !!after.clearance.downloadedAt !== !!before.clearance?.downloadedAt)) {
      const { error } = await db.from('clearances').update({ revised_from: after.clearance.revisedFrom ?? null, downloaded_at: after.clearance.downloadedAt ?? null }).eq('application_id', row.id);
      if (error) return fail('Could not mark the clearance as revised: ' + error.message);
    }
    if (before.confirmation && !after.confirmation) await db.from('receipt_confirmations').delete().eq('application_id', row.id);
    if (before.feedback && !after.feedback) await db.from('feedback').delete().eq('application_id', row.id);
    if (before.simulatedPayment && !after.simulatedPayment) await db.from('simulated_payments').delete().eq('application_id', row.id);
    // The Reversion Audit Report's own record, besides the audit log entry written below.
    const entry = next.audits.find(a => a.reversion);
    const { error } = await db.from('transaction_reversions').insert({ application_id: row.id, admin_id: me.user.id, action: command.data.action,
      reason: command.data.reason.trim(), old_values: parsed(entry?.oldValue), new_values: parsed(entry?.newValue) });
    if (error) return fail('Could not record the reversion: ' + error.message);
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
