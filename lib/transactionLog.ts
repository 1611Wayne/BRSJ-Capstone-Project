import type { Application, AuditLog } from '@/types';
import { isSensitiveViewAction } from '@/lib/sensitiveViews';

export const transactionDateLabel = (timestamp?: string) => timestamp
  ? new Date(timestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' }) : '—';

// These are the latest stored milestones; repeated stages remain separate events in the audit history below.
export function transactionMilestones(a: Application) {
  const reviewed = a.documents.filter(d => d.reviewedAt).sort((x, y) => Date.parse(y.reviewedAt!) - Date.parse(x.reviewedAt!))[0];
  return [
    { stage: 'Request Time', action: 'Application submitted', timestamp: a.status === 'Draft' ? undefined : a.dateRequested, user: a.source === 'Assisted / Walk-in' ? a.staffEncoder : a.applicant },
    { stage: 'Document Review Time', action: 'Requirements reviewed', timestamp: reviewed?.reviewedAt, user: reviewed?.reviewedBy },
    { stage: 'Inspection Saved Time', action: 'Inspection report saved', timestamp: a.inspection?.savedAt },
    { stage: 'Assessment Time', action: 'Assessment confirmed', timestamp: a.assessment?.assessedAt, user: a.assessment?.assessedBy },
    { stage: 'Receipt Submission Time', action: a.simulatedPayment ? 'Simulated online payment' : 'Receipt submitted for checking', timestamp: a.paymentVerification?.submittedAt || a.receipt?.recordedAt || a.simulatedPayment?.paidAt },
    { stage: 'OR Verification Time', action: 'Payment verified by staff', timestamp: a.paymentVerification?.status === 'Verified' ? a.paymentVerification.checkedAt : undefined, user: a.paymentVerification?.checkedBy },
    { stage: 'Payment Returned Time', action: 'Payment returned for correction', timestamp: a.paymentVerification?.status === 'Needs Correction' ? a.paymentVerification.checkedAt : undefined, user: a.paymentVerification?.checkedBy },
    { stage: 'Clearance Generated Time', action: 'Clearance generated', timestamp: a.clearance?.generatedAt, user: a.paymentVerification?.checkedBy },
    { stage: 'Clearance Download Time', action: 'Clearance downloaded', timestamp: a.clearance?.downloadedAt, user: a.applicant },
    { stage: 'Completion Time', action: a.confirmation?.confirmedBy ? 'Release confirmed by Staff for the Applicant' : 'Receipt confirmed', timestamp: a.confirmation?.completionTime, user: a.confirmation?.confirmedBy || a.applicant },
    { stage: 'Feedback Submitted Time', action: 'Feedback submitted', timestamp: a.feedback?.submittedAt, user: a.applicant },
    { stage: 'Rejection Time', action: 'Application rejected', timestamp: a.rejection?.timestamp, user: a.rejection?.rejectedBy },
  ];
}

export function transactionEvents(a: Application, audits: AuditLog[]) {
  const events = audits.filter(log => log.reference === a.reference && !isSensitiveViewAction(log.action)).slice().reverse().map(log => ({
    id: log.id, timestamp: log.timestamp, user: log.user, action: log.action, reason: log.reason,
  }));
  for (const milestone of transactionMilestones(a)) {
    if (!milestone.timestamp) continue;
    // Prefer the audit event when one exists for this action. Receipt submission has two legacy action labels.
    const actions = milestone.stage === 'Receipt Submission Time' ? ['Receipt photo submitted for checking', 'OR details submitted for checking', 'Simulated online payment']
      : milestone.stage === 'Inspection Saved Time' ? ['Inspection report saved', 'Inspection scheduled', 'Inspection rescheduled', 'Inspection schedule cleared', 'Inspection completed'] : [milestone.action];
    if (events.some(event => actions.includes(event.action))) continue;
    events.push({ id: 'milestone-' + milestone.stage, timestamp: milestone.timestamp, user: milestone.user || 'Not recorded', action: milestone.action, reason: undefined });
  }
  return events.sort((x, y) => Date.parse(x.timestamp) - Date.parse(y.timestamp));
}
