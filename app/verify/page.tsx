'use client';
import { useState } from 'react';
import Link from 'next/link';
import { PublicNavbar } from '@/components/PublicNavbar';
import { Footer } from '@/components/Footer';
import { usePortal } from '@/components/PortalProvider';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { BUSINESS_SEARCH_LIMIT, searchSampleBusinesses } from '@/lib/businessVerification';

type Results = ReturnType<typeof searchSampleBusinesses>;
export default function BusinessVerificationPage() {
  const { state, ready } = usePortal();
  const [name,setName] = useState(''), [searched,setSearched] = useState('');
  const [results,setResults] = useState<Results>([]), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  async function search() {
    setBusy(true); setError(''); setResults([]); setSearched('');
    try {
      let found: Results;
      if (useSupabaseAuth) {
        const response = await fetch('/api/verify?businessName=' + encodeURIComponent(name.trim()), { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Search is unavailable.');
        found = body.results;
      } else found = searchSampleBusinesses(state.applications, name);
      setResults(found); setSearched(name.trim());
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="min-h-screen flex flex-col"><PublicNavbar/><main className="flex-1 max-w-[950px] w-full mx-auto px-5 py-12">
    <h1 className="text-[28px] font-bold text-brand-ink">Verify a business clearance</h1>
    <p className="mt-3">Enter the full business name exactly as it appears on the clearance. Capitalization is ignored. Partial-name searches are unavailable.</p>
    <form className="content-card p-6 mt-6" onSubmit={e=>{e.preventDefault();void search();}}>
      <label className="field-label" htmlFor="business-search">Full business name</label>
      <input id="business-search" className="text-field" required minLength={2} maxLength={160} value={name} onChange={e=>setName(e.target.value)}/>
      <button className="primary-btn mt-4" disabled={busy || (!useSupabaseAuth && !ready)}>{busy?'Searching…':'Search business'}</button>
    </form>
    <p className="text-sm mt-4">Only issued Business Clearances with recorded Treasury receipts are listed. Demonstration payments are excluded. Results show up to {BUSINESS_SEARCH_LIMIT} records; use the clearance’s QR code to verify a specific reference. A matching name alone does not establish business ownership or creditworthiness.</p>
    {!useSupabaseAuth&&<p className="text-sm mt-3">Sample-data mode: these are fictional records from this browser tab.</p>}
    {error&&<p role="alert" className="text-red-700 mt-4">{error}</p>}
    {searched&&<section className="mt-6" aria-live="polite"><h2 className="text-xl font-bold">Results for {searched}</h2>
      {!results.length?<p className="mt-3">No matching issued business clearances found. Check the spelling or verify using the QR code on the clearance.</p>:<ul className="space-y-4 mt-4">{results.map(r=><li className="content-card p-5" key={r.reference}><dl>{Object.entries({'Business name':r.businessName,'Reference number':r.reference,'Clearance type':r.clearanceType,'Issue date':r.issueDate,'Verification status':r.status}).map(([k,v])=><div key={k} className="sm:grid sm:grid-cols-2 gap-3 py-1"><dt className="font-semibold">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl><Link className="underline inline-block mt-3" href={'/verify/'+encodeURIComponent(r.reference)}>Open verification</Link></li>)}</ul>}
    </section>}
  </main><Footer/></div>;
}
