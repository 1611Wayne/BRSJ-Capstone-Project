import type { Application, ReportRecord } from '@/types';
export const SLA_SECONDS = 60; // Demo threshold; replace with approved capstone SLA.
export function monthlyRows(applications: Application[]): ReportRecord[] {
  const groups: Record<string, ReportRecord> = {};
  for (const a of applications.filter(a => a.status !== 'Draft' && a.status !== 'Void')) {
    const row = groups[a.clearanceType] ||= { clearanceType: a.clearanceType, count: 0, assessed: 0, recorded: 0 };
    row.count++; row.assessed += a.assessment?.total || 0; row.recorded += a.receipt?.amountPaid || 0;
  }
  return Object.values(groups);
}
export function processingSeconds(a: Application) {
  return a.clearance && a.receipt ? Math.max(0, (Date.parse(a.clearance.generatedAt) - Date.parse(a.receipt.recordedAt)) / 1000) : null;
}
