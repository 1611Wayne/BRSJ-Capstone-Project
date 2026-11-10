import type { Application, NotificationEvent, UserRole } from '@/types';

// Shared by the sample workflow and server saves. Call only after the action succeeds.
export function teamNotice(action: string, before: Application | undefined, after: Application) {
  const reference = after.reference;
  let event: NotificationEvent, message: string;
  if (action === 'saveApplication' && after.status === 'Pending Assessment' && (!before || before.status === 'Draft')) {
    event = 'submission_received'; message = `New application ${reference} was submitted. Review its documents and assessment.`;
  } else if (action === 'requestCorrection' && (after.corrections?.length ?? 0) > (before?.corrections?.length ?? 0)) {
    event = 'correction_requested'; message = `The Applicant requested a correction for ${reference}. Review the request before resolving it.`;
  } else if (['receiptPhoto', 'onlinePayment', 'or'].includes(action) && after.status === 'For Checking' && before?.status !== 'For Checking') {
    event = 'payment_pending'; message = `${after.simulatedPayment ? 'A simulated payment' : 'Payment evidence'} for ${reference} is waiting for Staff verification.`;
  } else if (action === 'verifyPayment' && after.status === 'Ready for Download' && before?.status !== 'Ready for Download') {
    event = 'release_pending'; message = `Payment for ${reference} was verified. Its clearance is ready for printing, the official stamp, and release at the monitoring office.`;
  } else return undefined;
  return { event, message, key: `team:${event}:${reference}` };
}

export function notificationApplicationPath(role: UserRole, reference: string) {
  return `/${role === 'resident' ? 'resident/applications' : role === 'staff' ? 'staff/applications' : 'admin/applications'}/${encodeURIComponent(reference)}`;
}
