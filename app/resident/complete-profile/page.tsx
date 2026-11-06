'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { usePortal } from '@/components/PortalProvider';
import { Field, ErrorMessage } from '@/components/Field';
import { FileUpload } from '@/components/FileUpload';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { mobileForms } from '@/lib/phone';
import type { UploadedDocument, User } from '@/types';

const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);

// A resident who signed in with a text code for a new number gives the facts the Register page asks for. The ID goes
// into their own folder of the private valid-ids bucket; the server checks it and records the privacy consent.
export default function CompleteProfilePage() {
  const { user, act } = usePortal();
  const router = useRouter();
  const [id, setId] = useState<UploadedDocument>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (!user) return null;
  const me = user;
  const mobile = mobileForms(me.contact)?.local ?? me.contact;

  async function submit(f: FormData) {
    setError('');
    if (!me.hasValidId && !id) { setError('Upload a photo or PDF of a valid ID.'); return; }
    setBusy(true);
    try {
      let validIdPath: string | undefined;
      if (id?.url) {
        const blob = await (await fetch(id.url)).blob();
        validIdPath = `${me.id}/${Date.now()}-${safeFileName(id.name)}`;
        const { error: uploadError } = await supabaseBrowser().storage.from('valid-ids').upload(validIdPath, blob, { contentType: id.type, upsert: false });
        if (uploadError) throw new Error('Your ID could not be uploaded: ' + uploadError.message);
      }
      const get = (name: string) => String(f.get(name) ?? '').trim();
      const response = await fetch('/api/profile/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        firstName: get('first'), lastName: get('last'), address: get('address'), email: get('email'), validIdPath, privacyConsent: f.get('privacy') === 'on',
      }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Your details could not be saved.');
      const meResponse = await fetch('/api/me', { cache: 'no-store' });
      const meBody = await meResponse.json().catch(() => ({}));
      if (!meResponse.ok) throw new Error(meBody.error || 'Could not load your account.');
      act({ type: 'sessionUser', user: meBody.user as User });
      router.push('/resident/dashboard');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (!me.needsProfile) return <div className="p-5 md:p-8"><div className="content-card p-8 max-w-[520px]"><h1 className="text-xl font-bold text-brand-ink">Your registration is complete</h1><Link href="/resident/dashboard" className="primary-btn inline-block mt-5">Go to My Dashboard</Link></div></div>;
  return <div className="p-5 md:p-8">
    <form className="content-card w-full max-w-[520px] px-7 py-8" onSubmit={e => { e.preventDefault(); void submit(new FormData(e.currentTarget)); }}>
      <h1 className="text-[25px] font-bold text-brand-ink">Complete Your Registration</h1>
      <p className="text-sm text-slate-600 mt-2">You signed in with {mobile}. Before you can apply, the barangay needs your name, address and a valid ID, the same as for any registration.</p>
      <div className="form-grid mt-6">
        <Field label="First Name *"><input name="first" required className="text-field" defaultValue={me.firstName} /></Field>
        <Field label="Last Name *"><input name="last" required className="text-field" defaultValue={me.lastName} /></Field>
        <div className="sm:col-span-2"><Field label="Full Address *"><input name="address" required className="text-field" placeholder="House No., Street, Subdivision" defaultValue={me.address} /></Field></div>
        <div className="sm:col-span-2"><Field label="Email Address (optional)"><input name="email" type="email" className="text-field" placeholder="Leave empty if you have no email" defaultValue={me.email} /></Field></div>
        {!me.hasValidId && <div className="sm:col-span-2"><FileUpload label="Upload Valid ID" required idCard value={id} onChange={setId} /></div>}
      </div>
      <label className="flex gap-2 mt-5 text-xs leading-4 text-slate-600"><input name="privacy" type="checkbox" required />I have read and agree to the Privacy Notice regarding the processing of my personal information for barangay clearance services.</label>
      <Link href="/information#privacy" target="_blank" className="text-xs underline mt-2 block w-fit">Read Privacy Notice</Link>
      <ErrorMessage message={error} />
      <button className="primary-btn mt-6" disabled={busy}>{busy ? 'Saving…' : 'Finish Registration'}</button>
    </form>
  </div>;
}
