import type { AuditLog } from '@/types';

// Database JSON audit values are displayed/exported as text, matching locally generated audit entries.
export function auditRecord(row: Record<string, any>, user: string): AuditLog {
  const timestamp = row.timestamp || row.created_at;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) throw new Error('An audit entry has no valid recorded time.');
  const value = (v: unknown) => v === null || v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v);
  return { id: 'db-' + row.id, timestamp, user, userId: row.user_id || undefined, role: row.role,
    action: row.action, reference: row.reference_no || '', reason: row.reason || undefined,
    oldValue: value(row.old_value), newValue: value(row.new_value), reversion: !!row.reversion };
}
