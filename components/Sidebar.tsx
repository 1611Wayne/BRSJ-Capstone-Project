'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { LayoutDashboard, FileText, FolderOpen, User, LogOut, ClipboardList, ReceiptText, BarChart3, Settings, Undo2, Users, History, UserPlus, Menu, X } from 'lucide-react';
import type { UserRole } from '@/types';
import { usePortal } from './PortalProvider';
import { BarangayLogo } from './BarangayLogo';
const menus={
 resident:[['dashboard','Dashboard',LayoutDashboard],['apply','Apply for Clearance',FileText],['applications','My Applications',FolderOpen],['profile','Profile',User]],
 staff:[['dashboard','Dashboard',LayoutDashboard],['applications','Applications Queue',ClipboardList],['assessment','Assessment & Evaluation',FileText],['walk-in','New Walk-in Application',UserPlus],['or-entry','Assist OR Entry',ReceiptText],['transactions','Processed Transactions',History]],
 admin:[['dashboard','Dashboard',LayoutDashboard],['transactions','Transactions',ClipboardList],['fee-configuration','Fee Configuration',Settings],['transaction-reversion','Transaction Reversion',Undo2],['reports','Reports',BarChart3],['users','User Management',Users],['audit-trail','Audit Trail',History]]
} as const;
export function Sidebar({role}:{role:UserRole}) {
 const pathname=usePathname(), router=useRouter(); const {act}=usePortal(); const [open,setOpen]=useState(false);
 function logout(){act({type:'logout'});router.push('/login');}
 return <><button aria-label="Open navigation" aria-expanded={open} className="mobile-nav-toggle primary-btn" onClick={()=>setOpen(true)}><Menu size={20}/></button>{open&&<button aria-label="Close navigation" className="mobile-nav-backdrop" onClick={()=>setOpen(false)}/>}<aside className={`portal-sidebar ${open?'is-open':''} sidebar-dark`}><div className={`px-5 border-b py-6 border-brand-gold`}><button aria-label="Close navigation" className="md:hidden float-right" onClick={()=>setOpen(false)}><X size={18}/></button>{role==='resident'?<><div className="flex items-center gap-2 font-bold text-lg"><BarangayLogo size={32}/>San Jose</div><p className="text-xs mt-1">Clearance Portal</p></>:<div className="text-center"><div className="w-12 h-12 grid place-items-center mx-auto mb-3 rounded-md bg-white text-brand-ink border border-slate-200"><BarangayLogo size={44}/></div><p className="text-lg font-bold">{role==='staff'?'San Jose Staff':'Admin Portal'}</p><p className="text-xs mt-1">{role==='staff'?'Official Portal':'San Jose Government'}</p></div>}</div><nav aria-label={role+' navigation'} className="p-2 space-y-1">{menus[role].map(([slug,label,Icon])=>{const href='/'+role+'/'+slug;const active=pathname.startsWith(href);return <Link onClick={()=>setOpen(false)} key={href} href={href} aria-current={active?'page':undefined} className={`flex items-center gap-3 px-3 py-3 text-xs font-semibold ${active?'bg-brand-gold-soft text-brand-ink':'hover:bg-brand-gold-soft'}`}><Icon className="shrink-0" size={16}/>{label}</Link>})}</nav><div className="sidebar-logout mt-auto p-4 border-t border-current/10"><button className="flex items-center gap-3 text-xs font-semibold w-full p-2" onClick={logout}><LogOut size={17}/>Logout</button></div></aside></>;
}
