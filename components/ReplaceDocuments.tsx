'use client';
import { useState } from 'react';
import type { Application, UploadedDocument } from '@/types';
import { usePortal } from './PortalProvider';
import { FileUpload } from './FileUpload';
import { ErrorMessage, Notice } from './Field';

// Documents Staff flagged as Missing / Needs Replacement, while the request can still be assessed.
export const needsNewCopy = (a: Application) =>
  a.status === 'Pending Assessment' || a.status === 'Under Review'
    ? a.documents.filter(d => d.status === 'Missing' || d.status === 'Needs Replacement')
    : [];

// The Applicant uploads a new copy of a flagged document from their own account; Staff can upload it for them
// (for example when the Applicant brings it to the barangay hall). The new copy goes back to Pending Review.
export function ReplaceDocuments({ application: a, onReplaced }: { application: Application; onReplaced?: (documents: UploadedDocument[]) => void }) {
  const { user, act } = usePortal();
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  if (user?.role !== 'resident' && user?.role !== 'staff') return null;
  const flagged = needsNewCopy(a), staff = user.role === 'staff';
  if (!flagged.length && !message) return null;
  function replace(file?: UploadedDocument) {
    if (!file) return;
    try {
      const next = act({ type: 'replaceDocument', reference: a.reference, document: file });
      setError(''); setMessage(`New copy of ${file.requirement} uploaded. It is back in review.`);
      onReplaced?.(next.applications.find(x => x.reference === a.reference)!.documents);
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="content-card p-6 mt-6 border-l-4 border-l-amber-400">
    {flagged.length > 0 && <>
      <h2 className="text-lg font-bold text-brand-ink">{staff ? 'Documents waiting for a new copy' : 'Please upload a new copy'}</h2>
      <p className="text-sm text-slate-600 mt-2">{staff
        ? 'The Applicant can upload these from their own account. You can also upload the new copy for them here, for example when they bring it to the barangay hall.'
        : 'Staff asked for a new copy of the document below. Upload a clear photo or PDF. Staff will check it again.'}</p>
      <div className="grid sm:grid-cols-2 gap-4 mt-5">
        {flagged.map(d => <div key={d.requirement + d.name}>
          <p className="text-xs font-semibold text-red-700 mb-1">{d.status}: {d.name}</p>
          {d.note && <p className="text-xs text-slate-700 mb-2">Staff note: {d.note}</p>}
          <FileUpload label={d.requirement} helper={staff ? 'Upload for the Applicant • JPG, PNG, PDF • Max 5 MB' : 'JPG, PNG, PDF • Max 5 MB'} persist onChange={replace} />
        </div>)}
      </div>
    </>}
    <ErrorMessage message={error} />
    {message && <Notice>{message}</Notice>}
  </div>;
}
