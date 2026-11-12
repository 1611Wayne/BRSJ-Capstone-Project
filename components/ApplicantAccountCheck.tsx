'use client';
import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Field, ErrorMessage } from './Field';
import { usePortal } from './PortalProvider';
import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';
import { dateLabel } from '@/lib/workflow';

type Check = { idVerifiedAt: string | null; idVerifiedBy: string | null; spamFlaggedAt: string | null; spamFlaggedBy: string | null; spamReason: string | null };

// DB-11 (migration 21): on the Staff assessment page, whether the applicant's ID was checked and whether the account is
// flagged as spam. Until Staff check the ID once, an online applicant can have only one open request; a flagged account
// cannot submit new requests until Admin clears the flag. With real sign-in only (the sample mode has no accounts to check).
export function ApplicantAccountCheck({ residentId }: { residentId: string }) {
  const { user } = usePortal();
  const [check, setCheck] = useState<Check>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [flagging, setFlagging] = useState(false), [reason, setReason] = useState('');
  const real = useSupabaseAuth && isRealAccount(user?.id ?? null) && isRealAccount(residentId);
  useEffect(() => {
    if (!real) return;
    let cancelled = false;
    fetch('/api/residents/check?id=' + residentId, { cache: 'no-store' }).then(async r => {
      const body = await r.json().catch(() => ({}));
      if (!cancelled) { if (r.ok) setCheck(body.check); else setError(body.error || 'The account check could not be loaded.'); }
    });
    return () => { cancelled = true; };
  }, [real, residentId]);
  if (!real) return null;
  async function change(action: 'verify' | 'flag' | 'unflag', why = '') {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/residents/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ residentId, action, reason: why }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Not saved.');
      setCheck(body.check); setFlagging(false); setReason('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="border border-brand-border bg-slate-50 px-4 py-3 mb-5 text-sm" aria-label="Applicant's account">
    {!check ? <p className="text-slate-600">{error || 'Checking the applicant\'s account…'}</p> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>{check.idVerifiedAt
          ? <><span className="font-semibold text-green-800">ID checked</span><span className="text-slate-600"> · {dateLabel(check.idVerifiedAt)}{check.idVerifiedBy ? ' by ' + check.idVerifiedBy : ''}</span></>
          : <><span className="font-semibold text-amber-800">ID not checked yet</span><span className="text-slate-600"> · until it is, this applicant can have only one open request. Compare the ID in the documents below with the applicant&apos;s name, then mark it.</span></>}</p>
        <div className="flex gap-2 flex-wrap">
          {!check.idVerifiedAt && <button type="button" className="secondary-btn" disabled={busy} onClick={() => void change('verify')}>Mark ID verified</button>}
          {!check.spamFlaggedAt && <button type="button" className="text-xs underline text-red-700" disabled={busy} onClick={() => setFlagging(true)}>Flag as spam</button>}
          {check.spamFlaggedAt && user?.role === 'admin' && <button type="button" className="text-xs underline text-brand-primary" disabled={busy} onClick={() => void change('unflag')}>Clear spam flag</button>}
        </div>
      </div>
      {check.spamFlaggedAt && <p className="mt-2 text-red-800"><span className="font-semibold">Flagged as spam</span> · {dateLabel(check.spamFlaggedAt)}{check.spamFlaggedBy ? ' by ' + check.spamFlaggedBy : ''}: {check.spamReason}. New requests from this account are stopped until Admin clears the flag.</p>}
      <ErrorMessage message={error} />
    </>}
    {flagging && <Modal title="Flag account as spam" onClose={() => setFlagging(false)}>
      <form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); void change('flag', reason); }}>
        <p className="text-sm">A flagged account cannot submit new requests until Admin clears the flag. Admin sees it in User Management.</p>
        <Field label="Reason *"><textarea className="textarea-field min-h-[80px]" required maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        <ErrorMessage message={error} />
        <div className="flex justify-end gap-2"><button type="button" className="secondary-btn" onClick={() => setFlagging(false)}>Cancel</button><button className="primary-btn" disabled={busy || !reason.trim()}>Flag as Spam</button></div>
      </form>
    </Modal>}
  </div>;
}
