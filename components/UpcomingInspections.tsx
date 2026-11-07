'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePortal } from './PortalProvider';
import { ReportTable } from './ReportTable';
import { inspectionQueue } from '@/lib/inspections';
import { dateLabel, manilaDate } from '@/lib/workflow';
import type { Application } from '@/types';

export function UpcomingInspections() {
  const { state } = usePortal();
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const timer = setInterval(() => setNow(new Date().toISOString()), 60000); return () => clearInterval(timer); }, []);
  const { upcoming, overdue } = inspectionQueue(state.applications, now);
  const headers = ['Scheduled Date / Time (Manila)', 'Schedule', 'Request Reference', 'Applicant', 'Clearance Type', 'Location', 'Inspector', 'Action'];
  const rows = (applications: Application[], missed = false) => applications.map(a => [dateLabel(a.inspection!.scheduledAt), missed ? 'Overdue' : manilaDate(a.inspection!.scheduledAt!) === manilaDate(now) ? 'Today' : 'Scheduled', a.reference, a.applicant, a.clearanceType, a.businessLocation || a.address, a.inspection!.inspector,
    <Link key={a.reference} className="text-brand-primary underline" href={'/staff/assessment/' + a.reference + '#inspection-report'}>Open Inspection</Link>]);
  return <section aria-labelledby="upcoming-inspections-heading" className="mt-10">
    <h2 id="upcoming-inspections-heading" className="text-xl font-bold text-brand-ink mb-3">Upcoming Inspections</h2>
    <p className="text-sm text-slate-600 mb-4">Pending visits for all inspectors, earliest appointment first. Times are shown in Manila time.</p>
    {upcoming.length ? <ReportTable headers={headers} rows={rows(upcoming)} /> : <p className="content-card p-5 text-sm text-slate-500">No upcoming inspections scheduled.</p>}
    {overdue.length > 0 && <section aria-labelledby="overdue-inspections-heading" className="mt-6">
      <h3 id="overdue-inspections-heading" className="text-lg font-bold text-amber-800 mb-3">Overdue Inspections</h3>
      <p className="text-xs text-slate-500 mb-3">These appointments are still pending. Open the inspection to record completion, reschedule, or clear the appointment.</p>
      <ReportTable headers={headers} rows={rows(overdue, true)} />
    </section>}
  </section>;
}
