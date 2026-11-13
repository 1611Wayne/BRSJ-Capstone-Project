// How long an open request has been waiting, so nothing is forgotten (extra, not in the paper; agreed 2026-11-14).
// "Waiting" runs from the request's LAST RECORDED ACTIVITY: submission, a document check, the assessment, payment sent,
// payment checked or returned, the clearance made, a correction resolved. In the normal flow that is exactly when the
// request entered its current stage. An Admin reversion stores no time of its own, so a reverted request counts from its
// last activity before that (it shows as older, which is the safe side: it needs attention anyway). Likewise a replaced
// document clears its own review time, so the clock runs from the last Staff document check before the replacement.
// Calendar hours, weekends included. Change WAITING_LIMIT_HOURS to change the limit everywhere.
import type { Application, ApplicationStatus } from '@/types';

export const WAITING_LIMIT_HOURS = 24;
export type WaitingOn = 'Staff' | 'Applicant';

// Open stages and who the request is waiting on. Draft, Rejected, Void and Closed - Cleared have no clock.
const STAGE_OWNER: Partial<Record<ApplicationStatus, WaitingOn>> = {
  'Pending Assessment': 'Staff',   // review the documents and assess
  'Under Review': 'Staff',         // an Admin reversion: Staff look again
  'For Checking': 'Staff',         // check the payment or receipt
  'Ready for Download': 'Staff',   // print, stamp and release (the Applicant may also download and confirm)
  'Awaiting OR': 'Applicant',      // the Applicant pays and uploads the receipt
};

export interface Waiting { on: WaitingOn; since: string; hours: number; overdue: boolean }

const time = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : 0; };

export function lastActivity(a: Application): string {
  const times = [
    a.dateRequested,
    a.assessment?.assessedAt,
    a.paymentVerification?.submittedAt,
    a.paymentVerification?.checkedAt,
    a.clearance?.generatedAt,
    a.rejection?.timestamp,
    ...a.documents.map(d => d.reviewedAt),
    ...(a.corrections ?? []).flatMap(c => [c.requestedAt, c.resolvedAt]),
  ];
  let latest = '';
  for (const t of times) if (t && time(t) > time(latest)) latest = t;
  return latest || a.dateRequested;
}

export function waiting(a: Application, now: number = Date.now()): Waiting | undefined {
  let on = STAGE_OWNER[a.status];
  // An open correction request always waits on Staff (even on a Rejected request, which otherwise has no clock).
  if (a.corrections?.some(c => c.status === 'Open')) on = 'Staff';
  // Before assessment, a document sent back as Missing / Needs Replacement waits on the Applicant to replace it.
  else if (on && (a.status === 'Pending Assessment' || a.status === 'Under Review') && a.documents.some(d => d.status === 'Missing' || d.status === 'Needs Replacement')) on = 'Applicant';
  if (!on) return undefined;
  const since = lastActivity(a);
  const hours = Math.max(0, (now - time(since)) / 3_600_000);
  return { on, since, hours, overdue: hours >= WAITING_LIMIT_HOURS };
}

// Staff-side requests past the limit: what the "Waiting over 24 hours" card counts and its link filters.
export const staffOverdue = (a: Application, now: number = Date.now()) => { const w = waiting(a, now); return !!w && w.on === 'Staff' && w.overdue; };

export function waitingLabel(hours: number): string {
  if (hours < 1) return 'under 1 hour';
  if (hours < 24) { const h = Math.floor(hours); return `${h} hour${h === 1 ? '' : 's'}`; }
  const d = Math.floor(hours / 24); return `${d} day${d === 1 ? '' : 's'}`;
}
