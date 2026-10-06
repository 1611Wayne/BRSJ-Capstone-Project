'use client';
import { useState } from 'react';
import type { Application, ApplicationEdits, CorrectionRequest } from '@/types';
import { usePortal } from './PortalProvider';
import { Field, ErrorMessage, Notice } from './Field';
import { businessSubcategories } from '@/data/clearanceTypes';
import { correctableStatuses, dateLabel, today } from '@/lib/workflow';

const MAX_MESSAGE = 500;
export const openCorrection = (a: Application) => a.corrections?.find(c => c.status === 'Open');

// What the Applicant sees and does: describe the mistake in a text box. They never edit the entries themselves.
function SendRequest({ application: a }: { application: Application }) {
  const { act } = usePortal();
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [sent, setSent] = useState(false);
  function send(e: React.FormEvent) {
    e.preventDefault();
    try { act({ type: 'requestCorrection', reference: a.reference, message }); setMessage(''); setError(''); setSent(true); }
    catch (err) { setError((err as Error).message); }
  }
  const returned = a.status === 'Rejected';
  return <form onSubmit={send} className="mt-4">
    <p className="text-sm text-slate-600">{returned
      ? 'Your request was returned to you. You do not need to change anything yourself. Write what is wrong and what it should say, and Staff will fix it for you.'
      : 'Found a mistake? You do not need to change anything yourself. Write what is wrong and what it should say, and Staff will fix it for you.'}</p>
    <Field label="What needs to be corrected?" hint={`Example: My last name is spelled "Clarra". It should be "Clara". ${message.length}/${MAX_MESSAGE}`}>
      <textarea className="textarea-field min-h-[90px]" maxLength={MAX_MESSAGE} required value={message} onChange={e => { setMessage(e.target.value); setSent(false); }} />
    </Field>
    <ErrorMessage message={error} />
    {sent && <Notice>Your request was sent to Staff.</Notice>}
    <button className="primary-btn mt-3" disabled={!message.trim()}>Send to Staff</button>
  </form>;
}

type Form = { applicant: string; address: string; contact: string; purpose: string; applicationType: Application['applicationType']; businessLocation: string; businessName: string; initialOperation: string; businessContact: string; ownership: Application['ownership']; propertyOwner: string; businessSubcategory: string; hasEmployees: string; employeeCount: string };
const toForm = (a: Application): Form => ({
  applicant: a.applicant, address: a.address, contact: a.contact, purpose: a.purpose, applicationType: a.applicationType, businessLocation: a.businessLocation, businessName: a.businessName,
  initialOperation: a.initialOperation, businessContact: a.businessContact, ownership: a.ownership, propertyOwner: a.propertyOwner, businessSubcategory: a.businessSubcategory || '',
  hasEmployees: a.hasEmployees === undefined ? '' : a.hasEmployees ? 'yes' : 'no', employeeCount: a.employeeCount == null ? '' : String(a.employeeCount),
});
const toEdits = (f: Form, business: boolean): ApplicationEdits => ({
  applicant: f.applicant, address: f.address, contact: f.contact, purpose: f.purpose, applicationType: f.applicationType, businessLocation: f.businessLocation, ownership: f.ownership, propertyOwner: f.propertyOwner,
  hasEmployees: f.hasEmployees === '' ? undefined : f.hasEmployees === 'yes', employeeCount: f.hasEmployees === 'yes' && f.employeeCount !== '' ? Number(f.employeeCount) : undefined,
  ...(business ? { businessName: f.businessName, initialOperation: f.initialOperation, businessContact: f.businessContact, businessSubcategory: (f.businessSubcategory || undefined) as ApplicationEdits['businessSubcategory'] } : {}),
});

// Staff change the Applicant's entries for them. Every change is logged with the old and new values.
function EditEntries({ application: a, onSaved }: { application: Application; onSaved: () => void }) {
  const { act } = usePortal();
  const business = a.clearanceType === 'Business Clearance';
  const [form, setForm] = useState<Form>(() => toForm(a)), [error, setError] = useState('');
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(f => ({ ...f, [key]: value }));
  function save(e: React.FormEvent) {
    e.preventDefault();
    try { act({ type: 'editApplication', reference: a.reference, changes: toEdits(form, business) }); setError(''); onSaved(); }
    catch (err) { setError((err as Error).message); }
  }
  return <form onSubmit={save} className="mt-4 border border-brand-border p-4">
    <p className="text-xs text-slate-600">Change only what the Applicant asked for. The old and new values are saved in the audit trail. The clearance type cannot be changed here.</p>
    <div className="form-grid mt-4">
      <Field label="Full Name *"><input required className="text-field" value={form.applicant} onChange={e => set('applicant', e.target.value)} /></Field>
      <Field label="Complete Address *"><input required className="text-field" value={form.address} onChange={e => set('address', e.target.value)} /></Field>
      <Field label="Contact Number *"><input required className="text-field" value={form.contact} onChange={e => set('contact', e.target.value)} /></Field>
      <Field label="Purpose of Clearance *"><input required className="text-field" value={form.purpose} onChange={e => set('purpose', e.target.value)} /></Field>
      <Field label="Business / Property Location *"><input required className="text-field" value={form.businessLocation} onChange={e => set('businessLocation', e.target.value)} /></Field>
      <Field label="Application Type"><select className="select-field" value={form.applicationType} onChange={e => set('applicationType', e.target.value as Form['applicationType'])}><option>New Application</option><option>Renewal</option></select></Field>
      <Field label="Ownership"><select className="select-field" value={form.ownership} onChange={e => set('ownership', e.target.value as Form['ownership'])}><option>Owner</option><option>Renter</option><option>Occupant</option></select></Field>
      {form.ownership !== 'Owner' && <Field label="Name of Property Owner *"><input required className="text-field" value={form.propertyOwner} onChange={e => set('propertyOwner', e.target.value)} /></Field>}
      {business && <>
        <Field label="Name of Business *"><input required className="text-field" value={form.businessName} onChange={e => set('businessName', e.target.value)} /></Field>
        <Field label="Business Contact Number *"><input required className="text-field" value={form.businessContact} onChange={e => set('businessContact', e.target.value)} /></Field>
        <Field label="Date of Initial Operation *"><input type="date" max={today()} required className="text-field" value={form.initialOperation} onChange={e => set('initialOperation', e.target.value)} /></Field>
        <Field label="Business Subcategory (optional)"><select className="select-field" value={form.businessSubcategory} onChange={e => set('businessSubcategory', e.target.value)}><option value="">Business Clearance only</option>{businessSubcategories.map(c => <option key={c}>{c}</option>)}</select></Field>
      </>}
      <Field label="Has employees?"><select className="select-field" value={form.hasEmployees} onChange={e => set('hasEmployees', e.target.value)}><option value="">Not stated</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
      {form.hasEmployees === 'yes' && <Field label="Number of employees (optional)"><input type="number" min="1" className="text-field" value={form.employeeCount} onChange={e => set('employeeCount', e.target.value)} /></Field>}
    </div>
    {(form.ownership === 'Renter' || form.applicationType === 'Renewal') && <p className="text-xs text-amber-800 mt-3">Renter and Renewal applications need extra documents. Any that are not on file will be added as Missing for the Applicant to upload.</p>}
    <ErrorMessage message={error} />
    <button className="primary-btn mt-3">Save Changes</button>
  </form>;
}

const History = ({ items }: { items: CorrectionRequest[] }) => items.length ? <div className="mt-5">
  <h3 className="text-sm font-bold text-brand-ink">Earlier requests</h3>
  <ul className="mt-2 space-y-2">{items.map(c => <li key={c.id} className="text-sm border border-slate-200 p-3">
    <p>{c.message}</p>
    <p className="text-xs text-slate-500 mt-1">Sent {dateLabel(c.requestedAt)} • Resolved by {c.resolvedBy} • {dateLabel(c.resolvedAt)}</p>
    {c.resolutionNote && <p className="text-xs text-slate-700 mt-1">Staff note: {c.resolutionNote}</p>}
  </li>)}</ul>
</div> : null;

// One panel for every role: the Applicant sends the request, Staff read it, edit the entries and mark it resolved,
// and Admin can read the history.
export function CorrectionRequests({ application: a }: { application: Application }) {
  const { user, act } = usePortal();
  const [editing, setEditing] = useState(false), [note, setNote] = useState(''), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  if (!user) return null;
  const open = openCorrection(a), done = (a.corrections || []).filter(c => c.status === 'Resolved').reverse(), allowed = correctableStatuses.includes(a.status);
  const resident = user.role === 'resident', staff = user.role === 'staff';
  if (!(allowed && (resident || staff)) && !a.corrections?.length) return null;
  function resolve() {
    try { act({ type: 'resolveCorrection', reference: a.reference, note }); setNote(''); setEditing(false); setError(''); setSaved(false); }
    catch (err) { setError((err as Error).message); }
  }
  return <div className="content-card p-6 mt-6 border-l-4 border-l-brand-primary">
    <h2 className="text-lg font-bold text-brand-ink">{resident && allowed && !open ? 'Ask for a correction' : 'Correction requests'}</h2>
    {open && <div className="mt-3 bg-brand-soft p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-brand-ink">{resident ? 'Waiting for Staff' : 'Open request'}</p>
      <p className="text-sm mt-2">{open.message}</p>
      <p className="text-xs text-slate-500 mt-2">Sent by {open.requestedBy} • {dateLabel(open.requestedAt)}</p>
    </div>}
    {resident && allowed && !open && <SendRequest application={a} />}
    {staff && <>
      {allowed ? <>
        {!open && <p className="text-sm text-slate-600 mt-3">There is no open request. You can still correct an entry if the Applicant asks you in person.</p>}
        <button type="button" className="secondary-btn mt-4" onClick={() => setEditing(v => !v)}>{editing ? 'Close editing' : 'Edit application entries'}</button>
        {editing && <EditEntries key={JSON.stringify(toForm(a))} application={a} onSaved={() => setSaved(true)} />}
        {saved && <Notice>Changes saved.{open ? ' Mark the request as resolved when you are done.' : ''}</Notice>}
      </> : open && <p className="text-sm text-slate-600 mt-3">The clearance is already generated, so entries can only be changed through the Admin transaction reversion. Mark this request as resolved once that is done.</p>}
      {open && <div className="mt-5 border-t pt-4">
        <Field label="Note for the Applicant (optional)" hint={a.status === 'Rejected' ? 'Resolving this request reopens the application for assessment.' : undefined}>
          <input className="text-field" maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="Example: Corrected the spelling of the last name." />
        </Field>
        <ErrorMessage message={error} />
        <button type="button" className="primary-btn mt-3" onClick={resolve}>Mark as Resolved</button>
      </div>}
    </>}
    <History items={done} />
  </div>;
}
