import type { Application, ApplicationEdits, ApplicationInput, ApplicationStatus, AuditLog, Clearance, CorrectionRequest, DocumentRequirement, FeeSchedule, InspectionReport, PortalState, SimulatedPayment, TransactionReversion, UploadedDocument, User } from '@/types';
import { clearanceTypes, businessSubcategories } from '@/data/clearanceTypes';
import { fullName } from '@/data/mockUsers';
import { canScheduleInspection, inspectionCalendarDate, validInspectionTimestamp } from '@/lib/inspections';
import type { AppNotification, NotificationEvent } from '@/types';
import { teamNotice } from '@/lib/teamNotifications';
import { validRecordRequestId } from '@/lib/personalRecords';
import type { PersonalRecordsRequest } from '@/types';
// An Applicant's notifications, newest first.
export const notificationsFor = (state: PortalState, userId?: string): AppNotification[] =>
  (state.notifications ?? []).filter(n => n.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
// The calendar day (YYYY-MM-DD) an ISO timestamp falls on in Manila. A plain slice(0, 10) gives the UTC day, which is the
// day before for anything between 00:00 and 08:00 Manila time.
export const manilaDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
export const dateLabel = (value?: string) => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', ...(value.includes('T') ? { timeStyle: 'short' as const } : {}) }) : '—';
export type DateRangePreset = 'annual' | 'quarterly' | 'weekly' | 'daily';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Calendar-aligned periods (matching the Monthly Collection Report's own calendar-month convention), computed
// from the plain Y-M-D parts of `anchor` — no timezone conversion needed since we never leave calendar-date math.
export function presetRange(preset: DateRangePreset, anchor = today()): { from: string; to: string } {
  const [y, m, d] = anchor.split('-').map(Number);
  if (preset === 'daily') return { from: anchor, to: anchor };
  if (preset === 'weekly') {
    const monday = new Date(y, m - 1, d - ((new Date(y, m - 1, d).getDay() + 6) % 7));
    return { from: iso(monday), to: iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) };
  }
  if (preset === 'quarterly') {
    const qStart = Math.floor((m - 1) / 3) * 3;
    return { from: iso(new Date(y, qStart, 1)), to: iso(new Date(y, qStart + 3, 0)) };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
export function requirements(a: Pick<Application, 'clearanceType' | 'ownership' | 'applicationType'>): DocumentRequirement[] {
  if (a.clearanceType !== 'Business Clearance') return [{ name: 'Valid ID', required: true }, { name: 'Supporting Property / Clearance Document', required: true }];
  return [{ name: 'Valid ID of Owner', required: true }, { name: 'Picture of Establishment / Business', required: true }, { name: 'DTI / SEC Document', required: true }, ...(a.ownership === 'Renter' ? [{ name: 'Contract of Lease', required: true }] : []), ...(a.applicationType === 'Renewal' ? [{ name: 'Old Business Clearance', required: true }] : [])];
}
// Payment evidence is a typed receipt, an uploaded receipt photo (the OR number is then kept in paymentVerification, not in
// receipt), or a simulated payment. The download rule and the public verification page both use this, so they cannot drift apart.
export const hasPaymentEvidence = (a: Pick<Application, 'receipt' | 'receiptPhoto' | 'simulatedPayment'>) => !!(a.receipt || a.receiptPhoto || a.simulatedPayment);
export const verifiableClearance = (a: Application): a is Application & { clearance: Clearance } => !!a.clearance && hasPaymentEvidence(a);
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
  validateAmountPaid(amount, total);
}
// The Amount Paid read off a receipt: a currency amount with at most two decimals that equals the assessed total. A receipt that
// shows a different amount cannot be verified; Staff return it to the Applicant with a reason.
export function validateAmountPaid(amount: string | number, total: number) {
  requireThat(/^\d+(\.\d{1,2})?$/.test(String(amount)) && Number.isFinite(Number(amount)) && Number(amount) >= 0, 'Enter a valid currency amount with at most two decimal places.');
  requireThat(Math.round(Number(amount) * 100) === Math.round(total * 100), 'Amount Paid must match the assessed amount.');
}
// The OR date Staff type from a receipt image: a real calendar date, not in the future. (validateOR also ties the OR number's year
// to the date, which only fits the typed TR-YYYY-##### format; a number read off an image is not held to that pattern.)
export const validOrDate = (date?: string, currentDate = today()) => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date && date <= currentDate;
// Before the clearance is generated, an Applicant can ask for a correction and Staff can make it. A rejected request counts as
// returned to the Applicant. After generation, changes go through the Admin transaction reversion.
export const correctableStatuses: ApplicationStatus[] = ['Pending Assessment', 'Under Review', 'Rejected', 'Awaiting OR', 'For Checking'];
export type Command =
  | { type: 'login'; email: string; password: string } | { type: 'logout' }
  | { type: 'sessionUser'; user: User }
  | { type: 'loadApplications'; applications: Application[]; replaceOwn?: boolean; replaceAll?: boolean; requestedAt?: number }   // requestedAt: when a reload asked the server (see PortalProvider)
  | { type: 'loadNotifications'; notifications: AppNotification[] }
  | { type: 'loadRecordRequests'; requests: PersonalRecordsRequest[] }
  | { type: 'requestRecords'; id: string; message: string }
  | { type: 'answerRecords'; id: string; response: string; includeSummary: boolean }
  | { type: 'loadAudits'; audits: AuditLog[]; reference?: string }
  | { type: 'loadSchedules'; schedules: FeeSchedule[] }
  | { type: 'loadUsers'; users: User[] }
  | { type: 'register'; user: User }
  | { type: 'saveApplication'; application: ApplicationInput; reference?: string; draft: boolean }
  | { type: 'review'; reference: string; documents: UploadedDocument[] }
  | { type: 'replaceDocument'; reference: string; document: UploadedDocument }
  | { type: 'inspection'; reference: string; report: InspectionReport }
  | { type: 'assess'; reference: string; category: string; classification: string; amounts?: number[] }
  | { type: 'reject'; reference: string; reason: string; category?: 'standard' | 'spam' }
  | { type: 'requestCorrection'; reference: string; message: string }
  | { type: 'editApplication'; reference: string; changes: ApplicationEdits }
  | { type: 'resolveCorrection'; reference: string; note?: string }
  | { type: 'or'; reference: string; number: string; date: string; amount: string; receiptPhoto?: UploadedDocument }
  | { type: 'onlinePayment'; reference: string; method: SimulatedPayment['method']; amount: number }
  | { type: 'receiptPhoto'; reference: string; photo: UploadedDocument }
  | { type: 'verifyPayment'; reference: string; orNumber?: string; orDate?: string; amountPaid?: string | number }
  | { type: 'returnPayment'; reference: string; reason: string }
  | { type: 'download' | 'confirm' | 'printClearance'; reference: string }
  | { type: 'readNotifications' }
  | { type: 'feedback'; reference: string; rating: number; comment: string }
  | { type: 'revert'; data: TransactionReversion }
  | { type: 'fees'; schedule: FeeSchedule }
  | { type: 'user'; user: User; reason: string };
export function transition(state: PortalState, command: Command, now = new Date().toISOString()): PortalState {
  const s: PortalState = { ...state, users: [...state.users], applications: [...state.applications], schedules: [...state.schedules], audits: [...state.audits], notifications: [...(state.notifications ?? [])] };
  const actor = state.users.find(u => u.id === state.currentUserId && u.status === 'Active');
  const log = (action: string, reference: string, oldValue = '', newValue = '', reason = '', reversion = false) => s.audits.unshift({ id: `audit-${now}-${s.audits.length}`, timestamp: now, user: actor ? fullName(actor) : 'Resident registration', userId: actor?.id, role: actor?.role || 'resident', action, reference, oldValue, newValue, reason, reversion });
  // Notify the Applicant who owns a request. An unread notice with the same key is updated instead of repeated.
  const notify = (userId: string, reference: string, event: NotificationEvent, message: string, key?: string) => {
    const existing = key ? s.notifications.find(n => n.userId === userId && n.key === key && !n.readAt) : undefined;
    if (existing) { s.notifications = s.notifications.map(n => n === existing ? { ...n, message, createdAt: now } : n); return; }
    s.notifications = [{ id: `note-${now}-${s.notifications.length}`, userId, reference, event, message, createdAt: now, ...(key ? { key } : {}) }, ...s.notifications];
  };
  const dropUnread = (userId: string, key: string) => { s.notifications = s.notifications.filter(n => !(n.userId === userId && n.key === key && !n.readAt)); };
  const notifyTeam = (before: Application | undefined, after: Application) => {
    const notice = teamNotice(command.type, before, after);
    if (notice) for (const user of s.users) if (user.status === 'Active' && (user.role === 'staff' || user.role === 'admin')) {
      notify(user.id, after.reference, notice.event, notice.message, notice.key);
    }
  };
  if (command.type === 'logout') { s.currentUserId = null; return s; }
  if (command.type === 'login') {
    const user = s.users.find(u => u.email.toLowerCase() === command.email.trim().toLowerCase() && !!u.password && u.password === command.password && u.status === 'Active');
    requireThat(user, 'The account details are incorrect or the account is inactive.');
    s.currentUserId = user!.id; return s;
  }
  // Real sign-in (Supabase Auth): the server already checked the password and read the role from the database
  // (/api/me). The screens still run on the prototype state, so the signed-in person is added to it.
  if (command.type === 'sessionUser') {
    requireThat(command.user.status === 'Active', 'This account is inactive. Ask the barangay office.');
    s.users = [...s.users.filter(u => u.id !== command.user.id), { ...command.user, password: '' }];
    s.currentUserId = command.user.id; return s;
  }
  // A new account needs an email and a password of 8 or more characters. When an existing account is edited, the
  // password may stay as it is (real accounts never show it: it is '' on screen) and an account that never had an email
  // (made by a text code) may stay without one; a password reset still needs 8 or more characters.
  const validateUser = (u: User, previous?: User) => {
    requireThat(u.firstName.trim() && u.lastName.trim() && (u.email.trim() || (previous && !previous.email.trim())) && (u.password.length >= 8 || (previous && u.password === previous.password)), 'Name, email / username, and a password of at least 8 characters are required.');
    requireThat(!u.email.trim() || !s.users.some(x => x.id !== u.id && x.email.toLowerCase() === u.email.toLowerCase()), 'This email or username is already registered.');
  };
  if (command.type === 'register') {
    validateUser(command.user);
    requireThat(command.user.role === 'resident' && command.user.validId && validFile(command.user.validId) && command.user.privacyConsentAt, 'Valid ID and privacy consent are required.');
    requireThat(!s.users.some(u => u.id === command.user.id), 'This resident already exists.');
    s.users.push(command.user); log('Resident registered', command.user.id); return s;
  }
  requireThat(actor, 'Please log in to continue.');
  if (command.type === 'loadRecordRequests') {
    requireThat(actor.role !== 'resident' || command.requests.every(r => r.residentId === actor.id), 'These records requests belong to someone else.');
    s.recordRequests = [...command.requests]; return s;
  }
  if (command.type === 'requestRecords') {
    requireThat(actor.role === 'resident', 'Only an Applicant can request their own records.');
    requireThat(validRecordRequestId(command.id), 'The request identifier is invalid.');
    requireThat(typeof command.message === 'string' && command.message.trim() && command.message.trim().length <= 2000, 'Describe the records you need in 1 to 2,000 characters.');
    requireThat(!(s.recordRequests ?? []).some(r => r.id === command.id), 'This request has already been submitted.');
    s.recordRequests = [{ id: command.id, residentId: actor.id, requestedBy: fullName(actor), message: command.message.trim(), requestedAt: now, status: 'Pending' }, ...(s.recordRequests ?? [])];
    log('Personal records copy requested', 'RR-' + command.id, '', 'Pending'); return s;
  }
  if (command.type === 'answerRecords') {
    requireThat(actor.role === 'staff' || actor.role === 'admin', 'Only Staff or Admin can answer records requests.');
    const request = s.recordRequests?.find(r => r.id === command.id);
    requireThat(request && request.status === 'Pending', 'This records request is missing or has already been answered.');
    requireThat(typeof command.response === 'string' && command.response.trim() && command.response.trim().length <= 4000, 'Enter an office response in 1 to 4,000 characters.');
    requireThat(typeof command.includeSummary === 'boolean', 'Choose whether to include the records summary.');
    s.recordRequests = s.recordRequests!.map(r => r.id === command.id ? { ...r, status: 'Answered', response: command.response.trim(), respondedAt: now, respondedBy: fullName(actor), includeSummary: command.includeSummary } : r);
    log('Personal records request answered', 'RR-' + command.id, 'Pending', 'Answered'); return s;
  }
  if (command.type === 'loadAudits') {
    requireThat(actor.role === 'admin' || (actor.role === 'staff' && command.reference), 'Only Admin can load all logs; Staff must select a transaction.');
    requireThat(!command.reference || command.audits.every(a => a.reference === command.reference), 'These logs belong to another transaction.');
    if (command.reference) { s.audits = [...command.audits, ...s.audits.filter(a => a.reference !== command.reference)]; return s; }
    // Admin screens each load the slice they show (a date range, reversions, the newest entries). Database entries
    // collect across loads; sample and on-screen entries are dropped, the database has the saved ones. Newest first.
    const incoming = new Set(command.audits.map(a => a.id));
    s.audits = [...command.audits, ...s.audits.filter(a => a.id.startsWith('db-') && !incoming.has(a.id))]
      .sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp) || Number(y.id.slice(3)) - Number(x.id.slice(3)));
    return s;
  }
  // Admin User Management (real sign-in): the Staff and resident accounts from the database replace the sample ones.
  // The signed-in Admin stays; Admin accounts are never in the list (they are managed outside the app).
  if (command.type === 'loadUsers') {
    requireThat(actor.role === 'admin', 'Only Admin loads the user accounts.');
    s.users = [actor, ...command.users.filter(u => u.id !== actor.id && u.role !== 'admin').map(u => ({ ...u, password: '' }))]; return s;
  }
  // The fee schedules from the database replace the sample ones for Staff and Admin (their ids are database ids).
  if (command.type === 'loadSchedules') {
    requireThat(actor.role === 'staff' || actor.role === 'admin', 'Only Staff and Admin load the fee schedules.');
    s.schedules = [...command.schedules]; return s;
  }
  // Records read from the database (Supabase mode) are put into the screens' state. replaceOwn swaps in the full list
  // of the signed-in Applicant's own requests; otherwise each record is added or replaced by its reference.
  if (command.type === 'loadApplications') {
    requireThat(command.applications.every(a => actor.role !== 'resident' || a.residentId === actor.id), 'These requests belong to another resident.');
    // Staff and Admin: the database list replaces the whole list (the prototype's sample requests disappear).
    if (command.replaceAll) { requireThat(actor.role !== 'resident', 'Only Staff and Admin load every request.'); s.applications = [...command.applications]; return s; }
    const incoming = new Set(command.applications.map(a => a.reference));
    s.applications = [...command.applications, ...s.applications.filter(a => !incoming.has(a.reference) && !(command.replaceOwn && a.residentId === actor.id))];
    return s;
  }
  // The signed-in person's own notices from the database replace theirs in the screens' state.
  if (command.type === 'loadNotifications') {
    requireThat(command.notifications.every(n => n.userId === actor.id), 'These notifications belong to someone else.');
    s.notifications = [...command.notifications, ...s.notifications.filter(n => n.userId !== actor.id)];
    return s;
  }
  const staff = () => requireThat(actor.role === 'staff', 'Only Staff can perform this action.');
  const admin = () => requireThat(actor.role === 'admin', 'Only Admin can perform this action.');
  // Anyone logged in can mark their own notifications as read; nobody else's.
  if (command.type === 'readNotifications') { s.notifications = s.notifications.map(n => n.userId === actor.id && !n.readAt ? { ...n, readAt: now } : n); return s; }
  if (command.type === 'user') {
    const previous = s.users.find(u => u.id === command.user.id);
    const self = actor.role === 'resident' && actor.id === command.user.id;
    requireThat(actor.role === 'admin' || self || (actor.role === 'staff' && !previous && command.user.role === 'resident'), 'You cannot manage this account.');
    requireThat(command.user.role !== 'admin' && (!previous || previous.role !== 'admin'), 'Admin accounts cannot be created or changed here.');
    requireThat(!self || (command.user.role === 'resident' && command.user.status === actor.status && command.user.password === actor.password), 'Profile updates cannot change account permissions.');
    validateUser(command.user, previous);
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
    requireThat(!a.businessSubcategory || businessSubcategories.includes(a.businessSubcategory), 'Choose a supported business subcategory.');
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
    const record: Application = { ...a, businessSubcategory: a.clearanceType === 'Business Clearance' ? a.businessSubcategory : undefined, documents: a.documents.map(d => ({ ...d, status: 'Pending Review' as const, reviewedAt: undefined, reviewedBy: undefined })), source: actor.role === 'staff' ? 'Assisted / Walk-in' : 'Online', staffEncoder: actor.role === 'staff' ? fullName(actor) : undefined, reference, dateRequested: command.draft ? previous?.dateRequested || now : now, status: command.draft ? 'Draft' : 'Pending Assessment' };
    s.applications = previous ? s.applications.map(x => x.reference === reference ? record : x) : [record, ...s.applications];
    log(command.draft ? 'Draft saved' : 'Application submitted', reference, previous?.status, record.status);
    notifyTeam(previous, record); return s;
  }
  const reference = command.type === 'revert' ? command.data.reference : command.reference;
  const original = s.applications.find(a => a.reference === reference);
  requireThat(original, 'Application not found.');
  requireThat(actor.role !== 'resident' || original.residentId === actor.id, 'This request belongs to another resident.');
  const a = { ...original };
  if (command.type === 'review') {
    staff(); requireThat(a.status === 'Pending Assessment' || a.status === 'Under Review', 'Requirements can only be reviewed before assessment.');
    a.documents = command.documents.map(({ note, reviewedAt, reviewedBy, ...d }) => {
      const flagged = d.status === 'Missing' || d.status === 'Needs Replacement', text = flagged ? note?.trim().slice(0, 200) : undefined;
      const old = original.documents.find(x => x.requirement === d.requirement);
      const changed = !old?.reviewedAt || old.status !== d.status || (old.note || '') !== (text || '');
      return { ...d, ...(text ? { note: text } : {}), reviewedAt: changed ? now : old.reviewedAt, reviewedBy: changed ? fullName(actor) : old.reviewedBy };
    });
    const reviewValues = (documents: UploadedDocument[]) => JSON.stringify(documents.map(d => ({ requirement: d.requirement, status: d.status, note: d.note, reviewedAt: d.reviewedAt, reviewedBy: d.reviewedBy })));
    log('Requirements reviewed', reference, reviewValues(original.documents), reviewValues(a.documents));
  }
  // The notice key names the request AND the document: the same document type flagged on two requests of one Applicant
  // gives two notices (one each), and repeating it on one request updates that one notice.
  if (command.type === 'review') {
    const isFlagged = (d: UploadedDocument) => d.status === 'Missing' || d.status === 'Needs Replacement';
    for (const d of a.documents) {
      const before = original.documents.find(x => x.requirement === d.requirement);
      if (isFlagged(d) && (!before || before.status !== d.status || (before.note || '') !== (d.note || ''))) notify(a.residentId, reference, 'documents_flagged', `Please upload a new copy of ${d.requirement}.${d.note ? ' Staff note: ' + d.note : ''}`, `docs:${reference}:${d.requirement}`);
      else if (!isFlagged(d) && before && isFlagged(before)) dropUnread(a.residentId, `docs:${reference}:${d.requirement}`);
    }
  }
  // A document Staff flagged (Missing / Needs Replacement) can be replaced with a new copy, by the Applicant or by Staff
  // on the Applicant's behalf (e.g. at the counter). It goes back to Pending Review so Staff verify it again.
  if (command.type === 'replaceDocument') {
    requireThat(actor.role === 'staff' || actor.role === 'resident', 'Only the Applicant or Staff can replace a document.');
    requireThat(a.status === 'Pending Assessment' || a.status === 'Under Review', 'Documents can only be replaced before assessment is confirmed.');
    const index = a.documents.findIndex(d => d.requirement === command.document.requirement);
    const old = a.documents[index];
    requireThat(old && (old.status === 'Missing' || old.status === 'Needs Replacement'), 'Only a document that Staff marked Missing or Needs Replacement can be replaced.');
    requireThat(validFile(command.document), 'Upload a valid file in JPG, PNG, or PDF, up to 5 MB.');
    a.documents = a.documents.map((d, i) => i === index ? { ...command.document, requirement: old.requirement, status: 'Pending Review' as const, reviewedAt: undefined, reviewedBy: undefined } : d);
    log(actor.role === 'staff' ? 'Document replaced by Staff for the Applicant' : 'Document replaced by Applicant', reference, JSON.stringify({ requirement: old.requirement, file: old.name, status: old.status }), JSON.stringify({ requirement: old.requirement, file: command.document.name, status: 'Pending Review' }));
  }
  if (command.type === 'inspection') {
    staff(); requireThat(!['Draft', 'Void', 'Rejected'].includes(a.status), 'A draft, void, or rejected transaction cannot be inspected.');
    const report = command.report;
    requireThat(report.status === 'Pending' || report.status === 'Completed', 'Select a valid inspection status.');
    requireThat(typeof report.inspector === 'string' && typeof report.date === 'string' && typeof report.remarks === 'string', 'Enter valid inspection details.');
    const inspector = report.inspector.trim(), date = report.date, remarks = report.remarks.trim();
    requireThat(inspector.length <= 120 && remarks.length <= 2000, 'Keep the inspector name within 120 characters and remarks within 2,000 characters.');
    requireThat(!date || (inspectionCalendarDate(date) && date <= manilaDate(now)), 'Enter a valid inspection completion date that is not in the future.');
    requireThat(report.status !== 'Completed' || (inspector && date), 'Completed inspections need an inspector and valid date.');
    const scheduledAt = report.scheduledAt || undefined;
    requireThat(!scheduledAt || (typeof scheduledAt === 'string' && validInspectionTimestamp(scheduledAt)), 'Enter a valid inspection date and time.');
    const changedSchedule = Date.parse(scheduledAt || '') !== Date.parse(original.inspection?.scheduledAt || '') && !!scheduledAt;
    if (scheduledAt) {
      requireThat(inspector, 'Assign an inspector before scheduling an inspection.');
      if (changedSchedule) {
        requireThat(report.status === 'Pending' && canScheduleInspection(a), 'Schedule inspections while the request is pending assessment or under review, before recording completion.');
        requireThat(Date.parse(scheduledAt) >= Math.floor(Date.parse(now) / 60000) * 60000, 'Choose an inspection date and time that is not in the past.');
      }
      if (report.status === 'Pending' && original.inspection?.status === 'Completed') requireThat(canScheduleInspection(a), 'Reopen inspections before assessment.');
    }
    a.inspection = { status: report.status, inspector, date, remarks, savedAt: now, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}) };
    const action = report.status === 'Completed' && original.inspection?.status !== 'Completed' ? 'Inspection completed'
      : changedSchedule ? original.inspection?.scheduledAt ? 'Inspection rescheduled' : 'Inspection scheduled'
      : !scheduledAt && original.inspection?.scheduledAt ? 'Inspection schedule cleared' : 'Inspection report saved';
    log(action, reference, JSON.stringify(original.inspection), JSON.stringify(a.inspection));
  }
  if (command.type === 'assess') {
    staff(); requireThat(a.status === 'Pending Assessment' || (a.status === 'Under Review' && !a.receipt), 'This request cannot be assessed at its current stage.');
    requireThat(!a.inspection?.scheduledAt || a.inspection.status === 'Completed', 'Complete the scheduled inspection before confirming assessment.');
    requireThat(requirements(a).every(r => a.documents.some(d => d.requirement === r.name && d.status === 'Verified')), 'Verify every required document before confirming assessment.');
    const schedule = activeSchedule(s.schedules, a.clearanceType, command.category, command.classification);
    requireThat(schedule, 'No effective fee schedule matches this selection.');
    const amounts = command.amounts || schedule.items.map(item => item.amount);
    requireThat(amounts.length === schedule.items.length && amounts.every(amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(Math.round(amount * 100)) && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001), 'Enter a valid non-negative amount with at most two decimal places for every fee component.');
    const items = schedule.items.map((item, index) => ({ ...item, amount: amounts[index] }));
    const totalCents = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
    requireThat(Number.isSafeInteger(totalCents), 'The total assessment amount is too large.');
    if (items.some((item, index) => item.amount !== schedule.items[index].amount)) log('Assessment fee amounts adjusted', reference, JSON.stringify(schedule.items), JSON.stringify(items));
    a.assessment = { items, total: totalCents/100, category: schedule.category, classification: schedule.classification, scheduleId: schedule.id, assessedBy: fullName(actor), assessedAt: now, ordinance: schedule.ordinance };
    a.status = 'Awaiting OR'; a.staffEncoder = fullName(actor); log('Assessment confirmed', reference, original.status, JSON.stringify(a.assessment));
    notify(a.residentId, reference, 'assessment_ready', `Your assessment is ready: ₱${a.assessment.total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Pay at the Municipal Treasury, then upload a photo of your receipt here, or bring the receipt to the barangay. Your reference number is ${reference}.`);
  }
  if (command.type === 'reject') {
    requireThat(actor.role === 'staff' || actor.role === 'admin', 'Only Staff or Admin can reject an application.');
    requireThat(typeof command.reason === 'string' && command.reason.trim(), 'A rejection reason is required.');
    requireThat(command.category === undefined || command.category === 'standard' || command.category === 'spam', 'Select a valid rejection category.');
    requireThat(['Pending Assessment', 'Under Review'].includes(a.status), 'Only applications pending assessment or under review can be rejected.');
    const reason = (command.category === 'spam' ? 'Spam / abuse: ' : '') + command.reason.trim();
    a.status = 'Rejected';
    a.rejection = { reason, rejectedBy: fullName(actor), timestamp: now };
    log('Application rejected', reference, original.status, 'Rejected', reason);
    notify(a.residentId, reference, 'application_returned', `Your application was returned: ${reason.replace(/[.!?\s]+$/, '')}. Tell us what to correct using the box on your application page.`);
  }
  // Correction requests. A rejected application is returned to the Applicant (it stays Rejected until Staff reopen it by
  // resolving the request). The Applicant never edits entries directly: they describe the mistake, Staff change it.
  // Once a clearance is generated, changes go through the Admin reversion instead.
  const editableEntries = ['applicant', 'address', 'contact', 'purpose', 'applicationType', 'businessLocation', 'businessName', 'initialOperation', 'businessContact', 'ownership', 'propertyOwner', 'hasEmployees', 'employeeCount', 'businessSubcategory'];
  const openRequest = a.corrections?.find(c => c.status === 'Open');
  if (command.type === 'requestCorrection') {
    requireThat(actor.role === 'resident', 'Only the Applicant can send a correction request.');
    requireThat(correctableStatuses.includes(a.status), 'A correction request can no longer be sent for this request.');
    requireThat(command.message.trim(), 'Describe what needs to be corrected.');
    requireThat(command.message.trim().length <= 500, 'Keep the correction request to 500 characters or fewer.');
    requireThat(!openRequest, 'A correction request is already waiting for Staff.');
    const request: CorrectionRequest = { id: `corr-${now}-${(a.corrections?.length || 0) + 1}`, message: command.message.trim(), requestedBy: fullName(actor), requestedAt: now, status: 'Open' };
    a.corrections = [...(a.corrections || []), request]; log('Correction requested', reference, '', command.message.trim());
  }
  if (command.type === 'editApplication') {
    staff(); requireThat(correctableStatuses.includes(a.status), 'This request can no longer be edited here. Use the Admin transaction reversion.');
    requireThat(Object.keys(command.changes).every(k => editableEntries.includes(k)), 'That entry cannot be edited here.');
    const business = a.clearanceType === 'Business Clearance', before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    const next = { ...a, ...command.changes, contact: (command.changes.contact ?? a.contact).trim(), applicant: (command.changes.applicant ?? a.applicant).trim(), address: (command.changes.address ?? a.address).trim(), purpose: (command.changes.purpose ?? a.purpose).trim(), businessLocation: (command.changes.businessLocation ?? a.businessLocation).trim(), businessName: (command.changes.businessName ?? a.businessName).trim(), businessContact: (command.changes.businessContact ?? a.businessContact).trim(), propertyOwner: (command.changes.propertyOwner ?? a.propertyOwner).trim(), businessSubcategory: business ? ('businessSubcategory' in command.changes ? command.changes.businessSubcategory : a.businessSubcategory) : undefined };
    requireThat(next.applicant && next.address && next.purpose && /^(09\d{9}|\+639\d{9})$/.test(next.contact), 'Complete applicant details and enter a valid Philippine mobile number.');
    requireThat(next.businessLocation, 'Business / property location is required.');
    if (business) requireThat(next.businessName && next.initialOperation && !isNaN(Date.parse(next.initialOperation)) && next.initialOperation <= today() && next.businessContact, 'Complete the business information and use a valid operation date.');
    requireThat(next.ownership === 'Owner' || next.propertyOwner, 'Property owner name is required for renters and occupants.');
    requireThat(!next.businessSubcategory || businessSubcategories.includes(next.businessSubcategory), 'Choose a supported business subcategory.');
    requireThat(!next.hasEmployees || next.employeeCount === undefined || (Number.isInteger(next.employeeCount) && next.employeeCount > 0), 'Enter a valid number of employees.');
    for (const key of Object.keys(command.changes) as (keyof ApplicationEdits)[]) if (JSON.stringify(a[key]) !== JSON.stringify(next[key])) { before[key] = a[key]; after[key] = next[key]; }
    requireThat(Object.keys(after).length, 'Nothing was changed.');
    // A change such as Renter or Renewal makes another document required. Add it as Missing so it can be uploaded through
    // the normal replace step; once the assessment is confirmed that is no longer possible, so the Admin reversion applies.
    const added = requirements(next).filter(r => !a.documents.some(d => d.requirement === r.name));
    requireThat(!added.length || a.status === 'Pending Assessment' || a.status === 'Under Review' || a.status === 'Rejected', 'This change makes another document required after assessment. Use the Admin transaction reversion.');
    Object.assign(a, Object.fromEntries(Object.keys(after).map(k => [k, next[k as keyof typeof next]])));
    if (added.length) { a.documents = [...a.documents, ...added.map(r => ({ requirement: r.name, name: 'Not uploaded yet', size: 0, type: '', status: 'Missing' as const, note: 'Needed because the application was corrected.' }))]; after.documentsRequired = added.map(r => r.name); }
    log('Application edited by Staff for the Applicant', reference, JSON.stringify(before), JSON.stringify(after), openRequest?.message || '');
  }
  if (command.type === 'resolveCorrection') {
    staff(); requireThat(openRequest, 'There is no open correction request to resolve.');
    const note = command.note?.trim().slice(0, 300) || undefined;
    a.corrections = a.corrections!.map(c => c.id === openRequest.id ? { ...c, status: 'Resolved' as const, resolvedBy: fullName(actor), resolvedAt: now, resolutionNote: note } : c);
    if (a.status === 'Rejected') { a.status = 'Pending Assessment'; a.rejection = undefined; }
    notify(a.residentId, reference, 'correction_resolved', (original.status === 'Rejected' ? 'Staff made the correction you asked for, and your application is back in review.' : 'Staff made the correction you asked for.') + (note ? ` Note: ${note}` : ''));
    log('Correction request resolved', reference, openRequest.message, a.status === original.status ? 'Resolved' : `Resolved; ${original.status} -> ${a.status}`, note || '');
  }
  if (command.type === 'or') {
    requireThat(actor.role === 'staff', 'Only Staff can record OR details.');
    requireThat(a.status === 'Awaiting OR' && a.assessment, 'Staff must complete assessment before OR entry.');
    validateOR(command.number, command.date, command.amount, a.assessment.total);
    requireThat(!s.applications.some(x => x.reference !== reference && x.receipt?.orNumber === command.number), 'This OR number is already recorded for another request.');
    a.receipt = { orNumber: command.number, orDate: command.date, amountPaid: Number(command.amount), recordedAt: now, encodedBy: fullName(actor), ...(command.receiptPhoto ? { receiptPhoto: command.receiptPhoto } : {}) };
    a.receiptPhoto = command.receiptPhoto; a.simulatedPayment = undefined; a.clearance = undefined;
    a.paymentVerification = { status: 'Pending', submittedAt: now }; a.status = 'For Checking';
    log('OR details submitted for checking', reference, '', JSON.stringify({ orNumber: command.number, orDate: command.date, amountPaid: command.amount, hasPhoto: !!command.receiptPhoto }));
  }
  if (command.type === 'onlinePayment') {
    requireThat(actor.role === 'resident' || actor.role === 'staff', 'Only Residents or Staff can record payment.');
    requireThat(a.status === 'Awaiting OR' && a.assessment, 'Staff must complete assessment before payment.');
    requireThat(!a.simulatedPayment, 'A simulated payment has already been recorded for this application.');
    requireThat(['GCash','Bank Transfer','Maya','Other'].includes(command.method) && Number.isFinite(command.amount) && Math.round(command.amount * 100) === Math.round(a.assessment.total * 100), 'Payment amount must match the assessed amount.');
    const datePart = now.slice(0,10).replace(/-/g,'');
    const seqPart = String(Math.floor(10000 + Math.random() * 89999));
    const simRef = `SIM-${datePart}-${seqPart}`;
    a.simulatedPayment = { method: command.method, referenceNumber: simRef, amount: command.amount, paidAt: now, note: 'SIMULATION – not an official Treasury payment' };
    a.receipt = undefined; a.receiptPhoto = undefined; a.clearance = undefined;
    a.paymentVerification = { status: 'Pending', submittedAt: now }; a.status = 'For Checking';
    log('Simulated online payment', reference, '', JSON.stringify({ method: command.method, referenceNumber: simRef, amount: command.amount }));
  }
  if (command.type === 'receiptPhoto') {
    requireThat(actor.role === 'resident' || actor.role === 'staff', 'Only Residents or Staff can submit receipts.');
    requireThat(a.status === 'Awaiting OR' && a.assessment, 'Staff must complete assessment before receipt submission.');
    requireThat(validFile(command.photo), 'Upload a valid receipt in JPG, PNG, or PDF, up to 5 MB.');
    a.receiptPhoto = command.photo; a.receipt = undefined; a.simulatedPayment = undefined; a.clearance = undefined;
    a.paymentVerification = { status: 'Pending', submittedAt: now }; a.status = 'For Checking';
    log('Receipt photo submitted for checking', reference, original.status, a.status);
  }
  if (command.type === 'verifyPayment' || command.type === 'returnPayment') {
    staff();
    requireThat(a.status === 'For Checking' && a.assessment && a.paymentVerification?.status === 'Pending', 'Only payments awaiting staff checking can be verified.');
    if (command.type === 'returnPayment') {
      requireThat(command.reason.trim(), 'Explain the correction needed.');
      a.paymentVerification = { ...a.paymentVerification, status: 'Needs Correction', checkedBy: fullName(actor), checkedAt: now, notes: command.reason.trim() };
      a.status = 'Awaiting OR'; a.clearance = undefined; a.simulatedPayment = undefined;
      log('Payment returned for correction', reference, original.status, a.status, command.reason.trim());
      notify(a.residentId, reference, 'payment_returned', `Please upload your receipt again. Reason: ${command.reason.trim()}`);
    } else {
      requireThat(a.receipt || a.receiptPhoto || a.simulatedPayment, 'Payment evidence is required.');
      if (a.simulatedPayment) requireThat(a.simulatedPayment.amount === a.assessment.total, 'Payment amount must match the assessed amount.');
      else if (!a.receipt) requireThat(a.receiptPhoto && validFile(a.receiptPhoto), 'A valid receipt photo is required.');
      const orNumber = command.orNumber?.trim() ?? '';
      if (!a.simulatedPayment) {
        requireThat(orNumber, 'Enter the OR number from the receipt before verifying payment.');
        const orDate = command.orDate ?? '';
        const amountPaid = command.amountPaid ?? '';
        requireThat(validOrDate(orDate), 'Enter a valid OR date that is not in the future.');
        validateAmountPaid(amountPaid, a.assessment.total);
        requireThat(!s.applications.some(x => x.reference !== reference && (x.receipt?.orNumber === orNumber || x.paymentVerification?.orNumber === orNumber)), 'This OR number is already recorded for another request.');
        const receiptPhoto = a.receipt?.receiptPhoto ?? a.receiptPhoto;
        a.receipt = { orNumber, orDate, amountPaid: Number(amountPaid), recordedAt: now, encodedBy: fullName(actor), ...(receiptPhoto ? { receiptPhoto } : {}) };
      }
      a.paymentVerification = { ...a.paymentVerification, status: 'Verified', checkedBy: fullName(actor), checkedAt: now, ...(orNumber && !a.simulatedPayment ? { orNumber } : {}) };
      if (orNumber && !a.simulatedPayment) log('OR details recorded by staff', reference,
        JSON.stringify({ orNumber: original.receipt?.orNumber || original.paymentVerification?.orNumber || '', orDate: original.receipt?.orDate || '', amountPaid: original.receipt?.amountPaid ?? '' }),
        JSON.stringify({ orNumber, orDate: a.receipt!.orDate, amountPaid: a.receipt!.amountPaid }));
      a.clearance = { issueDate: today(), generatedAt: now, ...(a.clearanceRevisedFrom ? { revisedFrom: a.clearanceRevisedFrom } : {}) }; a.status = 'Ready for Download';
      log('Payment verified by staff', reference, original.status, a.status); log('Clearance generated', reference, original.status, a.status);
      notify(a.residentId, reference, 'clearance_ready', `Your clearance is ready. Claim the printed original, with the barangay’s official stamp, at the monitoring office. Bring your reference number (${reference}). Your digital copy is available as a backup.`);
    }
  }
  // The printed original needs the barangay's official stamp, so Staff print the clearance from the system. Printing changes nothing on
  // the record; it is logged so the audit trail shows who printed it and when (a replacement copy can be printed after release).
  if (command.type === 'printClearance') {
    staff(); requireThat(verifiableClearance(a) && (a.status === 'Ready for Download' || a.status === 'Closed - Cleared'), 'This clearance is not available for printing.');
    log('Clearance printed by Staff for the official stamp', reference);
  }
  if (command.type === 'download') {
    requireThat(actor.role === 'resident' && verifiableClearance(a) && (a.status === 'Ready for Download' || a.status === 'Closed - Cleared'), 'Clearance is not available for download.');
    a.clearance = { ...a.clearance, downloadedAt: now }; log('Clearance downloaded', reference);
  }
  if (command.type === 'confirm') {
    // The printed original is handed over at the monitoring office, so Staff can record the release for the Applicant (manuscript 3.3.1,
    // pp. 67 and 71). An Applicant confirming online must still have downloaded the clearance first.
    requireThat(actor.role === 'staff' || actor.role === 'resident', 'Only the Applicant or Staff can confirm receipt.');
    requireThat(a.status === 'Ready for Download', 'Only a clearance that is ready can be confirmed as received.');
    requireThat(actor.role === 'staff' || a.clearance?.downloadedAt, 'Download your clearance before confirming receipt.');
    a.confirmation = { timestamp: now, completionTime: now, ipPlaceholder: 'Not collected (prototype)', ...(actor.role === 'staff' ? { confirmedBy: fullName(actor) } : {}) }; a.status = 'Closed - Cleared';
    log(actor.role === 'staff' ? 'Release confirmed by Staff for the Applicant' : 'Receipt confirmed', reference, original.status, a.status);
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
      const clearanceType = d.clearanceType ?? a.clearanceType;
      requireThat(clearanceTypes.some(type => type.name === clearanceType), 'Select a supported clearance type.');
      const typeChanged = clearanceType !== original.clearanceType;
      requireThat(!typeChanged || d.feeAssessment, 'Select a fee assessment for the new clearance type.');
      a.clearanceType = clearanceType;
      if (clearanceType !== 'Business Clearance') a.businessSubcategory = undefined;
      if (d.feeAssessment) {
        const schedule = s.schedules.find(schedule => schedule.id === d.feeAssessment!.scheduleId);
        requireThat(schedule && schedule.clearanceType === clearanceType && activeSchedule(s.schedules, clearanceType, schedule.category, schedule.classification)?.id === schedule.id, 'Select an effective fee schedule for this clearance type.');
        const amounts = d.feeAssessment.amounts;
        requireThat(Array.isArray(amounts) && amounts.length === schedule.items.length && amounts.every(amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(Math.round(amount * 100)) && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001), 'Enter a valid non-negative amount with at most two decimal places for every fee component.');
        const items = schedule.items.map((item, index) => ({ ...item, amount: amounts[index] }));
        const totalCents = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
        requireThat(Number.isSafeInteger(totalCents), 'The total assessment amount is too large.');
        a.assessment = { items, total: totalCents / 100, category: schedule.category, classification: schedule.classification, scheduleId: schedule.id, ordinance: schedule.ordinance, assessedBy: fullName(actor), assessedAt: now };
      }
      const assessmentChanged = typeChanged || (!!d.feeAssessment && JSON.stringify([a.assessment?.items, a.assessment?.category, a.assessment?.classification, a.assessment?.scheduleId]) !== JSON.stringify([original.assessment?.items, original.assessment?.category, original.assessment?.classification, original.assessment?.scheduleId]));
      const hasOrDetails = d.orNumber !== undefined || d.orDate !== undefined || d.amountPaid !== undefined;
      const orDetailsChanged = a.receipt && hasOrDetails && (d.orNumber !== original.receipt?.orNumber || d.orDate !== original.receipt?.orDate || d.amountPaid !== original.receipt?.amountPaid);
      if (a.receipt && orDetailsChanged) {
        const orNumber = d.orNumber?.trim() ?? '';
        const orDate = d.orDate ?? '';
        const amountPaid = d.amountPaid ?? '';
        requireThat(orNumber, 'Enter the OR number.');
        requireThat(validOrDate(orDate), 'Enter a valid OR date that is not in the future.');
        validateAmountPaid(amountPaid, a.assessment!.total);
        if (orNumber !== original.receipt?.orNumber) requireThat(!s.applications.some(x => x.reference !== reference && x.receipt?.orNumber === orNumber), 'This OR number is already in use.');
        a.receipt = { ...a.receipt, orNumber, orDate, amountPaid: Number(amountPaid) };
        a.clearanceRevisedFrom = original.clearance?.revisedFrom || original.clearance?.issueDate || original.clearanceRevisedFrom;
        a.status = 'For Checking'; a.clearance = undefined; a.confirmation = undefined; a.feedback = undefined;
        a.paymentVerification = { status: 'Pending', submittedAt: now };
      }
      a.applicant = d.applicant!.trim(); a.businessName = d.businessName?.trim() || a.businessName;
      if (assessmentChanged) {
        // Retain the receipt as evidence, but revoke release and require Staff to check requirements and reassess.
        // A fresh receipt submission after assessment must still pass the existing amount and OR checks.
        a.clearanceRevisedFrom = original.clearance?.revisedFrom || original.clearance?.issueDate || original.clearanceRevisedFrom;
        a.clearance = undefined; a.confirmation = undefined; a.feedback = undefined;
        a.status = 'Pending Assessment';
        if (hasPaymentEvidence(a)) a.paymentVerification = { status: 'Needs Correction', submittedAt: original.paymentVerification?.submittedAt || now, notes: d.reason.trim() };
        a.simulatedPayment = undefined;
      }
      if (a.clearance) a.clearance = { ...a.clearance, revisedFrom: a.clearance.revisedFrom || a.clearance.issueDate, downloadedAt: undefined };
    }
    const snapshot = (x: Application) => JSON.stringify({ applicant: x.applicant, businessName: x.businessName, clearanceType: x.clearanceType, assessment: x.assessment, orNumber: x.receipt?.orNumber, receipt: x.receipt, simulatedPayment: x.simulatedPayment, status: x.status, clearance: x.clearance, clearanceRevisedFrom: x.clearanceRevisedFrom });
    log(d.action, reference, snapshot(original), snapshot(a), d.reason, true);
  }
  s.applications = s.applications.map(x => x.reference === reference ? a : x);
  notifyTeam(original, a);
  return s;
}
