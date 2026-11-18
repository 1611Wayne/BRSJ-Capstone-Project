import type { Application, AuditLog } from '@/types';

// The screen displays Manila dates; query the same full calendar days on the server.
export function auditDateRange(from: string, to: string) {
  return {
    since: from ? new Date(from + 'T00:00:00.000+08:00').toISOString() : undefined,
    until: to ? new Date(to + 'T23:59:59.999+08:00').toISOString() : undefined,
  };
}

// Prefer the historical type after the action; later corrections must not rewrite history.
// Legacy entries may contain only status text, so fall back to their linked transaction.
export function reversionClearanceType(entry: AuditLog, applications: Pick<Application, 'reference' | 'clearanceType'>[]): string {
  for (const value of [entry.newValue, entry.oldValue]) {
    if (!value) continue;
    try {
      const snapshot: unknown = JSON.parse(value);
      if (snapshot && typeof snapshot === 'object' && 'clearanceType' in snapshot &&
          typeof snapshot.clearanceType === 'string' && snapshot.clearanceType.trim()) return snapshot.clearanceType;
    } catch { /* Older audit values are plain status text. */ }
  }
  return applications.find(a => a.reference === entry.reference)?.clearanceType || '';
}
