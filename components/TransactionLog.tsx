'use client';
import { useEffect, useState } from 'react';
import { usePortal } from './PortalProvider';
import { ReportTable } from './ReportTable';
import { transactionDateLabel, transactionEvents } from '@/lib/transactionLog';
import { loadAudits } from '@/lib/supabase/applications';
import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';
import type { Application } from '@/types';

export function TransactionLog({ application }: { application: Application }) {
  const { state, user, act } = usePortal();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!useSupabaseAuth || !isRealAccount(user?.id)) return;
    let cancelled = false;
    loadAudits(application.reference).then(audits => {
      if (!cancelled) { act({ type: 'loadAudits', reference: application.reference, audits }); setError(''); }
    }).catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
    // Read once for this transaction and signed-in person, rather than reloading on every shared-state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.reference, user?.id]);
  const events = transactionEvents(application, state.audits);
  return <section className="mt-7" aria-labelledby="transaction-log-heading">
    <h2 id="transaction-log-heading" className="text-lg font-bold text-brand-ink mb-3">Full Transaction Log</h2>
    <p className="text-xs text-slate-500 mb-4">Recorded stages in chronological order, including repeated reviews, returns, and reversions. Times are shown in Manila time, including seconds. Older records may have only their saved milestones.</p>
    {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
    <ReportTable headers={['Date / Time', 'User', 'Stage / Action', 'Reason']} rows={events.map(event => [transactionDateLabel(event.timestamp), event.user, event.action, event.reason || '—'])} />
  </section>;
}
