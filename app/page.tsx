import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ChevronDown, ClipboardList, Clock3, Download, FileCheck2, FileText, Info, Landmark, ListChecks, MapPin, Search, Upload, Monitor } from 'lucide-react';
import { PublicNavbar } from '@/components/PublicNavbar';
import { Footer } from '@/components/Footer';
import { BarangayLocationLink } from '@/components/BarangayLocationLink';
import { ClearanceCard } from '@/components/ClearanceCard';
import { clearanceTypes } from '@/data/clearanceTypes';
import { applicationSteps, homepageFAQs, portalBenefits } from '@/data/homepageContent';

const stepIcons = [ClipboardList, Upload, Landmark, Download];
const benefitIcons = [Monitor, ListChecks, Search, FileCheck2];

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-page-bg">
      <PublicNavbar />
      <main className="flex-1">
        <section className="max-w-[1200px] mx-auto px-6 md:px-12 py-12 md:py-[86px] grid md:grid-cols-[0.9fr_1.1fr] items-center gap-10 lg:gap-12 min-h-[530px]">
          <div>
            <h1 className="text-[34px] lg:text-[39px] leading-[1.08] font-bold text-brand-ink max-w-[450px]">Apply for Barangay<br/><span className="text-brand-primary">Clearances Online</span></h1>
            <p className="mt-6 text-[14px] leading-6 text-slate-700 max-w-[430px]">Quickly apply for any of our 13 clearance types from the comfort of your home. A streamlined, transparent civic service.</p>
            <div className="flex flex-wrap gap-3 mt-10">
              <Link href="/resident/apply" className="primary-btn">Apply Now</Link>
              <Link href="/track" className="secondary-btn">Track My Application</Link>
            </div>
          </div>
          <figure className="relative justify-self-center w-full max-w-[560px]">
            <div className="relative overflow-hidden rounded-2xl bg-white shadow-[0_18px_40px_rgba(99,50,15,0.18)]">
              <Image src="/cityhall.jpg" width={560} height={420} sizes="(max-width: 767px) calc(100vw - 48px), (max-width: 1199px) 51vw, 560px" alt="Barangay San Jose Government Center" className="block w-full h-auto object-cover" priority />
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-2xl border-[5px] border-brand-accent" />
            </div>
          </figure>
        </section>
        <section aria-labelledby="how-it-works-heading" className="border-t border-slate-200 bg-white py-14">
          <div className="max-w-[1000px] mx-auto px-6 md:px-8">
            <div className="text-center mb-9">
              <h2 id="how-it-works-heading" className="text-[25px] font-bold text-brand-ink">How It Works</h2>
              <p className="text-sm mt-2 text-slate-600">Your clearance request, from application to download.</p>
            </div>
            <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {applicationSteps.map((step, index) => {
                const Icon = stepIcons[index];
                return <li key={step.title} className="border-t-2 border-brand-border pt-5">
                  <div className="flex items-center justify-between mb-5">
                    <span className="w-9 h-9 rounded-full bg-brand-accent text-brand-ink grid place-items-center text-sm font-bold" aria-hidden="true">{index + 1}</span>
                    <Icon size={23} className="text-brand-primary" aria-hidden="true" />
                  </div>
                  <h3 className="text-base font-bold text-brand-ink">{step.title}</h3>
                  <p className="text-sm leading-6 text-slate-600 mt-2">{step.description}</p>
                </li>;
              })}
            </ol>
          </div>
        </section>
        <section id="available-clearances" aria-labelledby="clearances-heading" className="border-t border-slate-200 py-14 bg-page-bg">
          <div className="max-w-[1000px] mx-auto px-8">
            <div className="text-center mb-10"><h2 id="clearances-heading" className="text-[25px] font-bold text-brand-ink">Available Clearances</h2><p className="text-sm mt-2 text-slate-700">Select a clearance type to view requirements and begin your application.</p></div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {clearanceTypes.map((item) => <ClearanceCard key={item.id} item={item} compact />)}
            </div>
          </div>
        </section>
        <section aria-labelledby="benefits-heading" className="border-t border-slate-200 bg-white py-14">
          <div className="max-w-[1000px] mx-auto px-6 md:px-8">
            <div className="text-center mb-9">
              <h2 id="benefits-heading" className="text-[25px] font-bold text-brand-ink">Why Use the Portal?</h2>
              <p className="text-sm mt-2 text-slate-600">Manage each stage of your clearance request in one place.</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {portalBenefits.map((benefit, index) => {
                const Icon = benefitIcons[index];
                return <Link key={benefit.title} href={benefit.href} className="group content-card p-5 hover:border-brand-primary transition-colors">
                  <Icon size={25} className="text-brand-primary mb-5" aria-hidden="true" />
                  <h3 className="text-base font-bold text-brand-ink flex items-center justify-between gap-2">{benefit.title}<ArrowRight size={15} className="shrink-0" aria-hidden="true" /></h3>
                  <p className="text-sm leading-6 text-slate-600 mt-2">{benefit.description}</p>
                </Link>;
              })}
            </div>
          </div>
        </section>
        <section aria-labelledby="tracking-heading" className="max-w-[1000px] mx-auto px-6 md:px-8 pt-14">
          <div className="border border-brand-border border-l-4 border-l-brand-primary bg-brand-soft p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 rounded-[4px]">
            <div className="flex items-start gap-4">
              <Search size={27} className="text-brand-ink shrink-0 mt-1" aria-hidden="true" />
              <div><h2 id="tracking-heading" className="text-[23px] font-bold text-brand-ink">Track Your Application</h2><p className="text-sm leading-6 text-slate-600 mt-2 max-w-[510px]">Already submitted a request? Log in to view its current status, check your assessment, and see your next step.</p></div>
            </div>
            <Link href="/track" className="primary-btn text-center shrink-0">Track Application</Link>
          </div>
        </section>
        <section aria-labelledby="notice-heading" className="max-w-[1000px] mx-auto px-6 md:px-8 py-8">
          <div className="border border-amber-200 bg-amber-50 p-5 flex gap-4 rounded-[4px]">
            <Info size={23} className="text-amber-800 shrink-0 mt-0.5" aria-hidden="true" />
            <div><h2 id="notice-heading" className="text-base font-bold text-amber-950">Important Notice</h2><p className="text-sm leading-6 text-amber-950 mt-1">Payments are made at the Municipal Treasury. The portal does not collect payments or issue Official Receipts.</p><p className="text-sm leading-6 text-amber-900 mt-2">Bring your Pre-Assessment Slip when paying, then enter your Treasury-issued OR details in the portal.</p></div>
          </div>
        </section>
        <section id="faq" aria-labelledby="faq-heading" className="max-w-[1000px] mx-auto px-6 md:px-8 pt-6 pb-14">
          <div className="text-center mb-9"><h2 id="faq-heading" className="text-[25px] font-bold text-brand-ink">Frequently Asked Questions</h2><p className="text-sm mt-2 text-slate-600">Help with requirements, assessment, payment, and downloads.</p></div>
          <div className="content-card divide-y divide-slate-200 overflow-hidden">
            {homepageFAQs.map(faq => <details key={faq.id} id={faq.id} className="home-faq scroll-mt-6">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-4 px-5 md:px-6 py-5 text-sm sm:text-base font-semibold text-brand-ink hover:bg-slate-50 focus-visible:outline-offset-[-3px]">
                {faq.question}<ChevronDown size={19} className="home-faq-chevron shrink-0" aria-hidden="true" />
              </summary>
              <p className="px-5 md:px-6 pb-5 text-sm leading-6 text-slate-600 max-w-[850px]">{faq.answer}</p>
            </details>)}
          </div>
        </section>
        <section aria-labelledby="office-heading" className="border-t border-slate-200 bg-white py-14">
          <div className="max-w-[1000px] mx-auto px-6 md:px-8">
            <h2 id="office-heading" className="text-[25px] font-bold text-brand-ink text-center mb-9">Office Information</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="flex gap-4"><MapPin size={23} className="text-brand-primary shrink-0" aria-hidden="true" /><div><h3 className="text-base font-bold text-brand-ink">Visit the Barangay Hall</h3><address className="text-sm leading-6 text-slate-600 mt-2 not-italic">Barangay San Jose<br />Rodriguez, Rizal</address><BarangayLocationLink className="mt-3 text-brand-primary" /></div></div>
              <div className="flex gap-4"><Clock3 size={23} className="text-brand-primary shrink-0" aria-hidden="true" /><div><h3 className="text-base font-bold text-brand-ink">Office Hours</h3><p className="text-sm leading-6 text-slate-600 mt-2">Monday–Friday<br />8:00 AM–5:00 PM</p></div></div>
              <div className="flex gap-4"><FileText size={23} className="text-brand-primary shrink-0" aria-hidden="true" /><div><h3 className="text-base font-bold text-brand-ink">Need Assistance?</h3><p className="text-sm leading-6 text-slate-600 mt-2">Visit the office for help with your request. Have your application reference ready.</p><Link href="/information#contact" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-primary underline mt-3">Contact Us<ArrowRight size={14} aria-hidden="true" /></Link></div></div>
            </div>
          </div>
        </section>
      </main>
      <Footer compact />
    </div>
  );
}
