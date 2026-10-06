export type UserRole = 'resident' | 'staff' | 'admin';
export type ApplicationStatus = 'Draft' | 'Pending Assessment' | 'Awaiting OR' | 'For Checking' | 'Ready for Download' | 'Closed - Cleared' | 'Under Review' | 'Void' | 'Rejected';
export interface User { id: string; firstName: string; lastName: string; email: string; password: string; role: UserRole; status: 'Active' | 'Inactive'; createdAt: string; contact: string; address: string; validId?: UploadedDocument; privacyConsentAt?: string }
export interface Resident extends User { role: 'resident' }
export interface Staff extends User { role: 'staff' }
export interface Admin extends User { role: 'admin' }
export interface ClearanceType { id: string; name: string; shortName: string; description: string; icon: string }
export type Ownership = 'Owner' | 'Renter' | 'Occupant';
export interface DocumentRequirement { name: string; required: boolean }
export interface UploadedDocument { requirement: string; name: string; size: number; type: string; status: 'Pending Review' | 'Verified' | 'Missing' | 'Needs Replacement'; url?: string; note?: string }
export interface BusinessClassification { name: string; businessClearance: number }
export interface BusinessCategory { name: string; classifications?: BusinessClassification[]; businessClearance?: number }
export type RevenueCategory = BusinessCategory;
export interface FeeComponent { name: string; amount: number; ordinance?: string }
export interface AssessmentItem extends FeeComponent {}
export interface FeeSchedule { id: string; clearanceType: string; category: string; classification: string; items: FeeComponent[]; effectiveDate: string; ordinance: string; notes: string; changedBy: string; createdAt: string }
export interface Assessment { items: AssessmentItem[]; total: number; category: string; classification: string; assessedBy: string; assessedAt: string; scheduleId: string }
export interface BusinessAssessment extends Assessment {}
export interface OfficialReceipt { orNumber: string; orDate: string; amountPaid: number; recordedAt: string; encodedBy: string; receiptPhoto?: UploadedDocument }
export interface SimulatedPayment { method: 'GCash' | 'Bank Transfer' | 'Maya' | 'Other'; referenceNumber: string; amount: number; paidAt: string; note: string }
export interface Clearance { issueDate: string; generatedAt: string; revisedFrom?: string; downloadedAt?: string }
export interface ReceiptConfirmation { timestamp: string; ipPlaceholder: string; completionTime: string }
export interface Feedback { rating: number; comment: string; submittedAt: string }
export interface InspectionReport { status: 'Pending' | 'Completed'; inspector: string; date: string; remarks: string; savedAt?: string }
export interface Application {
  reference: string; residentId: string; applicant: string; address: string; contact: string; purpose: string; clearanceType: string; dateRequested: string; status: ApplicationStatus;
  businessName: string; businessLocation: string; initialOperation: string; applicationType: 'New Application' | 'Renewal'; ownership: Ownership; propertyOwner: string; businessContact: string;
  source: 'Online' | 'Assisted / Walk-in'; staffEncoder?: string; documents: UploadedDocument[]; certified: boolean;
  hasEmployees?: boolean; employeeCount?: number;
  businessSubcategory?: 'Ambulant' | 'Lessor (Paupahan)';
  assessment?: Assessment; receipt?: OfficialReceipt; clearance?: Clearance; confirmation?: ReceiptConfirmation; feedback?: Feedback; inspection?: InspectionReport;
  simulatedPayment?: SimulatedPayment;
  receiptPhoto?: UploadedDocument;
  paymentVerification?: { status: 'Pending' | 'Verified' | 'Needs Correction'; submittedAt: string; checkedBy?: string; checkedAt?: string; orNumber?: string; notes?: string };
  rejection?: { reason: string; rejectedBy: string; timestamp: string };
  corrections?: CorrectionRequest[];
}
// The Applicant says in plain words what is wrong; Staff make the change for them and mark it Resolved.
export interface CorrectionRequest { id: string; message: string; requestedBy: string; requestedAt: string; status: 'Open' | 'Resolved'; resolvedBy?: string; resolvedAt?: string; resolutionNote?: string }
// The entries Staff may correct for an Applicant. Clearance type is not one of them: it changes the requirements and fees.
export type ApplicationEdits = Partial<Pick<Application, 'applicant' | 'address' | 'contact' | 'purpose' | 'applicationType' | 'businessLocation' | 'businessName' | 'initialOperation' | 'businessContact' | 'ownership' | 'propertyOwner' | 'hasEmployees' | 'employeeCount' | 'businessSubcategory'>>;
export type ApplicationInput = Omit<Application, 'reference' | 'dateRequested' | 'status'>;
export type ReversionAction = 'Edit Fields' | 'Void Transaction' | 'Mark Under Review';
export interface TransactionReversion { reference: string; action: ReversionAction; reason: string; applicant?: string; businessName?: string; orNumber?: string }
export interface AuditLog { id: string; timestamp: string; user: string; role: UserRole; action: string; reference: string; oldValue?: string; newValue?: string; reason?: string; reversion?: boolean }
export interface ReportRecord { clearanceType: string; count: number; assessed: number; recorded: number }
export interface PortalState { users: User[]; applications: Application[]; schedules: FeeSchedule[]; audits: AuditLog[]; currentUserId: string | null }
