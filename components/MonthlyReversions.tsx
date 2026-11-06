'use client';
import { useState } from 'react';
import { Field } from './Field';
import { ReportTable } from './ReportTable';
import { monthlyReversions } from '@/data/mockReports';
import { today } from '@/lib/workflow';
import { useDbAudits } from './useDbAudits';
import type { AuditLog } from '@/types';

export function MonthlyReversions({ audits }: { audits: AuditLog[] }) {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  // Real sign-in mode: that month of reversions, in Manila time (the same month the counts use).
  const [y, m] = month.split('-').map(Number);
  const error = useDbAudits(y && m ? { reversion: true, since: `${month}-01T00:00:00+08:00`, until: new Date(Date.parse(`${y + Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, '0')}-01T00:00:00+08:00`) - 1).toISOString() } : null);
  const rows = monthlyReversions(audits, month), total = rows.reduce((sum, row) => sum + row.total, 0);
  return <section aria-labelledby="monthly-reversions-heading" className="mt-12">
    <div className="flex flex-wrap justify-between items-end gap-4 mb-4">
      <h2 id="monthly-reversions-heading" className="text-xl font-bold text-brand-ink">Monthly Reversions by Admin</h2>
      <Field label="Reversion Month"><input type="month" className="text-field" value={month} onChange={e => setMonth(e.target.value)} /></Field>
    </div>
    {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
    <p className="text-sm text-slate-600 mb-4">Total reversion actions: <strong>{total}</strong>. Counts use the month of each action in Manila time. A transaction can have more than one reversion.</p>
    {rows.length ? <ReportTable headers={['Admin', 'Edit Fields', 'Void Transaction', 'Mark Under Review', 'Total']} rows={rows.map(row => [row.admin, row.edits, row.voids, row.reviews, row.total])} /> : <p className="content-card p-5 text-sm text-slate-500">{month ? 'No reversion actions recorded for this month.' : 'Select a month to view reversion actions.'}</p>}
  </section>;
}
