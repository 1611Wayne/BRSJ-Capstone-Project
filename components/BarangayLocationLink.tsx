import { ArrowUpRight } from 'lucide-react';

export function BarangayLocationLink({ className = '' }: { className?: string }) {
  return (
    <a
      href="https://maps.app.goo.gl/HxGQJ6w6XaUZHvAb6"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-2 ${className}`}
    >
      View on Google Maps
      <ArrowUpRight size={16} aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
