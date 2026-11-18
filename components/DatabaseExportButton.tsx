'use client';
// DB-10: Admin downloads the monthly database export (app/api/admin/database-export). Real accounts only.
import { useState } from 'react';
import { downloadBlob } from '@/lib/downloads';
import { exportFileName } from '@/lib/databaseExport';
import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';
import { today } from '@/lib/workflow';
import { usePortal } from './PortalProvider';

export function DatabaseExportButton() {
  const { user } = usePortal();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (user?.role !== 'admin') return null;
  const available = useSupabaseAuth && isRealAccount(user?.id);
  async function exportDatabase() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/database-export', { method: 'POST', cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'The database export could not be made.');
      const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || exportFileName(today());
      downloadBlob(name, await response.blob());
      setMessage(`Downloaded ${name}. Keep it with this month's files ZIP.`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-2 items-start">
    <button type="button" className="secondary-btn" disabled={!available || busy} onClick={exportDatabase}>
      {!available ? 'Not available in sample mode' : busy ? 'Preparing the export…' : 'Download database export (ZIP)'}
    </button>
    <p className="text-xs text-slate-600">Every record except uploaded files and passwords. It contains personal data: keep it on the office computer and a second drive.</p>
    {message && <p role="status" aria-live="polite" className="text-xs text-slate-600">{message}</p>}
  </div>;
}
