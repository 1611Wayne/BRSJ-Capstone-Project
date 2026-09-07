import { BarangayLogo } from './BarangayLogo';

export function Brand({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <div className={`flex items-center gap-2 font-bold ${inverse ? 'text-white' : 'text-brand-ink'}`}>
      <BarangayLogo size={compact ? 32 : 40} />
      <span className={compact ? 'text-[18px]' : 'text-xl'}>San Jose</span>
    </div>
  );
}
