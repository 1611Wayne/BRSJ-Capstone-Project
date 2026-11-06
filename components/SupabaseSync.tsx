'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePortal } from './PortalProvider';
import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';
import { loadDbFeeSchedules, loadMyApplications, loadMyNotifications } from '@/lib/supabase/applications';

// In real sign-in mode, loads requests from the database into the screens once per page load: an Applicant's own
// requests, or every submitted request for Staff and Admin (and the fee schedules from the database). If the sign-in has expired, it signs the person out of the
// screens and sends them to the login page. Does nothing for the prototype's sample accounts or in prototype mode.
export function SupabaseSync() {
  const { user, act, ready } = usePortal();
  const router = useRouter();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!useSupabaseAuth || !ready || !user || !isRealAccount(user.id)) return;
    let cancelled = false;
    const requestedAt = Date.now();   // clicks saved after this moment are newer than what this reload brings
    loadMyApplications()
      .then(async applications => {
        if (cancelled) return;
        act({ type: 'loadApplications', applications, requestedAt, ...(user.role === 'resident' ? { replaceOwn: true } : { replaceAll: true }) });
        if (user.role === 'resident') { const notifications = await loadMyNotifications(); if (!cancelled) act({ type: 'loadNotifications', notifications }); }
        if (user.role !== 'resident') { const schedules = await loadDbFeeSchedules(); if (!cancelled) act({ type: 'loadSchedules', schedules }); }
      })
      .catch(e => {
        if (cancelled) return;
        if ((e as Error & { status?: number }).status === 401) { act({ type: 'logout' }); router.push('/login'); return; }
        setError((e as Error).message);
      });
    return () => { cancelled = true; };
    // act and router change identity between renders; loading once per user and page load is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);
  return error ? <p role="alert" className="m-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2">{error}</p> : null;
}
