import { NextResponse } from 'next/server';
import type { Command } from '@/lib/workflow';
import { transition } from '@/lib/workflow';
import type { PortalState } from '@/types';
import { supabaseAdmin } from '@/lib/supabase/server';
import { currentUser } from '@/lib/server/currentUser';
import { APPLICATION_SELECT, toApplication } from '@/lib/server/applicationRows';
import { loadFeeSchedules } from '@/lib/server/feeSchedules';
import { loadUnreadNotifications, persistAudits, persistNotifications } from '@/lib/server/persist';

export const dynamic = 'force-dynamic';

// The workflow steps the database can already save. Each one runs the prototype's own rules (lib/workflow.ts) as the
// signed-in person, on the request as it is in the database, and then saves exactly what changed.
const SUPPORTED = new Set<Command['type']>(['review', 'assess', 'reject']);
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

  // Status (and, for a rejection, the reason and who rejected), with the status history.
  if (after.status !== before.status) {
    const changes: Record<string, unknown> = { status: after.status };
    if (command.type === 'reject') Object.assign(changes, { rejection_reason: after.rejection!.reason, rejected_by: me.user.id, rejected_at: now });
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
