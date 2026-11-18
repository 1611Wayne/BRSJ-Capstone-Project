'use client';
// DB-10 clean-up by hand (Admin): choose a month, preview, then remove the files of its finished requests from Storage.
// The same rule runs by itself every day once the app is on Vercel (app/api/cron/file-cleanup).
import { useState } from 'react';
import { dueMonths, GRACE_DAYS } from '@/lib/fileCleanup';
import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';
import { today } from '@/lib/workflow';
import { usePortal } from './PortalProvider';

type Preview = { month: string; due: string; blockers: string[]; toRemove: number; keptOpen: number; keptIds: number; alreadyRemoved: number; filesExported: number | null; databaseExport: string | null };
const monthLabel = (m: string) => new Date(m + '-01T00:00:00+08:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });

export function FileCleanupPanel() {
  const { user } = usePortal();
  const months = dueMonths(today()).slice(-12).reverse();
  const [month, setMonth] = useState(months[0] || '');
  const [preview, setPreview] = useState<Preview>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (user?.role !== 'admin') return null;
  const available = useSupabaseAuth && isRealAccount(user?.id);
  async function call(action: 'preview' | 'remove') {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/file-cleanup', { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ month, action, ...(action === 'remove' ? { expected: preview?.toRemove } : {}) }) });
      const body = await response.json().catch(() => ({}));
      if (action === 'preview') { if (!response.ok) throw new Error(body.error || 'The preview could not be made.'); setPreview(body); setConfirmed(false); }
      else {
        if (body.summary) setPreview({ ...body.summary, toRemove: response.ok ? 0 : body.summary.toRemove, alreadyRemoved: body.summary.alreadyRemoved + (body.removed || 0) });
        if (!response.ok) throw new Error(body.error || 'The files could not be removed.');
        setConfirmed(false);
        setMessage(`Removed ${body.removed} file${body.removed === 1 ? '' : 's'} from the online system${body.failed ? `; ${body.failed} could not be removed (run it again)` : ''}. The records stay.`);
      }
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-3 items-start w-full">
    <label className="text-xs font-semibold text-slate-700" htmlFor="cleanup-month">Month</label>
    <select id="cleanup-month" className="select-field" disabled={!available || busy || !months.length} value={month} onChange={e => { setMonth(e.target.value); setPreview(undefined); setMessage(''); }}>
      {months.length ? months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>) : <option value="">No month is past its grace period yet</option>}
    </select>
    <button type="button" className="secondary-btn" disabled={!available || busy || !month} onClick={() => call('preview')}>{!available ? 'Not available in sample mode' : 'Preview'}</button>
    {preview && <div className="text-xs text-slate-700 space-y-1" aria-live="polite">
      <p><strong>{preview.toRemove}</strong> file{preview.toRemove === 1 ? '' : 's'} of finished requests can be removed. Kept: {preview.keptOpen} of unfinished requests, {preview.keptIds} valid ID{preview.keptIds === 1 ? '' : 's'}{preview.alreadyRemoved ? `; ${preview.alreadyRemoved} already removed` : ''}.</p>
      <p>Files ZIP: {preview.filesExported === null ? 'not downloaded after the month ended' : `${preview.filesExported} files downloaded`}. Database export: {preview.databaseExport ? new Date(preview.databaseExport).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' }) : 'not downloaded after the month ended'}.</p>
      {preview.blockers.map(b => <p key={b} className="text-amber-800">{b}</p>)}
    </div>}
    {preview && !preview.blockers.length && preview.toRemove > 0 && <>
      <label className="text-xs flex gap-2 items-start"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/> The month&apos;s files ZIP and database export are saved on the office computer and the second drive.</label>
      <button type="button" className="primary-btn" disabled={busy || !confirmed} onClick={() => call('remove')}>Remove {preview.toRemove} file{preview.toRemove === 1 ? '' : 's'}</button>
    </>}
    {message && <p role="status" className="text-xs text-slate-700">{message}</p>}
    <p className="text-xs text-slate-500">Rule: files are kept for the month plus {GRACE_DAYS} days. Only finished requests (closed, rejected, void) lose their files; valid IDs and all records stay. Every removal is in the Audit Trail. Automatic: runs every day once the app is on Vercel.</p>
  </div>;
}
