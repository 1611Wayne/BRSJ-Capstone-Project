import type { Application } from '@/types';

export function inspectionCalendarDate(value: string) {
  const time = Date.parse(value + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function inspectionInputValue(timestamp?: string) {
  if (!timestamp) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

// datetime-local has no timezone. Treat Staff input explicitly as Manila time, regardless of the device timezone.
export function inspectionTimestamp(value: string) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || !inspectionCalendarDate(value.slice(0, 10))) throw new Error('Enter a valid inspection date and time.');
  return new Date(value + ':00+08:00').toISOString();
}

export function validInspectionTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && inspectionCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

export const canScheduleInspection = (a: Application) => (a.status === 'Pending Assessment' || a.status === 'Under Review') && !a.clearance;

export function inspectionQueue(applications: Application[], now = new Date().toISOString()) {
  const pending = applications.filter(a => canScheduleInspection(a) && a.inspection?.status === 'Pending' && a.inspection.scheduledAt && validInspectionTimestamp(a.inspection.scheduledAt))
    .slice().sort((a, b) => Date.parse(a.inspection!.scheduledAt!) - Date.parse(b.inspection!.scheduledAt!) || a.reference.localeCompare(b.reference));
  return { upcoming: pending.filter(a => Date.parse(a.inspection!.scheduledAt!) >= Date.parse(now)), overdue: pending.filter(a => Date.parse(a.inspection!.scheduledAt!) < Date.parse(now)) };
}
