import type { Metadata } from 'next';
import './globals.css';
import { PortalProvider } from '@/components/PortalProvider';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Barangay San Jose Clearance Portal',
  description: 'Frontend prototype for Barangay San Jose clearance services',
  icons: {
    icon: { url: '/barangaylogo.png', type: 'image/png' },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PortalProvider><Suspense fallback={<p className="p-8">Loading portal…</p>}>{children}</Suspense></PortalProvider></body>
    </html>
  );
}
