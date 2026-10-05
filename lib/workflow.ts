import type { Application, ApplicationInput, DocumentRequirement, FeeSchedule, InspectionReport, PortalState, SimulatedPayment, TransactionReversion, UploadedDocument, User } from '@/types';
import { clearanceTypes } from '@/data/clearanceTypes';
import { fullName } from '@/data/mockUsers';
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
export const dateLabel = (value?: string) => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', ...(value.includes('T') ? { timeStyle: 'short' as const } : {}) }) : '—';
export function requirements(a: Pick<Application, 'clearanceType' | 'ownership' | 'applicationType'>): DocumentRequirement[] {
  if (a.clearanceType !== 'Business Clearance') return [{ name: 'Valid ID', required: true }, { name: 'Supporting Property / Clearance Document', required: true }];
  return [{ name: 'Valid ID of Owner', required: true }, { name: 'Picture of Establishment / Business', required: true }, { name: 'DTI / SEC Document', required: true }, ...(a.ownership === 'Renter' ? [{ name: 'Contract of Lease', required: true }] : []), ...(a.applicationType === 'Renewal' ? [{ name: 'Old Business Clearance', required: true }] : [])];
}
export function validFile(file: Pick<UploadedDocument, 'name' | 'size' | 'type'>) {
  return /\.(jpe?g|png|pdf)$/i.test(file.name) && ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) && file.size > 0 && file.size <= 5 * 1024 * 1024;
}
function requireThat(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function activeSchedule(schedules: FeeSchedule[], type: string, category: string, classification: string, date = today()) {
  return schedules.filter(s => s.clearanceType === type && s.category === category && s.classification === classification && s.effectiveDate <= date).sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt.localeCompare(a.createdAt))[0];
}
export function validateOR(number: string, date: string, amount: string | number, total: number, currentDate = today()) {
  requireThat(/^TR-\d{4}-\d{5}$/.test(number), 'Use the OR format TR-YYYY-#####.');
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date && date <= currentDate, 'Enter a valid OR date that is not in the future.');
  requireThat(number.slice(3,7) === date.slice(0,4), 'The OR year must match the OR date.');
  requireThat(/^\d+(\.\d{1,2})?$/.test(String(amount)) && Number.isFinite(Number(amount)) && Number(amount) >= 0, 'Enter a valid currency amount with at most two decimal places.');
  requireThat(Math.round(Number(amount) * 100) === Math.round(total * 100), 'Amount Paid must match the assessed amount.');
}
export type Command =
  | { type: 'login'; email: string; password: string; staffLogin?: boolean } | { type: 'logout' }
  | { type: 'register'; user: User }
  | { type: 'saveApplication'; application: ApplicationInput; reference?: string; draft: boolean }
  | { type: 'review'; reference: string; documents: UploadedDocument[] }
  | { type: 'inspection'; reference: string; report: InspectionReport }
  | { type: 'assess'; reference: string; category: string; classification: string }
  | { type: 'reject'; reference: string; reason: string }
  | { type: 'or'; reference: string; number: string; date: string; amount: string; receiptPhoto?: UploadedDocument }
  | { type: 'onlinePayment'; reference: string; method: SimulatedPayment['method']; amount: number }
  | { type: 'download' | 'confirm'; reference: string }
  | { type: 'feedback'; reference: string; rating: number; comment: string }
  | { type: 'revert'; data: TransactionReversion }
  | { type: 'fees'; schedule: FeeSchedule }
  | { type: 'user'; user: User; reason: string };
export function transition(state: PortalState, command: Command, now = new Date().toISOString()): PortalState {
  const s: PortalState = { ...state, users: [...state.users], applications: [...state.applications], schedules: [...state.schedules], audits: [...state.audits] };
  const actor = state.users.find(u => u.id === state.currentUserId && u.status === 'Active');
  const log = (action: string, reference: string, oldValue = '', newValue = '', reason = '', reversion = false) => s.audits.unshift({ id: `audit-${now}-${s.audits.length}`, timestamp: now, user: actor ? fullName(actor) : 'Resident registration', role: actor?.role || 'resident', action, reference, oldValue, newValue, reason, reversion });
  if (command.type === 'logout') { s.currentUserId = null; return s; }
  if (command.type === 'login') {
    const user = s.users.find(u => u.email.toLowerCase() === command.email.trim().toLowerCase() && u.password === command.password && u.status === 'Active');
    requireThat(user, 'The account details are incorrect or the account is inactive.');
    s.currentUserId = user!.id; return s;
  }
  const validateUser = (u: User) => {
    requireThat(u.firstName.trim() && u.lastName.trim() && u.email.trim() && u.password.length >= 8, 'Name, email / username, and a password of at least 8 characters are required.');
    requireThat(!s.users.some(x => x.id !== u.id && x.email.toLowerCase() === u.email.toLowerCase()), 'This email or username is already registered.');
  };
  if (command.type === 'register') {
    validateUser(command.user);
    requireThat(command.user.role === 'resident' && command.user.validId && validFile(command.user.validId) && command.user.privacyConsentAt, 'Valid ID and privacy consent are required.');
    requireThat(!s.users.some(u => u.id === command.user.id), 'This resident already exists.');
    s.users.push(command.user); log('Resident registered', command.user.id); return s;
  }
  requireThat(actor, 'Please log in to continue.');
  const staff = () => requireThat(actor.role === 'staff', 'Only Staff can perform this action.');
  const admin = () => requireThat(actor.role === 'admin', 'Only Admin can perform this action.');
  if (command.type === 'user') {
    const previous = s.users.find(u => u.id === command.user.id);
    const self = actor.role === 'resident' && actor.id === command.user.id;
    requireThat(actor.role === 'admin' || self || (actor.role === 'staff' && !previous && command.user.role === 'resident'), 'You cannot manage this account.');
    requireThat(command.user.role !== 'admin' && (!previous || previous.role !== 'admin'), 'Admin accounts cannot be created or changed here.');
    requireThat(!self || (command.user.role === 'resident' && command.user.status === actor.status && command.user.password === actor.password), 'Profile updates cannot change account permissions.');
    validateUser(command.user);
    if (previous) s.users = s.users.map(u => u.id === command.user.id ? command.user : u); else s.users.push(command.user);
    const safe = (u?: User) => u ? JSON.stringify({ name: fullName(u), email: u.email, role: u.role, status: u.status, contact: u.contact, address: u.address }) : '';
    log(command.reason, command.user.id, safe(previous), safe(command.user)); return s;
  }
  if (command.type === 'fees') {
    admin(); const f = command.schedule;
    requireThat(clearanceTypes.some(c => c.name === f.clearanceType), 'Select a supported clearance type.');
    requireThat(f.effectiveDate && !isNaN(Date.parse(f.effectiveDate)) && f.ordinance.trim(), 'Effective date and ordinance reference are required.');
    requireThat(f.items.length && f.items.every(i => i.name.trim() && Number.isFinite(i.amount) && i.amount >= 0 && Math.abs(i.amount * 100 - Math.round(i.amount * 100)) < 0.00001), 'Each fee needs a name and a non-negative amount with at most two decimal places.');
    const previous = activeSchedule(s.schedules, f.clearanceType, f.category, f.classification, f.effectiveDate);
    const schedule = { ...f, id: `fee-${now}`, changedBy: fullName(actor), createdAt: now, items: f.items.map(i => ({ ...i })) };
    s.schedules.push(schedule); log('Updated fee schedule', schedule.id, JSON.stringify(previous?.items || []), JSON.stringify(schedule.items), f.notes); return s;
  }
  if (command.type === 'saveApplication') {
    const a = command.application, previous = s.applications.find(x => x.reference === command.reference);
    requireThat(actor.role === 'staff' || (actor.role === 'resident' && a.residentId === actor.id), 'This request belongs to another resident.');
    requireThat(!previous || (previous.status === 'Draft' && previous.residentId === a.residentId), 'Only drafts can be edited.');
    requireThat(clearanceTypes.some(c => c.name === a.clearanceType), 'Choose a supported clearance type.');
    if (!command.draft) {
      requireThat(a.applicant.trim() && a.address.trim() && a.purpose.trim() && /^(09\d{9}|\+639\d{9})$/.test(a.contact), 'Complete applicant details and enter a valid Philippine mobile number.');
      requireThat(a.businessLocation.trim(), 'Business / property location is required.');
      if (a.clearanceType === 'Business Clearance') requireThat(a.businessName.trim() && a.initialOperation && !isNaN(Date.parse(a.initialOperation)) && a.initialOperation <= today() && a.businessContact.trim(), 'Complete the business information and use a valid operation date.');
      requireThat(a.ownership === 'Owner' || a.propertyOwner.trim(), 'Property owner name is required for renters and occupants.');
      requireThat(a.certified, 'Certify that the information is true and correct.');
      requireThat(requirements(a).every(r => !r.required || a.documents.some(d => d.requirement === r.name && validFile(d))), 'Upload all required documents in JPG, PNG, or PDF, up to 5 MB each.');
    }
    const next = Math.max(126, ...s.applications.map(x => Number(x.reference.split('-')[2]))) + 1;
    const reference = previous?.reference || `SJ-${now.slice(0,4)}-${String(next).padStart(6,'0')}`;
    const record: Application = { ...a, source: actor.role === 'staff' ? 'Assisted / Walk-in' : 'Online', staffEncoder: actor.role === 'staff' ? fullName(actor) : undefined, reference, dateRequested: command.draft ? previous?.dateRequested || now : now, status: command.draft ? 'Draft' : 'Pending Assessment' };
    s.applications = previous ? s.applications.map(x => x.reference === reference ? record : x) : [record, ...s.applications];
    log(command.draft ? 'Draft saved' : 'Application submitted', reference, previous?.status, record.status); return s;
  }
  const reference = command.type === 'revert' ? command.data.reference : command.reference;
  const original = s.applications.find(a => a.reference === reference);
  requireThat(original, 'Application not found.');
  requireThat(actor.role !== 'resident' || original.residentId === actor.id, 'This request belongs to another resident.');
  const a = { ...original };
  if (command.type === 'review') { staff(); requireThat(a.status === 'Pending Assessment' || a.status === 'Under Review', 'Requirements can only be reviewed before assessment.'); a.documents = command.documents; log('Requirements reviewed', reference, JSON.stringify(original.documents.map(d => [d.requirement, d.status])), JSON.stringify(a.documents.map(d => [d.requirement, d.status]))); }
  if (command.type === 'inspection') { staff(); requireThat(a.status !== 'Void', 'A void transaction cannot be inspected.'); requireThat(command.report.status !== 'Completed' || (command.report.inspector.trim() && command.report.date && command.report.date <= today()), 'Completed inspections need an inspector and valid date.'); a.inspection = { ...command.report, savedAt: now }; log('Inspection report saved', reference, JSON.stringify(original.inspection), JSON.stringify(a.inspection)); }
  if (command.type === 'assess') {
    staff(); requireThat(a.status === 'Pending Assessment' || (a.status === 'Under Review' && !a.receipt), 'This request cannot be assessed at its current stage.');
    requireThat(requirements(a).every(r => a.documents.some(d => d.requirement === r.name && d.status === 'Verified')), 'Verify every required document before confirming assessment.');
    const schedule = activeSchedule(s.schedules, a.clearanceType, command.category, command.classification);
    requireThat(schedule, 'No effective fee schedule matches this selection.');
    a.assessment = { items: schedule.items.map(i => ({ ...i })), total: Math.round(schedule.items.reduce((sum,i) => sum + i.amount,0)*100)/100, category: schedule.category, classification: schedule.classification, scheduleId: schedule.id, assessedBy: fullName(actor), assessedAt: now };
    a.status = 'Awaiting OR'; a.staffEncoder = fullName(actor); log('Assessment confirmed', reference, original.status, JSON.stringify(a.assessment));
  }
  if (command.type === 'reject') {
    requireThat(actor.role === 'staff' || actor.role === 'admin', 'Only Staff or Admin can reject an application.');
    requireThat(command.reason.trim(), 'A rejection reason is required.');
    requireThat(['Pending Assessment', 'Under Review'].includes(a.status), 'Only applications pending assessment or under review can be rejected.');
    a.status = 'Rejected';
    a.rejection = { reason: command.reason.trim(), rejectedBy: fullName(actor), timestamp: now };
    log('Application rejected', reference, original.status, 'Rejected', command.reason);
  }
  if (command.type === 'or') {
    requireThat(actor.role === 'resident' || actor.role === 'staff', 'Only Residents or Staff can record OR details.');
    requireThat(a.status === 'Awaiting OR' && a.assessment, 'Staff must complete assessment before OR entry.');
    validateOR(command.number, command.date, command.amount, a.assessment.total);
    requireThat(!s.applications.some(x => x.reference !== reference && x.receipt?.orNumber === command.number), 'This OR number is already recorded for another request.');
    a.receipt = { orNumber: command.number, orDate: command.date, amountPaid: Number(command.amount), recordedAt: now, encodedBy: fullName(actor), ...(command.receiptPhoto ? { receiptPhoto: command.receiptPhoto } : {}) };
    a.clearance = { issueDate: today(), generatedAt: now }; a.status = 'Ready for Download';
    log('OR details recorded', reference, '', JSON.stringify({ orNumber: command.number, orDate: command.date, amountPaid: command.amount, hasPhoto: !!command.receiptPhoto })); log('Clearance generated', reference, original.status, a.status);
  }
  if (command.type === 'onlinePayment') {
    requireThat(actor.role === 'resident' || actor.role === 'staff', 'Only Residents or Staff can record payment.');
    requireThat(a.status === 'Awaiting OR' && a.assessment, 'Staff must complete assessment before payment.');
    requireThat(!a.simulatedPayment, 'A simulated payment has already been recorded for this application.');
    const datePart = now.slice(0,10).replace(/-/g,'');
    const seqPart = String(Math.floor(10000 + Math.random() * 89999));
    const simRef = `SIM-${datePart}-${seqPart}`;
    a.simulatedPayment = { method: command.method, referenceNumber: simRef, amount: command.amount, paidAt: now, note: 'SIMULATION – not an official Treasury payment' };
    a.clearance = { issueDate: today(), generatedAt: now }; a.status = 'Ready for Download';
    log('Simulated online payment', reference, '', JSON.stringify({ method: command.method, referenceNumber: simRef, amount: command.amount }));
  }
  if (command.type === 'download') {
    requireThat(actor.role === 'resident' && (a.receipt || a.simulatedPayment) && a.clearance && (a.status === 'Ready for Download' || a.status === 'Closed - Cleared'), 'Clearance is not available for download.');
    a.clearance = { ...a.clearance, downloadedAt: now }; log('Clearance downloaded', reference);
  }
  if (command.type === 'confirm') {
    requireThat(actor.role === 'resident' && a.status === 'Ready for Download' && a.clearance?.downloadedAt, 'Download your clearance before confirming receipt.');
    a.confirmation = { timestamp: now, completionTime: now, ipPlaceholder: 'Not collected (prototype)' }; a.status = 'Closed - Cleared'; log('Receipt confirmed', reference, original.status, a.status);
  }
  if (command.type === 'feedback') {
    requireThat(actor.role === 'resident' && a.confirmation && !a.feedback && Number.isInteger(command.rating) && command.rating >= 1 && command.rating <= 5, 'Feedback requires confirmed receipt and a rating from 1 to 5.');
    a.feedback = { rating: command.rating, comment: command.comment.trim(), submittedAt: now }; log('Feedback submitted', reference);
  }
  if (command.type === 'revert') {
    admin(); const d = command.data; requireThat(d.reason.trim(), 'Reason for reversion is required.');
    if (d.action === 'Void Transaction') a.status = 'Void';
    else if (d.action === 'Mark Under Review') a.status = 'Under Review';
    else {
      requireThat(d.applicant?.trim(), 'Applicant name is required.');
      if (a.receipt && d.orNumber) {
        validateOR(d.orNumber, a.receipt.orDate, a.receipt.amountPaid, a.assessment!.total);
        requireThat(!s.applications.some(x => x.reference !== reference && x.receipt?.orNumber === d.orNumber), 'This OR number is already in use.');
        a.receipt = { ...a.receipt, orNumber: d.orNumber };
      }
      a.applicant = d.applicant!.trim(); a.businessName = d.businessName?.trim() || a.businessName;
      if (a.clearance) a.clearance = { ...a.clearance, revisedFrom: a.clearance.revisedFrom || a.clearance.issueDate, downloadedAt: undefined };
    }
    const snapshot = (x: Application) => JSON.stringify({ applicant: x.applicant, businessName: x.businessName, orNumber: x.receipt?.orNumber, status: x.status });
    log(d.action, reference, snapshot(original), snapshot(a), d.reason, true);
  }
  s.applications = s.applications.map(x => x.reference === reference ? a : x);
  return s;
}

