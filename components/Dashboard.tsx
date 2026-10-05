'use client';
import Link from 'next/link';
import { ClipboardCheck, ReceiptText, Archive, CircleCheck, ClipboardList, Gauge, Star, Clock3, TrendingUp, BarChart2 } from 'lucide-react';
import { usePortal } from './PortalProvider';
import { StatCard } from './StatCard';
import { ApplicationTable } from './ApplicationTable';
import { ReportTable } from './ReportTable';
import { dateLabel } from '@/lib/workflow';
import { processingSeconds, SLA_SECONDS } from '@/data/mockReports';
import type { UserRole } from '@/types';

/* ── helpers ─────────────────────────────────────────────── */
function last14Days(anchorDate: Date = new Date()): string[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() - (13 - i));
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  });
}

/* ── SVG Bar Chart ────────────────────────────────────────── */
function BarChart({ days, data, label }: { days: string[]; data: number[]; label: string }) {
  const W = 560, H = 160, PAD = { t: 12, r: 12, b: 36, l: 36 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;
  const max = Math.max(...data, 1);
  const barW = chartW / data.length;
  const barGap = barW * 0.25;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
      <title>{label}</title>
      {/* y-axis gridlines */}
      {[0, 0.5, 1].map(pct => {
        const y = PAD.t + chartH * (1 - pct);
        const val = Math.round(max * pct);
        return (
          <g key={pct}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD.l - 4} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{val}</text>
          </g>
        );
      })}
      {/* bars */}
      {data.map((val, i) => {
        const bw = barW - barGap;
        const bh = val === 0 ? 2 : (val / max) * chartH;
        const x = PAD.l + i * barW + barGap / 2;
        const y = PAD.t + chartH - bh;
        const dayLabel = i % 2 === 0 ? days[i].slice(5) : '';
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={bh} rx="2" fill="var(--brand-primary, #7c3aed)" opacity="0.85" />
            {val > 0 && <text x={x + bw / 2} y={y - 3} textAnchor="middle" fontSize="9" fill="#475569">{val}</text>}
            {dayLabel && <text x={x + bw / 2} y={H - PAD.b + 14} textAnchor="middle" fontSize="10" fill="#94a3b8">{dayLabel}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/* ── SVG Line Chart ───────────────────────────────────────── */
function LineChart({ days, data, label, unit = '' }: { days: string[]; data: (number | null)[]; label: string; unit?: string }) {
  const W = 560, H = 160, PAD = { t: 12, r: 12, b: 36, l: 48 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;
  const valid = data.filter((n): n is number => n !== null);
  const max = Math.max(...valid, 1);
  const pts = data.map((v, i) => ({ x: PAD.l + (i / (data.length - 1)) * chartW, y: v === null ? null : PAD.t + chartH * (1 - v / max) }));
  const segments: string[] = [];
  let seg = '';
  pts.forEach(p => {
    if (p.y === null) { if (seg) { segments.push(seg); seg = ''; } }
    else seg += (seg ? ' L' : 'M') + ` ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  });
  if (seg) segments.push(seg);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
      <title>{label}</title>
      {[0, 0.5, 1].map(pct => {
        const y = PAD.t + chartH * (1 - pct);
        return (
          <g key={pct}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD.l - 4} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{(max * pct).toFixed(1)}{unit}</text>
          </g>
        );
      })}
      {segments.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--brand-primary, #7c3aed)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
      {pts.map((p, i) => p.y !== null && (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--brand-primary, #7c3aed)" />
      ))}
      {data.map((_, i) => {
        const p = pts[i];
        const dayLabel = i % 2 === 0 ? days[i].slice(5) : '';
        return dayLabel ? <text key={i} x={p.x} y={H - PAD.b + 14} textAnchor="middle" fontSize="10" fill="#94a3b8">{dayLabel}</text> : null;
      })}
    </svg>
  );
}

/* ── Main Dashboard ───────────────────────────────────────── */
export function Dashboard({ role }: { role: UserRole }) {
  const { state, user } = usePortal();
  const apps = state.applications.filter(a => (role !== 'resident' || a.residentId === user?.id) && a.status !== 'Draft');
  const times = apps.map(processingSeconds).filter((n): n is number => n !== null);
  const ratings = apps.flatMap(a => a.feedback ? [a.feedback.rating] : []);

  const metrics = [
    { label: 'Pending Assessment', value: apps.filter(a => a.status === 'Pending Assessment').length, icon: ClipboardCheck },
    { label: 'For Checking', value: apps.filter(a => a.status === 'For Checking').length, icon: ClipboardCheck },
    { label: 'Awaiting OR', value: apps.filter(a => a.status === 'Awaiting OR').length, icon: ReceiptText },
    { label: 'Ready for Download', value: apps.filter(a => a.status === 'Ready for Download').length, icon: Archive },
    { label: 'Closed - Cleared', value: apps.filter(a => a.status === 'Closed - Cleared').length, icon: CircleCheck },
  ];
  if (role === 'admin') metrics.unshift({ label: 'Total Applications', value: apps.length, icon: ClipboardList });

  /* ── Admin-only chart data ─────────────────────────────── */
  const anchorTime = apps.reduce((latest, a) => Math.max(latest, new Date(a.dateRequested).getTime()), 0);
  const days = last14Days(anchorTime ? new Date(anchorTime) : new Date());
  const txByDay = days.map(d => apps.filter(a => a.dateRequested.slice(0, 10) === d).length);
  const avgSecByDay = days.map(d => {
    const dayTimes = apps
      .filter(a => a.clearance?.generatedAt?.slice(0, 10) === d)
      .map(processingSeconds)
      .filter((n): n is number => n !== null);
    return dayTimes.length ? dayTimes.reduce((a, b) => a + b, 0) / dayTimes.length : null;
  });
  const withinSlaByDay = days.map(d => {
    const dayTimes = apps.filter(a => a.clearance?.generatedAt?.slice(0, 10) === d).map(processingSeconds).filter((n): n is number => n !== null);
    return dayTimes.length ? Math.round(dayTimes.filter(t => t <= SLA_SECONDS).length / dayTimes.length * 100) : null;
  });

  return (
    <div className="px-5 md:px-8 py-12 max-w-[1250px] mx-auto">
      <h1 className="text-[27px] font-bold text-brand-ink">
        {role === 'resident' ? `Welcome back, ${user?.firstName}!` : role === 'admin' ? 'Admin Dashboard' : 'Staff Dashboard'}
      </h1>
      <p className="text-sm mt-2 text-slate-700">
        {role === 'resident' ? 'Track and manage your clearance applications here.' : 'Service requests and processing overview.'}
      </p>

      {/* Stat cards */}
      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mt-9">
        {metrics.map(m => <StatCard key={m.label} {...m} />)}
        {role === 'admin' && <>
          <StatCard label="Requests Within SLA" value={times.length ? Math.round(times.filter(t => t <= SLA_SECONDS).length / times.length * 100) + '%' : '—'} icon={Gauge} />
          <StatCard label="Average Processing Time" value={times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) + 's' : '—'} icon={Clock3} />
          <StatCard label="Average Satisfaction Rating" value={ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) + '/5' : '—'} icon={Star} />
        </>}
      </div>
      {role === 'admin' && <p className="text-xs text-slate-500 mt-3">Processing duration measures OR entry to clearance generation. Sample SLA target: {SLA_SECONDS} seconds.</p>}

      {/* Analytics charts – Admin only (Revision 1) */}
      {role === 'admin' && (
        <section aria-labelledby="analytics-heading" className="mt-12">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp size={20} className="text-brand-primary" aria-hidden="true" />
            <h2 id="analytics-heading" className="text-xl font-bold text-brand-ink">Analytics &amp; Trends</h2>
            <span className="text-xs text-slate-500 ml-1">(Last 14 days)</span>
          </div>
          <div className="grid xl:grid-cols-2 gap-6">
            {/* Bar chart – daily transaction volume */}
            <div className="content-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 size={16} className="text-brand-primary" aria-hidden="true" />
                <h3 className="text-sm font-bold text-brand-ink">Daily Transaction Volume</h3>
              </div>
              <BarChart days={days} data={txByDay} label="Daily transaction volume — last 14 days" />
              <p className="text-xs text-slate-500 mt-3">Applications submitted per day. Dates shown as MM-DD.</p>
            </div>
            {/* Line chart – average processing time */}
            <div className="content-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock3 size={16} className="text-brand-primary" aria-hidden="true" />
                <h3 className="text-sm font-bold text-brand-ink">Avg. Processing Time (seconds)</h3>
              </div>
              <LineChart days={days} data={avgSecByDay} label="Average processing time in seconds — last 14 days" unit="s" />
              <p className="text-xs text-slate-500 mt-3">Average time from OR entry to clearance generation. Missing dots = no clearances issued that day.</p>
            </div>
            {/* Line chart – SLA compliance % */}
            <div className="content-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Gauge size={16} className="text-brand-primary" aria-hidden="true" />
                <h3 className="text-sm font-bold text-brand-ink">Daily SLA Compliance (%)</h3>
              </div>
              <LineChart days={days} data={withinSlaByDay} label="Percentage of clearances processed within SLA — last 14 days" unit="%" />
              <p className="text-xs text-slate-500 mt-3">Percentage of clearances issued within the {SLA_SECONDS}s SLA target per day.</p>
            </div>
            {/* Bar chart – daily satisfaction ratings average */}
            <div className="content-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Star size={16} className="text-brand-primary" aria-hidden="true" />
                <h3 className="text-sm font-bold text-brand-ink">Daily Avg. Satisfaction Rating</h3>
              </div>
              <LineChart
                days={days}
                data={days.map(d => {
                  const dayRatings = apps.filter(a => a.feedback?.submittedAt?.slice(0, 10) === d).map(a => a.feedback!.rating);
                  return dayRatings.length ? dayRatings.reduce((a, b) => a + b, 0) / dayRatings.length : null;
                })}
                label="Average satisfaction rating per day — last 14 days"
                unit="/5"
              />
              <p className="text-xs text-slate-500 mt-3">Average resident satisfaction rating (1–5) for clearances completed each day.</p>
            </div>
          </div>
        </section>
      )}

      {/* Recent activity / applications table */}
      {role === 'admin'
        ? <><h2 className="text-xl font-bold text-brand-ink mt-10 mb-5">Recent Activity</h2><ReportTable headers={['Time', 'User', 'Action', 'Reference']} rows={state.audits.slice(0, 8).map(a => [dateLabel(a.timestamp), a.user, a.action, a.reference])} /></>
        : <><h2 className="text-xl font-bold text-brand-ink mt-10 mb-5">Recent Applications</h2><ApplicationTable applications={apps.slice(0, 5)} role={role} /><div className="text-right mt-5"><Link href={'/' + role + '/applications'} className="text-sm text-brand-primary underline">View all applications →</Link></div></>
      }
    </div>
  );
}
