'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePortal } from './PortalProvider';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { loadMyApplications } from '@/lib/supabase/applications';

// Real accounts have database ids (UUIDs); the prototype's sample accounts have ids like "resident-maria".
const isRealAccount = (id?: string) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// In real sign-in mode, loads the signed-in Applicant's own requests from the database into the screens once per
// page load, so My Applications, the dashboard and the detail pages show the saved records. If the sign-in has
// expired, it signs the person out of the screens and sends them to the login page. Does nothing otherwise.
export function SupabaseSync() {
  const { user, act, ready } = usePortal();
  const router = useRouter();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!useSupabaseAuth || !ready || user?.role !== 'resident' || !isRealAccount(user.id)) return;
    let cancelled = false;
    loadMyApplications()
      .then(applications => { if (!cancelled) act({ type: 'loadApplications', applications, replaceOwn: true }); })
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
