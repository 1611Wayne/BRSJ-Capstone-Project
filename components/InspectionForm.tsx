'use client';
import { useEffect, useState } from 'react';
import { usePortal } from './PortalProvider';
import { Field, ErrorMessage, Notice } from './Field';
import { today } from '@/lib/workflow';
import { canScheduleInspection, inspectionInputValue, inspectionTimestamp } from '@/lib/inspections';
import type { Application, InspectionReport } from '@/types';

const empty: InspectionReport = { status: 'Pending', inspector: '', date: '', remarks: '' };

export function InspectionForm({ application }: { application: Application }) {
  const { act } = usePortal();
  const [report, setReport] = useState<InspectionReport>(application.inspection || empty);
  const [scheduled, setScheduled] = useState(inspectionInputValue(application.inspection?.scheduledAt));
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    setReport(application.inspection || empty); setScheduled(inspectionInputValue(application.inspection?.scheduledAt));
  }, [application.reference, application.inspection]);
  const schedulable = canScheduleInspection(application), completed = report.status === 'Completed';
  const originalSchedule = inspectionInputValue(application.inspection?.scheduledAt);
  return <form id="inspection-report" className="content-card p-6" aria-labelledby="inspection-report-heading" onSubmit={e => {
    e.preventDefault();
    try {
      const scheduledAt = scheduled === originalSchedule ? application.inspection?.scheduledAt : inspectionTimestamp(scheduled);
      act({ type: 'inspection', reference: application.reference, report: { ...report, scheduledAt } });
      setError(''); setMessage('Inspection report saved.');
    } catch (e) { setError((e as Error).message); setMessage(''); }
  }}>
    <h2 id="inspection-report-heading" className="font-bold text-brand-ink border-b pb-3">Inspection Report</h2>
    <p className="text-xs text-slate-500 mt-3">Assign an inspector and a future appointment to schedule a visit. Times use Asia/Manila. Clear the appointment and save to remove it from the schedule.</p>
    <ErrorMessage message={error} />{message && <Notice>{message}</Notice>}
    <div className="form-grid mt-4">
      <Field label="Inspection Status"><select className="select-field" value={report.status} onChange={e => { setReport({ ...report, status: e.target.value as InspectionReport['status'], date: e.target.value === 'Pending' ? '' : report.date }); setMessage(''); }}><option>Pending</option><option>Completed</option></select></Field>
      <Field label="Name of Inspector"><input className="text-field" required={completed || !!scheduled} maxLength={120} value={report.inspector} onChange={e => { setReport({ ...report, inspector: e.target.value }); setMessage(''); }} /></Field>
      <Field label="Scheduled Date and Time (Manila)"><input type="datetime-local" className="text-field" disabled={!schedulable || completed} min={scheduled !== originalSchedule || !originalSchedule ? inspectionInputValue(new Date().toISOString()) : undefined} value={scheduled} onChange={e => { setScheduled(e.target.value); setMessage(''); }} /></Field>
      {completed && <Field label="Date Inspected"><input type="date" className="text-field" max={today()} required value={report.date} onChange={e => { setReport({ ...report, date: e.target.value }); setMessage(''); }} /></Field>}
      <Field label="Remarks"><textarea className="textarea-field" maxLength={2000} value={report.remarks} onChange={e => { setReport({ ...report, remarks: e.target.value }); setMessage(''); }} /></Field>
    </div>
    {!schedulable && <p className="text-xs text-slate-500 mt-3">New appointments are scheduled before assessment, on Pending Assessment or Under Review requests.</p>}
    <button disabled={['Draft', 'Void', 'Rejected'].includes(application.status)} className="secondary-btn mt-4">Save Inspection Report</button>
  </form>;
}
