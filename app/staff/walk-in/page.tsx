'use client';
import { useEffect, useState, useTransition } from 'react';
import { usePortal } from '@/components/PortalProvider';
import { Field, ErrorMessage } from '@/components/Field';
import { FileUpload } from '@/components/FileUpload';
import { ApplicationForm } from '@/components/ApplicationForm';
import { fullName } from '@/data/mockUsers';
import Link from 'next/link';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { loadWalkInDrafts } from '@/lib/supabase/applications';
import type { Application, User, UploadedDocument } from '@/types';

export default function WalkInPage() {
  const { state, act } = usePortal();
  const [mode, setMode] = useState<'search' | 'new'>('search');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<User>();
  const [continued, setContinued] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState<UploadedDocument>();
  const [dbResidents, setDbResidents] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [dbDrafts, setDbDrafts] = useState<Application[]>([]);
  const [resumed, setResumed] = useState<Application>();

  // Saved walk-in drafts, for any Staff member to pick up at the counter
  useEffect(() => {
    if (!useSupabaseAuth) return;
    let cancelled = false;
    loadWalkInDrafts()
      .then(drafts => {
        if (!cancelled) setDbDrafts(drafts);
      })
      .catch(err => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Search residents from database in Supabase mode
  useEffect(() => {
    if (!useSupabaseAuth || mode !== 'search') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/residents?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        .then(res => res.json())
        .then(json => {
          if (!cancelled && json.residents) {
            setDbResidents(json.residents);
          }
        })
        .catch(err => {
          if (!cancelled) setError((err as Error).message);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, mode]);

  if (continued && selected) {
    return <ApplicationForm resident={selected} savedDraft={resumed} />;
  }

  const savedDrafts = useSupabaseAuth
    ? dbDrafts
    : state.applications.filter(a => a.status === 'Draft' && a.source === 'Assisted / Walk-in');

  // Resident search results: from database when connected, else from in-memory state
  const matches = useSupabaseAuth
    ? dbResidents
    : state.users.filter(
        u =>
          u.role === 'resident' &&
          u.status === 'Active' &&
          [fullName(u), u.contact, u.email, u.address].join(' ').toLowerCase().includes(q.toLowerCase())
      );

  // The search list carries no file details, so the chosen resident's ID on file is loaded before opening the form.
  async function openForm(residentId: string, draft?: Application) {
    setBusy(true);
    setError('');
    try {
      let resident = state.users.find(u => u.id === residentId);
      if (useSupabaseAuth) {
        const res = await fetch(`/api/residents?id=${encodeURIComponent(residentId)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || 'Could not load this resident.');
        }
        resident = json.resident as User;
      }
      if (!resident) {
        throw new Error('Could not load this resident.');
      }
      setSelected(resident);
      setResumed(draft);
      setContinued(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateResident(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!id) {
      setError('Please upload a valid ID for the resident.');
      return;
    }
    setError('');
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    const rawName = String(f.get('name') ?? '').trim();
    const contact = String(f.get('contact') ?? '').trim();
    const address = String(f.get('address') ?? '').trim();
    const email = String(f.get('email') ?? '').trim();

    if (!rawName) {
      setError('Full name is required.');
      return;
    }
    if (!contact || !/^(09\d{9}|\+639\d{9})$/.test(contact)) {
      setError('Enter a valid Philippine mobile number (e.g. 09123456789).');
      return;
    }
    if (!address) {
      setError('Complete address is required.');
      return;
    }
    if (!f.get('privacy')) {
      setError("Confirm the resident's agreement to the Privacy Notice.");
      return;
    }

    if (useSupabaseAuth) {
      setBusy(true);
      try {
        const formData = new FormData();
        formData.append('name', rawName);
        formData.append('contact', contact);
        formData.append('address', address);
        formData.append('privacyConsent', 'true');
        if (email) formData.append('email', email);

        if (id.url) {
          const blob = await fetch(id.url).then(r => r.blob());
          formData.append('validId', blob, id.name);
        }

        const res = await fetch('/api/residents', { method: 'POST', body: formData });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || 'Could not register resident.');
        }

        // The server already saved and logged the new resident.
        setSelected(json.resident as User);
        setContinued(true);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    } else {
      // Prototype mode
      const nameParts = rawName.split(/\s+/);
      const u: User = {
        id: crypto.randomUUID(),
        firstName: nameParts.shift() || '',
        lastName: nameParts.join(' '),
        contact,
        address,
        email: email || 'walk-in-' + Date.now() + '@barangaysanjose.local',
        password: crypto.randomUUID(),
        role: 'resident',
        status: 'Active',
        createdAt: new Date().toISOString(),
        validId: id,
        privacyConsentAt: new Date().toISOString(),
      };
      try {
        act({ type: 'user', user: u, reason: 'Walk-in resident created' });
        setSelected(u);
        setContinued(true);
      } catch (err) {
        setError((err as Error).message);
      }
    }
  }

  return (
    <div className="p-5 md:p-8 max-w-[900px]">
      <h1 className="text-[27px] font-bold text-brand-ink">New Walk-in Application</h1>
      <p className="text-sm mt-1 text-slate-600">Assist a resident in submitting a clearance request at the counter.</p>

      {savedDrafts.length > 0 && (
        <div className="content-card mt-7 p-6">
          <h2 className="font-bold text-brand-ink mb-4">Saved Walk-in Drafts</h2>
          <div className="space-y-3 max-h-[260px] overflow-y-auto">
            {savedDrafts.map(d => (
              <div key={d.reference} className="border p-4 flex justify-between items-center gap-3">
                <div>
                  <p className="font-semibold text-sm text-brand-ink">{d.applicant}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {d.reference} • {d.clearanceType}
                  </p>
                  {d.staffEncoder && <p className="text-xs text-slate-400 mt-0.5">Started by {d.staffEncoder}</p>}
                </div>
                <button type="button" disabled={busy} className="secondary-btn" onClick={() => openForm(d.residentId, d)}>
                  Continue
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="content-card mt-7 p-6">
        <h2 className="font-bold text-brand-ink mb-4">Resident Information</h2>

        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setMode('search');
              setError('');
            }}
            className={mode === 'search' ? 'primary-btn' : 'secondary-btn'}
          >
            Search Existing Resident
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('new');
              setSelected(undefined);
              setError('');
            }}
            className={mode === 'new' ? 'primary-btn' : 'secondary-btn'}
          >
            Create New Resident
          </button>
        </div>

        {mode === 'search' ? (
          <div className="mt-6">
            <Field label="Search name / contact / email">
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                className="text-field"
                placeholder="Name, contact number, email, or address"
              />
            </Field>

            {searching && <p className="text-xs text-slate-500 mt-2">Searching residents…</p>}

            <div className="space-y-3 mt-4 max-h-[380px] overflow-y-auto">
              {matches.map(u => (
                <div
                  key={u.id}
                  className={`border p-4 flex justify-between items-center gap-3 transition-colors ${
                    selected?.id === u.id ? 'border-brand-primary bg-brand-soft/30' : 'hover:border-slate-300'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-sm text-brand-ink">{fullName(u)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {u.contact} • {u.address}
                    </p>
                    {u.email && !u.email.includes('@barangaysanjose.local') && (
                      <p className="text-xs text-slate-400 mt-0.5">{u.email}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className={selected?.id === u.id ? 'primary-btn' : 'secondary-btn'}
                    onClick={() => setSelected(u)}
                  >
                    {selected?.id === u.id ? 'Selected' : 'Select'}
                  </button>
                </div>
              ))}
              {!matches.length && !searching && (
                <p className="text-sm text-slate-500 py-2">
                  {q ? 'No registered residents matched your search.' : 'Type a name or contact number to search.'}
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={!selected || busy}
              className="primary-btn mt-5"
              onClick={() => selected && openForm(selected.id)}
            >
              Continue to Clearance Application
            </button>
          </div>
        ) : (
          <form className="mt-6" onSubmit={handleCreateResident}>
            <div className="form-grid">
              <Field label="Full Name *">
                <input name="name" required className="text-field" placeholder="e.g. Juan dela Cruz" />
              </Field>
              <Field label="Contact Number *">
                <input name="contact" type="tel" required className="text-field" placeholder="09123456789" />
              </Field>
              <Field label="Complete Address *">
                <input name="address" required className="text-field" placeholder="House / Street / Barangay" />
              </Field>
              <Field label="Email (optional)">
                <input name="email" type="email" className="text-field" placeholder="Leave empty if resident has no email" />
              </Field>
              <div className="sm:col-span-2">
                <FileUpload label="Valid ID of Resident" required value={id} onChange={setId} idCard />
              </div>
            </div>

            <label className="flex gap-2 mt-5 text-xs leading-4 text-slate-600">
              <input name="privacy" type="checkbox" required />
              The resident was told about the Privacy Notice and agrees to the processing of their personal information for
              barangay clearance services.
            </label>
            <Link href="/information#privacy" target="_blank" className="text-xs underline mt-2 block w-fit">
              Read Privacy Notice
            </Link>

            <button type="submit" disabled={busy} className="primary-btn mt-6">
              {busy ? 'Registering Resident…' : 'Continue to Clearance Application'}
            </button>
          </form>
        )}

        <ErrorMessage message={error} />
      </div>
    </div>
  );
}
