'use client';
import { useState } from 'react';
import type { Application } from '@/types';
import { usePortal } from './PortalProvider';
import { ErrorMessage, Notice } from './Field';
import { applicationPDF } from '@/lib/downloads';

// The printed original needs the barangay's official stamp, so it is released at the monitoring office. Staff print the clearance from here,
// stamp it, hand it over, and confirm the release. The Applicant keeps the digital copy as a backup.
export function ReleaseClearance({ application: a }: { application: Application }) {
  const { user, act } = usePortal();
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  if (user?.role !== 'staff' || !a.clearance || (a.status !== 'Ready for Download' && a.status !== 'Closed - Cleared')) return null;
  const waiting = a.status === 'Ready for Download';
  function print() {
    try { act({ type: 'printClearance', reference: a.reference }); applicationPDF(a, 'clearance'); setError(''); setMessage('The clearance PDF was generated for printing. The print is recorded in the audit trail.'); }
    catch (e) { setError((e as Error).message); }
  }
  function confirmRelease() {
    try { act({ type: 'confirm', reference: a.reference }); setError(''); setMessage(''); }
    catch (e) { setError((e as Error).message); }
  }
  return <div className="content-card p-6 mt-6 border-l-4 border-l-brand-primary">
    <h2 className="text-lg font-bold text-brand-ink">{waiting ? 'Release the printed clearance' : 'Clearance released'}</h2>
    <p className="text-sm text-slate-600 mt-2">{waiting
      ? 'Print the clearance, apply the barangay’s official stamp, and hand the printed original to the Applicant. Then confirm the release. The Applicant also keeps a digital copy as a backup.'
      : 'The printed original was released' + (a.confirmation?.confirmedBy ? ' (recorded by ' + a.confirmation.confirmedBy + ')' : '') + '. You can print a replacement copy if the Applicant needs one.'}</p>
    <div className="flex gap-3 mt-4 flex-wrap">
      <button type="button" className="secondary-btn" onClick={print}>Print Clearance (for the stamp)</button>
      {waiting && <button type="button" className="primary-btn" onClick={confirmRelease}>Confirm Release</button>}
    </div>
    <ErrorMessage message={error} />
    {message && <Notice>{message}</Notice>}
  </div>;
}
