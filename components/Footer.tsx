import Link from 'next/link';
import { Brand } from './Brand';
import { BarangayLocationLink } from './BarangayLocationLink';
import { Clock, Info } from 'lucide-react';

export function Footer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <footer className="public-footer bg-brand-nav text-brand-ink mt-auto">
        <div className="max-w-[1100px] mx-auto px-6 md:px-10 py-6 flex flex-col sm:flex-row items-center justify-between gap-5">
          <Brand compact />
          <nav aria-label="Policy links" className="flex flex-wrap justify-center gap-6 text-xs underline underline-offset-2">
            <Link href="/information#privacy">Privacy Policy</Link>
            <Link href="/information#terms">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    );
  }

  return (
    <footer className="public-footer bg-brand-nav text-brand-ink mt-auto">
      <div className="max-w-[1100px] mx-auto px-10 py-10 grid gap-8 md:grid-cols-[1.15fr_.75fr_1fr] text-[12px]">
        <div>
          <Brand compact />
          <p className="mt-4">Barangay Hall, San Jose, Rodriguez, Rizal</p>
          <BarangayLocationLink className="mt-3" />
          <p className="mt-3 flex items-center gap-2 text-[11px]"><Clock size={13}/> Monday - Friday: 8:00 AM - 5:00 PM</p>
        </div>
        <div>
          <p className="font-bold text-brand-ink tracking-wide mb-4">INFORMATION</p>
          <div className="space-y-3 underline underline-offset-2">
            <Link href="/information#contact">Contact Us</Link><br/>
            <Link href="/information#hours">Office Hours</Link><br/>
            <Link href="/information#privacy">Privacy Policy</Link><br/>
            <Link href="/information#terms">Terms of Service</Link>
          </div>
        </div>
        <div>
          <p className="font-bold text-brand-ink tracking-wide mb-4">PAYMENTS</p>
          <div className="border border-brand-gold bg-brand-nav-soft p-4 flex gap-3">
            <Info size={18} className="shrink-0 mt-0.5" />
            <p><strong>Note:</strong> Payments are made at the Municipal Treasury. The portal does not collect payments or issue Official Receipts.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
