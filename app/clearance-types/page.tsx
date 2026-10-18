import { PublicNavbar } from '@/components/PublicNavbar';
import { Footer } from '@/components/Footer';
import { ClearanceCard } from '@/components/ClearanceCard';
import { getClearanceTypes } from '@/lib/clearanceTypesSource';

// Read from the database on each request (falls back to the sample list when Supabase is not configured).
export const dynamic = 'force-dynamic';

export default async function ClearanceTypesPage() {
  const { types: clearanceTypes, source } = await getClearanceTypes();
  return <div className="min-h-screen flex flex-col bg-page-bg" data-source={source}>
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
