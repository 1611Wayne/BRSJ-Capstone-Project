require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transition, requirements, validateOR, validFile, activeSchedule, hasPaymentEvidence, verifiableClearance, manilaDate, validOrDate, validateAmountPaid, notificationsFor } = require('../lib/workflow.ts');
const { mockApplications } = require('../data/mockApplications.ts');
const { mockUsers } = require('../data/mockUsers.ts');
const { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const { monthlyRows, processingSeconds, paymentCheckSeconds, mmss, dailyOrApplications } = require('../data/mockReports.ts');
const { clearanceTypes } = require('../data/clearanceTypes.ts');
const { makePDF } = require('../lib/downloads.ts');
const state = (id = 'resident-maria') => structuredClone({users:mockUsers,applications:mockApplications,schedules:mockFeeSchedules,audits:[],currentUserId:id});
const at = '2026-09-07T02:30:12.000Z', ref = 'SJ-2026-000123';
const app = s => s.applications.find(a=>a.reference===ref);
const role = (s,id) => ({...s,currentUserId:id});
const assess = s => transition(role(s,'staff-maria'),{type:'assess',reference:ref,category:'Sari-Sari Store',classification:'Medium'},at);
const or = s => transition(role(s,'resident-maria'),{type:'or',reference:ref,number:'TR-2026-54321',date:'2026-09-06',amount:'600.00'},at);
// Updated 2026-10-05: the paper's Scope (Ch. 1.4) lists 13, but the user confirmed directly with Barangay
// San Jose office staff that only 9 are real; Ambulant and Lessor (Paupahan) were folded into Business
// Clearance, Film Shooting and Products Promo don't exist at this barangay. See CHANGES.md for the full note.
test('exactly nine supported clearance types (confirmed with the barangay office, supersedes the paper\'s 13)',()=>{
 assert.equal(clearanceTypes.length,9);
 assert.equal(new Set(clearanceTypes.map(c=>c.name)).size,9);
 assert.deepEqual(clearanceTypes.map(c=>c.name),['Business Clearance','Building Clearance','Electrical Clearance','Fencing Clearance','Excavation Clearance','Lot Survey Clearance','Water/MWSS Clearance','PODA Clearance','TODA Clearance']);
});
// Updated 2026-10-05: the Staff/Admin login toggle this test used to check (staffLogin) was removed by the
// 2026-09-29 "unified login" revision — one login form now, redirect comes from the account's own role, not
// a user-picked toggle. The old /different login/ assertion tested a check that no longer exists; removed.
test('registration requires consent and valid ID; login validates identity',()=>{
 let s=state(null);const user={...mockUsers[0],id:'new',email:'new@example.com',validId:{requirement:'ID',name:'id.pdf',size:2000,type:'application/pdf',status:'Needs Replacement'},privacyConsentAt:at};
 assert.throws(()=>transition(s,{type:'register',user:{...user,privacyConsentAt:undefined}}),/consent/);
 s=transition(s,{type:'register',user});
 assert.equal(transition(s,{type:'login',email:user.email,password:user.password}).currentUserId,user.id);
 assert.throws(()=>transition(s,{type:'register',user:{...user,id:'duplicate'}}),/already registered/);
 assert.throws(()=>transition(s,{type:'login',email:user.email,password:'wrong'}),/incorrect/);
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
 let s=or(assess(state()));assert.equal(app(s).status,'For Checking');
 assert.throws(()=>transition(s,{type:'download',reference:ref}),/not available/);
 s=role(transition(role(s,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'TR-2026-54321'},at),'resident-maria');assert.equal(app(s).status,'Ready for Download');
 assert.equal(app(s).receipt.amountPaid,app(s).assessment.total);assert.equal(processingSeconds(app(s)),null);assert.equal(paymentCheckSeconds(app(s)),0);
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
 let s=role(transition(role(or(assess(state())),'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'TR-2026-54321'},at),'resident-maria');const data={reference:ref,action:'Edit Fields',reason:'Correct applicant spelling',applicant:'Maria Clara Santos',businessName:'Maria Mini Mart',orNumber:'TR-2026-54321'};
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
 assert.equal(transition(s,{type:'login',email:resident.email,password:resident.password}).currentUserId,resident.id);
 s=transition(s,{type:'user',user:{...resident,status:'Inactive'},reason:'Deactivated'},at);
 assert.throws(()=>transition(s,{type:'login',email:resident.email,password:resident.password}),/inactive/);
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


test('all payment methods require staff verification and block release beforehand',()=>{
 const photo={requirement:'Official Receipt Photo',name:'receipt.png',type:'image/png',size:1024,status:'Needs Replacement',url:'data:image/png;base64,example'};
 for(const command of [
  {type:'or',reference:ref,number:'TR-2026-54321',date:'2026-09-06',amount:'600.00'},
  {type:'receiptPhoto',reference:ref,photo},
  {type:'onlinePayment',reference:ref,method:'GCash',amount:600}
 ]){
  let s=role(assess(state()),'resident-maria');s=transition(s,command,at);
  assert.equal(app(s).status,'For Checking');assert.equal(app(s).clearance,undefined);
  assert.throws(()=>transition(s,{type:'download',reference:ref}),/not available/);
  assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber:'TR-2026-54321'}),/Only Staff/);
  assert.throws(()=>transition(role(s,'admin'),{type:'verifyPayment',reference:ref,orNumber:'TR-2026-54321'}),/Only Staff/);
  const verify={type:'verifyPayment',reference:ref,orNumber:'TR-2026-54321',orDate:'2026-09-06',amountPaid:600};
  s=transition(role(s,'staff-maria'),verify,at);
  assert.equal(app(s).status,'Ready for Download');assert.equal(app(s).paymentVerification.status,'Verified');
  assert.ok(app(s).paymentVerification.checkedBy);assert.ok(app(s).clearance);
  assert.doesNotThrow(()=>transition(role(s,'resident-maria'),{type:'download',reference:ref},at));
  assert.throws(()=>transition(s,verify),/awaiting staff/);
 }
});

test('staff returns payment with reason and resubmission requires another check',()=>{
 let s=or(assess(state()));
 assert.throws(()=>transition(role(s,'staff-maria'),{type:'returnPayment',reference:ref,reason:''}),/correction/);
 s=transition(role(s,'staff-maria'),{type:'returnPayment',reference:ref,reason:'Upload a legible receipt'},at);
 assert.equal(app(s).status,'Awaiting OR');assert.equal(app(s).paymentVerification.notes,'Upload a legible receipt');
 s=or(s);assert.equal(app(s).status,'For Checking');assert.equal(app(s).paymentVerification.status,'Pending');
 assert.equal(app(s).clearance,undefined);
});

test('changing an OR number revokes release and requires staff verification again',()=>{
 let s=transition(role(or(assess(state())),'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'TR-2026-54321'},at);
 s=transition(role(s,'admin'),{type:'revert',data:{reference:ref,action:'Edit Fields',reason:'Correct OR',applicant:app(s).applicant,orNumber:'TR-2026-77777'}},at);
 assert.equal(app(s).status,'For Checking');assert.equal(app(s).clearance,undefined);
 assert.throws(()=>transition(role(s,'resident-maria'),{type:'download',reference:ref}),/not available/);
});


test('submitted documents start pending review and require staff verification for assessment',()=>{
 let s=transition(state(),{type:'saveApplication',application:app(state()),draft:false},at);
 const submitted=s.applications[0];
 assert.ok(submitted.documents.every(d=>d.status==='Pending Review'));
 s=role(s,'staff-maria');
 const command={type:'assess',reference:submitted.reference,category:'Sari-Sari Store',classification:'Medium'};
 assert.throws(()=>transition(s,command,at),/Verify every/);
 s=transition(s,{type:'review',reference:submitted.reference,documents:submitted.documents.map(d=>({...d,status:'Verified'}))},at);
 assert.equal(transition(s,command,at).applications[0].status,'Awaiting OR');
});


test('business clearance supports optional Ambulant and Lessor subcategories',()=>{
 for(const subcategory of [undefined,'Ambulant','Lessor (Paupahan)']){
  const input={...app(state()),businessSubcategory:subcategory};
  let s=transition(state(),{type:'saveApplication',application:input,draft:true},at);
  const draft=s.applications[0];assert.equal(draft.clearanceType,'Business Clearance');assert.equal(draft.businessSubcategory,subcategory);
  s=transition(s,{type:'saveApplication',application:draft,reference:draft.reference,draft:false},at);
  assert.equal(s.applications[0].businessSubcategory,subcategory);assert.equal(s.applications[0].status,'Pending Assessment');
 }
 const s=transition(state(),{type:'saveApplication',application:{...app(state()),clearanceType:'Building Clearance',businessSubcategory:'Ambulant'},draft:true},at);
 assert.equal(s.applications[0].businessSubcategory,undefined);
});

test('receipt photo verification requires a unique staff-entered OR number',()=>{
 const photo={requirement:'Official Receipt',name:'receipt.jpg',size:1000,type:'image/jpeg',status:'Pending Review'};
 let s=transition(role(assess(state()),'resident-maria'),{type:'receiptPhoto',reference:ref,photo},at);
 s=role(s,'staff-maria');
 for(const orNumber of [undefined,'','   '])assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber},at),/OR number/);
 const duplicate=s.applications.find(a=>a.reference!==ref);duplicate.paymentVerification={status:'Verified',submittedAt:at,orNumber:'TR-2026-77777'};
 assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber:'TR-2026-77777'},at),/already recorded/);
 for(const orDate of [undefined,'','2026-13-40','06/09/2026','2999-01-01'])assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber:'TR-2026-88888',orDate},at),/OR date/);
 for(const amountPaid of [undefined,'','abc','-5','0','599.99','600.001','1e3'])assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber:'TR-2026-88888',orDate:'2026-09-06',amountPaid},at),/amount/i,String(amountPaid));
 assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber:'TR-2026-88888',orDate:'2026-09-06',amountPaid:'599.99'},at),/must match the assessed amount/);
 s=transition(s,{type:'verifyPayment',reference:ref,orNumber:' 123456 ',orDate:'2026-09-06',amountPaid:'600.00'},at);
 assert.equal(app(s).paymentVerification.orNumber,'123456');
 const entry=s.audits.find(log=>log.action==='OR number recorded by staff');
 assert.equal(JSON.parse(entry.newValue).orNumber,'123456');assert.equal(entry.reference,ref);assert.equal(entry.role,'staff');assert.equal(entry.timestamp,at);
 assert.equal(app(s).status,'Ready for Download');assert.deepEqual(app(s).receiptPhoto,photo);
 // Staff verification records the full receipt: the number and date they typed, and the assessed total as the amount.
 assert.deepEqual([app(s).receipt.orNumber,app(s).receipt.orDate,app(s).receipt.amountPaid,app(s).receipt.encodedBy,app(s).receipt.recordedAt],['123456','2026-09-06',app(s).assessment.total,'Maria Staff',at]);
 assert.deepEqual(app(s).receipt.receiptPhoto,photo);assert.equal(JSON.parse(entry.newValue).orDate,'2026-09-06');
});

test('staff can adjust assessment fees per application with validation and audit history',()=>{
 const original=state('staff-maria');const schedules=structuredClone(original.schedules);
 const baseline=app(assess(original)).assessment;
 const amounts=baseline.items.map((item,index)=>index===0?123.45:item.amount);
 const command={type:'assess',reference:ref,category:'Sari-Sari Store',classification:'Medium',amounts};
 const s=transition(original,command,at);
 assert.deepEqual(app(s).assessment.items.map(item=>item.amount),amounts);
 assert.equal(app(s).assessment.total,amounts.reduce((sum,value)=>sum+Math.round(value*100),0)/100);
 assert.deepEqual(s.schedules,schedules);assert.equal(app(s).status,'Awaiting OR');
 const log=s.audits.find(log=>log.action==='Assessment fee amounts adjusted');
 assert.deepEqual(JSON.parse(log.oldValue),baseline.items);assert.deepEqual(JSON.parse(log.newValue),app(s).assessment.items);assert.equal(log.role,'staff');
 for(const invalid of [[],amounts.map(()=>-1),amounts.map(()=>NaN),amounts.map(()=>Infinity),amounts.map(()=>1.001),amounts.map(()=>'5')])assert.throws(()=>transition(original,{...command,amounts:invalid},at),/valid non-negative/);
 assert.throws(()=>transition(role(original,'resident-maria'),command,at),/Only Staff/);
});

test('staff make the final Business Category choice, whatever the Applicant indicated',()=>{
 // Decision D8 (2026-10-06): the Applicant may indicate Ambulant or Lessor at intake; Staff decide at assessment.
 for(const indicated of [undefined,'Ambulant','Lessor (Paupahan)']){
  const s0=state('staff-maria');app(s0).businessSubcategory=indicated;
  const s=transition(s0,{type:'assess',reference:ref,category:'Bakery',classification:'Medium'},at);
  assert.equal(app(s).assessment.category,'Bakery');assert.equal(app(s).assessment.classification,'Medium');
  assert.equal(app(s).businessSubcategory,indicated);assert.equal(app(s).status,'Awaiting OR');
 }
 const bank=transition(state('staff-maria'),{type:'assess',reference:ref,category:'Bank',classification:''},at);
 assert.equal(app(bank).assessment.category,'Bank');
 assert.throws(()=>transition(state('staff-maria'),{type:'assess',reference:ref,category:'No Such Category',classification:''},at),/No effective fee schedule/);
});

// Document replacement (2026-10-06): Staff flag a document Missing / Needs Replacement; the Applicant uploads a new copy,
// or Staff upload it on the Applicant's behalf; the new copy goes back to Pending Review and must be verified again.
const newCopy=(requirement,patch={})=>({requirement,name:'new-copy.jpg',size:2000,type:'image/jpeg',status:'Pending Review',...patch});
const flagDoc=(s,requirement,status='Needs Replacement')=>transition(role(s,'staff-maria'),{type:'review',reference:ref,documents:app(s).documents.map(d=>d.requirement===requirement?{...d,status}:d)},at);
test('the Applicant or Staff can replace a document Staff flagged, and it goes back to review',()=>{
 const first=app(state()).documents[0].requirement;
 for(const [actorId,action] of [['resident-maria','Document replaced by Applicant'],['staff-maria','Document replaced by Staff for the Applicant']])for(const status of ['Needs Replacement','Missing']){
  const flagged=flagDoc(state(),first,status);
  const s=transition(role(flagged,actorId),{type:'replaceDocument',reference:ref,document:newCopy(first)},at);
  const replaced=app(s).documents.find(d=>d.requirement===first);
  assert.equal(replaced.name,'new-copy.jpg');assert.equal(replaced.status,'Pending Review');
  assert.deepEqual(app(s).documents.filter(d=>d.requirement!==first),app(flagged).documents.filter(d=>d.requirement!==first));
  assert.equal(s.audits[0].action,action);assert.match(s.audits[0].oldValue,new RegExp(status));assert.equal(app(s).status,'Pending Assessment');
 }
});
test('only a flagged document can be replaced, by the right people, with a valid file, before assessment is confirmed',()=>{
 const first=app(state()).documents[0].requirement;const flagged=flagDoc(state(),first);const replace=(s,id,document)=>transition(role(s,id),{type:'replaceDocument',reference:ref,document},at);
 assert.throws(()=>replace(state(),'resident-maria',newCopy(first)),/Only a document that Staff marked/);
 assert.throws(()=>replace(flagged,'resident-maria',newCopy('Not A Requirement')),/Only a document that Staff marked/);
 assert.throws(()=>replace(flagged,'resident-juan',newCopy(first)),/belongs to another resident/);
 assert.throws(()=>replace(flagged,'admin',newCopy(first)),/Only the Applicant or Staff/);
 assert.throws(()=>replace(flagged,'resident-maria',newCopy(first,{name:'note.txt',type:'text/plain'})),/valid file/);
 assert.throws(()=>replace(flagged,'resident-maria',newCopy(first,{size:6*1024*1024})),/valid file/);
 const assessed=assess(state());assert.equal(app(assessed).status,'Awaiting OR');
 assert.throws(()=>replace(assessed,'staff-maria',newCopy(first)),/before assessment is confirmed/);
});
test('a replaced document must be verified again before assessment can be confirmed',()=>{
 const first=app(state()).documents[0].requirement;
 let s=transition(role(flagDoc(state(),first),'resident-maria'),{type:'replaceDocument',reference:ref,document:newCopy(first)},at);
 const assessCmd={type:'assess',reference:ref,category:'Sari-Sari Store',classification:'Medium'};
 assert.throws(()=>transition(role(s,'staff-maria'),assessCmd,at),/Verify every required document/);
 s=transition(role(s,'staff-maria'),{type:'review',reference:ref,documents:app(s).documents.map(d=>({...d,status:'Verified'}))},at);
 assert.equal(app(transition(role(s,'staff-maria'),assessCmd,at)).status,'Awaiting OR');
});
// Correction requests (agreed 2026-09-23, built 2026-10-06): the Applicant describes the mistake in a text box, Staff
// change the entry for them and mark it resolved. A rejected request is returned to the Applicant and reopened by resolving.
const askFix=(s,id='resident-maria',message='My last name is misspelled. It should be Clarita.')=>transition(role(s,id),{type:'requestCorrection',reference:ref,message},at);
const staffEdit=(s,changes,id='staff-maria')=>transition(role(s,id),{type:'editApplication',reference:ref,changes},at);
const rejectIt=s=>transition(role(s,'staff-maria'),{type:'reject',reference:ref,reason:'The name does not match the ID.'},at);
test('the Applicant sends a free-text correction request: one open at a time, only while it can still be corrected',()=>{
 const s=askFix(state());const [c]=app(s).corrections;
 assert.equal(c.status,'Open');assert.match(c.message,/misspelled/);assert.equal(c.requestedAt,at);assert.equal(s.audits[0].action,'Correction requested');
 assert.throws(()=>askFix(s),/already waiting/);
 assert.throws(()=>askFix(state(),'resident-maria','   '),/Describe what/);
 assert.throws(()=>askFix(state(),'resident-maria','x'.repeat(501)),/500 characters/);
 assert.throws(()=>askFix(state(),'resident-juan'),/belongs to another resident/);
 for(const id of ['staff-maria','admin'])assert.throws(()=>askFix(state(),id),/Only the Applicant/);
 for(const status of ['Ready for Download','Closed - Cleared','Void','Draft']){const s2=state();app(s2).status=status;assert.throws(()=>askFix(s2),/can no longer be sent/,status);}
 for(const status of ['Pending Assessment','Under Review','Rejected','Awaiting OR','For Checking']){const s2=state();app(s2).status=status;assert.equal(app(askFix(s2)).corrections.length,1,status);}
});
test('Staff correct the Applicant\'s entries for them; only the changed entries are logged, old and new',()=>{
 const before=app(state());const s=staffEdit(state(),{applicant:'  Maria Clarita ',contact:before.contact,purpose:'Renewal of business permit'});
 assert.equal(app(s).applicant,'Maria Clarita');assert.equal(app(s).purpose,'Renewal of business permit');assert.equal(app(s).clearanceType,before.clearanceType);assert.equal(app(s).status,before.status);
 const entry=s.audits[0];assert.equal(entry.action,'Application edited by Staff for the Applicant');
 assert.deepEqual(JSON.parse(entry.oldValue),{applicant:before.applicant,purpose:before.purpose});assert.deepEqual(JSON.parse(entry.newValue),{applicant:'Maria Clarita',purpose:'Renewal of business permit'});
 assert.equal(entry.user,'Maria Staff');
 const asked=staffEdit(askFix(state()),{address:'Purok 3, San Jose'});assert.match(asked.audits[0].reason,/misspelled/);
});
test('Staff edits keep the submit rules and cannot touch anything but the Applicant\'s entries',()=>{
 assert.throws(()=>staffEdit(state(),{contact:'123456789'}),/valid Philippine mobile/);
 assert.throws(()=>staffEdit(state(),{applicant:'  '}),/Complete applicant details/);
 assert.throws(()=>staffEdit(state(),{businessName:''}),/Complete the business information/);
 assert.throws(()=>staffEdit(state(),{initialOperation:'2999-01-01'}),/valid operation date/);
 assert.throws(()=>staffEdit(state(),{ownership:'Renter'}),/Property owner name is required/);
 assert.throws(()=>staffEdit(state(),{businessSubcategory:'Fishing'}),/supported business subcategory/);
 assert.throws(()=>staffEdit(state(),{hasEmployees:true,employeeCount:-2}),/valid number of employees/);
 assert.throws(()=>staffEdit(state(),{}),/Nothing was changed/);
 assert.throws(()=>staffEdit(state(),{applicant:app(state()).applicant}),/Nothing was changed/);
 for(const key of ['clearanceType','status','residentId','reference','documents','assessment','receipt','clearance'])assert.throws(()=>staffEdit(state(),{[key]:app(state())[key]}),/cannot be edited here/,key);
 for(const id of ['resident-maria','admin'])assert.throws(()=>staffEdit(state(),{purpose:'Changed'},id),/Only Staff/);
 for(const status of ['Ready for Download','Closed - Cleared','Void','Draft']){const s2=state();app(s2).status=status;assert.throws(()=>staffEdit(s2,{purpose:'Changed'}),/Admin transaction reversion/,status);}
 assert.equal(app(staffEdit(assess(state()),{purpose:'Changed'})).purpose,'Changed');
 const set=staffEdit(state(),{businessSubcategory:'Lessor (Paupahan)'});assert.equal(app(set).businessSubcategory,'Lessor (Paupahan)');
 assert.equal(app(staffEdit(set,{businessSubcategory:undefined})).businessSubcategory,undefined);
});
test('a rejection is returned to the Applicant, and resolving their correction request reopens it for assessment',()=>{
 let s=rejectIt(state());assert.equal(app(s).status,'Rejected');assert.ok(app(s).rejection);
 s=askFix(s);assert.equal(app(s).status,'Rejected');
 s=staffEdit(s,{applicant:'Maria Clarita'});assert.equal(app(s).status,'Rejected');
 s=transition(role(s,'staff-maria'),{type:'resolveCorrection',reference:ref,note:'  Fixed the spelling.  '},at);
 const a=app(s),[c]=a.corrections;
 assert.equal(a.status,'Pending Assessment');assert.equal(a.rejection,undefined);
 assert.deepEqual([c.status,c.resolvedBy,c.resolvedAt,c.resolutionNote],['Resolved','Maria Staff',at,'Fixed the spelling.']);
 assert.equal(s.audits[0].action,'Correction request resolved');assert.match(s.audits[0].newValue,/Rejected -> Pending Assessment/);assert.equal(s.audits[0].reason,'Fixed the spelling.');
 const again=askFix(s,'resident-maria','The business name has a typo too.');assert.deepEqual(app(again).corrections.map(x=>x.status),['Resolved','Open']);
});
test('resolving a correction request does not change the status of a request that was not rejected',()=>{
 const s=transition(role(askFix(state()),'staff-maria'),{type:'resolveCorrection',reference:ref},at);
 assert.equal(app(s).status,'Pending Assessment');assert.equal(app(s).corrections[0].status,'Resolved');assert.equal(app(s).corrections[0].resolutionNote,undefined);
 assert.throws(()=>transition(role(state(),'staff-maria'),{type:'resolveCorrection',reference:ref},at),/no open correction request/);
 assert.throws(()=>transition(role(s,'staff-maria'),{type:'resolveCorrection',reference:ref},at),/no open correction request/);
 for(const id of ['resident-maria','admin'])assert.throws(()=>transition(role(askFix(state()),id),{type:'resolveCorrection',reference:ref},at),/Only Staff/);
});
test('Staff can leave a short reason on a flagged document; it is dropped once the document is verified or replaced',()=>{
 const first=app(state()).documents[0].requirement,doc=s=>app(s).documents.find(d=>d.requirement===first);
 const flag=(s,status,note)=>transition(role(s,'staff-maria'),{type:'review',reference:ref,documents:app(s).documents.map(d=>d.requirement===first?{...d,status,note}:d)},at);
 let s=flag(state(),'Needs Replacement','  The photo is too blurry to read.  ');
 assert.equal(doc(s).note,'The photo is too blurry to read.');
 assert.equal(doc(flag(state(),'Missing','x'.repeat(300))).note.length,200);
 assert.equal(doc(flag(state(),'Needs Replacement','   ')).note,undefined);
 assert.equal(doc(flag(state(),'Verified','left over text')).note,undefined);
 assert.equal(doc(flag(s,'Verified','left over text')).note,undefined);
 const replaced=transition(role(s,'resident-maria'),{type:'replaceDocument',reference:ref,document:newCopy(first)},at);
 assert.equal(doc(replaced).note,undefined);assert.equal(doc(replaced).status,'Pending Review');
});

test('a correction that makes another document required adds it as Missing, to be uploaded like any flagged document',()=>{
 let s=staffEdit(state(),{ownership:'Renter',propertyOwner:'Pedro Santos'});
 const lease=app(s).documents.find(d=>d.requirement==='Contract of Lease');
 assert.equal(lease.status,'Missing');assert.equal(lease.size,0);assert.deepEqual(JSON.parse(s.audits[0].newValue).documentsRequired,['Contract of Lease']);
 assert.throws(()=>transition(role(s,'staff-maria'),{type:'assess',reference:ref,category:'Sari-Sari Store',classification:'Medium'},at),/Verify every required document/);
 s=transition(role(s,'resident-maria'),{type:'replaceDocument',reference:ref,document:newCopy('Contract of Lease')},at);
 assert.equal(app(s).documents.find(d=>d.requirement==='Contract of Lease').status,'Pending Review');
 assert.equal(app(staffEdit(state(),{purpose:'Changed'})).documents.length,app(state()).documents.length);
 assert.equal(app(staffEdit(rejectIt(state()),{applicationType:'Renewal'})).documents.some(d=>d.requirement==='Old Business Clearance'),true);
 assert.throws(()=>staffEdit(assess(state()),{ownership:'Renter',propertyOwner:'Pedro Santos'}),/another document required after assessment/);
});

// The public verification page (the QR code on the clearance) looks a clearance up with verifiableClearance. It used to
// require application.receipt, which the receipt-photo (D1) and simulation flows did not set, so those clearances showed as not found.
// (Staff verification now records the receipt for the photo flow; a simulation still has none and is found through hasPaymentEvidence.)
test('a released clearance can be verified whichever way payment was shown: typed OR, receipt photo, or simulation',()=>{
 const verify=(s,orNumber)=>transition(role(s,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber,orDate:'2026-09-06',amountPaid:600},at);
 const total=app(assess(state())).assessment.total;
 const typed=verify(or(assess(state())),'TR-2026-54321');
 const photo=verify(transition(role(assess(state()),'resident-maria'),{type:'receiptPhoto',reference:ref,photo:{requirement:'Official Receipt',name:'or.jpg',size:1000,type:'image/jpeg',status:'Pending Review'}},at),'TR-2026-77777');
 const sim=verify(transition(role(assess(state()),'resident-maria'),{type:'onlinePayment',reference:ref,method:'GCash',amount:total},at));
 for(const [name,s] of [['typed OR',typed],['receipt photo',photo],['simulation',sim]]){
  assert.equal(app(s).status,'Ready for Download',name);assert.ok(app(s).clearance,name);
  assert.equal(verifiableClearance(app(s)),true,name+' must be verifiable');
 }
 assert.equal(app(photo).receipt.orNumber,'TR-2026-77777');assert.equal(app(photo).paymentVerification.orNumber,'TR-2026-77777');
});
test('a request with no released clearance, or no payment evidence, cannot be verified',()=>{
 assert.equal(verifiableClearance(app(state())),false);
 assert.equal(verifiableClearance(app(assess(state()))),false);
 const sent=transition(role(assess(state()),'resident-maria'),{type:'receiptPhoto',reference:ref,photo:{requirement:'Official Receipt',name:'or.jpg',size:1000,type:'image/jpeg',status:'Pending Review'}},at);
 assert.equal(app(sent).status,'For Checking');assert.equal(verifiableClearance(app(sent)),false);
 assert.equal(verifiableClearance({...app(state()),clearance:{issueDate:'2026-09-06',generatedAt:at}}),false);
 assert.equal(hasPaymentEvidence({}),false);
 for(const a of state().applications.filter(a=>a.status==='Ready for Download'||a.status==='Closed - Cleared'))assert.equal(verifiableClearance(a),true,a.reference);
});

// Reports and timer for the D1 flow (2026-10-16, following the manuscript): Monthly Collection counts released, non-simulated
// payments at the assessed total; the Daily OR Summary groups by the Manila day Staff verified; the timer runs submission -> receipt
// confirmation; the SLA indicators measure the Staff payment check.
const photoFile={requirement:'Official Receipt',name:'or.jpg',size:1000,type:'image/jpeg',status:'Pending Review'};
const releasedByPhoto=(orNumber='TR-2026-77777',orDate='2026-09-06')=>transition(role(transition(role(assess(state()),'resident-maria'),{type:'receiptPhoto',reference:ref,photo:photoFile},at),'staff-maria'),{type:'verifyPayment',reference:ref,orNumber,orDate,amountPaid:600},at);
test('Monthly Collection counts released payments at the assessed total, and never unverified or simulated ones',()=>{
 const recorded=s=>monthlyRows(s.applications).filter(r=>r.clearanceType===app(s).clearanceType).reduce((n,r)=>n+r.recorded,0),base=recorded(state()),total=app(assess(state())).assessment.total;
 assert.equal(recorded(releasedByPhoto())-base,total);
 assert.equal(recorded(or(assess(state())))-base,0);
 const sim=transition(role(transition(role(assess(state()),'resident-maria'),{type:'onlinePayment',reference:ref,method:'GCash',amount:total},at),'staff-maria'),{type:'verifyPayment',reference:ref},at);
 assert.equal(app(sim).status,'Ready for Download');assert.equal(recorded(sim)-base,0);
});
test('the Daily OR Summary lists a payment on the Manila day Staff verified it, with its OR date and amount',()=>{
 const s=releasedByPhoto('TR-2026-77777','2026-09-06');
 assert.deepEqual(dailyOrApplications(s.applications,'2026-09-07').map(a=>a.reference).filter(r=>r===ref),[ref]);
 assert.equal(dailyOrApplications(s.applications,'2026-09-06').some(a=>a.reference===ref),false);
 assert.equal(dailyOrApplications(s.applications,'2026-09-07','Business Clearance').some(a=>a.reference===ref),true);
 assert.equal(dailyOrApplications(s.applications,'2026-09-07','Building Clearance').some(a=>a.reference===ref),false);
 assert.equal(dailyOrApplications(or(assess(state())).applications,'2026-09-07').some(a=>a.reference===ref),false);
 assert.equal(manilaDate('2026-10-05T17:00:00.000Z'),'2026-10-06');assert.equal(manilaDate('2026-10-05T15:59:00.000Z'),'2026-10-05');
 assert.equal(validOrDate('2026-09-06'),true);assert.equal(validOrDate('2026-09-31'),false);assert.equal(validOrDate('2999-01-01'),false);assert.equal(validOrDate(),false);
});
test('total processing time runs from submission to receipt confirmation (MM:SS); the payment check is timed separately',()=>{
 const closed=state().applications.find(a=>a.status==='Closed - Cleared');
 assert.equal(processingSeconds(closed),9300);assert.equal(mmss(processingSeconds(closed)),'155:00');
 assert.equal(paymentCheckSeconds(closed),3);
 assert.equal(processingSeconds(app(state())),null);assert.equal(paymentCheckSeconds(app(state())),null);
 assert.equal(processingSeconds(app(releasedByPhoto())),null);
 assert.equal(mmss(59.9),'00:59');assert.equal(mmss(61),'01:01');assert.equal(mmss(0),'00:00');
});
test('Staff transcribe the Amount Paid, and it must equal the assessed total (manuscript 3.3.1)',()=>{
 assert.doesNotThrow(()=>validateAmountPaid('600',600));assert.doesNotThrow(()=>validateAmountPaid(600.5,600.5));assert.doesNotThrow(()=>validateAmountPaid('600.00',600));
 assert.throws(()=>validateAmountPaid('599.99',600),/must match/);assert.throws(()=>validateAmountPaid('6e2',600),/valid currency/);assert.throws(()=>validateAmountPaid('',600),/valid currency/);
 const s=releasedByPhoto('TR-2026-12121');
 assert.equal(app(s).receipt.amountPaid,600);assert.equal(JSON.parse(s.audits.find(l=>l.action==='OR number recorded by staff').newValue).amountPaid,600);
 // a receipt that shows another amount is not verified: Staff return it with a reason, and the Applicant uploads it again
 const sent=transition(role(transition(role(assess(state()),'resident-maria'),{type:'receiptPhoto',reference:ref,photo:photoFile},at),'staff-maria'),{type:'returnPayment',reference:ref,reason:'The receipt shows 500.00, not 600.00'},at);
 assert.equal(app(sent).status,'Awaiting OR');assert.equal(app(sent).receipt,undefined);
});

// Release at the counter (D6 answered 2026-10-16): the printed, stamped original is handed over at the monitoring office, so Staff print the
// clearance (logged) and confirm the release for the Applicant. An Applicant confirming online must still download first.
test('Staff print the clearance and confirm its release for the Applicant; the Applicant still downloads first',()=>{
 const ready=releasedByPhoto();
 assert.throws(()=>transition(role(ready,'resident-maria'),{type:'confirm',reference:ref},at),/Download your clearance/);
 assert.throws(()=>transition(role(ready,'admin'),{type:'confirm',reference:ref},at),/Only the Applicant or Staff/);
 const printed=transition(role(ready,'staff-maria'),{type:'printClearance',reference:ref},at);
 assert.equal(printed.audits[0].action,'Clearance printed by Staff for the official stamp');assert.equal(app(printed).status,'Ready for Download');
 const closed=transition(role(printed,'staff-maria'),{type:'confirm',reference:ref},at);
 assert.equal(app(closed).status,'Closed - Cleared');assert.equal(app(closed).confirmation.confirmedBy,'Maria Staff');assert.equal(closed.audits[0].action,'Release confirmed by Staff for the Applicant');
 assert.equal(processingSeconds(app(closed)),(Date.parse(at)-Date.parse(app(closed).dateRequested))/1000);
 const own=transition(role(transition(role(ready,'resident-maria'),{type:'download',reference:ref},at),'resident-maria'),{type:'confirm',reference:ref},at);
 assert.equal(app(own).confirmation.confirmedBy,undefined);assert.equal(own.audits[0].action,'Receipt confirmed');
 const early=or(assess(state()));
 assert.throws(()=>transition(role(early,'staff-maria'),{type:'confirm',reference:ref},at),/ready can be confirmed/);
 assert.throws(()=>transition(role(early,'staff-maria'),{type:'printClearance',reference:ref},at),/not available for printing/);
 assert.throws(()=>transition(closed,{type:'confirm',reference:ref},at),/ready can be confirmed/);
 for(const id of ['resident-maria','admin'])assert.throws(()=>transition(role(ready,id),{type:'printClearance',reference:ref},at),/Only Staff/);
 assert.equal(transition(role(closed,'staff-maria'),{type:'printClearance',reference:ref},at).audits[0].action,'Clearance printed by Staff for the official stamp');
});

// In-app notifications for Applicants (2026-10-16): six events, no SMS.
const notes=(s,id='resident-maria')=>notificationsFor(s,id);
const flagDocNote=(s,status,note)=>{const first=app(s).documents[0].requirement;return transition(role(s,'staff-maria'),{type:'review',reference:ref,documents:app(s).documents.map(d=>d.requirement===first?{...d,status,note}:d)},at);};
test('the Applicant is told when a document needs replacing; the Staff note joins the same notice; a verified document clears it',()=>{
 const first=app(state()).documents[0].requirement;
 let s=flagDocNote(state(),'Needs Replacement');
 assert.equal(notes(s).length,1);assert.equal(notes(s)[0].event,'documents_flagged');assert.match(notes(s)[0].message,new RegExp('upload a new copy of '+first));assert.equal(notes(s)[0].readAt,undefined);
 s=flagDocNote(s,'Needs Replacement','The photo is too blurry to read.');
 assert.equal(notes(s).length,1);assert.match(notes(s)[0].message,/Staff note: The photo is too blurry/);
 assert.equal(notes(s,'resident-juan').length,0);assert.equal(notes(s,'staff-maria').length,0);
 s=flagDocNote(s,'Verified');assert.equal(notes(s).length,0);
 // once the Applicant has read it, a new flag is a new notice
 s=flagDocNote(state(),'Missing');s=transition(role(s,'resident-maria'),{type:'readNotifications'},at);s=flagDocNote(s,'Needs Replacement','Try again');
 assert.equal(notes(s).length,2);assert.equal(notes(s).filter(n=>!n.readAt).length,1);
 // flagging that changes nothing does not repeat the notice
 const same=flagDocNote(flagDocNote(state(),'Needs Replacement','x'),'Needs Replacement','x');assert.equal(notes(same).length,1);
});
test('the Applicant is told when the application is returned, and when the correction is made',()=>{
 let s=transition(role(state(),'staff-maria'),{type:'reject',reference:ref,reason:'The name does not match the ID.'},at);
 assert.equal(notes(s).length,1);assert.equal(notes(s)[0].event,'application_returned');assert.match(notes(s)[0].message,/The name does not match the ID\./);assert.match(notes(s)[0].message,/what to correct/);
 s=transition(role(s,'resident-maria'),{type:'requestCorrection',reference:ref,message:'Please fix my name.'},at);
 assert.equal(notes(s).length,1);
 s=transition(role(s,'staff-maria'),{type:'resolveCorrection',reference:ref,note:'Fixed.'},at);
 assert.equal(notes(s)[0].event,'correction_resolved');assert.match(notes(s)[0].message,/back in review/);assert.match(notes(s)[0].message,/Note: Fixed\./);
 const plain=transition(role(transition(role(state(),'resident-maria'),{type:'requestCorrection',reference:ref,message:'Typo.'},at),'staff-maria'),{type:'resolveCorrection',reference:ref},at);
 assert.equal(notes(plain)[0].message,'Staff made the correction you asked for.');
});
test('the Applicant is told the fee and what to do next when the assessment is confirmed',()=>{
 const s=assess(state());
 assert.equal(notes(s).length,1);assert.equal(notes(s)[0].event,'assessment_ready');assert.match(notes(s)[0].message,/₱600\.00/);assert.match(notes(s)[0].message,/Municipal Treasury/);assert.match(notes(s)[0].message,new RegExp(ref));
 assert.equal(notes(s,'resident-juan').length,0);
});
test('the Applicant is told when a payment is returned, and when the clearance is ready (receipt photo or simulation)',()=>{
 const sent=transition(role(assess(state()),'resident-maria'),{type:'receiptPhoto',reference:ref,photo:photoFile},at);
 const returned=transition(role(sent,'staff-maria'),{type:'returnPayment',reference:ref,reason:'The OR number is cut off.'},at);
 assert.equal(notes(returned)[0].event,'payment_returned');assert.match(notes(returned)[0].message,/upload your receipt again\. Reason: The OR number is cut off\./);
 const ready=releasedByPhoto();
 assert.equal(notes(ready)[0].event,'clearance_ready');assert.match(notes(ready)[0].message,/monitoring office/);assert.match(notes(ready)[0].message,/backup/);
 const total=app(assess(state())).assessment.total;
 const sim=transition(role(transition(role(assess(state()),'resident-maria'),{type:'onlinePayment',reference:ref,method:'GCash',amount:total},at),'staff-maria'),{type:'verifyPayment',reference:ref},at);
 assert.equal(notes(sim)[0].event,'clearance_ready');
 assert.deepEqual(notes(ready).map(n=>n.event),['clearance_ready','assessment_ready']);
});
test('reading notifications only marks your own, and the newest come first',()=>{
 let t=flagDocNote(state(),'Missing');t=transition(role(t,'staff-maria'),{type:'reject',reference:ref,reason:'Later.'},'2026-09-07T03:30:12.000Z');
 assert.deepEqual(notes(t).map(n=>n.event),['application_returned','documents_flagged']);
 const read=transition(role(t,'resident-juan'),{type:'readNotifications'},at);assert.equal(notes(read).filter(n=>!n.readAt).length,2);
 const staffRead=transition(role(t,'staff-maria'),{type:'readNotifications'},at);assert.equal(notes(staffRead).filter(n=>!n.readAt).length,2);
 const mine=transition(role(t,'resident-maria'),{type:'readNotifications'},at);assert.equal(notes(mine).filter(n=>!n.readAt).length,0);assert.ok(notes(mine).every(n=>n.readAt===at));
 assert.equal(notificationsFor({users:[],applications:[],schedules:[],audits:[],currentUserId:null},'x').length,0);
});
test('real sign-in: the signed-in person (role from the database) is adopted; an empty password never logs in',()=>{
 const real={id:'0000-real',firstName:'Ana',lastName:'Reyes',email:'ana@example.com',password:'should-not-be-kept',role:'staff',status:'Active',createdAt:at,contact:'',address:''};
 const s=transition(state(null),{type:'sessionUser',user:real},at);
 assert.equal(s.currentUserId,'0000-real');assert.equal(s.users.find(u=>u.id==='0000-real').role,'staff');assert.equal(s.users.find(u=>u.id==='0000-real').password,'');
 const again=transition(s,{type:'sessionUser',user:{...real,firstName:'Ana Maria'}},at);assert.equal(again.users.filter(u=>u.id==='0000-real').length,1);assert.equal(again.users.find(u=>u.id==='0000-real').firstName,'Ana Maria');
 assert.throws(()=>transition(state(null),{type:'sessionUser',user:{...real,status:'Inactive'}},at),/inactive/);
 const out=transition(s,{type:'logout'},at);assert.throws(()=>transition(out,{type:'login',email:'ana@example.com',password:''},at),/incorrect/);
});
test('database records load into the screens: own list replaced, single records added or replaced, never another resident\'s',()=>{
 const s=state('resident-maria');const mine=s.applications.filter(a=>a.residentId==='resident-maria');const others=s.applications.filter(a=>a.residentId!=='resident-maria');
 const fromDb={...mine[0],reference:'SJ-2026-000001',dbId:7,status:'Draft'};
 const replaced=transition(s,{type:'loadApplications',applications:[fromDb],replaceOwn:true},at);
 assert.deepEqual(replaced.applications.filter(a=>a.residentId==='resident-maria').map(a=>a.reference),['SJ-2026-000001']);
 assert.equal(replaced.applications.filter(a=>a.residentId!=='resident-maria').length,others.length);
 const updated=transition(replaced,{type:'loadApplications',applications:[{...fromDb,status:'Pending Assessment'}]},at);
 assert.equal(updated.applications.filter(a=>a.reference==='SJ-2026-000001').length,1);assert.equal(updated.applications.find(a=>a.reference==='SJ-2026-000001').status,'Pending Assessment');
 assert.throws(()=>transition(s,{type:'loadApplications',applications:[{...fromDb,residentId:'resident-juan'}]},at),/another resident/);
 assert.throws(()=>transition(state(null),{type:'loadApplications',applications:[]},at),/log in/);
});
test('Staff load every request from the database; an Applicant may not',()=>{
 const s=state('staff-maria');const db=[{...s.applications[0],reference:'SJ-2026-000009',dbId:9}];
 const loaded=transition(s,{type:'loadApplications',applications:db,replaceAll:true},at);
 assert.deepEqual(loaded.applications.map(a=>a.reference),['SJ-2026-000009']);
 assert.throws(()=>transition(state('resident-maria'),{type:'loadApplications',applications:[],replaceAll:true},at),/Only Staff and Admin/);
});
test('notifications from the database replace only the signed-in person own notices',()=>{
 const s={...state('resident-maria'),notifications:[{id:'x',userId:'resident-juan',reference:'R',event:'clearance_ready',message:'other',createdAt:at}]};
 const mine={id:'db-1',userId:'resident-maria',reference:'SJ-2026-000002',event:'assessment_ready',message:'m',createdAt:at};
 const loaded=transition(s,{type:'loadNotifications',notifications:[mine]},at);
 assert.deepEqual(loaded.notifications.map(n=>n.id).sort(),['db-1','x']);
 assert.throws(()=>transition(s,{type:'loadNotifications',notifications:[{...mine,userId:'resident-juan'}]},at),/someone else/);
});
test('the same document flagged on two requests of one Applicant gives one notice per request',()=>{
 let s=state('staff-maria');const original=app(s);const twin={...structuredClone(original),reference:'SJ-2026-000999'};s={...s,applications:[...s.applications,twin]};
 const flagFirst=docs=>docs.map((d,i)=>i===0?{...d,status:'Needs Replacement',note:'Blurry.'}:d);
 s=transition(s,{type:'review',reference:ref,documents:flagFirst(original.documents)},at);
 s=transition(s,{type:'review',reference:'SJ-2026-000999',documents:flagFirst(twin.documents)},at);
 const notes=s.notifications.filter(n=>n.event==='documents_flagged'&&!n.readAt);
 assert.equal(notes.length,2);assert.deepEqual(notes.map(n=>n.reference).sort(),[ref,'SJ-2026-000999'].sort());
 assert.ok(notes.every(n=>n.key==='docs:'+n.reference+':'+original.documents[0].requirement));
});
test('assessment snapshots ordinance reference onto assessment record',()=>{
 let s=state('staff-maria');
 s=transition(s,{type:'review',reference:ref,documents:app(s).documents.map(d=>({...d,status:'Verified'}))},at);
 s=assess(s);
 assert.equal(typeof app(s).assessment.ordinance,'string');
 assert.ok(app(s).assessment.ordinance.length > 0);
});
