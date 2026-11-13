import type { Application } from '@/types';

// Hide rejected/void records in the general office queue, while explicit status and correction filters
// still reach them. Applicant lists opt into all records so returned requests remain actionable.
export function matchesApplicationStatus(application: Application, status: string, includeRejectedVoid: boolean) {
  if (status === 'Correction Requests') return !!application.corrections?.some(c => c.status === 'Open');
  if (status) return application.status === status;
  return includeRejectedVoid || !['Rejected', 'Void'].includes(application.status);
}
