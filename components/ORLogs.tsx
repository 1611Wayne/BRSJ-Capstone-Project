'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePortal } from './PortalProvider';
import { Field } from './Field';
import { ReportTable } from './ReportTable';
import { dateLabel } from '@/lib/workflow';
import { formatPeso } from '@/data/revenueCodeData';

type OrRecord = { id: string; reference: string; orNumber: string; orDate: string; amountPaid?: number; recordedAt: string; staff: string; action: string };

export function ORLogs() {
 const {state}=usePortal();
 const [search,setSearch]=useState('');
 const records:OrRecord[]=state.audits.flatMap(log=>{
  if(!['OR number recorded by staff','OR details recorded by staff','OR details submitted for checking','Edit Fields'].includes(log.action))return [];
  try {
   const value=JSON.parse(log.newValue||'{}');
   const receipt=value.receipt||{},orNumber=value.orNumber||receipt.orNumber;
   if(typeof orNumber!=='string'||!orNumber)return [];
   const orDate=value.orDate||receipt.orDate||'';
   const amountValue=value.amountPaid??receipt.amountPaid;
   const amountPaid=amountValue!==undefined&&amountValue!==''&&Number.isFinite(Number(amountValue))?Number(amountValue):undefined;
   if(log.action==='Edit Fields'){
    const old=JSON.parse(log.oldValue||'{}'),oldReceipt=old.receipt||{};
    if((old.orNumber||oldReceipt.orNumber)===orNumber&&(oldReceipt.orDate||old.orDate||'')===orDate&&(oldReceipt.amountPaid??old.amountPaid)===amountPaid)return [];
   }
   return [{id:log.id,reference:log.reference,orNumber,orDate,amountPaid,recordedAt:log.timestamp,staff:log.user,action:log.action}];
  } catch {return [];}
 });
 for(const a of state.applications) {
  const orNumber=a.paymentVerification?.orNumber||a.receipt?.orNumber;
  if(orNumber&&!records.some(r=>r.reference===a.reference&&r.orNumber===orNumber))records.push({id:a.reference,reference:a.reference,orNumber,orDate:a.receipt?.orDate||'',amountPaid:a.receipt?.amountPaid,recordedAt:a.paymentVerification?.checkedAt||a.receipt?.recordedAt||'',staff:a.paymentVerification?.checkedBy||a.receipt?.encodedBy||'—',action:'Recorded OR'});
 }
 const query=search.trim().toLowerCase();
 const filtered=records.filter(r=>[r.orNumber,r.orDate,r.amountPaid===undefined?'':String(r.amountPaid),r.reference,state.applications.find(a=>a.reference===r.reference)?.applicant||'',r.staff].some(value=>value.toLowerCase().includes(query))).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt));
 return <div className="p-5 md:p-8"><h1 className="text-[27px] font-bold text-brand-ink">OR Logs</h1><p className="text-sm text-slate-600 mt-2">Find recorded OR details and open their application details. Earlier entries remain available when a number changes.</p><div className="content-card p-5 mt-6"><Field label="Search OR number, date, amount, reference, applicant, or staff"><input type="search" className="text-field" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search OR details"/></Field></div><p role="status" className="text-sm text-slate-500 my-4">{filtered.length} records found</p><ReportTable headers={['OR Number','OR Date','Amount Paid','Application','Applicant','Recorded At','Recorded By','Action']} rows={filtered.map(r=>[r.orNumber,r.orDate||'—',r.amountPaid===undefined?'—':formatPeso(r.amountPaid),<Link key={r.id} href={'/staff/applications/'+r.reference} className="text-brand-primary underline">{r.reference}</Link>,state.applications.find(a=>a.reference===r.reference)?.applicant||'—',dateLabel(r.recordedAt),r.staff,r.action])}/></div>;
}
