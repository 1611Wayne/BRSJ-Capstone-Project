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
// Ambulant vendors often have no DTI / SEC registration (UAT notes, 2026-11-24): for them it is optional (they may still
// upload one); the valid ID and the picture of the business stay required.
export function requirements(a: Pick<Application, 'clearanceType' | 'ownership' | 'applicationType'> & { businessSubcategory?: Application['businessSubcategory'] }): DocumentRequirement[] {
  // TODA: the OR/CR of the vehicle; PODA: the certification from their association (UAT notes 2026-11-24). Both with an ID.
  if (a.clearanceType === 'TODA Clearance') return [{ name: 'OR/CR of the Vehicle', required: true }, { name: 'Valid ID', required: true }];
  if (a.clearanceType === 'PODA Clearance') return [{ name: 'Certification from the Association', required: true }, { name: 'Valid ID', required: true }];
  if (a.clearanceType !== 'Business Clearance') return [{ name: 'Valid ID', required: true }, { name: 'Proof of Ownership', required: true }];
  return [{ name: 'Valid ID of Owner', required: true }, { name: 'Picture of Establishment / Business', required: true }, { name: 'DTI / SEC Document', required: a.businessSubcategory !== 'Ambulant' }, ...(a.ownership === 'Renter' ? [{ name: 'Contract of Lease', required: true }] : []), ...(a.applicationType === 'Renewal' ? [{ name: 'Old Business Clearance', required: true }] : [])];
}
// Payment evidence is a typed receipt, an uploaded receipt photo (the OR number is then kept in paymentVerification, not in
// receipt), or a simulated payment. The download rule and the public verification page both use this, so they cannot drift apart.
export const hasPaymentEvidence = (a: Pick<Application, 'receipt' | 'receiptPhoto' | 'simulatedPayment'>) => !!(a.receipt || a.receiptPhoto || a.simulatedPayment);
export const verifiableClearance = (a: Application): a is Application & { clearance: Clearance } => !!a.clearance && hasPaymentEvidence(a);
export function validFile(file: Pick<UploadedDocument, 'name' | 'size' | 'type'>) {
  return /\.(jpe?g|png|pdf)$/i.test(file.name) && ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) && file.size > 0 && file.size <= 5 * 1024 * 1024;
}
function requireThat(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
// A retired category or size (the barangay dropped it; its schedules stay as history) is never in force.
export function activeSchedule(schedules: FeeSchedule[], type: string, category: string, classification: string, date = today()) {
  return schedules.filter(s => !s.retired && s.clearanceType === type && s.category === category && s.classification === classification && s.effectiveDate <= date).sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt.localeCompare(a.createdAt))[0];
}
// The fee categories (and their sizes) Staff and Admin choose from for a clearance type: every category with a schedule
// in force, A to Z. They come from the loaded schedules, so in connected mode they are the database's (the Revenue Code,
// migration 24) and in sample mode the sample ones. A type with no categorised schedule returns [] and needs no choice.
export function feeCategoryOptions(schedules: FeeSchedule[], type: string, date = today()): { name: string; classifications?: { name: string }[] }[] {
  const found = new Map<string, Set<string>>();
  for (const s of schedules) {
    if (s.retired || s.clearanceType !== type || !s.category || s.effectiveDate > date) continue;
    if (!found.has(s.category)) found.set(s.category, new Set());
    if (s.classification) found.get(s.category)!.add(s.classification);
  }
  const rank = (size: string) => { const i = ['Small', 'Medium', 'Large', 'Big'].indexOf(size); return i < 0 ? 9 : i; };
  return sortedOptions(found, rank);
}
export const employeesOf = (a: Pick<Application, 'hasEmployees' | 'employeeCount'>) => a.hasEmployees ? Math.max(0, Number(a.employeeCount) || 0) : 0;
// Sizes that count as "big" for the Inspection Fee (small 50 / big 100).
const BIG_SIZES = ['Medium', 'Large', 'Big'];
// The amounts an assessment starts from (Staff may still change them; changes are logged). The barangay's written answers
// (2026-11-22) on top of FT-1 (2026-11-18):
// - Business, NEW: Plate and Inspection Fee, no Sticker. RENEWAL: Sticker, no Plate, no Inspection Fee (Staff add an
//   inspection when one is done). Staff pick the size from the photo of the business; the Inspection Fee follows it
//   (Small 50; Medium, Large or Big 100). A schedule's own non-standard inspection (the seasonal stall's 100) is kept.
// - Business: "No. of Employee" holds the rate, 50 per head, times the employees the Applicant entered (New and Renewal).
// - TODA: NEW = the plate only (150 in total); RENEWAL = the franchise permit only (50).
export function assessmentDefaults(a: Pick<Application, 'clearanceType' | 'applicationType' | 'hasEmployees' | 'employeeCount'>, schedule: Pick<FeeSchedule, 'items' | 'classification'>): number[] {
  const renewal = a.applicationType === 'Renewal';
  // (Only when the schedule has a plate amount: the sample fees have none, so they keep the franchise fee.)
  if (a.clearanceType === 'TODA Clearance' && schedule.items.some(i => i.name === 'Plate' && i.amount > 0)) return schedule.items.map(i => i.name === 'Plate' ? (renewal ? 0 : i.amount) : i.name === 'TODA Clearance' ? (renewal ? i.amount : 0) : i.amount);
  if (a.clearanceType !== 'Business Clearance') return schedule.items.map(i => i.amount);
  return schedule.items.map(i => {
    if (i.name === 'Plate') return renewal ? 0 : i.amount;
    if (i.name === 'Sticker') return renewal ? i.amount : 0;
    if (i.name === 'Inspection Fee') return renewal ? 0 : i.amount === 50 ? (BIG_SIZES.includes(schedule.classification) ? 100 : 50) : i.amount;
    if (i.name === 'No. of Employee') return Math.round(i.amount * employeesOf(a) * 100) / 100;
    return i.amount;
  });
}
function sortedOptions(found: Map<string, Set<string>>, rank: (size: string) => number) {
  return [...found].sort(([a], [b]) => a.localeCompare(b)).map(([name, sizes]) => sizes.size
    ? { name, classifications: [...sizes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true })).map(size => ({ name: size })) }
    : { name });
}
// The Treasury's OR number (FT-15, paper UT-04; samples received 2026-11-24): the Municipal Treasury's receipt prints
// "NO. RZL 26662152" and the barangay's clearance shows only the number, "O.R. NO. : 26662152". Staff may type it with
// "NO." / "RZL", spaces or a dash; it is saved as the digits only. OR_DIGITS is the one place to change if the
// Treasury's series ever gets longer.
export const OR_DIGITS = 8;
export const OR_FORMAT_MESSAGE = `Enter the OR number from the Treasury receipt: ${OR_DIGITS} digits, for example 26662152 (printed as "NO. RZL 26662152").`;
export const normalizeOrNumber = (input?: string) => String(input ?? '').trim().replace(/^no\.?\s*/i, '').replace(/^rzl\s*/i, '').replace(/[\s-]/g, '');
export const validOrNumber = (orNumber: string) => new RegExp(`^\\d{${OR_DIGITS}}$`).test(orNumber);
// A plate number Staff type for a Business or TODA clearance (printed as "Plate No."; NO PLATE when there is none).
export const PLATE_TYPES = ['Business Clearance', 'TODA Clearance'];
// The property clearances (UAT notes 2026-11-24): the form asks only Name, Residential Address, Location, Remarks and
// Purpose, as printed on the clearance. Remarks is what the property is used for: Residential or Commercial.
export const PROPERTY_TYPES = ['Building Clearance', 'Electrical Clearance', 'Fencing Clearance', 'Excavation Clearance', 'Lot Survey Clearance', 'Water/MWSS Clearance'];
export const SAME_AS_ABOVE = '-SAME AS ABOVE-';
// TODA and PODA (UAT notes 2026-11-24): the vehicle instead of a location. TODA asks Name / Operator, Address, Type of
// Vehicle, Registration No., Plate No. and Body Number, with the OR/CR of the vehicle; PODA asks Name, Address, Type of
// Vehicle and Body Number, with the certification from their association. Both also need a valid ID.
export const VEHICLE_TYPES = ['TODA Clearance', 'PODA Clearance'];
export const validVehicleText = (value?: string) => !!value && value.trim().length > 0 && value.trim().length <= 40;
export const PROPERTY_USES = ['Residential', 'Commercial'];
export const validPlateNumber = (plate: string) => /^[A-Za-z0-9][A-Za-z0-9 -]{0,29}$/.test(plate);
export function validateOR(number: string, date: string, amount: string | number, total: number, currentDate = today()) {
  requireThat(validOrNumber(normalizeOrNumber(number)), OR_FORMAT_MESSAGE);
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date && date <= currentDate, 'Enter a valid OR date that is not in the future.');
  validateAmountPaid(amount, total);
}
// The Amount Paid read off a receipt: a currency amount with at most two decimals that equals the assessed total. A receipt that
// shows a different amount cannot be verified; Staff return it to the Applicant with a reason.
export function validateAmountPaid(amount: string | number, total: number) {
  requireThat(/^\d+(\.\d{1,2})?$/.test(String(amount)) && Number.isFinite(Number(amount)) && Number(amount) >= 0, 'Enter a valid currency amount with at most two decimal places.');
  requireThat(Math.round(Number(amount) * 100) === Math.round(total * 100), 'Amount Paid must match the assessed amount.');
}
// The OR date Staff type from a receipt image: a real calendar date, not in the future.
export const validOrDate = (date?: string, currentDate = today()) => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date && date <= currentDate;
// Before the clearance is generated, an Applicant can ask for a correction and Staff can make it. A rejected request counts as
// returned to the Applicant. After generation, changes go through the Admin transaction reversion.
export const correctableStatuses: ApplicationStatus[] = ['Pending Assessment', 'Under Review', 'Rejected', 'Awaiting OR', 'For Checking'];
// The Applicant can still ask "before the clearance is closed" (manuscript 3.1.1.1.2, decision D10): once payment is verified
// the request goes to an Admin, who makes the change through the transaction reversion (logged, clearance reissued as REVISED).
export const correctionRequestStatuses: ApplicationStatus[] = [...correctableStatuses, 'Ready for Download'];
export const correctionNeedsAdmin = (a: Pick<Application, 'status'>) => !correctableStatuses.includes(a.status);
// Entries the fee depends on for a business (New/Renewal, employees: FT-1). Once assessed, changing them means a new assessment.
const feeEntries = ['applicationType', 'hasEmployees', 'employeeCount'];
// Entries an Admin can correct on an issued clearance (besides the name and business name the reversion already had).
export const reversionEntries = ['address', 'contact', 'purpose', 'businessLocation', 'initialOperation', 'businessContact', 'propertyOwner', 'plateNumber'] as const;
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
  | { type: 'verifyPayment'; reference: string; orNumber?: string; orDate?: string; amountPaid?: string | number; plateNumber?: string }
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
      requireThat(a.applicant.trim() && a.address.trim() && (a.purpose.trim() || VEHICLE_TYPES.includes(a.clearanceType)) && /^(09\d{9}|\+639\d{9})$/.test(a.contact), 'Complete applicant details and enter a valid Philippine mobile number.');
      requireThat(a.businessLocation.trim() || VEHICLE_TYPES.includes(a.clearanceType), 'Location is required.');
      if (VEHICLE_TYPES.includes(a.clearanceType)) requireThat(validVehicleText(a.vehicleType) && validVehicleText(a.bodyNumber), 'Enter the type of vehicle and the body number (up to 40 characters each).');
      if (a.clearanceType === 'TODA Clearance') requireThat(validVehicleText(a.registrationNumber) && !!a.plateNumber && validPlateNumber(a.plateNumber.trim()), 'Enter the registration number and the plate number of the vehicle.');
      // Property clearances (PROPERTY_TYPES, UAT notes 2026-11-24): only Name, Residential Address, Location, Remarks
      // (Residential or Commercial) and Purpose; no business name, date of initial operation, employees or ownership.
      if (PROPERTY_TYPES.includes(a.clearanceType)) requireThat(PROPERTY_USES.includes(a.propertyUse as string), 'Choose Residential or Commercial under Remarks.');
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
    // A type whose fees have categories (every Business Clearance; Building and Fencing brackets) needs one of them, so
    // an older uncategorised schedule (the SAMPLE ones) can never be picked by leaving the category out.
    const categories = feeCategoryOptions(s.schedules, a.clearanceType);
    requireThat(!categories.length || categories.some(c => c.name === command.category && (c.classifications ? c.classifications.some(k => k.name === command.classification) : !command.classification)), 'Choose a fee category (and size) for this clearance type.');
    const schedule = activeSchedule(s.schedules, a.clearanceType, command.category, command.classification);
    requireThat(schedule, 'No effective fee schedule matches this selection.');
    const defaults = assessmentDefaults(a, schedule);
    const amounts = command.amounts || defaults;
    requireThat(amounts.length === schedule.items.length && amounts.every(amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(Math.round(amount * 100)) && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001), 'Enter a valid non-negative amount with at most two decimal places for every fee component.');
    const items = schedule.items.map((item, index) => ({ ...item, amount: amounts[index] }));
    const totalCents = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
    requireThat(Number.isSafeInteger(totalCents), 'The total assessment amount is too large.');
    // Logged when Staff change an amount from where it starts (the schedule, with the New / Renewal and size rules applied).
    if (items.some((item, index) => item.amount !== defaults[index])) log('Assessment fee amounts adjusted', reference, JSON.stringify(schedule.items.map((item, index) => ({ ...item, amount: defaults[index] }))), JSON.stringify(items));
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
  const editableEntries = ['applicant', 'address', 'contact', 'purpose', 'applicationType', 'businessLocation', 'businessName', 'initialOperation', 'businessContact', 'ownership', 'propertyOwner', 'hasEmployees', 'employeeCount', 'businessSubcategory', 'propertyUse', 'vehicleType', 'registrationNumber', 'bodyNumber', 'plateNumber'];
  const openRequest = a.corrections?.find(c => c.status === 'Open');
  const resolveOpenRequest = (note?: string) => {
    a.corrections = a.corrections!.map(c => c.id === openRequest!.id ? { ...c, status: 'Resolved' as const, resolvedBy: fullName(actor), resolvedAt: now, resolutionNote: note } : c);
  };
  if (command.type === 'requestCorrection') {
    requireThat(actor.role === 'resident', 'Only the Applicant can send a correction request.');
    requireThat(correctionRequestStatuses.includes(a.status), 'A correction request can no longer be sent for this request.');
    requireThat(command.message.trim(), 'Describe what needs to be corrected.');
    requireThat(command.message.trim().length <= 500, 'Keep the correction request to 500 characters or fewer.');
    requireThat(!openRequest, correctionNeedsAdmin(a) ? 'A correction request is already waiting for an Admin.' : 'A correction request is already waiting for Staff.');
    const request: CorrectionRequest = { id: `corr-${now}-${(a.corrections?.length || 0) + 1}`, message: command.message.trim(), requestedBy: fullName(actor), requestedAt: now, status: 'Open' };
    a.corrections = [...(a.corrections || []), request]; log('Correction requested', reference, '', command.message.trim());
  }
  if (command.type === 'editApplication') {
    staff(); requireThat(correctableStatuses.includes(a.status), 'This request can no longer be edited here. Use the Admin transaction reversion.');
    requireThat(Object.keys(command.changes).every(k => editableEntries.includes(k)), 'That entry cannot be edited here.');
    const business = a.clearanceType === 'Business Clearance', before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    const next = { ...a, ...command.changes, contact: (command.changes.contact ?? a.contact).trim(), applicant: (command.changes.applicant ?? a.applicant).trim(), address: (command.changes.address ?? a.address).trim(), purpose: (command.changes.purpose ?? a.purpose).trim(), businessLocation: (command.changes.businessLocation ?? a.businessLocation).trim(), businessName: (command.changes.businessName ?? a.businessName).trim(), businessContact: (command.changes.businessContact ?? a.businessContact).trim(), propertyOwner: (command.changes.propertyOwner ?? a.propertyOwner).trim(), businessSubcategory: business ? ('businessSubcategory' in command.changes ? command.changes.businessSubcategory : a.businessSubcategory) : undefined,
      // TODA / PODA vehicle details (TODA also registration and plate); cleared for other types.
      vehicleType: VEHICLE_TYPES.includes(a.clearanceType) ? ('vehicleType' in command.changes ? command.changes.vehicleType : a.vehicleType)?.trim() : undefined,
      bodyNumber: VEHICLE_TYPES.includes(a.clearanceType) ? ('bodyNumber' in command.changes ? command.changes.bodyNumber : a.bodyNumber)?.trim() : undefined,
      registrationNumber: a.clearanceType === 'TODA Clearance' ? ('registrationNumber' in command.changes ? command.changes.registrationNumber : a.registrationNumber)?.trim() : undefined,
      plateNumber: 'plateNumber' in command.changes ? command.changes.plateNumber?.trim() || undefined : a.plateNumber,
      propertyUse: PROPERTY_TYPES.includes(a.clearanceType) ? ('propertyUse' in command.changes ? command.changes.propertyUse : a.propertyUse) : undefined };
    requireThat(!('propertyUse' in command.changes) || (PROPERTY_TYPES.includes(a.clearanceType) && PROPERTY_USES.includes(next.propertyUse as string)), 'Choose Residential or Commercial (Building, Electrical, Fencing, Excavation, Lot Survey and Water clearances only).');
    requireThat(next.applicant && next.address && (next.purpose || VEHICLE_TYPES.includes(a.clearanceType)) && /^(09\d{9}|\+639\d{9})$/.test(next.contact), 'Complete applicant details and enter a valid Philippine mobile number.');
    requireThat(next.businessLocation || VEHICLE_TYPES.includes(a.clearanceType), 'Location is required.');
    requireThat(!['vehicleType', 'bodyNumber', 'registrationNumber'].some(k => k in command.changes) || (VEHICLE_TYPES.includes(a.clearanceType) && validVehicleText(next.vehicleType) && validVehicleText(next.bodyNumber) && (a.clearanceType !== 'TODA Clearance' || validVehicleText(next.registrationNumber))), 'Enter the vehicle details (up to 40 characters each; TODA and PODA clearances only).');
    requireThat(!('plateNumber' in command.changes) || (PLATE_TYPES.includes(a.clearanceType) && (!next.plateNumber || validPlateNumber(next.plateNumber))), 'Enter the plate number with letters, numbers, spaces or dashes (up to 30), for Business and TODA clearances only.');
    if (business) requireThat(next.businessName && next.initialOperation && !isNaN(Date.parse(next.initialOperation)) && next.initialOperation <= today() && next.businessContact, 'Complete the business information and use a valid operation date.');
    requireThat(next.ownership === 'Owner' || next.propertyOwner, 'Property owner name is required for renters and occupants.');
    requireThat(!next.businessSubcategory || businessSubcategories.includes(next.businessSubcategory), 'Choose a supported business subcategory.');
    requireThat(!next.hasEmployees || next.employeeCount === undefined || (Number.isInteger(next.employeeCount) && next.employeeCount > 0), 'Enter a valid number of employees.');
    for (const key of Object.keys(command.changes) as (keyof ApplicationEdits)[]) if (JSON.stringify(a[key]) !== JSON.stringify(next[key])) { before[key] = a[key]; after[key] = next[key]; }
    requireThat(Object.keys(after).length, 'Nothing was changed.');
    // The assessed fee depends on New/Renewal and the employees (FT-1), so after assessment those go through the reversion,
    // which returns the request for a new assessment.
    requireThat(!business || !a.assessment || !['Awaiting OR', 'For Checking'].includes(a.status) || !Object.keys(after).some(k => feeEntries.includes(k)), 'This change affects the assessed fee. Use the Admin transaction reversion to have it assessed again.');
    // A change such as Renter or Renewal makes another document required. Add it as Missing so it can be uploaded through
    // the normal replace step; once the assessment is confirmed that is no longer possible, so the Admin reversion applies.
    const added = requirements(next).filter(r => !a.documents.some(d => d.requirement === r.name));
    requireThat(!added.length || a.status === 'Pending Assessment' || a.status === 'Under Review' || a.status === 'Rejected', 'This change makes another document required after assessment. Use the Admin transaction reversion.');
    Object.assign(a, Object.fromEntries(Object.keys(after).map(k => [k, next[k as keyof typeof next]])));
    if (added.length) { a.documents = [...a.documents, ...added.map(r => ({ requirement: r.name, name: 'Not uploaded yet', size: 0, type: '', status: 'Missing' as const, note: 'Needed because the application was corrected.' }))]; after.documentsRequired = added.map(r => r.name); }
    log('Application edited by Staff for the Applicant', reference, JSON.stringify(before), JSON.stringify(after), openRequest?.message || '');
  }
  if (command.type === 'resolveCorrection') {
    // Before payment is verified Staff resolve it; after that an Admin does (after the transaction reversion, if a change was needed).
    if (correctionNeedsAdmin(a)) requireThat(actor.role === 'admin', 'Payment for this request is already verified, so an Admin resolves this correction request.');
    else staff();
    requireThat(openRequest, 'There is no open correction request to resolve.');
    const note = command.note?.trim().slice(0, 300) || undefined;
    resolveOpenRequest(note);
    if (a.status === 'Rejected') { a.status = 'Pending Assessment'; a.rejection = undefined; }
    notify(a.residentId, reference, 'correction_resolved', (original.status === 'Rejected' ? 'Staff made the correction you asked for, and your application is back in review.' : actor.role === 'admin' ? 'An Admin handled the correction you asked for.' : 'Staff made the correction you asked for.') + (note ? ` Note: ${note}` : ''));
    log('Correction request resolved', reference, openRequest.message, a.status === original.status ? 'Resolved' : `Resolved; ${original.status} -> ${a.status}`, note || '');
  }
  if (command.type === 'or') {
    requireThat(actor.role === 'staff', 'Only Staff can record OR details.');
    requireThat(a.status === 'Awaiting OR' && a.assessment, 'Staff must complete assessment before OR entry.');
    validateOR(command.number, command.date, command.amount, a.assessment.total);
    const typedOr = normalizeOrNumber(command.number);
    requireThat(!s.applications.some(x => x.reference !== reference && normalizeOrNumber(x.receipt?.orNumber) === typedOr), 'This OR number is already recorded for another request.');
    a.receipt = { orNumber: typedOr, orDate: command.date, amountPaid: Number(command.amount), recordedAt: now, encodedBy: fullName(actor), ...(command.receiptPhoto ? { receiptPhoto: command.receiptPhoto } : {}) };
    a.receiptPhoto = command.receiptPhoto; a.simulatedPayment = undefined; a.clearance = undefined;
    a.paymentVerification = { status: 'Pending', submittedAt: now }; a.status = 'For Checking';
    log('OR details submitted for checking', reference, '', JSON.stringify({ orNumber: typedOr, orDate: command.date, amountPaid: command.amount, hasPhoto: !!command.receiptPhoto }));
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
      const orNumber = a.simulatedPayment ? '' : normalizeOrNumber(command.orNumber);
      // Plate No. (Business and TODA): optional; the clearance prints NO PLATE without one.
      const plate = command.plateNumber === undefined ? (original.plateNumber ?? '') : command.plateNumber.trim();
      requireThat(!plate || PLATE_TYPES.includes(a.clearanceType), 'A plate number is only recorded for Business and TODA clearances.');
      requireThat(!plate || validPlateNumber(plate), 'Enter the plate number with letters, numbers, spaces or dashes (up to 30).');
      if (!a.simulatedPayment) {
        requireThat(orNumber, 'Enter the OR number from the receipt before verifying payment.');
        requireThat(validOrNumber(orNumber), OR_FORMAT_MESSAGE);
        const orDate = command.orDate ?? '';
        const amountPaid = command.amountPaid ?? '';
        requireThat(validOrDate(orDate), 'Enter a valid OR date that is not in the future.');
        validateAmountPaid(amountPaid, a.assessment.total);
        requireThat(!s.applications.some(x => x.reference !== reference && (normalizeOrNumber(x.receipt?.orNumber) === orNumber || normalizeOrNumber(x.paymentVerification?.orNumber) === orNumber)), 'This OR number is already recorded for another request.');
        const receiptPhoto = a.receipt?.receiptPhoto ?? a.receiptPhoto;
        a.receipt = { orNumber, orDate, amountPaid: Number(amountPaid), recordedAt: now, encodedBy: fullName(actor), ...(receiptPhoto ? { receiptPhoto } : {}) };
      }
      a.paymentVerification = { ...a.paymentVerification, status: 'Verified', checkedBy: fullName(actor), checkedAt: now, ...(orNumber && !a.simulatedPayment ? { orNumber } : {}) };
      if (orNumber && !a.simulatedPayment) log('OR details recorded by staff', reference,
        JSON.stringify({ orNumber: original.receipt?.orNumber || original.paymentVerification?.orNumber || '', orDate: original.receipt?.orDate || '', amountPaid: original.receipt?.amountPaid ?? '' }),
        JSON.stringify({ orNumber, orDate: a.receipt!.orDate, amountPaid: a.receipt!.amountPaid }));
      if (PLATE_TYPES.includes(a.clearanceType)) {
        if (plate !== (original.plateNumber ?? '')) log('Plate number recorded by staff', reference, original.plateNumber ?? '', plate || 'NO PLATE');
        a.plateNumber = plate || undefined;
      }
      a.clearance ={ issueDate: today(), generatedAt: now, ...(a.clearanceRevisedFrom ? { revisedFrom: a.clearanceRevisedFrom } : {}) }; a.status = 'Ready for Download';
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
        const orNumber = normalizeOrNumber(d.orNumber);
        const orDate = d.orDate ?? '';
        const amountPaid = d.amountPaid ?? '';
        requireThat(orNumber, 'Enter the OR number.');
        requireThat(validOrNumber(orNumber), OR_FORMAT_MESSAGE);
        requireThat(validOrDate(orDate), 'Enter a valid OR date that is not in the future.');
        validateAmountPaid(amountPaid, a.assessment!.total);
        if (orNumber !== normalizeOrNumber(original.receipt?.orNumber)) requireThat(!s.applications.some(x => x.reference !== reference && normalizeOrNumber(x.receipt?.orNumber) === orNumber), 'This OR number is already in use.');
        a.receipt = { ...a.receipt, orNumber, orDate, amountPaid: Number(amountPaid) };
        a.clearanceRevisedFrom = original.clearance?.revisedFrom || original.clearance?.issueDate || original.clearanceRevisedFrom;
        a.status = 'For Checking'; a.clearance = undefined; a.confirmation = undefined; a.feedback = undefined;
        a.paymentVerification = { status: 'Pending', submittedAt: now };
      }
      a.applicant = d.applicant!.trim(); a.businessName = d.businessName?.trim() || a.businessName;
      if (d.entries) {
        // Other entries printed on the clearance (address, purpose, ...), checked the same way as a Staff edit.
        const e = d.entries;
        requireThat(Object.keys(e).every(k => (reversionEntries as readonly string[]).includes(k)), 'That entry cannot be corrected here.');
        const fixed = { address: (e.address ?? a.address).trim(), contact: (e.contact ?? a.contact).trim(), purpose: (e.purpose ?? a.purpose).trim(), businessLocation: (e.businessLocation ?? a.businessLocation).trim(),
          initialOperation: e.initialOperation ?? a.initialOperation, businessContact: (e.businessContact ?? a.businessContact).trim(), propertyOwner: a.ownership === 'Owner' ? a.propertyOwner : (e.propertyOwner ?? a.propertyOwner).trim(),
          plateNumber: ('plateNumber' in e ? e.plateNumber : a.plateNumber)?.trim() || undefined };
        requireThat(!fixed.plateNumber || (PLATE_TYPES.includes(a.clearanceType) && validPlateNumber(fixed.plateNumber)), 'Enter the plate number with letters, numbers, spaces or dashes (up to 30), for Business and TODA clearances only.');
        requireThat(fixed.address && fixed.purpose && /^(09\d{9}|\+639\d{9})$/.test(fixed.contact), 'Complete the address and purpose, and enter a valid Philippine mobile number.');
        requireThat(fixed.businessLocation, 'Location is required.');
        if (a.clearanceType === 'Business Clearance') requireThat(fixed.businessContact && fixed.initialOperation && !isNaN(Date.parse(fixed.initialOperation)) && fixed.initialOperation <= today(), 'Complete the business contact and use a valid operation date.');
        requireThat(a.ownership === 'Owner' || fixed.propertyOwner, 'Property owner name is required for renters and occupants.');
        Object.assign(a, fixed);
      }
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
    const snapshot = (x: Application) => JSON.stringify({ applicant: x.applicant, businessName: x.businessName, ...(d.entries ? Object.fromEntries(reversionEntries.map(k => [k, x[k]])) : {}), clearanceType: x.clearanceType, assessment: x.assessment, orNumber: x.receipt?.orNumber, receipt: x.receipt, simulatedPayment: x.simulatedPayment, status: x.status, clearance: x.clearance, clearanceRevisedFrom: x.clearanceRevisedFrom });
    log(d.action, reference, snapshot(original), snapshot(a), d.reason, true);
    // The Applicant's correction request this reversion answers (D10): resolved together, so it is not left open.
    if (d.resolveCorrection) {
      requireThat(openRequest, 'There is no open correction request to resolve.');
      resolveOpenRequest();
      notify(a.residentId, reference, 'correction_resolved', a.status === 'Ready for Download' || a.status === 'Closed - Cleared' ? 'An Admin made the correction you asked for. Download the new copy of your clearance, marked REVISED.'
        : a.status === 'Void' ? 'An Admin reviewed the correction you asked for. This request was voided; contact the barangay office for details.' : 'An Admin made the correction you asked for. Your request will be checked again before the clearance is reissued.');
      log('Correction request resolved', reference, openRequest.message, `Resolved with the transaction reversion (${d.action})`);
    }
  }
  s.applications = s.applications.map(x => x.reference === reference ? a : x);
  notifyTeam(original, a);
  return s;
}
