import { NextResponse } from 'next/server';
import type { Command } from '@/lib/workflow';
import { transition } from '@/lib/workflow';
import type { PortalState } from '@/types';
import { supabaseAdmin } from '@/lib/supabase/server';
import { currentUser } from '@/lib/server/currentUser';
import { APPLICATION_SELECT, toApplication } from '@/lib/server/applicationRows';
import { loadUnreadNotifications, persistAudits, persistNotifications } from '@/lib/server/persist';

export const dynamic = 'force-dynamic';

// The workflow steps the database can already save. Each one runs the prototype's own rules (lib/workflow.ts) as the
// signed-in person, on the request as it is in the database, and then saves exactly what changed.
const SUPPORTED = new Set<Command['type']>(['review']);

// POST /api/workflow  { command }: one workflow step on one request.
export async function POST(request: Request) {
  const me = await currentUser(); if ('error' in me) return me.error;
  let command: Command;
  try { ({ command } = await request.json()); } catch { return NextResponse.json({ error: 'The request could not be read.' }, { status: 400 }); }
  if (!command || !SUPPORTED.has(command.type) || !('reference' in command)) return NextResponse.json({ error: 'This action is not connected to the database yet.' }, { status: 400 });

  const db = supabaseAdmin(), now = new Date().toISOString();
  const { data: row } = await db.from('applications').select(APPLICATION_SELECT).eq('reference_no', command.reference).maybeSingle();
  if (!row) return NextResponse.json({ error: 'This request was not found.' }, { status: 404 });
  if (me.user.role === 'resident' && row.resident_id !== me.user.id) return NextResponse.json({ error: 'This request belongs to another resident.' }, { status: 403 });

  const before = toApplication(row);
  const unread = await loadUnreadNotifications(db, row.resident_id, row.id, row.reference_no);
  const state: PortalState = { users: [me.user], applications: [before], schedules: [], audits: [], notifications: unread, currentUserId: me.user.id };
  let next: PortalState;
  try { next = transition(state, command, now); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  const after = next.applications[0];

  if (command.type === 'review') {
    for (const d of after.documents) {
      const old = before.documents.find(x => x.requirement === d.requirement);
      if (old && old.status === d.status && (old.note ?? '') === (d.note ?? '')) continue;
      const { error } = await db.from('application_documents')
        .update({ verification_status: d.status, note: d.note ?? null, reviewed_by: me.user.id, reviewed_at: now })
        .eq('application_id', row.id).eq('requirement_name', d.requirement);
      if (error) return NextResponse.json({ error: 'Could not save the review: ' + error.message }, { status: 500 });
    }
  }

  try {
    await persistAudits(db, next.audits, me.user, row.id);
    await persistNotifications(db, unread, next.notifications.filter(n => n.reference === row.reference_no && n.userId === row.resident_id), row.id);
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }

  const { data: saved } = await db.from('applications').select(APPLICATION_SELECT).eq('id', row.id).single();
  if (!saved) return NextResponse.json({ error: 'Saved, but could not read it back.' }, { status: 500 });
  return NextResponse.json({ application: toApplication(saved) });
}
