'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { PortalState, User } from '@/types';
import { mockUsers } from '@/data/mockUsers';
import { mockApplications } from '@/data/mockApplications';
import { mockFeeSchedules } from '@/data/mockFeeSchedules';
import { mockAuditLogs } from '@/data/mockAuditLogs';
import { Command, transition } from '@/lib/workflow';
const initial: PortalState = { users: mockUsers, applications: mockApplications, schedules: mockFeeSchedules, audits: mockAuditLogs, currentUserId: null };
const Context = createContext<{ state: PortalState; user?: User; ready: boolean; act: (command: Command) => PortalState } | null>(null);
export function PortalProvider({children}:{children:React.ReactNode}) {
  const [state,setState] = useState<PortalState>(initial); const [ready,setReady] = useState(false); const latest = useRef(state);
  useEffect(() => {
    try { const saved = sessionStorage.getItem('san-jose-prototype-v2'); if (saved) { const parsed = JSON.parse(saved); if (parsed.users && parsed.applications && parsed.schedules && parsed.audits) { latest.current = parsed; setState(parsed); } } } catch { /* Start with sample records when storage is unavailable. */ }
    setReady(true);
  },[]);
  function act(command: Command) {
    const next = transition(latest.current, command); latest.current = next; setState(next);
    try { sessionStorage.setItem('san-jose-prototype-v2', JSON.stringify(next, (key,value) => key === 'url' && !String(value).startsWith('data:') ? undefined : value)); } catch { /* State still works in memory. */ }
    return next;
  }
  return <Context.Provider value={{state, user: state.users.find(u => u.id === state.currentUserId && u.status === 'Active'), ready, act}}>{children}</Context.Provider>;
}
export function usePortal() { const context = useContext(Context); if (!context) throw new Error('PortalProvider is required'); return context; }
