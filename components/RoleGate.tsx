'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePortal } from './PortalProvider';
import type { UserRole } from '@/types';
export function RoleGate({role,children}:{role:UserRole;children:React.ReactNode}) {
  const {user,ready} = usePortal(); const router = useRouter(); const path = usePathname();
  useEffect(() => { if (ready && !user) router.replace('/login?next=' + encodeURIComponent(path + window.location.search)); },[ready,user,router,path]);
  if (!ready || !user) return <p className="p-8" role="status">Opening your account…</p>;
  if (user.role !== role) return <div className="content-card m-8 p-8"><h1 className="text-xl font-bold">This area is for {role} accounts</h1><Link className="primary-btn inline-block mt-5" href={`/${user.role}/dashboard`}>Return to my dashboard</Link></div>;
  return <>{children}</>;
}
