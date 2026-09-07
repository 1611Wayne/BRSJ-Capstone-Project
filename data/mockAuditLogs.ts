import type { AuditLog } from '@/types';
export const mockAuditLogs: AuditLog[] = [
  { id: 'audit-seed-1', timestamp: '2026-09-06T10:30:15+08:00', user: 'Maria Staff', role: 'staff', action: 'Clearance generated', reference: 'SJ-2026-000125', oldValue: 'Awaiting OR', newValue: 'Ready for Download' },
  { id: 'audit-seed-2', timestamp: '2026-09-06T09:00:00+08:00', user: 'Maria Staff', role: 'staff', action: 'Assessment confirmed', reference: 'SJ-2026-000124', oldValue: 'Pending Assessment', newValue: 'Awaiting OR' },
];
