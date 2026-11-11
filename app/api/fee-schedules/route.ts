import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseAdmin } from '@/lib/supabase/server';
import { insertFeeSchedule, loadFeeSchedules } from '@/lib/server/feeSchedules';
import { activeSchedule, transition } from '@/lib/workflow';
import { clearanceTypes } from '@/data/clearanceTypes';
import type { FeeSchedule, PortalState } from '@/types';

export const dynamic = 'force-dynamic';

const strip = (all: Awaited<ReturnType<typeof loadFeeSchedules>>): FeeSchedule[] => all.map(({ categoryId: _c, classificationId: _k, ...s }) => s);
const fail = (error: string, status = 500) => NextResponse.json({ error }, { status });

// GET /api/fee-schedules: every fee schedule version from the database, for Staff assessment, Admin corrections and
// Admin Fee Configuration, so the screens pick schedules by their database id (the sample schedules' ids mean nothing to the server).
export async function GET() {
  const me = await currentUser(); if ('error' in me) return me.error;
  if (me.user.role === 'resident') return fail('Only Staff and Admin can read the fee schedules here.', 403);
  try { return NextResponse.json({ schedules: strip(await loadFeeSchedules(supabaseAdmin())) }); }
  catch (e) { return fail((e as Error).message); }
}

// POST /api/fee-schedules { schedule }: Admin Fee Configuration. The same fee rule as the screen (transition 'fees' in
// lib/workflow.ts) checks it again here; it is then saved as a NEW version with the Admin's id, and the audit log keeps
// the previous and new amounts, the effective date and the ordinance (paper 3.3.1 item 8). Answers with every version.
export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  if (me.user.role !== 'admin') return fail('Only Admin can change the fee schedules.', 403);
  const body = await request.json().catch(() => null) as { schedule?: Record<string, unknown> } | null;
  const raw = body?.schedule;
  if (!raw || typeof raw !== 'object') return fail('Send the fee schedule to save.', 400);

  const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  const business = text(raw.clearanceType, 100) === 'Business Clearance';
  const schedule: FeeSchedule = {
    id: '', changedBy: '', createdAt: '',
    clearanceType: text(raw.clearanceType, 100),
    category: business ? text(raw.category, 100) : '', classification: business ? text(raw.classification, 100) : '',
    items: Array.isArray(raw.items) ? raw.items.slice(0, 31).map((i: any) => ({ name: text(i?.name, 100), amount: typeof i?.amount === 'number' ? i.amount : NaN })) : [],
    effectiveDate: text(raw.effectiveDate, 10), ordinance: text(raw.ordinance, 200), notes: text(raw.notes, 1000),
  };
  if (!clearanceTypes.some(c => c.name === schedule.clearanceType)) return fail('Select a supported clearance type.', 400);
  if (business && !schedule.category) return fail('Select a business category.', 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.effectiveDate)) return fail('Enter the effective date as a date.', 400);
  if (schedule.items.length > 30) return fail('A fee schedule can have at most 30 fee lines.', 400);
  if (schedule.items.some(i => i.amount >= 100_000_000)) return fail('A fee line is too large.', 400);

  const db = supabaseAdmin();
  let existing: FeeSchedule[];
  try { existing = strip(await loadFeeSchedules(db, schedule.clearanceType)); } catch (e) { return fail((e as Error).message); }
  const state: PortalState = { users: [me.user], applications: [], schedules: existing, audits: [], notifications: [], currentUserId: me.user.id };
  try { transition(state, { type: 'fees', schedule }); } catch (e) { return fail((e as Error).message, 400); }

  // The version this one follows: the one in force on the new effective date (it may be none).
  const previous = activeSchedule(existing, schedule.clearanceType, schedule.category, schedule.classification, schedule.effectiveDate);
  let id: number;
  try { id = await insertFeeSchedule(db, schedule, me.user.id); }
  catch (e) { return fail((e as Error).message, (e as { status?: number }).status ?? 500); }

  const label = [schedule.clearanceType, schedule.category, schedule.classification].filter(Boolean).join(' / ');
  const { error: auditError } = await db.from('audit_logs').insert({
    user_id: me.user.id, role: me.user.role, action: 'Updated fee schedule', application_id: null, reference_no: 'FEE-' + id,
    old_value: previous ? { schedule: label, version: previous.id, effectiveDate: previous.effectiveDate, ordinance: previous.ordinance, items: previous.items } : null,
    new_value: { schedule: label, version: String(id), effectiveDate: schedule.effectiveDate, ordinance: schedule.ordinance, items: schedule.items },
    reason: schedule.notes || null,
  });
  if (auditError) return fail('The fee schedule was saved, but the audit log was not: ' + auditError.message);

  try { return NextResponse.json({ id: String(id), schedules: strip(await loadFeeSchedules(db)) }); }
  catch (e) { return fail('Saved, but could not read the fee schedules back: ' + (e as Error).message); }
}
