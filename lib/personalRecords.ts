import type { Application, PersonalRecordsRequest, User } from '@/types';

export const RECORDS_RETENTION_TEXT = 'The Barangay is still confirming its retention and disposal schedule. Records may need to be kept for legal, audit and public-records duties. Asking for a copy does not delete records or change those duties. Contact the Monitoring Office for retention or deletion questions.';
export const RECORDS_SUMMARY_TEXT = 'The downloadable summary contains your profile and application details. Uploaded files and other office-held records are handled separately as explained in the office response.';
export const validRecordRequestId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// Explicit fields only: never serialize a User or Application wholesale (passwords, storage paths, internal flags).
export function personalRecordSummary(user: User, applications: Application[], request: PersonalRecordsRequest, generatedAt: string) {
  if (user.role !== 'resident' || request.residentId !== user.id || request.status !== 'Answered' || !request.includeSummary) throw new Error('This records summary is not available to your account.');
  return {
    requestId: request.id, generatedAt, scope: RECORDS_SUMMARY_TEXT,
    profile: { name: `${user.firstName} ${user.lastName}`.trim(), email: user.email, contact: user.contact, address: user.address, registeredAt: user.createdAt },
    applications: applications.filter(a => a.residentId === user.id).map(a => ({
      reference: a.reference, applicant: a.applicant, address: a.address, contact: a.contact, purpose: a.purpose,
      clearanceType: a.clearanceType, applicationType: a.applicationType, dateRequested: a.dateRequested, status: a.status,
      businessName: a.businessName, businessLocation: a.businessLocation, initialOperation: a.initialOperation,
      ownership: a.ownership, propertyOwner: a.propertyOwner, businessContact: a.businessContact,
      businessSubcategory: a.businessSubcategory, hasEmployees: a.hasEmployees, employeeCount: a.employeeCount, source: a.source,
      documents: a.documents.map(d => ({ requirement: d.requirement, filename: d.name, size: d.size, type: d.type, status: d.status, note: d.note })),
      assessment: a.assessment ? { items: a.assessment.items.map(i => ({ name: i.name, amount: i.amount })), total: a.assessment.total, category: a.assessment.category, classification: a.assessment.classification, ordinance: a.assessment.ordinance, assessedAt: a.assessment.assessedAt } : undefined,
      receipt: a.receipt ? { orNumber: a.receipt.orNumber, orDate: a.receipt.orDate, amountPaid: a.receipt.amountPaid, recordedAt: a.receipt.recordedAt } : undefined,
      clearance: a.clearance ? { issueDate: a.clearance.issueDate, generatedAt: a.clearance.generatedAt, downloadedAt: a.clearance.downloadedAt, revisedFrom: a.clearance.revisedFrom } : undefined,
      confirmedAt: a.confirmation?.timestamp,
      feedback: a.feedback ? { rating: a.feedback.rating, comment: a.feedback.comment, submittedAt: a.feedback.submittedAt } : undefined,
    })),
  };
}
