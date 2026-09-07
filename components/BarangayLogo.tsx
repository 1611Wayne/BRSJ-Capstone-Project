import Image from 'next/image';

export function BarangayLogo({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <Image
      src="/barangaylogo.png"
      alt="Barangay San Jose logo"
      width={size}
      height={size}
      sizes={`${size}px`}
      className={`shrink-0 rounded-full bg-white object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
