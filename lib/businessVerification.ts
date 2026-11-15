import type { Application } from '@/types';

export const BUSINESS_SEARCH_LIMIT = 20;
export function validBusinessSearch(name: string) {
  return name.trim().length >= 2 && name.trim().length <= 160;
}
export function businessSearchPattern(name: string) {
  return name.trim().replace(/[\\%_]/g, '\\$&');
}
// Explicit public projection. Never return an Application or database row to a verifier.
export function publicBusinessRecord(a: Application) {
  if (a.clearanceType !== 'Business Clearance' || !a.clearance || !a.receipt || a.simulatedPayment ||
      !['Ready for Download', 'Closed - Cleared', 'Void', 'Under Review'].includes(a.status)) return null;
  return { businessName: a.businessName, reference: a.reference, clearanceType: a.clearanceType,
    issueDate: a.clearance.issueDate,
    status: a.status === 'Void' ? 'Void' : a.status === 'Under Review' ? 'Under Review' : a.clearance.revisedFrom ? 'Revised' : 'Valid' };
}
export function searchSampleBusinesses(applications: Application[], name: string) {
  if (!validBusinessSearch(name)) return [];
  return applications.filter(a => a.businessName.toLowerCase() === name.trim().toLowerCase())
    .map(publicBusinessRecord).filter((a): a is NonNullable<typeof a> => a !== null)
    .sort((a,b) => b.issueDate.localeCompare(a.issueDate) || a.reference.localeCompare(b.reference))
    .slice(0, BUSINESS_SEARCH_LIMIT);
}
