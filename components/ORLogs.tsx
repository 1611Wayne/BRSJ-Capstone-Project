'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePortal } from './PortalProvider';
import { Field } from './Field';
import { ReportTable } from './ReportTable';
import { dateLabel } from '@/lib/workflow';

export function ORLogs() {
 const {state}=usePortal();
 const [search,setSearch]=useState('');
 const records=state.audits.flatMap(log=>{
  if(!['OR number recorded by staff','OR details submitted for checking','Edit Fields'].includes(log.action))return [];
  try {
   const value=JSON.parse(log.newValue||'{}');
   if(typeof value.orNumber!=='string'||!value.orNumber)return [];
   if(log.action==='Edit Fields'&&JSON.parse(log.oldValue||'{}').orNumber===value.orNumber)return [];
   return [{id:log.id,reference:log.reference,orNumber:value.orNumber as string,recordedAt:log.timestamp,staff:log.user,action:log.action}];
  } catch {return [];}
 });
 for(const a of state.applications) {
  const orNumber=a.paymentVerification?.orNumber||a.receipt?.orNumber;
  if(orNumber&&!records.some(r=>r.reference===a.reference&&r.orNumber===orNumber))records.push({id:a.reference,reference:a.reference,orNumber,recordedAt:a.paymentVerification?.checkedAt||a.receipt?.recordedAt||'',staff:a.paymentVerification?.checkedBy||a.receipt?.encodedBy||'—',action:'Recorded OR'});
 }
 const query=search.trim().toLowerCase();
 const filtered=records.filter(r=>[r.orNumber,r.reference,state.applications.find(a=>a.reference===r.reference)?.applicant||'',r.staff].some(value=>value.toLowerCase().includes(query))).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt));
 return <div className="p-5 md:p-8"><h1 className="text-[27px] font-bold text-brand-ink">OR Logs</h1><p className="text-sm text-slate-600 mt-2">Find recorded OR numbers and open their application details. Earlier entries remain available when a number changes.</p><div className="content-card p-5 mt-6"><Field label="Search OR number, application reference, applicant, or staff"><input type="search" className="text-field" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Enter an OR number"/></Field></div><p role="status" className="text-sm text-slate-500 my-4">{filtered.length} records found</p><ReportTable headers={['OR Number','Application','Applicant','Recorded At','Recorded By','Action']} rows={filtered.map(r=>[r.orNumber,<Link key={r.id} href={'/staff/applications/'+r.reference} className="text-brand-primary underline">{r.reference}</Link>,state.applications.find(a=>a.reference===r.reference)?.applicant||'—',dateLabel(r.recordedAt),r.staff,r.action])}/></div>;
}
