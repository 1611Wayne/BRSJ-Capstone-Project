import type { ApplicationStatus } from '@/types';

const styles: Record<ApplicationStatus, string> = {
  'Draft': 'bg-slate-100 text-slate-700',
  'Pending Assessment': 'bg-amber-100 text-amber-800',
  'Awaiting OR': 'bg-blue-100 text-blue-800',
  'Ready for Download': 'bg-cyan-100 text-cyan-800',
  'Closed - Cleared': 'bg-green-100 text-green-800',
  'Under Review': 'bg-orange-100 text-orange-800',
  'Void': 'bg-red-100 text-red-700',
  'Rejected': 'bg-red-700 text-white',
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-semibold ${styles[status]}`}>{status}</span>;
}
