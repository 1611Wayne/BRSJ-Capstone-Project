require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transition, requirements, validateOR, validFile, activeSchedule, hasPaymentEvidence, verifiableClearance, manilaDate, validOrDate, validateAmountPaid, notificationsFor } = require('../lib/workflow.ts');
const { mockApplications } = require('../data/mockApplications.ts');
const { mockUsers } = require('../data/mockUsers.ts');
const { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const { monthlyRows, monthlyCollectionReport, processingSeconds, paymentCheckSeconds, mmss, dailyOrApplications, feedbackSummary, monthlyReversions } = require('../data/mockReports.ts');
const { transactionMilestones, transactionEvents, transactionDateLabel } = require('../lib/transactionLog.ts');
const { auditRecord } = require('../lib/auditRecords.ts');
const { decideSensitiveView } = require('../lib/sensitiveViews.ts');
const { coalesceInFlight, createInFlightRequestCache } = require('../lib/inFlightRequests.ts');
const { clearanceTypes } = require('../data/clearanceTypes.ts');
const { makePDF } = require('../lib/downloads.ts');
const state = (id = 'resident-maria') => structuredClone({users:mockUsers,applications:mockApplications,schedules:mockFeeSchedules,audits:[],currentUserId:id});
const at = '2026-09-07T02:30:12.000Z', ref = 'SJ-2026-000123';
const app = s => s.applications.find(a=>a.reference===ref);
const role = (s,id) => ({...s,currentUserId:id});

test('SE-4 decision logs authorized Staff and Admin file views only after a successful insert',()=>{
 const now=Date.parse(at);
 for(const actorRole of ['staff','admin']){
  const pending=decideSensitiveView({action:'file_view',role:actorRole,isAuthorized:true,now});
  assert.equal(pending.shouldLog,true);assert.equal(pending.allowed,false);
  const saved=decideSensitiveView({action:'file_view',role:actorRole,isAuthorized:true,now,logWriteSucceeded:true});
  assert.equal(saved.shouldLog,true);assert.equal(saved.allowed,true);
 }
});

test('SE-4 allows a resident own-file view without logging, but denies another user file',()=>{
 const now=Date.parse(at);
 const own=decideSensitiveView({action:'file_view',role:'resident',isAuthorized:true,now});
 assert.equal(own.shouldLog,false);assert.equal(own.allowed,true);
 const other=decideSensitiveView({action:'file_view',role:'resident',isAuthorized:false,now});
 assert.equal(other.shouldLog,false);assert.equal(other.allowed,false);
});

test('SE-4 list views are not logged and a failed Staff audit write is denied',()=>{
 const now=Date.parse(at);
 const list=decideSensitiveView({action:'list_view',role:'staff',isAuthorized:true,now});
 assert.equal(list.shouldLog,false);assert.equal(list.allowed,true);
 const failed=decideSensitiveView({action:'file_view',role:'staff',isAuthorized:true,now,logWriteSucceeded:false});
 assert.equal(failed.shouldLog,true);assert.equal(failed.allowed,false);
});

test('SE-4 skips duplicate file or record views only inside five minutes',()=>{
 const now=Date.parse(at);
 const duplicate=decideSensitiveView({action:'file_view',role:'staff',isAuthorized:true,lastEventAt:new Date(now-299999).toISOString(),now});
 assert.equal(duplicate.shouldLog,false);assert.equal(duplicate.allowed,true);
 const later=decideSensitiveView({action:'record_view',role:'admin',isAuthorized:true,lastEventAt:new Date(now-300001).toISOString(),now});
 assert.equal(later.shouldLog,true);assert.equal(later.allowed,false);
});

test('in-flight coalescing shares same-key work and runs different keys independently',async()=>{
 const requests=new Map();let calls=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const work=key=>coalesceInFlight(requests,key,async()=>{calls++;await gate;return key;});
 const first=work('same'),replay=work('same'),other=work('other');
 assert.equal(first,replay);release();
 assert.deepEqual(await Promise.all([first,replay,other]),['same','same','other']);
 assert.equal(calls,2);
});

test('in-flight request cache reuses a pending promise and permits a later retry',async()=>{
 const cache=createInFlightRequestCache();let calls=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const first=cache.getOrCreate('receipt-photos|path',async()=>{calls++;await gate;return 'signed-url';});
 const replay=cache.getOrCreate('receipt-photos|path',async()=>{calls++;return 'unexpected';});
 assert.equal(first,replay);release();
 assert.equal(await first,'signed-url');assert.equal(await replay,'signed-url');assert.equal(calls,1);
 assert.equal(await cache.getOrCreate('receipt-photos|path',async()=>{calls++;return 'next-open';}),'next-open');
 assert.equal(calls,2);
});

test('FT-10 notifies only active Staff/Admin on submission, never drafts or failed submissions',()=>{
 const s=state();s.users.push({...s.users.find(u=>u.role==='staff'),id:'inactive-staff',status:'Inactive'});
 const input={...app(s),documents:app(s).documents.map(d=>({...d,size:100,type:'application/pdf'}))};
 const draft=transition(s,{type:'saveApplication',application:input,draft:true},at);
 assert.equal((draft.notifications??[]).length,0);
 const record=draft.applications[0];
 const submitted=transition(draft,{type:'saveApplication',application:input,reference:record.reference,draft:false},at);
 const notices=submitted.notifications.filter(n=>n.event==='submission_received');
 assert.deepEqual(notices.map(n=>n.userId).sort(),['admin','staff-maria','staff-pedro']);
 assert.ok(notices.every(n=>n.reference===record.reference));
 assert.equal(notificationsFor(submitted,'resident-maria').length,0);
 assert.equal((s.notifications??[]).length,0);
 assert.throws(()=>transition(s,{type:'saveApplication',application:{...input,certified:false},draft:false},at));
});

test('FT-10 correction, payment and release notices preserve Applicant events and per-user read history',()=>{
 let s=transition(state(),{type:'requestCorrection',reference:ref,message:'Fix the address'},at);
 assert.equal(notificationsFor(s,'admin')[0].event,'correction_requested');
 assert.throws(()=>transition(s,{type:'requestCorrection',reference:ref,message:'Another'},at));
 s=assess(state());
 const photo={requirement:'OR',name:'or.jpg',size:100,type:'image/jpeg',status:'Pending Review'};
 s=transition(role(s,'resident-maria'),{type:'receiptPhoto',reference:ref,photo},at);
 assert.equal(notificationsFor(s,'staff-maria')[0].event,'payment_pending');
 const read=transition(role(s,'staff-maria'),{type:'readNotifications'},at);
 assert.ok(notificationsFor(read,'staff-maria').every(n=>n.readAt));
 assert.ok(notificationsFor(read,'admin').every(n=>!n.readAt));
 s=transition(role(read,'staff-maria'),{type:'returnPayment',reference:ref,reason:'Unreadable'},at);
 s=transition(role(s,'resident-maria'),{type:'receiptPhoto',reference:ref,photo},'2026-09-07T03:00:00.000Z');
 assert.equal(notificationsFor(s,'admin').filter(n=>n.event==='payment_pending').length,1);
 assert.equal(notificationsFor(s,'staff-maria').filter(n=>n.event==='payment_pending').length,2);
 s=transition(role(s,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'FT10-OR',orDate:'2026-09-06',amountPaid:600},at);
 assert.ok(notificationsFor(s,'admin').some(n=>n.event==='release_pending'));
 assert.ok(notificationsFor(s,'resident-maria').some(n=>n.event==='clearance_ready'));
 assert.ok(notificationsFor(s,'resident-maria').every(n=>!['submission_received','correction_requested','payment_pending','release_pending'].includes(n.event)));
 assert.throws(()=>transition(role(s,'resident-maria'),{type:'verifyPayment',reference:ref},at));
});

test('FT-10 explicitly labels simulated payments and uses each role own application route',()=>{
 const {notificationApplicationPath}=require('../lib/teamNotifications.ts');
 const s=transition(role(assess(state()),'resident-maria'),{type:'onlinePayment',reference:ref,method:'GCash',amount:600},at);
 assert.match(notificationsFor(s,'admin')[0].message,/simulated payment/);
 for(const role of ['resident','staff','admin'])assert.equal(notificationApplicationPath(role,ref),`/${role}/applications/${ref}`);
});

test('document review times are recorded on changes, preserved on unchanged documents and cleared on replacement',()=>{
 const before=state('staff-maria'),original=structuredClone(app(before));
 let s=transition(before,{type:'review',reference:ref,documents:app(before).documents},at);
 assert.ok(app(s).documents.every(d=>d.reviewedAt===at&&d.reviewedBy==='Maria Staff'));
 const nextTime='2026-09-07T03:31:14.000Z';
 s=transition(s,{type:'review',reference:ref,documents:app(s).documents.map((d,i)=>i===0?{...d,status:'Needs Replacement',note:'Blurry'}:d)},nextTime);
 assert.equal(app(s).documents[0].reviewedAt,nextTime);assert.equal(app(s).documents[1].reviewedAt,at);
 assert.equal(transactionMilestones(app(s)).find(m=>m.stage==='Document Review Time').timestamp,nextTime);
 assert.equal(s.audits.filter(a=>a.action==='Requirements reviewed').length,2);
 const unchanged=transition(s,{type:'review',reference:ref,documents:app(s).documents.map(d=>({...d,reviewedAt:'2099-01-01',reviewedBy:'Fake'}))},'2026-09-07T04:00:00.000Z');
 assert.equal(app(unchanged).documents[0].reviewedAt,nextTime);assert.equal(app(unchanged).documents[0].reviewedBy,'Maria Staff');
 const file={...app(s).documents[0],name:'new.pdf',size:1000,type:'application/pdf'};
 s=transition(s,{type:'replaceDocument',reference:ref,document:file},'2026-09-07T04:00:00.000Z');
 assert.equal(app(s).documents[0].reviewedAt,undefined);assert.equal(app(s).documents[0].reviewedBy,undefined);
 assert.equal(s.audits.filter(a=>a.action==='Requirements reviewed').length,2);
 assert.deepEqual(app(before),original);
});

test('transaction log preserves repeated stages and reversions with exact times, omitting unrelated requests',()=>{
 let s=state('staff-maria');
 s=transition(s,{type:'review',reference:ref,documents:app(s).documents},at);
 s=transition(s,{type:'review',reference:ref,documents:app(s).documents.map((d,i)=>i===0?{...d,status:'Missing'}:d)},'2026-09-07T03:00:17.000Z');
 s=transition(role(s,'admin'),{type:'revert',data:{reference:ref,action:'Mark Under Review',reason:'Review again'}},'2026-09-07T03:01:18.000Z');
 const events=transactionEvents(app(s),[...s.audits,{...s.audits[0],reference:'other',action:'Other request'}]);
 assert.equal(events.filter(e=>e.action==='Requirements reviewed').length,2);
 assert.ok(events.some(e=>e.action==='Mark Under Review'&&e.reason==='Review again'&&e.timestamp==='2026-09-07T03:01:18.000Z'));
 assert.equal(events.some(e=>e.action==='Other request'),false);
 const views=[...s.audits,{...s.audits[0],id:'view-file',action:'file_view',reference:ref},{...s.audits[0],id:'view-record',action:'record_view',reference:ref}];
 assert.ok(transactionEvents(app(s),views).every(event=>!['file_view','record_view'].includes(event.action)));
 assert.deepEqual(events.map(e=>Date.parse(e.timestamp)),events.map(e=>Date.parse(e.timestamp)).sort((a,b)=>a-b));
 const fresh=transactionMilestones(app(state()));
 assert.equal(fresh.find(m=>m.stage==='Document Review Time').timestamp,undefined);
 assert.equal(fresh.find(m=>m.stage==='OR Verification Time').timestamp,undefined);
 const issued=state().applications.find(a=>a.status==='Closed - Cleared');
 assert.ok(transactionEvents(issued,[]).some(e=>e.action==='Feedback submitted'&&e.timestamp===issued.feedback.submittedAt));
 assert.match(transactionDateLabel('2026-09-07T03:01:18.000Z'),/11:01:18/);
});

test('monthly reversion counts group actions by Admin identity and Manila month',()=>{
 const entry=(id,userId,user,action,timestamp)=>({id,userId,user,action,timestamp,role:'admin',reference:ref,reversion:true});
 const audits=[
  entry('1','a','Same Name','Edit Fields','2026-10-31T16:00:00.000Z'),
  entry('2','a','Same Name','Void Transaction','2026-11-01T02:00:00.000Z'),
  entry('3','b','Same Name','Mark Under Review','2026-11-15T01:00:00.000Z'),
  entry('4','a','Same Name','Edit Fields','2026-11-30T16:00:00.000Z'),
  {...entry('5','a','Same Name','Edit Fields','2026-11-10T01:00:00.000Z'),reversion:false},
  {...entry('6','a','Same Name','Edit Fields','2026-11-10T01:00:00.000Z'),role:'staff'},
  entry('7','a','Same Name','Assessment confirmed','2026-11-10T01:00:00.000Z'),
  entry('8','a','Same Name','file_view','2026-11-10T01:00:00.000Z'),
 ];
 const rows=monthlyReversions(audits,'2026-11');
 assert.deepEqual(rows,[{adminId:'a',admin:'Same Name',edits:1,voids:1,reviews:0,total:2},{adminId:'b',admin:'Same Name',edits:0,voids:0,reviews:1,total:1}]);
 assert.equal(monthlyReversions(audits,'2026-12')[0].total,1);
 assert.deepEqual(monthlyReversions(audits,'2026-10'),[]);assert.deepEqual(monthlyReversions([],'2026-11'),[]);
 const legacy={...audits[0],userId:undefined};
 assert.deepEqual(monthlyReversions([legacy,audits[1]],'2026-11'),[{adminId:'a',admin:'Same Name',edits:1,voids:1,reviews:0,total:2}]);
 assert.equal(monthlyReversions([legacy,audits[1],audits[2]],'2026-11').length,3);
});

test('audit records retain database timestamps and JSON values; Staff log loads stay scoped to one transaction',()=>{
 const row={id:1,created_at:at,user_id:'admin-id',role:'admin',action:'Void Transaction',reference_no:ref,reversion:true,old_value:{status:'Ready for Download'},new_value:{status:'Void'},reason:'Test'};
 const log=auditRecord(row,'Admin Name');assert.equal(log.timestamp,at);assert.equal(log.userId,'admin-id');assert.equal(log.oldValue,JSON.stringify(row.old_value));
 assert.equal(auditRecord({...row,created_at:undefined,timestamp:at},'Admin Name').timestamp,at);
 assert.throws(()=>auditRecord({...row,created_at:undefined},'Admin Name'),/recorded time/);
 assert.throws(()=>transition(state(),{type:'loadAudits',audits:[log]}),/Only Admin/);
 assert.throws(()=>transition(state('staff-maria'),{type:'loadAudits',audits:[log]}),/select a transaction/);
 assert.throws(()=>transition(state('staff-maria'),{type:'loadAudits',reference:'other',audits:[log]}),/another transaction/);
 const loaded=transition(state('staff-maria'),{type:'loadAudits',reference:ref,audits:[log]});assert.ok(loaded.audits.some(a=>a.id===log.id));
 assert.deepEqual(transition(state('admin'),{type:'loadAudits',audits:[log]}).audits,[log]);
});

test('feedback summary includes all five rating counts and counts ratings without comments',()=>{
 const applications=[5,4,3,2,1,5].map((rating,index)=>({...mockApplications[0],reference:String(index),feedback:{rating,comment:index===0?'Helpful staff':'',submittedAt:at}}));
 const original=structuredClone(applications);
 const summary=feedbackSummary([...applications,{...mockApplications[0],feedback:undefined}]);
 assert.equal(summary.total,6);assert.equal(summary.commentCount,1);
 assert.deepEqual(summary.ratingCounts,[{rating:5,count:2},{rating:4,count:1},{rating:3,count:1},{rating:2,count:1},{rating:1,count:1}]);
 assert.deepEqual(applications,original);
});

test('feedback word counts ignore case, punctuation and connecting words while retaining English and Filipino content',()=>{
 const comments=['Fast, FAST service! Ang staff ay helpful po.',"I'm happy with the service. Mabilis, mabilis!",'Helpful staff; malinaw ang instructions.','   '];
 const summary=feedbackSummary(comments.map(comment=>({...mockApplications[0],feedback:{rating:5,comment,submittedAt:at}})));
 assert.equal(summary.commentCount,3);
 assert.deepEqual(summary.commonWords,[{word:'fast',count:2},{word:'helpful',count:2},{word:'mabilis',count:2},{word:'service',count:2},{word:'staff',count:2},{word:'happy',count:1},{word:'instructions',count:1},{word:'malinaw',count:1}]);
});

test('feedback summary handles empty feedback and limits word results with stable alphabetical ties',()=>{
 const empty=feedbackSummary([]);assert.equal(empty.total,0);assert.equal(empty.commentCount,0);
 assert.ok(empty.ratingCounts.every(row=>row.count===0));assert.deepEqual(empty.commonWords,[]);
 const feedback=comment=>({...mockApplications[0],feedback:{rating:4,comment,submittedAt:at}});
 assert.deepEqual(feedbackSummary([feedback('123 !!! ang ng po the and')]).commonWords,[]);
 assert.deepEqual(feedbackSummary([feedback('')]).commonWords,[]);
 const words=['zebra','yellow','violet','silver','orange','magenta','green','gold','cyan','blue','black','amber'];
 assert.deepEqual(feedbackSummary([feedback(words.join(' '))]).commonWords,words.sort().slice(0,10).map(word=>({word,count:1})));
 const invalid=[0,6,2.5,NaN].map(rating=>({...feedback('ignored'),feedback:{rating,comment:'ignored',submittedAt:at}}));
 assert.equal(feedbackSummary(invalid).total,0);
});
const assess = s => transition(role(s,'staff-maria'),{type:'assess',reference:ref,category:'Sari-Sari Store',classification:'Medium'},at);
const or = s => transition(role(s,'staff-maria'),{type:'or',reference:ref,number:'TR-2026-54321',date:'2026-09-06',amount:'600.00'},at);
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
 for(const actor of ['resident-maria','admin'])assert.throws(()=>transition(role(assess(state()),actor),{type:'or',reference:ref,number:'TR-2026-99999',date:'2026-09-06',amount:'600.00'}),/Only Staff can record OR details/);
 assert.equal(app(or(assess(state()))).receipt.encodedBy,'Maria Staff');
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
 const s=role(assess(state()),'staff-maria');
 assert.throws(()=>transition(s,{type:'or',reference:ref,number:'TR-2026-12342',date:'2026-09-06',amount:'600.00'}),/already recorded/);
});
test('download precedes confirmation; closure timestamps and feedback are recorded',()=>{
 let s=or(assess(state()));assert.equal(app(s).status,'For Checking');
 assert.throws(()=>transition(s,{type:'download',reference:ref}),/not available/);
 s=role(transition(role(s,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'TR-2026-54321',orDate:'2026-09-06',amountPaid:600},at),'resident-maria');assert.equal(app(s).status,'Ready for Download');
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
 let s=role(transition(role(or(assess(state())),'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'TR-2026-54321',orDate:'2026-09-06',amountPaid:600},at),'resident-maria');const data={reference:ref,action:'Edit Fields',reason:'Correct applicant spelling',applicant:'Maria Clara Santos',businessName:'Maria Mini Mart',orNumber:'TR-2026-54321',orDate:'2026-09-06',amountPaid:600};
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
test('Admin edits real accounts without seeing their passwords; new accounts still need one (2026-11-12)',()=>{
 // Real accounts arrive from the database without passwords (loadUsers), and some (made by a text code) have no email.
 const staffUser={id:'00000000-0000-4000-8000-000000000001',firstName:'Real',lastName:'Staff',email:'real.staff@example.com',password:'x',role:'staff',status:'Active',createdAt:at,contact:'',address:''};
 const phoneOnly={...staffUser,id:'00000000-0000-4000-8000-000000000002',firstName:'Phone',lastName:'Only',email:'',role:'resident',contact:'09170000000'};
 let s=transition(state('admin'),{type:'loadUsers',users:[staffUser,phoneOnly]},at);
 assert.equal(s.users.length,3);assert.ok(s.users.every(u=>u.id===s.currentUserId||u.password===''));
 assert.throws(()=>transition(state('staff-maria'),{type:'loadUsers',users:[staffUser]}),/Only Admin/);
 s=transition(s,{type:'user',user:{...s.users.find(u=>u.id===staffUser.id),lastName:'Renamed'},reason:'User updated'},at);
 assert.equal(s.users.find(u=>u.id===staffUser.id).lastName,'Renamed');
 s=transition(s,{type:'user',user:{...s.users.find(u=>u.id===phoneOnly.id),address:'Sitio 1'},reason:'User updated'},at);
 assert.throws(()=>transition(s,{type:'user',user:{...s.users.find(u=>u.id===staffUser.id),password:'short'},reason:'Password reset'}),/8 characters/);
 assert.throws(()=>transition(s,{type:'user',user:{...staffUser,id:'00000000-0000-4000-8000-000000000003',email:'new.staff@example.com',password:''},reason:'User created'}),/8 characters/);
 assert.throws(()=>transition(s,{type:'user',user:{...staffUser,id:'00000000-0000-4000-8000-000000000004',email:'',password:'long-enough-1'},reason:'User created'}),/email/);
});
test('monthly totals count issued verified receipt photos, excluding legacy typed-only samples and voids',()=>{
 assert.equal(monthlyRows(state().applications).length,0);
 const s=releasedByPhoto(),rows=monthlyRows(s.applications);
 assert.equal(rows.reduce((sum,r)=>sum+r.count,0),1);assert.equal(rows.reduce((sum,r)=>sum+r.recorded,0),600);
 app(s).status='Void';assert.equal(monthlyRows(s.applications).length,0);
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

test('changing OR details revokes release and requires staff verification again',()=>{
 let s=transition(role(or(assess(state())),'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'TR-2026-54321',orDate:'2026-09-06',amountPaid:600},at);
 s=transition(role(s,'admin'),{type:'revert',data:{reference:ref,action:'Edit Fields',reason:'Correct OR',applicant:app(s).applicant,orNumber:'TR-2026-77777',orDate:'2026-09-06',amountPaid:600}},at);
 assert.equal(app(s).status,'For Checking');assert.equal(app(s).clearance,undefined);
 assert.deepEqual([app(s).receipt.orNumber,app(s).receipt.orDate,app(s).receipt.amountPaid],['TR-2026-77777','2026-09-06',600]);
 assert.throws(()=>transition(role(s,'resident-maria'),{type:'download',reference:ref}),/not available/);
});

test('Admin can revise OR number, date, and amount together with an assessment change',()=>{
 const issued=releasedByPhoto('TR-2026-77777'),original=structuredClone(app(issued));
 const schedule=activeSchedule(issued.schedules,original.clearanceType,original.assessment.category,original.assessment.classification);
 const amounts=schedule.items.map(item=>item.amount);amounts[0]+=25;
 const amountPaid=amounts.reduce((sum,amount)=>sum+amount,0);
 const data={reference:ref,action:'Edit Fields',reason:'Correct receipt details',applicant:original.applicant,orNumber:'654321',orDate:'2026-09-07',amountPaid,feeAssessment:{scheduleId:schedule.id,amounts}};
 const corrected=transition(role(issued,'admin'),{type:'revert',data},at),a=app(corrected);
 assert.deepEqual([a.receipt.orNumber,a.receipt.orDate,a.receipt.amountPaid],['654321','2026-09-07',amountPaid]);
 assert.equal(a.assessment.total,amountPaid);assert.equal(a.status,'Pending Assessment');
 assert.equal(corrected.audits[0].reason,data.reason);assert.equal(corrected.audits[0].reversion,true);
 assert.deepEqual(JSON.parse(corrected.audits[0].newValue).receipt,a.receipt);
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
 for(const orNumber of [undefined,'','   '])assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber,orDate:'2026-09-06',amountPaid:600},at),/OR number/);
 const duplicate=s.applications.find(a=>a.reference!==ref);duplicate.paymentVerification={status:'Verified',submittedAt:at,orNumber:'TR-2026-77777'};
 assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber:'TR-2026-77777',orDate:'2026-09-06',amountPaid:600},at),/already recorded/);
 for(const orDate of [undefined,'','2026-13-40','06/09/2026','2999-01-01'])assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber:'TR-2026-88888',orDate,amountPaid:600},at),/OR date/);
 for(const amountPaid of [undefined,'','abc','-5','0','599.99','600.001','1e3'])assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber:'TR-2026-88888',orDate:'2026-09-06',amountPaid},at),/amount/i,String(amountPaid));
 assert.throws(()=>transition(s,{type:'verifyPayment',reference:ref,orNumber:'TR-2026-88888',orDate:'2026-09-06',amountPaid:'599.99'},at),/must match the assessed amount/);
 s=transition(s,{type:'verifyPayment',reference:ref,orNumber:' 123456 ',orDate:'2026-09-06',amountPaid:'600.00'},at);
 assert.equal(app(s).paymentVerification.orNumber,'123456');
 const entry=s.audits.find(log=>log.action==='OR details recorded by staff');
 assert.deepEqual(JSON.parse(entry.newValue),{orNumber:'123456',orDate:'2026-09-06',amountPaid:600});assert.equal(entry.reference,ref);assert.equal(entry.role,'staff');assert.equal(entry.timestamp,at);
 assert.equal(app(s).status,'Ready for Download');assert.deepEqual(app(s).receiptPhoto,photo);
 // Staff verification records the full receipt: the number and date they typed, and the assessed total as the amount.
 assert.deepEqual([app(s).receipt.orNumber,app(s).receipt.orDate,app(s).receipt.amountPaid,app(s).receipt.encodedBy,app(s).receipt.recordedAt],['123456','2026-09-06',app(s).assessment.total,'Maria Staff',at]);
 assert.deepEqual(app(s).receipt.receiptPhoto,photo);assert.equal(JSON.parse(entry.newValue).orDate,'2026-09-06');
});

test('Staff must encode all OR fields when an official receipt already exists',()=>{
 const pending=or(assess(state()));
 assert.throws(()=>transition(role(pending,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'123456',amountPaid:600},at),/OR date/);
 assert.throws(()=>transition(role(pending,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'123456',orDate:'2026-09-06'},at),/valid currency amount/);
 const verified=transition(role(pending,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'123456',orDate:'2026-09-07',amountPaid:600},at);
 assert.deepEqual([app(verified).receipt.orNumber,app(verified).receipt.orDate,app(verified).receipt.amountPaid],['123456','2026-09-07',600]);
 const entry=verified.audits.find(log=>log.action==='OR details recorded by staff');
 assert.deepEqual(JSON.parse(entry.newValue),{orNumber:'123456',orDate:'2026-09-07',amountPaid:600});
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

test('Admin can correct clearance type and fees, with reassessment, retained receipt and full audit snapshots',()=>{
 const issued=releasedByPhoto('123456'),original=structuredClone(app(issued));
 const schedule=activeSchedule(issued.schedules,'Electrical Clearance','','');
 const amounts=schedule.items.map(item=>item.amount);amounts[0]=375.25;
 const data={reference:ref,action:'Edit Fields',reason:'Wrong clearance and assessment',applicant:original.applicant,orNumber:original.receipt.orNumber,orDate:original.receipt.orDate,amountPaid:original.receipt.amountPaid,clearanceType:'Electrical Clearance',feeAssessment:{scheduleId:schedule.id,amounts}};
 assert.throws(()=>transition(role(issued,'staff-maria'),{type:'revert',data},at),/Only Admin/);
 const corrected=transition(role(issued,'admin'),{type:'revert',data},at),a=app(corrected);
 assert.equal(a.clearanceType,'Electrical Clearance');assert.equal(a.assessment.total,425.25);
 assert.equal(a.status,'Pending Assessment');assert.equal(a.clearance,undefined);
 assert.equal(a.confirmation,undefined);assert.equal(a.feedback,undefined);
 assert.deepEqual(a.receipt,original.receipt);assert.equal(a.paymentVerification.status,'Needs Correction');
 assert.equal(a.clearanceRevisedFrom,original.clearance.issueDate);
 const audit=corrected.audits[0],oldValue=JSON.parse(audit.oldValue),newValue=JSON.parse(audit.newValue);
 assert.equal(audit.reason,data.reason);assert.equal(audit.reversion,true);
 assert.equal(oldValue.clearanceType,'Business Clearance');assert.equal(oldValue.assessment.total,600);
 assert.equal(newValue.clearanceType,'Electrical Clearance');assert.equal(newValue.assessment.total,425.25);
 assert.deepEqual(app(issued),original);
 assert.throws(()=>transition(role(corrected,'resident-maria'),{type:'download',reference:ref},at),/not available/);
 assert.throws(()=>transition(role(corrected,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'123456'},at),/awaiting staff checking/);
 assert.throws(()=>transition(role(corrected,'staff-maria'),{type:'assess',reference:ref,category:'',classification:'',amounts},at),/Verify every required document/);
 const documents=requirements(a).map(r=>({requirement:r.name,name:'test.pdf',size:100,type:'application/pdf',status:'Verified'}));
 let s=transition(role(corrected,'staff-maria'),{type:'review',reference:ref,documents},at);
 s=transition(s,{type:'assess',reference:ref,category:'',classification:'',amounts},at);
 assert.equal(app(s).assessment.total,425.25);assert.equal(app(s).status,'Awaiting OR');
 s=transition(role(s,'resident-maria'),{type:'receiptPhoto',reference:ref,photo:photoFile},at);
 assert.throws(()=>transition(role(s,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'123456',orDate:'2026-09-06',amountPaid:600},at),/must match/);
 s=transition(role(s,'staff-maria'),{type:'verifyPayment',reference:ref,orNumber:'123456',orDate:'2026-09-06',amountPaid:425.25},at);
 assert.equal(app(s).status,'Ready for Download');assert.equal(app(s).clearance.revisedFrom,original.clearance.issueDate);
});

test('Admin fee-only corrections validate schedules and currency without changing shared schedules',()=>{
 const issued=releasedByPhoto(),schedule=activeSchedule(issued.schedules,'Business Clearance','Sari-Sari Store','Medium');
 const amounts=schedule.items.map(item=>item.amount);amounts[0]=325;
 const data={reference:ref,action:'Edit Fields',reason:'Correct fee',applicant:app(issued).applicant,feeAssessment:{scheduleId:schedule.id,amounts}};
 const edit=change=>transition(role(issued,'admin'),{type:'revert',data:{...data,...change}},at);
 const corrected=edit({});assert.equal(app(corrected).assessment.total,625);assert.equal(app(corrected).status,'Pending Assessment');
 assert.deepEqual(corrected.schedules,issued.schedules);
 for(const value of [-1,1.001,NaN,Infinity,'25']) {
  assert.throws(()=>edit({feeAssessment:{scheduleId:schedule.id,amounts:[value,...amounts.slice(1)]}}),/valid non-negative/);
 }
 assert.throws(()=>edit({feeAssessment:{scheduleId:schedule.id,amounts:[]}}),/every fee component/);
 assert.throws(()=>edit({clearanceType:'Unknown'}),/supported clearance type/);
 assert.throws(()=>edit({clearanceType:'Electrical Clearance',feeAssessment:undefined}),/new clearance type/);
 assert.throws(()=>edit({clearanceType:'Electrical Clearance'}),/effective fee schedule/);
 assert.throws(()=>edit({feeAssessment:{scheduleId:'missing',amounts}}),/effective fee schedule/);
 const future={...schedule,id:'future',effectiveDate:'2999-01-01'};
 assert.throws(()=>transition({...role(issued,'admin'),schedules:[...issued.schedules,future]},{type:'revert',data:{...data,feeAssessment:{scheduleId:future.id,amounts}}},at),/effective fee schedule/);
 const unchanged=edit({feeAssessment:{scheduleId:schedule.id,amounts:schedule.items.map(item=>item.amount)}});
 assert.equal(app(unchanged).status,'Ready for Download');
});
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
test('Daily OR Summary excludes a voided issued transaction while preserving its receipt and audit history',()=>{
 const issued=releasedByPhoto(),date=manilaDate(app(issued).clearance.generatedAt);
 const before=dailyOrApplications(issued.applications,date);
 assert.ok(before.some(a=>a.reference===ref));
 const voided=transition(role(issued,'admin'),{type:'revert',data:{reference:ref,action:'Void Transaction',reason:'Issued in error'}},at);
 const after=dailyOrApplications(voided.applications,date);
 assert.equal(after.some(a=>a.reference===ref),false);
 assert.equal(dailyOrApplications(voided.applications,date,'Business Clearance').some(a=>a.reference===ref),false);
 assert.deepEqual(after.map(a=>a.reference),before.filter(a=>a.reference!==ref).map(a=>a.reference));
 assert.equal(after.length,before.length-1);
 assert.equal(after.reduce((sum,a)=>sum+a.receipt.amountPaid,0),before.reduce((sum,a)=>sum+a.receipt.amountPaid,0)-app(issued).receipt.amountPaid);
 assert.deepEqual(app(voided).receipt,app(issued).receipt);
 assert.deepEqual(app(voided).clearance,app(issued).clearance);
 assert.ok(voided.audits.some(a=>a.reference===ref&&a.action==='Void Transaction'&&a.reason==='Issued in error'&&a.reversion));
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
 assert.equal(app(s).receipt.amountPaid,600);assert.equal(JSON.parse(s.audits.find(l=>l.action==='OR details recorded by staff').newValue).amountPaid,600);
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
test('staff can create and submit walk-in application on behalf of a resident with audit tracking',()=>{
 let s=state('staff-maria');
 const resident=mockUsers.find(u=>u.id==='resident-maria');
 const input={
  residentId:resident.id,applicant:resident.firstName+' '+resident.lastName,address:resident.address,contact:resident.contact,
  purpose:'New food stall',clearanceType:'Business Clearance',businessName:'San Jose Kiosk',businessLocation:'Barangay Plaza',
  initialOperation:'2026-01-01',applicationType:'New Application',ownership:'Owner',propertyOwner:'',businessContact:resident.contact,
  source:'Assisted / Walk-in',documents:requirements({clearanceType:'Business Clearance',ownership:'Owner',applicationType:'New Application'}).map(r=>({requirement:r.name,name:r.name+'.pdf',size:1024,type:'application/pdf',status:'Pending Review'})),
  certified:true
 };
 // Staff saves draft for walk-in resident
 s=transition(s,{type:'saveApplication',application:input,draft:true},at);
 const draft=s.applications[0];
 assert.equal(draft.status,'Draft');assert.equal(draft.source,'Assisted / Walk-in');assert.equal(draft.residentId,resident.id);
 assert.equal(draft.staffEncoder,'Maria Staff');
 // Staff submits walk-in application
 s=transition(s,{type:'saveApplication',application:input,reference:draft.reference,draft:false},at);
 const submitted=s.applications.find(a=>a.reference===draft.reference);
 assert.equal(submitted.status,'Pending Assessment');assert.equal(submitted.source,'Assisted / Walk-in');
 assert.equal(submitted.staffEncoder,'Maria Staff');assert.equal(submitted.residentId,resident.id);
 const audit=s.audits.find(a=>a.action==='Application submitted'&&a.reference===draft.reference);
 assert.ok(audit);assert.equal(audit.role,'staff');assert.equal(audit.user,'Maria Staff');
});

// Exercise the audit endpoint with a fake database: no Supabase connection or real records are used.
const Module = require('node:module');
let auditApiActor, auditApiRows = [], auditApiApplication, auditApiCalls, auditApiFilters;
const fakeAuditDb = {
 from(table) {
  auditApiCalls.push(table);let start=0,end=999,reference,allowedActions,excludedActions=[];
  const query={
   select(){return query},order(){return query},range(a,b){start=a;end=b;return query},
   eq(field,value){if(field==='reference_no')reference=value;return query},
   in(field,values){if(field==='action'){allowedActions=values;auditApiFilters.push(['in',values])}return query},
   neq(field,value){if(field==='action'){excludedActions.push(value);auditApiFilters.push(['neq',value])}return query},
   async maybeSingle(){return {data:auditApiApplication,error:null}},
   then(resolve,reject){
    const data=table==='profiles'?[{id:'admin-id',first_name:'Admin',last_name:'One'}]:auditApiRows.filter(row=>(!reference||row.reference_no===reference)&&(!allowedActions||allowedActions.includes(row.action))&&!excludedActions.includes(row.action)).slice(start,end+1);
    return Promise.resolve({data,error:null}).then(resolve,reject);
   },
  };return query;
 },
};
const originalLoad = Module._load;
let auditEndpoint;
try {
 Module._load=function(request,parent,...rest){
  if(request==='@/lib/server/currentUser')return {currentUser:async()=>({user:auditApiActor})};
  if(request==='@/lib/supabase/server')return {supabaseAdmin:()=>fakeAuditDb};
  return originalLoad.call(this,request,parent,...rest);
 };
 auditEndpoint=require('../app/api/audits/route.ts');
} finally {Module._load=originalLoad;}

test('audit endpoint denies resident access and unscoped Staff reads before querying the database',async()=>{
 auditApiCalls=[];auditApiActor={role:'resident'};
 let response=await auditEndpoint.GET(new Request('http://localhost/api/audits?reference='+ref));
 assert.equal(response.status,403);assert.deepEqual(auditApiCalls,[]);
 auditApiActor={role:'staff'};response=await auditEndpoint.GET(new Request('http://localhost/api/audits'));
 assert.equal(response.status,403);assert.deepEqual(auditApiCalls,[]);
 auditApiApplication={id:1,status:'Draft',staff_encoder_id:null};
 response=await auditEndpoint.GET(new Request('http://localhost/api/audits?reference='+ref));assert.equal(response.status,404);
});

test('audit endpoint reads every page for Admin and scopes Staff transaction history',async()=>{
 auditApiCalls=[];auditApiFilters=[];auditApiActor={role:'admin'};
 auditApiRows=Array.from({length:1001},(_,index)=>({id:index+1,timestamp:at,user_id:'admin-id',role:'admin',action:'Edit Fields',reference_no:index===1000?'other':ref,reversion:true}));
 let response=await auditEndpoint.GET(new Request('http://localhost/api/audits'));
 assert.equal(response.status,200);let body=await response.json();
 assert.equal(body.audits.length,1001);assert.equal(body.audits[1000].id,'db-1001');
 assert.equal(body.audits[0].user,'Admin One');assert.equal(body.audits[0].timestamp,at);
 auditApiActor={role:'staff'};auditApiApplication={id:1,status:'Pending Assessment',staff_encoder_id:null};
 response=await auditEndpoint.GET(new Request('http://localhost/api/audits?reference='+ref));body=await response.json();
 assert.equal(response.status,200);assert.equal(body.audits.length,1000);assert.ok(body.audits.every(row=>row.reference===ref));
});

test('audit endpoint filters views and changes in the database, defaulting to changes',async()=>{
 auditApiActor={role:'admin'};auditApiCalls=[];auditApiFilters=[];
 auditApiRows=[
  {id:1,timestamp:at,user_id:'admin-id',role:'admin',action:'file_view',reference_no:ref},
  {id:2,timestamp:at,user_id:'admin-id',role:'admin',action:'record_view',reference_no:ref},
  {id:3,timestamp:at,user_id:'admin-id',role:'admin',action:'Edit Fields',reference_no:ref},
 ];
 let response=await auditEndpoint.GET(new Request('http://localhost/api/audits?view=views'));let body=await response.json();
 assert.equal(response.status,200);assert.deepEqual(body.audits.map(row=>row.action),['file_view','record_view']);
 assert.deepEqual(auditApiFilters,[['in',['file_view','record_view']]]);
 auditApiFilters=[];response=await auditEndpoint.GET(new Request('http://localhost/api/audits'));body=await response.json();
 assert.equal(response.status,200);assert.deepEqual(body.audits.map(row=>row.action),['Edit Fields']);
 assert.deepEqual(auditApiFilters,[['neq','file_view'],['neq','record_view']]);
 response=await auditEndpoint.GET(new Request('http://localhost/api/audits?view=everything'));assert.equal(response.status,400);
});

test('Admin log loads collect database entries newest first and drop sample ones; schedules load only for Staff and Admin',()=>{
 const entry=(id,timestamp,extra={})=>({id,timestamp,user:'Admin One',role:'admin',action:'Edit Fields',reference:'SJ-2026-000001',reversion:true,...extra});
 let s={...state('admin'),audits:[entry('audit-sample','2026-01-01T00:00:00.000Z')]};
 s=transition(s,{type:'loadAudits',audits:[entry('db-1','2026-11-01T00:00:00.000Z'),entry('db-2','2026-11-02T00:00:00.000Z')]});
 assert.deepEqual(s.audits.map(a=>a.id),['db-2','db-1']);
 s=transition(s,{type:'loadAudits',audits:[entry('db-3','2026-10-01T00:00:00.000Z'),entry('db-2','2026-11-02T00:00:00.000Z',{reason:'reloaded'})]});
 assert.deepEqual(s.audits.map(a=>a.id),['db-2','db-1','db-3']);assert.equal(s.audits[0].reason,'reloaded');
 const schedules=[{...mockFeeSchedules[0],id:'42'}];
 assert.deepEqual(transition(state('staff-maria'),{type:'loadSchedules',schedules}).schedules.map(x=>x.id),['42']);
 assert.deepEqual(transition(state('admin'),{type:'loadSchedules',schedules}).schedules.map(x=>x.id),['42']);
 assert.throws(()=>transition(state(),{type:'loadSchedules',schedules}),/Only Staff and Admin/);
});

test('one mobile number in its three spellings maps to the same forms; other numbers are refused',()=>{
 const { mobileForms } = require('../lib/phone.ts');
 const forms={local:'09171234567',international:'+639171234567',stored:'639171234567'};
 for(const input of ['09171234567','+639171234567','639171234567','0917 123 4567','0917-123-4567'])assert.deepEqual(mobileForms(input),forms);
 for(const input of ['','08171234567','0917123456','091712345678','+6309171234567','02 8123 4567','abc'])assert.equal(mobileForms(input),null);
});

// FT-4 reports use saved assessment snapshots; these fixtures do not implement or change the pending FT-1 fee rules.
const collectionFixture=(reference,date,applicationType,category,items,changes={})=>{
 const total=items.reduce((sum,item)=>sum+Math.round(item.amount*100),0)/100;
 return {...mockApplications[0],reference,status:'Ready for Download',dateRequested:'2026-08-15T02:00:00.000Z',applicationType,
  assessment:{items,total,category,classification:'',scheduleId:'saved-snapshot',assessedBy:'Staff',assessedAt:'2026-08-15T03:00:00.000Z'},
  receipt:{orNumber:reference,orDate:'2026-08-31',amountPaid:total,recordedAt:date,encodedBy:'Staff',receiptPhoto:{requirement:'Official Receipt',name:'receipt.jpg',size:100,type:'image/jpeg',status:'Verified'}},
  paymentVerification:{status:'Verified',submittedAt:date,checkedAt:date,checkedBy:'Staff'},clearance:{issueDate:manilaDate(date),generatedAt:date},...changes};
};

test('FT-4 groups by Manila issuance date, subcategory, and New or Renewal with saved fee components',()=>{
 const applications=[
  collectionFixture('new','2026-08-31T16:00:00.000Z','New Application','Ambulant / Mobile Vendor',[{name:'Clearance Fee',amount:100},{name:'Plate',amount:50},{name:'Inspection Fee',amount:25}]),
  collectionFixture('renew','2026-09-01T03:00:00.000Z','Renewal','Ambulant / Mobile Vendor',[{name:'Sticker',amount:40}]),
  collectionFixture('lessor','2026-09-02T03:00:00.000Z','New Application','Lessor',[{name:'Clearance Fee',amount:200}]),
 ];
 const before=structuredClone(applications),report=monthlyCollectionReport(applications,'2026-09');
 assert.equal(report.totals.count,3);assert.equal(report.totals.assessed,415);assert.equal(report.totals.recorded,415);
 assert.equal(report.daily.find(row=>row.applicationType==='Renewal').components.Sticker,40);
 assert.equal(report.daily.find(row=>row.applicationType==='Renewal').components.Plate,undefined);
 assert.equal(report.monthly.filter(row=>row.subcategory==='Ambulant / Mobile Vendor').length,2);
 assert.equal(report.monthly.filter(row=>row.subcategory==='Lessor').length,1);
 assert.deepEqual(report.peakDates,['2026-09-01']);assert.equal(report.peakCount,2);
 assert.equal(report.daily[0].date,'2026-09-01');assert.equal(monthlyCollectionReport(applications,'2026-08').totals.count,0);
 assert.deepEqual(report.totals.components,{'Clearance Fee':300,'Inspection Fee':25,Plate:50,Sticker:40});
 assert.deepEqual(applications,before);
});

test('FT-4 never counts Rejected, Void, pending, review, simulated, or unverified records even with stale OR fields',()=>{
 const valid=collectionFixture('valid','2026-09-01T00:00:00.000Z','Renewal','Lessor',[{name:'Sticker',amount:50}]);
 const excluded=['Draft','Rejected','Void','Pending Assessment','Awaiting OR','For Checking','Under Review'].map((status,index)=>({...valid,reference:'bad-'+index,status}));
 excluded.push({...valid,simulatedPayment:{method:'GCash',amount:50,referenceNumber:'SIM-test',paidAt:at,note:'Simulation'}},
  {...valid,paymentVerification:{...valid.paymentVerification,status:'Pending'}},
  {...valid,receipt:undefined},{...valid,clearance:undefined},{...valid,assessment:undefined},
  {...valid,receipt:{...valid.receipt,receiptPhoto:undefined},receiptPhoto:undefined});
 assert.equal(monthlyCollectionReport(excluded,'2026-09').totals.count,0);
 const report=monthlyCollectionReport([valid,...excluded],'2026-09');assert.equal(report.totals.count,1);assert.equal(report.totals.recorded,50);
 const closed={...valid,status:'Closed - Cleared'};assert.equal(monthlyCollectionReport([closed],'2026-09').totals.recorded,50);
});

test('FT-4 reconciles decimal amounts, tied peak days, type filters, and empty months',()=>{
 const applications=[
  collectionFixture('one','2026-09-01T00:00:00.000Z','New Application','Lessor',[{name:'Custom Fee',amount:0.1},{name:'constructor',amount:0.2}]),
  collectionFixture('two','2026-09-02T00:00:00.000Z','New Application','Lessor',[{name:'Custom Fee',amount:0.2}]),
  collectionFixture('three','2026-09-02T01:00:00.000Z','New Application','',[{name:'Electrical Clearance',amount:100}],{clearanceType:'Electrical Clearance'}),
 ];
 const report=monthlyCollectionReport(applications,'2026-09');assert.equal(report.totals.recorded,100.5);
 assert.equal(report.totals.components['Custom Fee'],0.3);assert.equal(report.totals.components.constructor,0.2);
 const filtered=monthlyCollectionReport(applications,'2026-09','Business Clearance');
 assert.deepEqual(filtered.peakDates,['2026-09-01','2026-09-02']);assert.equal(filtered.peakCount,1);
 assert.equal(filtered.totals.recorded,0.5);assert.equal(filtered.monthly[0].recorded,0.5);
 const empty=monthlyCollectionReport(applications,'2026-10');assert.equal(empty.totals.count,0);assert.deepEqual(empty.daily,[]);assert.deepEqual(empty.peakDates,[]);assert.deepEqual(empty.feeComponents,[]);
 assert.equal(monthlyCollectionReport(applications,'2026-09','Building Clearance').totals.count,0);
});

const {inspectionInputValue,inspectionTimestamp,inspectionQueue}=require('../lib/inspections.ts');

test('FT-9 converts Manila appointment inputs independently of device timezone and validates calendar dates',()=>{
 assert.equal(inspectionTimestamp('2026-11-07T00:30'),'2026-11-06T16:30:00.000Z');
 assert.equal(inspectionInputValue('2026-11-06T16:30:00.000Z'),'2026-11-07T00:30');
 assert.equal(inspectionTimestamp(''),undefined);
 for(const value of ['2026-02-30T09:00','2026-11-07T25:00','bad'])assert.throws(()=>inspectionTimestamp(value),/valid inspection/);
});

test('FT-9 records scheduling, rescheduling, completion and unscheduling without mutating earlier reports',()=>{
 const scheduledAt='2026-09-08T01:00:00.000Z',report={status:'Pending',inspector:'  Pedro Staff  ',date:'',remarks:'Bring checklist',scheduledAt};
 const before=state('staff-maria');let s=transition(before,{type:'inspection',reference:ref,report},at);
 assert.equal(app(s).inspection.inspector,'Pedro Staff');assert.equal(app(s).inspection.scheduledAt,scheduledAt);assert.equal(s.audits[0].action,'Inspection scheduled');
 const first=structuredClone(app(s).inspection);
 s=transition(s,{type:'inspection',reference:ref,report:{...app(s).inspection,scheduledAt:'2026-09-09T02:00:00.000Z'}},at);
 assert.equal(s.audits[0].action,'Inspection rescheduled');assert.equal(JSON.parse(s.audits[0].oldValue).scheduledAt,scheduledAt);
 assert.equal(app(before).inspection,undefined);assert.equal(first.scheduledAt,scheduledAt);
 const overdue=transition(s,{type:'inspection',reference:ref,report:{...app(s).inspection,remarks:'Following up'}},'2026-09-10T01:00:00.000Z');
 assert.equal(app(overdue).inspection.scheduledAt,'2026-09-09T02:00:00.000Z');
 const completed=transition(overdue,{type:'inspection',reference:ref,report:{...app(overdue).inspection,status:'Completed',date:'2026-09-10'}},'2026-09-10T02:00:00.000Z');
 assert.equal(completed.audits[0].action,'Inspection completed');assert.equal(inspectionQueue(completed.applications,'2026-09-10T02:00:00.000Z').overdue.length,0);
 s=transition(s,{type:'inspection',reference:ref,report:{...app(s).inspection,scheduledAt:undefined}},at);
 assert.equal(s.audits[0].action,'Inspection schedule cleared');assert.equal(app(s).inspection.scheduledAt,undefined);
});

test('FT-9 rejects unauthorized or invalid scheduling and blocks assessment until the scheduled inspection is complete',()=>{
 const report={status:'Pending',inspector:'Pedro Staff',date:'',remarks:'',scheduledAt:'2026-09-08T01:00:00.000Z'};
 const schedule=(s,changes={})=>transition(s,{type:'inspection',reference:ref,report:{...report,...changes}},at);
 for(const id of ['resident-maria','admin'])assert.throws(()=>schedule(state(id)),/Only Staff/);
 assert.throws(()=>schedule(state('staff-maria'),{inspector:' '}),/Assign an inspector/);
 assert.throws(()=>schedule(state('staff-maria'),{scheduledAt:'2026-09-01T00:00:00Z'}),/not in the past/);
 assert.throws(()=>schedule(state('staff-maria'),{scheduledAt:'2026-02-30T00:00:00Z'}),/valid inspection date/);
 assert.throws(()=>schedule(state('staff-maria'),{status:'Unknown'}),/valid inspection status/);
 for(const status of ['Draft','Rejected','Void','Awaiting OR','Ready for Download']){const s=state('staff-maria');app(s).status=status;assert.throws(()=>schedule(s));}
 let s=schedule(state('staff-maria'));assert.throws(()=>assess(s),/Complete the scheduled inspection/);
 s=transition(s,{type:'inspection',reference:ref,report:{...app(s).inspection,status:'Completed',date:'2026-09-07'}},at);
 assert.equal(app(assess(s)).status,'Awaiting OR');
 assert.throws(()=>transition(s,{type:'inspection',reference:ref,report:{...app(s).inspection,date:'2026-09-31'}},at),/valid inspection completion date/);
 const cleared=transition(schedule(state('staff-maria')),{type:'inspection',reference:ref,report:{...report,scheduledAt:undefined}},at);
 assert.equal(app(assess(cleared)).status,'Awaiting OR');
});

test('FT-9 lists upcoming and overdue appointments in time order and excludes completed or inactive requests',()=>{
 const make=(reference,scheduledAt,changes={})=>({...app(state()),reference,inspection:{status:'Pending',inspector:'Pedro',date:'',remarks:'',scheduledAt},...changes});
 const applications=[make('later','2026-09-08T03:00:00Z'),make('earlier','2026-09-07T03:00:00Z'),make('overdue','2026-09-06T03:00:00Z'),make('void','2026-09-08T03:00:00Z',{status:'Void'}),make('rejected','2026-09-08T03:00:00Z',{status:'Rejected'}),make('closed','2026-09-08T03:00:00Z',{status:'Closed - Cleared'}),make('completed','2026-09-08T03:00:00Z',{inspection:{status:'Completed',inspector:'Pedro',date:'2026-09-06',remarks:'',scheduledAt:'2026-09-08T03:00:00Z'}})];
 const original=structuredClone(applications),queue=inspectionQueue(applications,'2026-09-07T02:00:00Z');
 assert.deepEqual(queue.upcoming.map(a=>a.reference),['earlier','later']);assert.deepEqual(queue.overdue.map(a=>a.reference),['overdue']);assert.deepEqual(applications,original);
});

// The inspection workflow endpoint is exercised without a Supabase connection.
let inspectionApiActor,inspectionApiReport,inspectionApiError,inspectionApiAudit=[];
const inspectionDbRow={id:1,reference_no:ref,resident_id:'resident-maria',applicant_name:'Maria Clara',status:'Pending Assessment',date_requested:at,clearance_types:{name:'Business Clearance'},application_documents:[]};
const inspectionDb={from(table){const q={select(){return q},eq(){return q},is(){return q},
 async maybeSingle(){return {data:{...inspectionDbRow,inspection_reports:inspectionApiReport},error:null}},
 async single(){return {data:{...inspectionDbRow,inspection_reports:inspectionApiReport},error:null}},
 async upsert(value){if(!inspectionApiError)inspectionApiReport=value;return {error:inspectionApiError}},
 async insert(value){if(table==='audit_logs')inspectionApiAudit.push(...value);return {error:null}},
 then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)},
 };return q}};
let inspectionEndpoint,inspectionMapper;
try{
 Module._load=function(request,parent,...rest){
  if(request==='server-only')return {};
  if(request==='@/lib/server/currentUser')return {currentUser:async()=>({user:inspectionApiActor})};
  if(request==='@/lib/supabase/server')return {supabaseAdmin:()=>inspectionDb};
  return originalLoad.call(this,request,parent,...rest);
 };
 inspectionEndpoint=require('../app/api/workflow/route.ts');inspectionMapper=require('../lib/server/applicationRows.ts').toApplication;
}finally{Module._load=originalLoad;}

test('FT-9 persists and restores scheduled inspections, restricts internal data, and explains a missing migration',async()=>{
 inspectionApiActor={id:'staff-id',role:'staff',firstName:'Maria',lastName:'Staff',status:'Active'};inspectionApiReport=undefined;inspectionApiError=null;inspectionApiAudit=[];
 const report={status:'Pending',inspector:'Pedro Staff',date:'',remarks:'Site visit',scheduledAt:new Date(Date.now()+86400000).toISOString()};
 const request=()=>new Request('http://localhost/api/workflow',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:{type:'inspection',reference:ref,report}})});
 let response=await inspectionEndpoint.POST(request());assert.equal(response.status,200);let body=await response.json();
 assert.equal(inspectionApiReport.scheduled_at,report.scheduledAt);assert.equal(inspectionApiReport.saved_by,'staff-id');assert.equal(body.application.inspection.scheduledAt,report.scheduledAt);
 assert.equal(inspectionApiAudit[0].action,'Inspection scheduled');
 assert.equal(inspectionMapper({...inspectionDbRow,inspection_reports:inspectionApiReport}).inspection,undefined);
 assert.equal(inspectionMapper({...inspectionDbRow,inspection_reports:inspectionApiReport},true).inspection.inspector,'Pedro Staff');
 inspectionApiActor={...inspectionApiActor,id:'resident-maria',role:'resident'};response=await inspectionEndpoint.POST(request());assert.equal(response.status,400);assert.match((await response.json()).error,/Only Staff/);
 inspectionApiActor={...inspectionApiActor,id:'staff-id',role:'staff'};inspectionApiError={message:'scheduled_at column missing'};
 response=await inspectionEndpoint.POST(request());assert.equal(response.status,500);assert.match((await response.json()).error,/20261108000000_inspection_scheduling.sql/);
});


test('FT-10 server resolves active team recipients, refreshes unread duplicates and surfaces schema errors',async()=>{
 const {persistTeamNotice}=require('../lib/server/teamNotifications.ts');
 const calls=[];let insertError=null,recipientError=null;
 const db={from(table){const q={
  select(){return q},eq(column,value){calls.push(['eq',table,column,value]);return q},
  in(column,value){calls.push(['in',column,value]);return q},order(){return q},is(column,value){calls.push(['is',column,value]);return q},
  async range(){return {data:recipientError?null:[{id:'staff-db'},{id:'admin-db'}],error:recipientError}},
  async insert(row){calls.push(['insert',row]);return {error:insertError}},
  update(row){calls.push(['update',row]);return q},then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject)}
 };return q}};
 const after={...app(state()),status:'For Checking'},before={...after,status:'Awaiting OR'};
 await persistTeamNotice(db,'receiptPhoto',before,after,42,at);
 assert.deepEqual(calls.find(c=>c[0]==='in'),['in','role',['staff','admin']]);
 assert.ok(calls.some(c=>c[0]==='eq'&&c[2]==='status'&&c[3]==='Active'));
 assert.deepEqual(calls.filter(c=>c[0]==='insert').map(c=>c[1].user_id),['staff-db','admin-db']);
 assert.ok(calls.filter(c=>c[0]==='insert').every(c=>c[1].application_id===42&&c[1].event==='payment_pending'));
 calls.length=0;insertError={code:'23505'};
 await persistTeamNotice(db,'receiptPhoto',before,after,42,at);
 assert.equal(calls.filter(c=>c[0]==='update').length,2);assert.ok(calls.some(c=>c[0]==='is'&&c[1]==='read_at'&&c[2]===null));
 calls.length=0;await persistTeamNotice(db,'review',before,after,42,at);assert.deepEqual(calls,[]);
 insertError={code:'23514',message:'event constraint'};
 await assert.rejects(()=>persistTeamNotice(db,'receiptPhoto',before,after,42,at),/FT-10 notification event constraint/);
 recipientError={message:'offline'};
 await assert.rejects(()=>persistTeamNotice(db,'receiptPhoto',before,after,42,at),/recipients could not be loaded/);
});

let teamNotificationEndpoint,teamNotificationActor,teamNotificationCalls=[];
const teamNotificationDb={from(){const q={select(){return q},order(){return q},limit(){return q},
 eq(column,value){teamNotificationCalls.push(['eq',column,value]);return q},is(column,value){teamNotificationCalls.push(['is',column,value]);return q},update(){return q},
 then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)}
 };return q}};
try{
 Module._load=function(request,parent,...rest){
  if(request==='@/lib/server/currentUser')return {currentUser:async()=>({user:teamNotificationActor})};
  if(request==='@/lib/supabase/session')return {supabaseForRequest:()=>teamNotificationDb};
  return originalLoad.call(this,request,parent,...rest);
 };
 teamNotificationEndpoint=require('../app/api/notifications/route.ts');
}finally{Module._load=originalLoad;}

test('FT-10 notification GET and mark-read stay scoped to the authenticated user for every role',async()=>{
 for(const role of ['resident','staff','admin']){
  teamNotificationActor={id:role+'-id',role};teamNotificationCalls=[];
  assert.equal((await teamNotificationEndpoint.GET()).status,200);
  assert.deepEqual(teamNotificationCalls,[['eq','user_id',role+'-id']]);
  teamNotificationCalls=[];assert.equal((await teamNotificationEndpoint.POST()).status,200);
  assert.deepEqual(teamNotificationCalls,[['eq','user_id',role+'-id'],['is','read_at',null]]);
 }
});

let sensitiveActor,sensitiveLogError,sensitiveLogged=[],sensitiveSigned=[],sensitiveMembership=true;
const sensitiveApplication={id:42,resident_id:'resident-id',status:'Pending Assessment',staff_encoder_id:null,reference_no:ref};
const sensitiveDb={
 from(table){
  const filters={};
  const query={
   select(){return query},eq(column,value){filters[column]=value;return query},
   async maybeSingle(){
    if(table==='applications')return {data:sensitiveApplication,error:null};
    if(table==='application_documents')return {data:sensitiveMembership&&filters.storage_path==='42/id.pdf'?{storage_path:'42/id.pdf'}:null,error:null};
    if(table==='official_receipts')return {data:null,error:null};
    if(table==='profiles')return {data:sensitiveMembership&&filters.valid_id_path==='resident-id/id.jpg'?{valid_id_path:'resident-id/id.jpg'}:null,error:null};
    return {data:null,error:null};
   },
  };
  return query;
 },
 storage:{from(bucket){return {async createSignedUrl(path,expiresIn){sensitiveSigned.push({bucket,path,expiresIn});return {data:{signedUrl:'https://signed.example/private'},error:null}}}}},
};
let signedUrlEndpoint,recordViewEndpoint,sensitivePersist;
try{
 Module._load=function(request,parent,...rest){
  if(request==='@/lib/server/currentUser')return {currentUser:async()=>({user:sensitiveActor})};
  if(request==='@/lib/server/persist')return {logSensitiveView:async(_db,event)=>{sensitiveLogged.push(event);if(sensitiveLogError)throw sensitiveLogError;return true}};
  if(request==='@/lib/supabase/server')return {supabaseAdmin:()=>sensitiveDb};
  if(request==='server-only')return {};
  return originalLoad.call(this,request,parent,...rest);
 };
 signedUrlEndpoint=require('../app/api/files/signed-url/route.ts');
 recordViewEndpoint=require('../app/api/applications/[reference]/view/route.ts');
 sensitivePersist=require('../lib/server/persist.ts');
}finally{Module._load=originalLoad;}

test('SE-4 signed URL route logs Staff opens before signing and fails closed on log errors',async()=>{
 sensitiveActor={id:'staff-id',role:'staff'};sensitiveLogError=null;sensitiveLogged=[];sensitiveSigned=[];
 const request=()=>new Request('http://localhost/api/files/signed-url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bucket:'application-documents',path:'42/id.pdf',reference:ref})});
 let response=await signedUrlEndpoint.POST(request());let body=await response.json();
 assert.equal(response.status,200);assert.equal(body.signedUrl,'https://signed.example/private');
 assert.deepEqual(sensitiveLogged.map(event=>[event.action,event.objectPath,event.applicationId]),[['file_view','42/id.pdf',42]]);
 assert.deepEqual(sensitiveSigned,[{bucket:'application-documents',path:'42/id.pdf',expiresIn:300}]);
 sensitiveLogError=new Error('audit insert failed');sensitiveLogged=[];sensitiveSigned=[];
 response=await signedUrlEndpoint.POST(request());body=await response.json();
 assert.equal(response.status,500);assert.equal(body.signedUrl,undefined);assert.deepEqual(sensitiveSigned,[]);
});

test('SE-4 signed URL route permits only an authenticated resident own-file path without logging',async()=>{
 sensitiveActor={id:'resident-id',role:'resident'};sensitiveLogError=null;sensitiveLogged=[];sensitiveSigned=[];
 const request=(reference=ref,path='42/id.pdf')=>new Request('http://localhost/api/files/signed-url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bucket:'application-documents',path,reference})});
 let response=await signedUrlEndpoint.POST(request());assert.equal(response.status,200);assert.equal(sensitiveLogged.length,0);
 sensitiveActor={id:'other-resident',role:'resident'};response=await signedUrlEndpoint.POST(request());
 assert.equal(response.status,403);assert.equal(sensitiveSigned.length,1);
});

test('SE-4 record view route logs Staff opens but validates resident ownership without logging',async()=>{
 sensitiveActor={id:'admin-id',role:'admin'};sensitiveLogged=[];sensitiveLogError=null;
 let response=await recordViewEndpoint.POST(new Request('http://localhost/api/applications/'+ref+'/view',{method:'POST'}),{params:{reference:ref}});
 assert.equal(response.status,200);assert.deepEqual(sensitiveLogged.map(event=>event.action),['record_view']);
 sensitiveActor={id:'resident-id',role:'resident'};sensitiveLogged=[];
 response=await recordViewEndpoint.POST(new Request('http://localhost/api/applications/'+ref+'/view',{method:'POST'}),{params:{reference:ref}});
 assert.equal(response.status,200);assert.equal((await response.json()).logged,false);assert.equal(sensitiveLogged.length,0);
});

test('SE-4 database lookup deduplicates file and record views and writes again after five minutes',async()=>{
 const entries=[],inserted=[];let insertError=null;
 const db={from(table){
  let filters={},cutoff='',containsValue;
  const query={
   select(){return query},eq(column,value){filters[column]=value;return query},gte(_column,value){cutoff=value;return query},
   contains(_column,value){containsValue=value;return query},order(){return query},limit(){return query},
   async maybeSingle(){
    const data=entries.filter(row=>row.user_id===filters.user_id&&row.action===filters.action&&row.created_at>=cutoff
     &&(filters.application_id===undefined||row.application_id===filters.application_id)
     &&(!containsValue||row.new_value.objectPath===containsValue.objectPath)).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
    return {data:data?{created_at:data.created_at}:null,error:null};
   },
   async insert(row){if(insertError)return {error:insertError};for(const item of Array.isArray(row)?row:[row]){entries.push(item);inserted.push(item)}return {error:null}},
  };return query;
 }};
 const base=new Date(at),actor={id:'staff-id',role:'staff'};
 for(const action of ['file_view','record_view']){
  const event={action,actor,applicationId:42,reference:ref,...(action==='file_view'?{objectPath:'42/id.pdf'}:{})};
  assert.equal(await sensitivePersist.logSensitiveView(db,{...event,at:base}),true);
  assert.equal(await sensitivePersist.logSensitiveView(db,{...event,at:new Date(base.getTime()+299999)}),false);
  if(action==='file_view')assert.equal(await sensitivePersist.logSensitiveView(db,{...event,applicationId:43,at:new Date(base.getTime()+1000)}),true);
  assert.equal(await sensitivePersist.logSensitiveView(db,{...event,at:new Date(base.getTime()+300001)}),true);
 }
 assert.equal(inserted.length,5);assert.deepEqual(inserted.filter(row=>row.action==='file_view').map(row=>row.application_id),[42,43,42]);
 assert.deepEqual(inserted.filter(row=>row.action==='file_view').map(row=>row.new_value),[{objectPath:'42/id.pdf'},{objectPath:'42/id.pdf'},{objectPath:'42/id.pdf'}]);
 assert.ok(inserted.every(row=>!JSON.stringify(row).includes('signed.example')));
});


test('FT-17 spam rejection records a canonical reason in the application, audit and Applicant notice',()=>{
 const s=state('staff-maria'),before=structuredClone(s);
 const next=transition(s,{type:'reject',reference:ref,category:'spam',reason:'  Repeated abusive submissions  '},at);
 assert.equal(app(next).rejection.reason,'Spam / abuse: Repeated abusive submissions');
 assert.equal(next.audits[0].reason,app(next).rejection.reason);
 assert.ok(notificationsFor(next,'resident-maria')[0].message.includes(app(next).rejection.reason));
 assert.deepEqual(s,before);assert.equal(next.users.find(u=>u.id==='resident-maria').spamFlaggedAt,undefined);
 assert.throws(()=>transition(s,{type:'reject',reference:ref,category:'spam',reason:' '},at),/reason is required/);
 assert.throws(()=>transition(s,{type:'reject',reference:ref,category:'invalid',reason:'test'},at),/valid rejection category/);
 assert.throws(()=>transition(state(),{type:'reject',reference:ref,category:'spam',reason:'test'},at),/Only Staff or Admin/);
 const ordinary=transition(s,{type:'reject',reference:ref,reason:'Missing document'},at);
 assert.equal(app(ordinary).rejection.reason,'Missing document');
});

test('FT-17 defaults hide Rejected and Void, but explicit filters and open corrections remain reachable',()=>{
 const {matchesApplicationStatus}=require('../lib/applicationVisibility.ts');const base=app(state());
 for(const status of ['Rejected','Void']){
  const a={...base,status};assert.equal(matchesApplicationStatus(a,'',false),false);
  assert.equal(matchesApplicationStatus(a,'',true),true);assert.equal(matchesApplicationStatus(a,status,false),true);
 }
 const rejected={...base,status:'Rejected',corrections:[{id:'c',status:'Open'}]};
 assert.equal(matchesApplicationStatus(rejected,'Correction Requests',false),true);
 assert.equal(matchesApplicationStatus({...rejected,corrections:[{id:'c',status:'Resolved'}]},'Correction Requests',false),false);
 assert.equal(matchesApplicationStatus(base,'',false),true);
 assert.equal(matchesApplicationStatus(base,'Awaiting OR',false),false);
});

test('FT-17 retains DB-11 submission rules: spam block and one open request until ID verification',async()=>{
 let submissionBlock;
 try{Module._load=function(request,parent,...rest){if(request==='server-only')return {};return originalLoad.call(this,request,parent,...rest)};({submissionBlock}=require('../lib/server/accountChecks.ts'));}finally{Module._load=originalLoad;}
 let profile={id_verified_at:null,id_verified_by:null,spam_flagged_at:null,spam_flagged_by:null,spam_reason:null},count=1,error=null,calls=[];
 const db={from(table){const q={select(){return q},eq(column,value){calls.push(['eq',column,value]);return q},in(column,value){calls.push(['in',column,value]);return q},neq(column,value){calls.push(['neq',column,value]);return q},
 async maybeSingle(){return {data:profile,error}},then(resolve,reject){return Promise.resolve({count,error}).then(resolve,reject)}
 };return q}};
 const block=()=>submissionBlock(db,'resident-id','current-draft',false);
 assert.equal((await block()).status,409);assert.ok(calls.some(c=>c[0]==='neq'&&c[1]==='reference_no'&&c[2]==='current-draft'));
 assert.ok(calls.find(c=>c[0]==='in')[2].includes('Rejected'));assert.ok(!calls.find(c=>c[0]==='in')[2].includes('Void'));
 count=0;assert.equal(await block(),null);count=10;
 profile={...profile,id_verified_at:at};assert.equal(await block(),null);
 profile={...profile,id_verified_at:null};assert.equal(await submissionBlock(db,'resident-id',undefined,true),null);
 profile={...profile,spam_flagged_at:at};assert.equal((await block()).status,403);
 assert.equal((await submissionBlock(db,'resident-id',undefined,true)).status,403);
 profile={...profile,spam_flagged_at:null};error={message:'offline'};assert.equal((await block()).status,500);
});


let abuseEndpoint,abuseActor,abuseCheck={},abuseAudit=[],abuseRole='resident';
const abuseResident='11111111-1111-4111-8111-111111111111';
const abuseDb={from(table){let columns='';const q={select(value){columns=value;return q},eq(){return q},in(){return q},
 async maybeSingle(){return {data:columns==='id, role'?{id:abuseResident,role:abuseRole}:abuseCheck,error:null}},
 update(value){abuseCheck={...abuseCheck,...value};return q},async insert(value){abuseAudit.push(value);return {error:null}},
 then(resolve,reject){return Promise.resolve({data:table==='profiles'?[{id:'staff-id',first_name:'Maria',last_name:'Staff'}]:[],error:null}).then(resolve,reject)}
 };return q}};
try{
 Module._load=function(request,parent,...rest){
  if(request==='server-only')return {};
  if(request==='@/lib/server/currentUser')return {currentUser:async()=>({user:abuseActor})};
  if(request==='@/lib/supabase/server')return {supabaseAdmin:()=>abuseDb};
  return originalLoad.call(this,request,parent,...rest);
 };
 abuseEndpoint=require('../app/api/residents/check/route.ts');
}finally{Module._load=originalLoad;}

test('FT-17 existing account flag is audited, requires a reason and can only be cleared by Admin',async()=>{
 abuseActor={id:'resident-id',role:'resident'};abuseRole='resident';abuseAudit=[];
 const request=(action,reason='')=>new Request('http://localhost/api/residents/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({residentId:abuseResident,action,reason})});
 assert.equal((await abuseEndpoint.POST(request('flag','test'))).status,403);
 abuseActor={id:'staff-id',role:'staff'};assert.equal((await abuseEndpoint.POST(request('flag'))).status,400);
 assert.equal((await abuseEndpoint.POST(request('unflag'))).status,403);
 abuseCheck={id_verified_at:null,id_verified_by:null,spam_flagged_at:null,spam_flagged_by:null,spam_reason:null};
 let response=await abuseEndpoint.POST(request('flag','Repeated abusive requests'));let body=await response.json();
 assert.equal(response.status,200);assert.ok(body.check.spamFlaggedAt);assert.equal(body.check.spamReason,'Repeated abusive requests');
 assert.equal(abuseAudit.at(-1).action,'Account flagged as spam');assert.equal(abuseAudit.at(-1).reason,'Repeated abusive requests');
 abuseActor={id:'admin-id',role:'admin'};response=await abuseEndpoint.POST(request('unflag'));body=await response.json();
 assert.equal(response.status,200);assert.equal(body.check.spamFlaggedAt,null);assert.equal(abuseAudit.at(-1).action,'Spam flag cleared');
 abuseRole='staff';assert.equal((await abuseEndpoint.POST(request('flag','test'))).status,404);
});
