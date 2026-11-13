'use client';
import { useEffect, useState } from 'react';
import { usePortal } from './PortalProvider';
import { Field, ErrorMessage, Notice } from './Field';
import { dateLabel } from '@/lib/workflow';
import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';
import { personalRecordSummary, RECORDS_RETENTION_TEXT, RECORDS_SUMMARY_TEXT } from '@/lib/personalRecords';
import { downloadBlob } from '@/lib/downloads';
import type { PersonalRecordsRequest } from '@/types';

function OfficeResponse({ request, busy, answer }: { request: PersonalRecordsRequest; busy: boolean; answer: (id: string, response: string, summary: boolean) => Promise<void> }) {
  const [response, setResponse] = useState(''), [summary, setSummary] = useState(false);
  return <form className="border-t mt-4 pt-4" onSubmit={e => { e.preventDefault(); void answer(request.id, response, summary); }}>
    <Field label="Office response *"><textarea required maxLength={4000} className="textarea-field min-h-[110px]" value={response} onChange={e => setResponse(e.target.value)} /></Field>
    <p className="text-xs text-slate-600 mt-2">Explain how the Applicant can receive the requested copy, including any supporting files or records held at the office. If clarification is needed, explain what to provide next.</p>
    <label className="flex items-start gap-2 text-sm mt-3"><input type="checkbox" checked={summary} onChange={e => setSummary(e.target.checked)} />Make their current profile and application summary available for download</label>
    <p className="text-xs text-slate-600 mt-2">{RECORDS_SUMMARY_TEXT}</p>
    <button className="primary-btn mt-4" disabled={busy || !response.trim()}>Send response</button>
  </form>;
}

export function RecordCopyRequests() {
  const { state, user, act, ready } = usePortal();
  const real = useSupabaseAuth && isRealAccount(user?.id), resident = user?.role === 'resident';
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [text, setText] = useState(''), [status, setStatus] = useState(resident ? '' : 'Pending');
  const requests = (state.recordRequests ?? []).filter(r => !resident || r.residentId === user?.id)
    .filter(r => !status || r.status === status).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || a.id.localeCompare(b.id));
  async function refresh(signal?: AbortSignal) {
    if (!real) return;
    const response = await fetch('/api/record-requests', { cache: 'no-store', signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The requests could not be loaded.');
    if (!signal?.aborted) act({ type: 'loadRecordRequests', requests: data.requests });
  }
  useEffect(() => {
    if (!ready || !real) return;
    const controller = new AbortController();
    setLoading(true);
    refresh(controller.signal).catch(e => { if (!controller.signal.aborted) setError((e as Error).message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, real, user?.id]);
  if (!user) return null;
  async function change(action: 'request' | 'answer', id: string, response?: string, includeSummary = false) {
    setBusy(true); setError(''); setMessage('');
    try {
      if (real) {
        const result = await fetch('/api/record-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id, message: text, response, includeSummary }) });
        const data = await result.json().catch(() => ({}));
        if (!result.ok) throw new Error(data.error || 'The request could not be saved.');
        await refresh();
      } else {
        act(action === 'request' ? { type: 'requestRecords', id, message: text } : { type: 'answerRecords', id, response: response ?? '', includeSummary });
      }
      if (action === 'request') setText('');
      setMessage(action === 'request' ? 'Your records request was sent. Check this section for the office response.' : 'Response sent. The Applicant can read it on Profile.');
    } catch (e) {
      if (real) await refresh().catch(() => undefined);
      setError((e as Error).message);
    } finally { setBusy(false); }
  }
  async function download(record: PersonalRecordsRequest) {
    setBusy(true); setError('');
    try {
      if (real) {
        const result = await fetch('/api/record-requests?copy=' + encodeURIComponent(record.id), { cache: 'no-store' });
        if (!result.ok) throw new Error((await result.json().catch(() => ({}))).error || 'Your summary could not be downloaded.');
        downloadBlob('records-summary-' + record.id + '.json', await result.blob());
      } else {
        const summary = personalRecordSummary(user!, state.applications, record, new Date().toISOString());
        downloadBlob('records-summary-' + record.id + '.json', new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' }));
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section id="record-copy-requests" aria-labelledby="record-copy-heading" className={resident ? 'content-card mt-6 p-7' : 'p-5 md:p-8 max-w-[1000px]'}>
    {resident ? <h2 id="record-copy-heading" className="text-lg font-bold text-brand-ink">Request a copy of my records</h2> : <h1 id="record-copy-heading" className="text-[27px] font-bold text-brand-ink">Records Requests</h1>}
    <p className="text-sm text-slate-600 mt-3">{resident ? 'Ask the Barangay for a copy of your personal records, such as applications, payment records or submitted documents. Your request is linked to your signed-in account.' : 'Review Applicant requests for their own personal records and explain how they can receive their copies.'}</p>
    <p className="text-xs text-slate-600 mt-3">{RECORDS_RETENTION_TEXT}</p>
    {message && <Notice>{message}</Notice>}<ErrorMessage message={error} />
    {resident && <form className="mt-5" onSubmit={e => { e.preventDefault(); void change('request', crypto.randomUUID()); }}>
      <Field label="Which records do you need? *"><textarea required maxLength={2000} className="textarea-field min-h-[100px]" value={text} onChange={e => setText(e.target.value)} placeholder="Describe the records, application reference numbers or dates you need." /></Field>
      <button className="primary-btn mt-3" disabled={busy || !text.trim()}>Send records request</button>
    </form>}
    <div className="flex flex-wrap gap-3 items-end justify-between mt-7"><Field label="Request status"><select className="select-field" value={status} onChange={e => setStatus(e.target.value)}><option value="">All requests</option><option>Pending</option><option>Answered</option></select></Field>
      <button type="button" className="secondary-btn" disabled={busy || loading} onClick={() => { setError(''); setLoading(true); refresh().catch(e => setError((e as Error).message)).finally(() => setLoading(false)); }}>Refresh requests</button>
    </div>
    {loading && <p role="status" className="text-sm mt-4">Loading requests...</p>}
    {!requests.length && !loading && <p className="text-sm text-slate-500 mt-5">No records requests match this status.</p>}
    <div className="space-y-4 mt-5">{requests.map(r => <article key={r.id} aria-label={'Records request ' + r.id} className="border border-brand-border rounded p-4">
      <div className="flex justify-between gap-3 flex-wrap"><p className="text-xs text-slate-600">{dateLabel(r.requestedAt)}{!resident && ' - ' + r.requestedBy}</p><span className="text-xs font-semibold">{r.status}</span></div>
      <p className="text-xs text-slate-500 mt-2 break-all">Request ID: {r.id}</p><p className="text-sm mt-3 whitespace-pre-wrap break-words">{r.message}</p>
      {r.status === 'Answered' && <div className="bg-slate-50 border-t mt-4 pt-4 px-3 pb-3"><h3 className="font-bold text-sm">Office response</h3><p className="text-sm mt-2 whitespace-pre-wrap break-words">{r.response}</p><p className="text-xs text-slate-500 mt-2">{r.respondedBy} - {dateLabel(r.respondedAt)}</p>
        {resident && r.includeSummary && <><p className="text-xs text-slate-600 mt-3">{RECORDS_SUMMARY_TEXT} The summary reflects records held at the time you download it.</p><button type="button" className="secondary-btn mt-3" disabled={busy} onClick={() => void download(r)}>Download my records summary (JSON)</button></>}
      </div>}
      {!resident && r.status === 'Pending' && <OfficeResponse request={r} busy={busy} answer={(id, response, summary) => change('answer', id, response, summary)} />}
    </article>)}</div>
  </section>;
}
