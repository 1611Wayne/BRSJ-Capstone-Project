import { NextResponse } from 'next/server';
import type { AppNotification } from '@/types';
import { currentUser } from '@/lib/server/currentUser';
import { supabaseForRequest } from '@/lib/supabase/session';

export const dynamic = 'force-dynamic';

// GET /api/notifications: the signed-in person's own notices, newest first. Read AS that person, so the database
// rules apply (a person can only ever see their own).
export async function GET() {
  const me = await currentUser(); if ('error' in me) return me.error;
  const { data, error } = await supabaseForRequest().from('notifications')
    .select('id, user_id, event, message, created_at, read_at, dedupe_key, applications ( reference_no )')
    .order('created_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: 'Could not load your notifications: ' + error.message }, { status: 500 });
  const notifications: AppNotification[] = (data ?? []).map((n: Record<string, any>) => ({
    id: 'db-' + n.id, userId: n.user_id, reference: (Array.isArray(n.applications) ? n.applications[0] : n.applications)?.reference_no ?? '',
    event: n.event, message: n.message, createdAt: n.created_at, ...(n.read_at ? { readAt: n.read_at } : {}), ...(n.dedupe_key ? { key: n.dedupe_key } : {}),
  }));
  return NextResponse.json({ notifications });
}

// POST /api/notifications: mark all of the signed-in person's unread notices as read. As that person: the database
// rules and trigger allow only setting read_at on their own notices.
export async function POST() {
  const me = await currentUser(); if ('error' in me) return me.error;
  const { error } = await supabaseForRequest().from('notifications').update({ read_at: new Date().toISOString() })
    .eq('user_id', me.user.id).is('read_at', null);
  if (error) return NextResponse.json({ error: 'Could not mark your notifications as read: ' + error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
