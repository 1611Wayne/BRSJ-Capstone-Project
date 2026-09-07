require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transition, requirements, validateOR, validFile, activeSchedule } = require('../lib/workflow.ts');
const { mockApplications } = require('../data/mockApplications.ts');
const { mockUsers } = require('../data/mockUsers.ts');
const { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const { monthlyRows, processingSeconds } = require('../data/mockReports.ts');
const { clearanceTypes } = require('../data/clearanceTypes.ts');
const { makePDF } = require('../lib/downloads.ts');
const state = (id = 'resident-maria') => structuredClone({users:mockUsers,applications:mockApplications,schedules:mockFeeSchedules,audits:[],currentUserId:id});
const at = '2026-09-07T02:30:12.000Z', ref = 'SJ-2026-000123';
const app = s => s.applications.find(a=>a.reference===ref);
const role = (s,id) => ({...s,currentUserId:id});
const assess = s => transition(role(s,'staff-maria'),{type:'assess',reference:ref,category:'Sari-Sari Store',classification:'Medium'},at);
const or = s => transition(role(s,'resident-maria'),{type:'or',reference:ref,number:'TR-2026-54321',date:'2026-09-06',amount:'600.00'},at);
test('exactly thirteen supported clearance types',()=>{
 assert.equal(clearanceTypes.length,13);
 assert.equal(new Set(clearanceTypes.map(c=>c.name)).size,13);
 assert.deepEqual(clearanceTypes.map(c=>c.name),['Business Clearance','Building Clearance','Electrical Clearance','Fencing Clearance','Excavation Clearance','Lot Survey Clearance','Water/MWSS Clearance','PODA Clearance','TODA Clearance','Ambulant Clearance','Lessor (Paupahan) Clearance','Film Shooting Clearance','Products Promo Clearance']);
});
test('registration requires consent and valid ID; login validates identity and area',()=>{
 let s=state(null);const user={...mockUsers[0],id:'new',email:'new@example.com',validId:{requirement:'ID',name:'id.pdf',size:2000,type:'application/pdf',status:'Needs Replacement'},privacyConsentAt:at};
 assert.throws(()=>transition(s,{type:'register',user:{...user,privacyConsentAt:undefined}}),/consent/);
 s=transition(s,{type:'register',user});
 assert.equal(transition(s,{type:'login',email:user.email,password:user.password,staffLogin:false}).currentUserId,user.id);
 assert.throws(()=>transition(s,{type:'register',user:{...user,id:'duplicate'}}),/already registered/);
 assert.throws(()=>transition(s,{type:'login',email:user.email,password:'wrong',staffLogin:false}),/incorrect/);
 assert.throws(()=>transition(s,{type:'login',email:user.email,password:user.password,staffLogin:true}),/different login/);
});
test('renter renewal documents and 5 MB/type boundaries',()=>{
 assert.equal(requirements({...app(state()),ownership:'Renter',applicationType:'Renewal'}).length,5);
 assert.ok(requirements({...app(state()),ownership:'Renter'}).some(r=>r.name==='Contract of Lease'));
 const file={name:'id.png',type:'image/png',size:5*1024*1024};
 assert.equal(validFile(file),true);
 assert.equal(validFile({...file,size:file.size+1}),false);
 assert.equal(validFile({...file,name:'id.exe'}),false);
 assert.equal(validFile({...file,type:'text/html'}),false);
});
test('draft resumes with same reference; subsequent submissions are unique',()=>{
 let s=state();const input={...app(s),purpose:'',certified:false};
 s=transition(s,{type:'saveApplication',application:input,draft:true},at);
 const draft=s.applications[0];assert.equal(draft.status,'Draft');assert.equal(draft.reference,'SJ-2026-000127');
 assert.throws(()=>transition(s,{type:'saveApplication',application:input,reference:draft.reference,draft:false}),/Complete applicant/);
 s=transition(s,{type:'saveApplication',application:{...input,purpose:'Business renewal',certified:true},reference:draft.reference,draft:false},at);
 assert.equal(s.applications[0].status,'Pending Assessment');assert.equal(s.applications.length,7);
 assert.throws(()=>transition(s,{type:'saveApplication',application:input,reference:draft.reference,draft:true}),/Only drafts/);
 s=transition(s,{type:'saveApplication',application:input,draft:true},at);
 assert.equal(s.applications[0].reference,'SJ-2026-000128');
});
test('submission requires documents and walk-ins retain resident ownership',()=>{
 const input=app(state());
 assert.throws(()=>transition(state(),{type:'saveApplication',application:{...input,documents:[]},draft:false}),/Upload all/);
 const s=transition(state('staff-maria'),{type:'saveApplication',application:input,draft:false},at);
 assert.equal(s.applications[0].source,'Assisted / Walk-in');
 assert.equal(s.applications[0].residentId,'resident-maria');
});
test('role separation blocks assessment, fees, and another residents OR entry',()=>{
 const s=state();
 assert.throws(()=>transition(s,{type:'assess',reference:ref,category:'Bakery',classification:'Small'}),/Only Staff/);
 assert.throws(()=>transition(s,{type:'fees',schedule:mockFeeSchedules[0]}),/Only Admin/);
 assert.throws(()=>transition(s,{type:'or',reference:'SJ-2026-000124',number:'TR-2026-99999',date:'2026-09-06',amount:'550.00'}),/another resident/);
});
test('assessment requires verified documents and automatically uses configured fees',()=>{
 let s=state('staff-maria');app(s).documents[0].status='Missing';
 assert.throws(()=>assess(s),/Verify every/);
 s=transition(s,{type:'review',reference:ref,documents:app(s).documents.map(d=>({...d,status:'Verified'}))},at);
 s=assess(s);assert.equal(app(s).status,'Awaiting OR');assert.equal(app(s).assessment.total,600);
 assert.equal(app(s).assessment.classification,'Medium');
 assert.throws(()=>assess(s),/current stage/);
});
test('inspection requires inspector and date and persists its saved timestamp',()=>{
 let s=state('staff-maria');
 assert.throws(()=>transition(s,{type:'inspection',reference:ref,report:{status:'Completed',inspector:'',date:'',remarks:''}}),/inspector/);
 s=transition(s,{type:'inspection',reference:ref,report:{status:'Completed',inspector:'Pedro Staff',date:'2026-09-06',remarks:'Reviewed'}},at);
 assert.equal(app(s).inspection.savedAt,at);
});
test('OR gate blocks premature, invalid, future, mismatched, duplicate and non-currency entries',()=>{
 assert.throws(()=>or(state()),/complete assessment/);
 for(const args of [
 ['12345','2026-09-06','600',600],['TR-2026-54321','2026-02-30','600',600],
 ['TR-2026-54321','2099-01-01','600',600],['TR-2025-54321','2026-09-06','600',600],
 ['TR-2026-54321','2026-09-06','600.001',600],['TR-2026-54321','2026-09-06','-600',600],
 ['TR-2026-54321','2026-09-06','500',600],['TR-2026-54321','2026-09-06','6e2',600]
 ])assert.throws(()=>validateOR(...args));
 assert.doesNotThrow(()=>validateOR('TR-2026-54321','2026-09-06','600.00',600));
 const s=role(assess(state()),'resident-maria');
 assert.throws(()=>transition(s,{type:'or',reference:ref,number:'TR-2026-12342',date:'2026-09-06',amount:'600.00'}),/already recorded/);
});
test('download precedes confirmation; closure timestamps and feedback are recorded',()=>{
 let s=or(assess(state()));assert.equal(app(s).status,'Ready for Download');
 assert.equal(app(s).receipt.amountPaid,app(s).assessment.total);assert.equal(processingSeconds(app(s)),0);
 assert.throws(()=>transition(s,{type:'confirm',reference:ref}),/Download your clearance/);
 assert.throws(()=>transition(s,{type:'feedback',reference:ref,rating:5,comment:''}),/confirmed receipt/);
 s=transition(s,{type:'download',reference:ref},at);s=transition(s,{type:'confirm',reference:ref},at);
 assert.equal(app(s).status,'Closed - Cleared');assert.equal(app(s).confirmation.timestamp,at);
 assert.equal(app(s).confirmation.ipPlaceholder,'Not collected (prototype)');
 assert.throws(()=>transition(s,{type:'feedback',reference:ref,rating:0,comment:''}),/rating/);
 s=transition(s,{type:'feedback',reference:ref,rating:5,comment:'Convenient.'},at);
 assert.equal(app(s).feedback.comment,'Convenient.');
 assert.throws(()=>transition(s,{type:'feedback',reference:ref,rating:3,comment:''}),/Feedback requires/);
});
test('fee histories retain old versions and do not change existing assessment snapshots',()=>{
 let s=role(assess(state()),'admin');
 const previous=activeSchedule(s.schedules,'Business Clearance','Sari-Sari Store','Medium');
 s=transition(s,{type:'fees',schedule:{...previous,effectiveDate:'2099-01-01',items:[{name:'Business Clearance',amount:999}],notes:'Future adjustment'}},at);
 assert.equal(s.schedules.length,mockFeeSchedules.length+1);
 assert.equal(activeSchedule(s.schedules,'Business Clearance','Sari-Sari Store','Medium').id,previous.id);
 assert.equal(activeSchedule(s.schedules,'Business Clearance','Sari-Sari Store','Medium','2099-01-01').items[0].amount,999);
 assert.equal(app(s).assessment.total,600);
 assert.throws(()=>transition(s,{type:'fees',schedule:{...previous,items:[{name:'Test',amount:-1}]}}),/non-negative/);
});
test('admin reversion requires reason and preserves original and revised values',()=>{
 let s=or(assess(state()));const data={reference:ref,action:'Edit Fields',reason:'Correct applicant spelling',applicant:'Maria Clara Santos',businessName:'Maria Mini Mart',orNumber:'TR-2026-54321'};
 assert.throws(()=>transition(s,{type:'revert',data}),/Only Admin/);
 assert.throws(()=>transition(role(s,'admin'),{type:'revert',data:{...data,reason:''}}),/Reason/);
 s=transition(role(s,'admin'),{type:'revert',data},at);
 assert.ok(app(s).clearance.revisedFrom);assert.equal(app(s).applicant,'Maria Clara Santos');
 assert.match(s.audits[0].oldValue,/Maria Clara/);assert.match(s.audits[0].newValue,/Maria Clara Santos/);
 assert.equal(s.audits[0].reversion,true);assert.equal(s.audits[0].reason,data.reason);
});
test('void and review retain receipts but block downloads',()=>{
 for(const action of ['Void Transaction','Mark Under Review']){
 let s=or(assess(state()));s=transition(role(s,'admin'),{type:'revert',data:{reference:ref,action,reason:'Review requested'}},at);
 assert.ok(app(s).receipt);assert.throws(()=>transition(role(s,'resident-maria'),{type:'download',reference:ref}),/not available/);
 }
});
test('reset passwords and deactivated users affect login without leaking passwords into audit',()=>{
 let s=state('admin'),resident={...mockUsers[0],password:'new-password-123'};
 s=transition(s,{type:'user',user:resident,reason:'Password reset'},at);
 assert.ok(!JSON.stringify(s.audits).includes(resident.password));
 assert.equal(transition(s,{type:'login',email:resident.email,password:resident.password,staffLogin:false}).currentUserId,resident.id);
 s=transition(s,{type:'user',user:{...resident,status:'Inactive'},reason:'Deactivated'},at);
 assert.throws(()=>transition(s,{type:'login',email:resident.email,password:resident.password,staffLogin:false}),/inactive/);
 assert.throws(()=>transition(s,{type:'user',user:{...resident,role:'admin'},reason:'Bad role'}),/Admin accounts/);
});
test('report totals match included requests; drafts and voids are excluded',()=>{
 const s=state(),rows=monthlyRows(s.applications);assert.equal(rows.reduce((sum,r)=>sum+r.count,0),6);
 assert.equal(rows.reduce((sum,r)=>sum+r.recorded,0),s.applications.reduce((sum,a)=>sum+(a.receipt?.amountPaid||0),0));
 app(s).status='Void';assert.equal(monthlyRows(s.applications).reduce((sum,r)=>sum+r.count,0),5);
});
test('generated PDF has valid object offsets, prototype watermark and a real QR matrix',async()=>{
 const pdf=await makePDF('Electrical Clearance',['SJ-2026-000125','OR: TR-2026-12342'],'http://localhost:3001/verify/SJ-2026-000125').text();
 assert.ok(pdf.startsWith('%PDF-1.4'));assert.ok(pdf.includes('SAMPLE ONLY'));assert.match(pdf,/ re f/);
 const start=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.equal(pdf.slice(start,start+4),'xref');
 const offsets=[...pdf.matchAll(/(\d{10}) 00000 n/g)].map(m=>Number(m[1]));
 offsets.forEach((offset,i)=>assert.ok(pdf.slice(offset).startsWith((i+1)+' 0 obj')));
});
