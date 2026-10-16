'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { usePortal } from './PortalProvider';
import { dateLabel, notificationsFor } from '@/lib/workflow';

// The Applicant's inbox: what happened to their applications and what to do next. Opening it counts as reading it; the items stay
// marked "New" for this visit only.
export function NotificationInbox() {
  const { state, user, act } = usePortal();
  const mine = notificationsFor(state, user?.id), unread = mine.filter(n => !n.readAt).length;
  const [fresh] = useState(() => new Set(mine.filter(n => !n.readAt).map(n => n.id)));
  useEffect(() => { if (unread > 0) act({ type: 'readNotifications' }); }, [unread, act]);
  return <div className="p-5 md:p-8 max-w-[800px]">
    <h1 className="text-[27px] font-bold text-brand-ink">Notifications</h1>
    <p className="text-sm mt-2 text-slate-600">Updates on your clearance applications, and what to do next.</p>
    {!mine.length
      ? <div className="content-card p-8 mt-6 text-center"><Bell size={26} className="mx-auto text-slate-400" aria-hidden="true" /><p className="text-sm mt-3">No notifications yet. When Staff review, assess or release your application, you will see it here.</p></div>
      : <ul className="mt-6 space-y-3">{mine.map(n => <li key={n.id} className={'content-card p-4 ' + (fresh.has(n.id) ? 'border-l-4 border-l-brand-primary' : '')}>
          <div className="flex justify-between gap-3 flex-wrap"><span className="text-xs text-slate-500">{dateLabel(n.createdAt)} • {n.reference}</span>{fresh.has(n.id) && <span className="text-xs font-bold text-brand-primary">New</span>}</div>
          <p className="text-sm mt-2">{n.message}</p>
          <Link href={'/resident/applications/' + n.reference} className="text-sm text-brand-primary underline mt-2 inline-block">Open application</Link>
        </li>)}</ul>}
  </div>;
}

// A short "What's new" card for the Applicant's dashboard: the latest unread notices.
export function WhatsNew() {
  const { state, user } = usePortal();
  const unread = notificationsFor(state, user?.id).filter(n => !n.readAt);
  if (!unread.length) return null;
  return <section aria-label="What's new" className="content-card p-5 mt-6 border-l-4 border-l-brand-primary">
    <h2 className="text-sm font-bold text-brand-ink flex items-center gap-2"><Bell size={16} aria-hidden="true" />What&apos;s new ({unread.length})</h2>
    <ul className="mt-3 space-y-3">{unread.slice(0, 3).map(n => <li key={n.id} className="text-sm"><span className="block text-xs text-slate-500">{n.reference} • {dateLabel(n.createdAt)}</span>{n.message}</li>)}</ul>
    <Link href="/resident/notifications" className="text-sm text-brand-primary underline mt-3 inline-block">{unread.length > 3 ? 'See all ' + unread.length + ' notifications' : 'Open notifications'}</Link>
  </section>;
}
