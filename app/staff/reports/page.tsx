import Link from 'next/link';
import { CalendarRange, ReceiptText } from 'lucide-react';

const cards = [
  ['Monthly Collection Report', 'View monthly transaction counts and recorded assessment/OR totals.', '/staff/reports/monthly-collection', CalendarRange],
  ['Daily OR Summary', 'Review Official Receipt records entered for a selected date.', '/staff/reports/daily-or', ReceiptText],
] as const;

export default function StaffReportsPage() {
  return <div className="p-5 md:p-8">
    <h1 className="text-[27px] font-bold text-brand-ink">Reports</h1>
    <p className="text-[13px] mt-1 text-slate-600">Generate and export collection and Official Receipt reports.</p>
    <div className="grid md:grid-cols-2 gap-5 mt-8">{cards.map(([title, description, href, Icon]) =>
      <div key={title} className="content-card p-6"><Icon size={26} className="text-brand-primary"/>
        <h2 className="font-bold text-[17px] mt-5">{title}</h2><p className="text-xs text-slate-600 mt-2 leading-5">{description}</p>
        <Link href={href} className="secondary-btn inline-block mt-6">View Report</Link>
      </div>)}</div>
  </div>;
}
