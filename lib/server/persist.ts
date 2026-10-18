import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppNotification, AuditLog, User } from '@/types';

// The prototype writes audit values as plain text or as JSON text; the database column is jsonb (SCHEMA_MAP trap 1).
// JSON text is stored as the JSON it describes; plain text as a JSON string; empty as NULL.
function jsonValue(value?: string): unknown {
  if (value === undefined || value === '') return null;
  try { return JSON.parse(value); } catch { return value; }
}

// Writes the audit entries a reducer step produced (the state started with none, so all of them are new).
export async function persistAudits(db: SupabaseClient, audits: AuditLog[], actor: User, applicationId: number | null) {
  if (!audits.length) return;
  const rows = [...audits].reverse().map(a => ({   // the reducer adds newest first; store them in the order they happened
    user_id: actor.id, role: actor.role, action: a.action, application_id: applicationId, reference_no: a.reference || null,
    old_value: jsonValue(a.oldValue), new_value: jsonValue(a.newValue), reason: a.reason || null, reversion: !!a.reversion,
  }));
  const { error } = await db.from('audit_logs').insert(rows);
  if (error) throw new Error('The change was saved, but the audit log was not: ' + error.message);
}

// Unread notices of one Applicant for one request, in the reducer's shape (ids prefixed so they map back to rows).
export async function loadUnreadNotifications(db: SupabaseClient, userId: string, applicationId: number, reference: string): Promise<AppNotification[]> {
  const { data } = await db.from('notifications').select('id, user_id, event, message, created_at, dedupe_key')
    .eq('user_id', userId).eq('application_id', applicationId).is('read_at', null);
  return (data ?? []).map(n => ({ id: 'db-' + n.id, userId: n.user_id, reference, event: n.event, message: n.message, createdAt: n.created_at, ...(n.dedupe_key ? { key: n.dedupe_key } : {}) }));
}

// Applies what the reducer did to those unread notices: new ones are inserted, changed ones updated, dropped ones deleted.
export async function persistNotifications(db: SupabaseClient, before: AppNotification[], after: AppNotification[], applicationId: number) {
  const dbId = (n: AppNotification) => n.id.startsWith('db-') ? Number(n.id.slice(3)) : null;
  const afterIds = new Set(after.map(n => n.id));
  for (const n of before) if (!afterIds.has(n.id)) await db.from('notifications').delete().eq('id', dbId(n)!);
  for (const n of after) {
    const id = dbId(n);
    if (id === null) {
      const { error } = await db.from('notifications').insert({ user_id: n.userId, application_id: applicationId, event: n.event, message: n.message, dedupe_key: n.key ?? null });
      if (error) throw new Error('The change was saved, but the Applicant was not notified: ' + error.message);
    } else {
      const old = before.find(b => b.id === n.id);
      if (old && (old.message !== n.message || old.createdAt !== n.createdAt)) await db.from('notifications').update({ message: n.message, created_at: n.createdAt }).eq('id', id);
    }
  }
}
