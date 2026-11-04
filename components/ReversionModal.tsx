'use client';
import { useState } from 'react';
import { Modal } from './Modal';
import { Field, ErrorMessage } from './Field';
import { StatusBadge } from './StatusBadge';
import { usePortal } from './PortalProvider';
import { clearanceTypes } from '@/data/clearanceTypes';
import { formatPeso } from '@/data/revenueCodeData';
import { activeSchedule } from '@/lib/workflow';
import type { Application, ReversionAction, TransactionReversion } from '@/types';

export function ReversionModal({application:a,onClose,onConfirm}:{application:Application;onClose:()=>void;onConfirm:(data:TransactionReversion)=>void}) {
 const {state}=usePortal();
 const [action,setAction]=useState<ReversionAction>('Edit Fields'),[reason,setReason]=useState(''),[applicant,setApplicant]=useState(a.applicant),[businessName,setBusinessName]=useState(a.businessName),[orNumber,setOrNumber]=useState(a.receipt?.orNumber||''),[error,setError]=useState('');
 const [clearanceType,setClearanceType]=useState(a.clearanceType),[editFees,setEditFees]=useState(false),[scheduleId,setScheduleId]=useState(a.assessment?.scheduleId||'');
 const [feeDraft,setFeeDraft]=useState<{scheduleId:string;amounts:string[]}>();
 const schedules=state.schedules.filter(s=>s.clearanceType===clearanceType&&activeSchedule(state.schedules,clearanceType,s.category,s.classification)?.id===s.id);
 const schedule=schedules.find(s=>s.id===scheduleId)||schedules.find(s=>s.category===a.assessment?.category&&s.classification===a.assessment?.classification)||schedules[0];
 const correctingFees=editFees||clearanceType!==a.clearanceType;
 const amounts=schedule?(feeDraft?.scheduleId===schedule.id?feeDraft.amounts:a.assessment?.scheduleId===schedule.id?a.assessment.items.map(item=>item.amount.toFixed(2)):schedule.items.map(item=>item.amount.toFixed(2))):[];
 const validAmounts=!!schedule&&amounts.length===schedule.items.length&&amounts.every(value=>/^\d+(\.\d{1,2})?$/.test(value)&&Number.isSafeInteger(Math.round(Number(value)*100)));
 const totalCents=amounts.reduce((sum,value)=>sum+Math.round(Number(value)*100),0);
 return <Modal title="Transaction Reversion" onClose={onClose}>
  <dl className="form-grid text-xs mt-5">{Object.entries({'Reference No.':a.reference,Applicant:a.applicant,'Clearance Type':a.clearanceType,'Staff Encoder':a.staffEncoder||'Resident self-service'}).map(([k,v])=><div key={k}><dt className="text-slate-500">{k}</dt><dd className="font-semibold mt-1">{v}</dd></div>)}</dl>
  <div className="text-xs mt-3">Current Status: <StatusBadge status={a.status}/></div>
  <form className="mt-5 space-y-4" onSubmit={e=>{e.preventDefault();try{onConfirm({reference:a.reference,action,reason,applicant,businessName,orNumber,clearanceType,...(action==='Edit Fields'&&correctingFees&&schedule?{feeAssessment:{scheduleId:schedule.id,amounts:amounts.map(Number)}}:{})});onClose();}catch(e){setError((e as Error).message);}}}>
   <Field label="Select Action *"><select className="select-field" value={action} onChange={e=>setAction(e.target.value as ReversionAction)}><option>Edit Fields</option><option>Void Transaction</option><option>Mark Under Review</option></select></Field>
   <Field label="Reason for Reversion *"><textarea className="textarea-field min-h-[90px]" value={reason} required onChange={e=>setReason(e.target.value)}/></Field>
   {action==='Edit Fields'&&<div className="space-y-4">
    <Field label="Applicant Name *"><input required className="text-field" value={applicant} onChange={e=>setApplicant(e.target.value)}/></Field>
    <Field label="Clearance Type *"><select className="select-field" value={clearanceType} onChange={e=>{setClearanceType(e.target.value);setScheduleId('');setFeeDraft(undefined);}}>{clearanceTypes.map(type=><option key={type.id}>{type.name}</option>)}</select></Field>
    {clearanceType==='Business Clearance'&&<Field label="Business Name"><input className="text-field" value={businessName} onChange={e=>setBusinessName(e.target.value)}/></Field>}
    {a.receipt&&<Field label="OR Number *"><input required className="text-field" value={orNumber} onChange={e=>setOrNumber(e.target.value)}/></Field>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={correctingFees} disabled={clearanceType!==a.clearanceType} onChange={e=>setEditFees(e.target.checked)}/>Correct fee assessment</label>
    {correctingFees&&<div className="space-y-4">
     <Field label="Fee Schedule *"><select required className="select-field" value={schedule?.id||''} onChange={e=>{setScheduleId(e.target.value);setFeeDraft(undefined);}}>{!schedule&&<option value="">No effective fee schedule available</option>}{schedules.map(s=><option key={s.id} value={s.id}>{[s.clearanceType,s.category,s.classification].filter(Boolean).join(' / ')}</option>)}</select></Field>
     {schedule&&<>{schedule.items.map((item,index)=><Field key={schedule.id+'-'+index} label={item.name+' amount *'}><input type="number" min="0" step="0.01" required className="text-field" value={amounts[index]} onChange={e=>setFeeDraft({scheduleId:schedule.id,amounts:amounts.map((value,i)=>i===index?e.target.value:value)})}/></Field>)}<p className="text-sm font-semibold" aria-live="polite">Total Assessment: {validAmounts&&Number.isSafeInteger(totalCents)?formatPeso(totalCents/100):'Enter valid amounts'}</p></>}
     <p className="text-xs text-slate-600">Changing the clearance type or fees returns this request to Pending Assessment. Staff must check the required documents, confirm the corrected assessment, and verify payment again before release. The existing receipt is retained for reference.</p>
    </div>}
   </div>}
   <ErrorMessage message={error}/>
   <div className="flex justify-end gap-2"><button className="secondary-btn" type="button" onClick={onClose}>Cancel</button><button className="primary-btn" disabled={!reason.trim()||(action==='Edit Fields'&&correctingFees&&(!validAmounts||!Number.isSafeInteger(totalCents)))}>Confirm Reversion</button></div>
  </form>
 </Modal>;
}
