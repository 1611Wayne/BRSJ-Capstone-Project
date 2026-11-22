// Fees on the Staff assessment page (FT-1, 2026-11-18, and the barangay's written answers, 2026-11-22): the size is NOT
// pre-selected (Staff pick it from the photo of the business); the Inspection Fee follows the size (Small 50; Medium,
// Large, Big 100); a new business pays the Plate and the Inspection Fee, a renewal the Sticker only; "No. of Employee" is
// 50 per head; a new TODA Clearance is the plate only (150), a renewal the franchise permit (50).
require('../tests/register-ts.cjs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mockApplications}=require('../data/mockApplications.ts'),{mockUsers}=require('../data/mockUsers.ts'),{mockFeeSchedules}=require('../data/mockFeeSchedules.ts');
const KEY='san-jose-prototype-v2',BASE=process.env.E2E_BASE||'http://localhost:3100',CHANNEL=process.env.E2E_CHANNEL??'msedge';
const base=mockApplications[0];
const entry=(reference,changes)=>({...base,reference,status:'Pending Assessment',assessment:undefined,...changes});
// This test's own copy of the sample fees with the real rates: 50 per employee, and the TODA plate 150.
const schedules=mockFeeSchedules.map(s=>({...s,items:s.items.map(i=>s.clearanceType==='Business Clearance'&&i.name==='No. of Employee'?{...i,amount:50}:s.clearanceType==='TODA Clearance'&&i.name==='Plate'?{...i,amount:150}:i)}));
const seed={users:mockUsers,schedules,audits:[],notifications:[],currentUserId:'staff-maria',applications:[...mockApplications,
 entry('SJ-2026-000140',{applicationType:'New Application',hasEmployees:true,employeeCount:5}),
 entry('SJ-2026-000141',{applicationType:'New Application',hasEmployees:true,employeeCount:150}),
 entry('SJ-2026-000142',{applicationType:'Renewal',hasEmployees:true,employeeCount:2}),
 entry('SJ-2026-000143',{clearanceType:'TODA Clearance',applicationType:'New Application',hasEmployees:false,employeeCount:undefined}),
 entry('SJ-2026-000144',{clearanceType:'TODA Clearance',applicationType:'Renewal',hasEmployees:false,employeeCount:undefined})]};
let checks=0;const check=(name,ok,detail='')=>{assert.ok(ok,name+(detail?' -> '+detail:''));checks++;console.log('PASS '+name)};
(async()=>{
 const browser=await chromium.launch({...(CHANNEL?{channel:CHANNEL}:{}),headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(([key,value])=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,value)},[KEY,JSON.stringify(seed)]);
  const amount=name=>page.getByLabel(name+' amount',{exact:true}).inputValue();
  const open=async ref=>{await page.goto(BASE+'/staff/assessment/'+ref);await page.getByRole('heading',{name:/Assessment & Evaluation/}).waitFor();};
  const size=()=>page.getByLabel(/^Classification/);

  await open('SJ-2026-000140');
  check('no size is pre-selected (Staff pick it from the photo)',await size().inputValue()==='');
  check('...the page says to pick it from the Picture of Establishment',await page.getByText(/^Pick the size from the Picture of Establishment/).count()===1);
  check('...no fees until a size is chosen, and the hint says so',await page.getByLabel('Plate amount',{exact:true}).count()===0&&await page.getByText('Choose the size above to see the fees.').count()===1);
  check('...and no employee-based suggestion any more',await page.getByText(/Suggested from/).count()===0);
  await size().selectOption('Small');
  check('Small, new: Plate 150, Inspection 50, Sticker 0',await amount('Plate')==='150.00'&&await amount('Inspection Fee')==='50.00'&&await amount('Sticker')==='0.00');
  check('5 employees x 50 = 250 on No. of Employee, and the note says so',await amount('No. of Employee')==='250.00'&&await page.getByText(/No\. of Employee: ₱50 per head × 5 employees/).count()===1);
  check('total ₱550.00 (Small 100 + plate 150 + inspection 50 + employees 250)',await page.getByText('₱550.00').count()>0);

  await open('SJ-2026-000141');
  await size().selectOption('Medium');
  check('Medium: the inspection is the big one, 100, whatever the employees',await amount('Inspection Fee')==='100.00');
  check('150 employees x 50 = 7,500',await amount('No. of Employee')==='7500.00');
  await size().selectOption('Small');
  check('changing to Small brings the inspection back to 50',await amount('Inspection Fee')==='50.00');
  await page.getByLabel('Inspection Fee amount',{exact:true}).fill('100');
  check('Staff can still edit any amount by hand',await amount('Inspection Fee')==='100');

  await open('SJ-2026-000142');
  await size().selectOption('Large');
  check('a renewal: Sticker 100, Plate 0, Inspection 0; employees still charged (2 x 50)',await amount('Sticker')==='100.00'&&await amount('Plate')==='0.00'&&await amount('Inspection Fee')==='0.00'&&await amount('No. of Employee')==='100.00');
  check('...and the note says the Sticker applies',await page.getByText(/^Renewal: the Sticker applies/).count()===1);

  await open('SJ-2026-000143');
  await page.getByLabel('Plate amount',{exact:true}).waitFor();
  check('TODA new: the plate only, 150 in total',await amount('Plate')==='150.00'&&await amount('TODA Clearance')==='0.00'&&await page.getByText('New application: the plate only; no franchise permit fee.').count()===1);
  await open('SJ-2026-000144');
  await page.getByLabel('Plate amount',{exact:true}).waitFor();
  check('TODA renewal: the franchise permit only (the schedule amount), no plate',await amount('Plate')==='0.00'&&await amount('TODA Clearance')===schedules.find(s=>s.clearanceType==='TODA Clearance').items[0].amount.toFixed(2)&&await page.getByText('Renewal: the franchise permit only; no plate.').count()===1);
  check('no page errors',errors.length===0,errors.join(' | '));
 }finally{await browser.close();}
 console.log(`${checks}/${checks} checks passed`);
})().catch(e=>{console.error('SCRIPT ERROR',e.message);process.exitCode=1;});
