import type { Application, AuditLog } from '@/types';

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
