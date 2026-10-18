'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Application, PortalState, User } from '@/types';
import { mockUsers } from '@/data/mockUsers';
import { mockApplications } from '@/data/mockApplications';
import { mockFeeSchedules } from '@/data/mockFeeSchedules';
import { mockAuditLogs } from '@/data/mockAuditLogs';
import { Command, transition } from '@/lib/workflow';
import { isRealAccount, useSupabaseAuth } from '@/lib/supabase/config';
const initial: PortalState = { users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: mockAuditLogs, notifications: [], currentUserId: null };
const Context = createContext<{ state: PortalState; user?: User; ready: boolean; act: (command: Command) => PortalState } | null>(null);

// Workflow steps the database can already save (app/api/workflow/route.ts). In real sign-in mode, after the screen
// updates with the same rules, the step is sent to the server, which checks it again and saves it. If the server
// refuses, a banner says why and the saved requests are loaded again, so the screen never shows unsaved changes.
const SAVED_ON_SERVER = new Set<Command['type']>(['review', 'assess', 'reject', 'readNotifications']);

export function PortalProvider({children}:{children:React.ReactNode}) {
  const [state,setState] = useState<PortalState>(initial); const [ready,setReady] = useState(false); const latest = useRef(state);
  const [serverError,setServerError] = useState('');
  useEffect(() => {
    try { const saved = sessionStorage.getItem('san-jose-prototype-v2'); if (saved) { const parsed = JSON.parse(saved); if (parsed.users && parsed.applications && parsed.schedules && parsed.audits) { const loaded = { ...parsed, notifications: parsed.notifications ?? [] }; latest.current = loaded; setState(loaded); } } } catch { /* Start with sample records when storage is unavailable. */ }
    setReady(true);
  },[]);
  function commit(next: PortalState) {
    latest.current = next; setState(next);
    try { sessionStorage.setItem('san-jose-prototype-v2', JSON.stringify(next, (key,value) => key === 'url' && !String(value).startsWith('data:') ? undefined : value)); } catch { /* State still works in memory. */ }
  }
  // Saves go to the server one at a time, in the order of the clicks. A request's saved copy is put back on screen only
  // when no newer save for that request is still waiting, so a slow answer never undoes a newer click.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(new Map<string, number>());
  function act(command: Command) {
    const next = transition(latest.current, command); commit(next);
    if (useSupabaseAuth && SAVED_ON_SERVER.has(command.type) && isRealAccount(latest.current.currentUserId)) {
      const key = ('reference' in command && command.reference) || '*';
      waiting.current.set(key, (waiting.current.get(key) ?? 0) + 1);
      queue.current = queue.current.then(() => saveOnServer(command, key));
    }
    return next;
  }
  async function saveOnServer(command: Command, key: string) {
    const newest = () => { const left = (waiting.current.get(key) ?? 1) - 1; waiting.current.set(key, left); return left === 0; };
    try {
      if (command.type === 'readNotifications') {
        const response = await fetch('/api/notifications', { method: 'POST' });
        if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || 'Your notifications could not be marked as read.');
        newest(); return;
      }
      const response = await fetch('/api/workflow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The server did not save this change.');
      if (newest()) commit(transition(latest.current, { type: 'loadApplications', applications: [body.application as Application] }));
      setServerError('');
    } catch (e) {
      waiting.current.set(key, 0);   // the saved data is reloaded below; later saves still go in order
      setServerError('Not saved: ' + (e as Error).message + ' The page now shows what is saved.');
      try {
        const response = await fetch('/api/applications', { cache: 'no-store' });
        const body = await response.json();
        const role = latest.current.users.find(u => u.id === latest.current.currentUserId)?.role;
        if (response.ok) commit(transition(latest.current, { type: 'loadApplications', applications: body.applications, ...(role === 'resident' ? { replaceOwn: true } : { replaceAll: true }) }));
      } catch { /* The banner already says the change was not saved. */ }
    }
  }
  return <Context.Provider value={{state, user: state.users.find(u => u.id === state.currentUserId && u.status === 'Active'), ready, act}}>
    {serverError && <div role="alert" className="fixed top-0 inset-x-0 z-50 bg-red-50 border-b border-red-200 text-red-800 text-sm px-4 py-3 flex gap-3 items-start justify-between"><span>{serverError}</span><button type="button" className="underline shrink-0" onClick={() => setServerError('')}>Dismiss</button></div>}
    {children}
  </Context.Provider>;
}
export function usePortal() { const context = useContext(Context); if (!context) throw new Error('PortalProvider is required'); return context; }
