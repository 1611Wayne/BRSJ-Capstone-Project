import { PublicNavbar } from '@/components/PublicNavbar';
import { Footer } from '@/components/Footer';
import { ClearanceCard } from '@/components/ClearanceCard';
import { clearanceTypes } from '@/data/clearanceTypes';

export default function ClearanceTypesPage() {
  return <div className="min-h-screen flex flex-col bg-page-bg">
    <PublicNavbar />
    <main className="flex-1 max-w-[1100px] mx-auto w-full px-6 md:px-12 py-16">
      <h1 className="text-[28px] font-bold text-brand-ink">Choose a Clearance Type to Apply For</h1>
      <p className="text-[13px] leading-6 mt-2 max-w-[650px] text-slate-700">Select the type of clearance you need. Requirements and processing times may vary based on your selection.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
        {clearanceTypes.map((item) => <ClearanceCard key={item.id} item={item} />)}
      </div>
    </main>
    <Footer />
  </div>
}
