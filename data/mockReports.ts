import type { Application, ReportRecord } from '@/types';
import { manilaDate } from '@/lib/workflow';
export const SLA_SECONDS = 60; // Demo threshold for the Staff payment check (upload to verification). No SLA has been approved; replace when one is.
export function monthlyRows(applications: Application[]): ReportRecord[] {
  const groups: Record<string, ReportRecord> = {};
  for (const a of applications.filter(a => a.status !== 'Draft' && a.status !== 'Void')) {
    const row = groups[a.clearanceType] ||= { clearanceType: a.clearanceType, count: 0, assessed: 0, recorded: 0 };
    row.count++; row.assessed += a.assessment?.total || 0; // Collections are released payments with an OR. A simulated payment has no receipt, so it is never counted (manuscript 3.3.4).
    row.recorded += a.clearance && a.receipt ? a.receipt.amountPaid : 0;
  }
  return Object.values(groups);
}
// Total processing duration, as the manuscript defines it (3.3.1): from the initial application submission to the Applicant's
// receipt confirmation. Null until the Applicant has confirmed receipt.
export function processingSeconds(a: Application) {
  return a.confirmation ? Math.max(0, (Date.parse(a.confirmation.timestamp) - Date.parse(a.dateRequested)) / 1000) : null;
}
// Staff payment check turnaround: from the receipt upload to Staff verification. This is what the SLA indicators measure.
export function paymentCheckSeconds(a: Application) {
  const v = a.paymentVerification;
  return v?.status === 'Verified' && v.checkedAt ? Math.max(0, (Date.parse(v.checkedAt) - Date.parse(v.submittedAt)) / 1000) : null;
}
export const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
// Daily OR Summary: clearances released against a verified OR on the given Manila day (the day Staff verified the payment).
export const dailyOrApplications = (applications: Application[], date: string, type = '') =>
  applications.filter(a => a.receipt && a.clearance && manilaDate(a.clearance.generatedAt) === date && (!type || a.clearanceType === type));
