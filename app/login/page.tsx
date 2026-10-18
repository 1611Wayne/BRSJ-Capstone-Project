'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { usePortal } from '@/components/PortalProvider';
import { Field, ErrorMessage } from '@/components/Field';
import { PasswordInput } from '@/components/PasswordInput';
import { useSupabaseAuth } from '@/lib/supabase/config';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { PortalState, User } from '@/types';

// Real sign-in: Supabase checks the password, then /api/me reads the role from the database.
async function signInWithSupabase(email: string, password: string): Promise<User> {
  const supabase = supabaseBrowser();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(/invalid login credentials/i.test(error.message) ? 'The email or password is incorrect.' : /email not confirmed/i.test(error.message) ? 'Please confirm your email first, using the link we sent you.' : error.message);
  const response = await fetch('/api/me', { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { await supabase.auth.signOut(); throw new Error(body.error || 'Could not load your account.'); }
  return body.user as User;
}

export default function LoginPage(){
 const router=useRouter(),query=useSearchParams();const {act}=usePortal();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function submit(f:FormData){
  setError('');setBusy(true);
  try{
   const email=String(f.get('email')),password=String(f.get('password'));
   const s:PortalState=useSupabaseAuth?act({type:'sessionUser',user:await signInWithSupabase(email,password)}):act({type:'login',email,password});
   const user=s.users.find(u=>u.id===s.currentUserId)!;const next=query.get('next');router.push(next?.startsWith('/'+user.role+'/')?next:'/'+user.role+'/dashboard');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="min-h-screen bg-page-bg flex items-start justify-center pt-[60px] px-4"><form className="content-card w-full max-w-[325px] px-9 py-9" onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}>
 <div className="text-center"><h1 className="text-[25px] font-bold text-brand-ink">Login</h1><p className="text-xs text-slate-600 mt-3">Access your Barangay San Jose account.</p></div>
 <div className="mt-8 space-y-4"><Field label="Email or Username"><input name="email" autoComplete="username" required className="text-field" placeholder="Enter your email or username"/></Field><Field label="Password"><PasswordInput name="password" autoComplete="current-password" required placeholder="Enter your password"/></Field></div>
 <ErrorMessage message={error}/><button className="primary-btn w-full mt-6" disabled={busy}>{busy?'Signing in…':'Login'}</button><Link href="/" className="secondary-btn w-full mt-3 block text-center">Back to Home</Link><p className="text-xs text-center mt-8">Don&apos;t have an account? <Link href="/register" className="underline text-brand-primary">Register</Link></p><p className="text-xs text-center mt-4 text-slate-500"><Link href="/information#privacy" className="underline">Privacy Notice</Link></p>
 </form></div>;
}
