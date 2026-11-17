'use client';

import { useState } from 'react';
import { canExportMonthlyFiles } from '@/lib/monthlyFileExport';
import { downloadMonthlyFilePart, type SignedMonthlyExportFile } from '@/lib/downloads';
import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';
import { usePortal } from './PortalProvider';

type ExportResponse = {
  month: string;
  part: number;
  parts: number;
  file_count: number;
  files: SignedMonthlyExportFile[];
};

async function requestPart(month: string, part: number): Promise<ExportResponse> {
  const response = await fetch('/api/files/monthly-export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ month, part }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The monthly export could not be prepared.');
  return body as ExportResponse;
}

export function MonthlyFilesExportButton({ month }: { month: string }) {
  const { user } = usePortal();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!canExportMonthlyFiles(user?.role)) return null;

  const available = useSupabaseAuth && isRealAccount(user?.id);
  async function exportMonth() {
    setBusy(true);
    setMessage('');
    try {
      const first = await requestPart(month, 1);
      if (!first.parts) {
        setMessage('No uploaded files were found for this month.');
        return;
      }
      if (first.part !== 1 || first.files.length !== first.file_count) throw new Error('The export response was incomplete. Please try again.');
      await downloadMonthlyFilePart(month, 1, first.files);
      for (let part = 2; part <= first.parts; part++) {
        const next = await requestPart(month, part);
        if (next.part !== part || next.parts !== first.parts || next.files.length !== next.file_count) {
          throw new Error('The monthly file list changed during export. Some parts may already be downloaded.');
        }
        await downloadMonthlyFilePart(month, part, next.files);
      }
      setMessage(`Downloaded ${first.parts} part${first.parts === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage((error as Error).message || 'The monthly export could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-col items-end gap-1">
    <button type="button" className="secondary-btn" disabled={!available || busy} onClick={exportMonth}>
      {!available ? 'Not available in sample mode' : busy ? 'Preparing ZIP parts…' : 'Download uploaded files ZIP'}
    </button>
    <p className="text-xs text-slate-600">Keep the export on the office computer and a second drive. It contains personal data.</p>
    {message && <p role="status" aria-live="polite" className="text-xs text-slate-600">{message}</p>}
  </div>;
}
