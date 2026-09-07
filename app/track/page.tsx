import Link from 'next/link';
import { PublicNavbar } from '@/components/PublicNavbar';
export default function TrackPage(){return <div className="min-h-screen bg-page-bg"><PublicNavbar/><main className="max-w-[720px] mx-auto px-6 py-20"><div className="content-card p-8"><h1 className="text-2xl font-bold text-brand-ink">Track Application</h1><p className="text-sm mt-2 text-slate-600">For privacy, detailed application tracking is available after login.</p><Link href="/resident/applications" className="primary-btn inline-block mt-6">Login to Track</Link></div></main></div>}
