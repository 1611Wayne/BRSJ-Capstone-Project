'use client';
import { useEffect, useState } from 'react';
import { usePortal } from './PortalProvider';
import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';
import { loadAudits, type AuditQuery } from '@/lib/supabase/applications';

// Real sign-in mode: an Admin screen loads only the slice of the audit log it shows (dates, reversions, view category,
// newest entries) into screen state whenever that slice changes. Does nothing in prototype mode. Returns an error text.
export function useDbAudits(query: AuditQuery | null) {
  const { user, act } = usePortal();
  const [error, setError] = useState('');
  const key = query ? JSON.stringify(query) : '';
  useEffect(() => {
    if (!useSupabaseAuth || !query || user?.role !== 'admin' || !isRealAccount(user.id)) return;
    let cancelled = false;
    loadAudits(query)
      .then(audits => { if (!cancelled) { act({ type: 'loadAudits', audits }); setError(''); } })
      .catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
    // act changes identity between renders; the query's text is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, user?.id]);
  return error;
}
