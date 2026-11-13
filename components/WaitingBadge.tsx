import { waiting, waitingLabel, WAITING_LIMIT_HOURS } from '@/lib/waiting';
import type { Application } from '@/types';
// "Waiting" cell for the Staff and Admin request lists: how long since the request last moved, and on whom it waits.
// Past the limit it is highlighted (Staff side in red, Applicant side in amber). Closed, rejected and void requests show a dash.
export function WaitingBadge({ application, now }: { application: Application; now?: number }) {
  const w = now === undefined ? undefined : waiting(application, now);
  if (!w) return <span className="text-slate-400" aria-label="No waiting time">—</span>;
  const label = waitingLabel(w.hours);
  const tone = !w.overdue ? 'text-slate-600' : w.on === 'Staff' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-amber-50 text-amber-900 border border-amber-200';
  const title = `Waiting on ${w.on} for ${label} (since the last activity on this request)` + (w.overdue ? `: over the ${WAITING_LIMIT_HOURS}-hour limit` : '');
  return <span title={title} className={`inline-block whitespace-nowrap text-xs ${w.overdue ? 'rounded-full px-2 py-0.5 font-semibold ' : ''}${tone}`}>
    {label}<span className="block text-[10px] font-normal opacity-80">on {w.on}{w.overdue ? ` · over ${WAITING_LIMIT_HOURS}h` : ''}</span>
  </span>;
}
