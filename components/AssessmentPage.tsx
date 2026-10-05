'use client';
import { useState } from 'react';import Link from 'next/link';import { XCircle } from 'lucide-react';
import { usePortal } from './PortalProvider';import { Field,ErrorMessage,Notice } from './Field';import { FeeTable } from './FeeTable';import { ReportTable } from './ReportTable';import { StatusBadge } from './StatusBadge';import { DocumentPreview } from './DocumentPreview';import { revenueCategories } from '@/data/revenueCodeData';import { activeSchedule,today } from '@/lib/workflow';import type { UploadedDocument,InspectionReport } from '@/types';
export function AssessmentPage({reference}:{reference:string}){
 const {state,user,act}=usePortal();const a=state.applications.find(a=>a.reference===reference);
 const [category,setCategory]=useState(a?.assessment?.category||revenueCategories[0].name),[classification,setClassification]=useState(a?.assessment?.classification||'Small'),[error,setError]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState<UploadedDocument>();
 const [docs,setDocs]=useState(a?.documents||[]);const [inspection,setInspection]=useState<InspectionReport>(a?.inspection||{status:'Pending',inspector:'',date:'',remarks:''});
 // Reject state
 const [showReject,setShowReject]=useState(false),[rejectReason,setRejectReason]=useState('');
 if(!a)return <div className="p-8">Application Not Found</div>;const business=a.clearanceType==='Business Clearance';const current=revenueCategories.find(c=>c.name===category)!;const schedule=activeSchedule(state.schedules,a.clearanceType,business?category:'',business?classification:'');const editable=a.status==='Pending Assessment'||(a.status==='Under Review'&&!a.receipt);
 function review(next:UploadedDocument[]){try{act({type:'review',reference,documents:next});setDocs(next);setError('');}catch(e){setError((e as Error).message);}}
 return <div className="p-5 md:p-8">
  <h1 className="text-[27px] font-bold text-brand-ink">{a.clearanceType} Assessment &amp; Evaluation</h1>
  <div className="flex gap-3 mt-3 items-center"><span className="text-sm">{reference}</span><StatusBadge status={a.status}/></div>
  <ErrorMessage message={error}/>{message&&<Notice>{message}</Notice>}

  {/* Rejected banner */}
  {a.status==='Rejected'&&a.rejection&&<div className="mt-5 border border-red-200 bg-red-50 rounded-md p-4 flex gap-3"><XCircle size={20} className="text-red-600 shrink-0 mt-0.5"/><div><p className="font-semibold text-red-800 text-sm">Application Rejected</p><p className="text-xs text-red-700 mt-1">{a.rejection.reason}</p><p className="text-xs text-slate-500 mt-1">By {a.rejection.rejectedBy}</p></div></div>}

  <div className="grid xl:grid-cols-[1.25fr_1fr] gap-6 mt-7">
   <div className="space-y-6">
    <div className="content-card p-6">
     <h2 className="font-bold text-brand-ink border-b pb-3">Application Summary</h2>
     <dl className="form-grid mt-5">{Object.entries({Applicant:a.applicant,'Business Name':business?a.businessName:'—','Business / Property Location':a.businessLocation,'Application Type':a.applicationType,'Ownership Type':a.ownership,'Property Owner':a.propertyOwner||'—',...(a.hasEmployees!==undefined?{'Employees':a.hasEmployees?(a.employeeCount!=null?`Yes (${a.employeeCount})`:'Yes'):'No'}:{})}).map(([k,v])=><div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="text-sm font-semibold mt-1">{v}</dd></div>)}</dl>
    </div>
    <div className="content-card p-6">
     <h2 className="font-bold text-brand-ink mb-4">Requirements Review</h2>
     <ReportTable headers={['Document','Status','Action']} rows={docs.map((d,i)=>[d.requirement,<select key="status" aria-label={d.requirement+' review status'} disabled={!editable} className="select-field !text-xs" value={d.status} onChange={e=>review(docs.map((x,j)=>i===j?{...x,status:e.target.value as UploadedDocument['status']}:x))}>{['Verified','Missing','Needs Replacement'].map(s=><option key={s}>{s}</option>)}</select>,<button key="view" className="text-brand-primary underline" onClick={()=>setPreview(d)}>View</button>])}/>
    </div>
    <form className="content-card p-6" onSubmit={e=>{e.preventDefault();try{act({type:'inspection',reference,report:inspection});setMessage('Inspection report saved.');setError('');}catch(e){setError((e as Error).message);}}}>
     <h2 className="font-bold text-brand-ink border-b pb-3">Inspection Report</h2>
     <div className="form-grid mt-4">
      <Field label="Inspection Status"><select className="select-field" value={inspection.status} onChange={e=>setInspection({...inspection,status:e.target.value as InspectionReport['status']})}><option>Pending</option><option>Completed</option></select></Field>
      <Field label="Name of Inspector"><input className="text-field" required={inspection.status==='Completed'} value={inspection.inspector} onChange={e=>setInspection({...inspection,inspector:e.target.value})}/></Field>
      <Field label="Date Inspected"><input type="date" className="text-field" max={today()} required={inspection.status==='Completed'} value={inspection.date} onChange={e=>setInspection({...inspection,date:e.target.value})}/></Field>
      <Field label="Remarks"><textarea className="textarea-field" value={inspection.remarks} onChange={e=>setInspection({...inspection,remarks:e.target.value})}/></Field>
     </div>
     <button disabled={a.status==='Void'||a.status==='Rejected'} className="secondary-btn mt-4">Save Inspection Report</button>
    </form>
   </div>

   <div className="content-card p-6 h-fit">
    <h2 className="font-bold text-brand-ink border-b pb-3">Assessment Information</h2>
    {business&&<div className="space-y-4 mt-4">
     <Field label="Business Category *"><select disabled={!editable} className="select-field" value={category} onChange={e=>{setCategory(e.target.value);setClassification(revenueCategories.find(c=>c.name===e.target.value)?.classifications?.[0].name||'');}}>{revenueCategories.map(c=><option key={c.name}>{c.name}</option>)}</select></Field>
     {current.classifications&&<Field label="Classification / Scale *"><select disabled={!editable} value={classification} className="select-field" onChange={e=>setClassification(e.target.value)}>{current.classifications.map(c=><option key={c.name}>{c.name}</option>)}</select></Field>}
    </div>}
    <div className="mt-6"><FeeTable items={a.assessment&&!editable?a.assessment.items:schedule?.items||[]}/></div>
    <p className="text-xs mt-4 text-slate-500">Sample fee schedule. Standard fees are retrieved automatically from the effective configuration.</p>
    <p className="text-sm mt-5">Assessed By: <strong>{a.assessment?.assessedBy||user?.firstName+' '+user?.lastName}</strong></p>

    <button disabled={!editable||!schedule} className="primary-btn w-full mt-5" onClick={()=>{try{act({type:'assess',reference,category:business?category:'',classification:business?classification:''});setMessage('Assessment confirmed. Status: Awaiting OR. The resident can now access the Pre-Assessment Slip.');setError('');}catch(e){setError((e as Error).message);}}}>Confirm Assessment</button>

    {/* Reject Button */}
    {editable&&!showReject&&<button type="button" className="w-full mt-3 flex items-center justify-center gap-2 border border-red-300 text-red-700 hover:bg-red-50 transition-colors rounded px-4 py-2 text-sm font-semibold" onClick={()=>setShowReject(true)}><XCircle size={16}/>Reject Application</button>}

    {/* Inline rejection form */}
    {showReject&&<div className="mt-3 border border-red-200 bg-red-50 rounded-md p-4">
     <p className="text-sm font-semibold text-red-800 mb-2">Reject this application</p>
     <Field label="Reason for Rejection *"><textarea className="textarea-field min-h-[70px]" placeholder="State the reason clearly so the resident can address it." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/></Field>
     <div className="flex gap-2 mt-3">
      <button type="button" className="secondary-btn flex-1" onClick={()=>{setShowReject(false);setRejectReason('');}}>Cancel</button>
      <button type="button" className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded px-4 py-2 text-sm font-semibold transition-colors" onClick={()=>{try{act({type:'reject',reference,reason:rejectReason});setShowReject(false);setMessage('Application has been rejected.');setError('');}catch(e){setError((e as Error).message);}}}disabled={!rejectReason.trim()}>Confirm Rejection</button>
     </div>
    </div>}

    <Link href={'/staff/applications/'+reference} className="text-sm underline block mt-4">View transaction details</Link>
   </div>
  </div>
  {preview&&<DocumentPreview document={preview} onClose={()=>setPreview(undefined)}/>}
 </div>;
}
