// FT-1 and the size suggestion on the Staff assessment page (barangay, 2026-11-18): a new business starts with the Plate
// and the Inspection Fee (100 for 100+ employees) and no Sticker; a renewal starts with the Sticker only; the size is
// pre-selected from the employees the Applicant entered (1-99 Small, 100-199 Medium, 200+ Large) and Staff can change it.
require('../tests/register-ts.cjs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mockApplications}=require('../data/mockApplications.ts'),{mockUsers}=require('../data/mockUsers.ts'),{mockFeeSchedules}=require('../data/mockFeeSchedules.ts');
const KEY='san-jose-prototype-v2',BASE=process.env.E2E_BASE||'http://localhost:3100',CHANNEL=process.env.E2E_CHANNEL??'msedge';
const base=mockApplications[0];
const entry=(reference,changes)=>({...base,reference,status:'Pending Assessment',assessment:undefined,...changes});
const seed={users:mockUsers,schedules:mockFeeSchedules,audits:[],notifications:[],currentUserId:'staff-maria',applications:[...mockApplications,
 entry('SJ-2026-000140',{applicationType:'New Application',hasEmployees:true,employeeCount:5}),
 entry('SJ-2026-000141',{applicationType:'New Application',hasEmployees:true,employeeCount:150}),
 entry('SJ-2026-000142',{applicationType:'Renewal',hasEmployees:true,employeeCount:250})]};
let checks=0;const check=(name,ok,detail='')=>{assert.ok(ok,name+(detail?' -> '+detail:''));checks++;console.log('PASS '+name)};
(async()=>{
 const browser=await chromium.launch({...(CHANNEL?{channel:CHANNEL}:{}),headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(([key,value])=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,value)},[KEY,JSON.stringify(seed)]);
  const amount=name=>page.getByLabel(name+' amount',{exact:true}).inputValue();
  const open=async ref=>{await page.goto(BASE+'/staff/assessment/'+ref);await page.getByLabel(/^Business Category/).waitFor();};

  await open('SJ-2026-000140');
  check('5 employees: the size is pre-selected as Small, with the reason shown',await page.getByLabel(/^Classification/).inputValue()==='Small'&&await page.getByText('Suggested from 5 employees: Small').count()===1);
  check('a new business: the note says Plate and Inspection Fee apply, no Sticker',await page.getByText(/^New application: the Plate and the Inspection Fee apply/).count()===1);
  check('a new business starts with Plate 150, Inspection 50, Sticker 0 (total ₱300.00 for Sari-Sari Small: 100 + 150 + 50)',await amount('Plate')==='150.00'&&await amount('Inspection Fee')==='50.00'&&await amount('Sticker')==='0.00'&&await page.getByText('₱300.00').count()>0);

  await open('SJ-2026-000141');
  check('150 employees: Medium is pre-selected',await page.getByLabel(/^Classification/).inputValue()==='Medium');
  check('...and the inspection starts at 100 (big)',await amount('Inspection Fee')==='100.00');
  await page.getByLabel(/^Classification/).selectOption('Large');
  check('Staff can still change the size',await page.getByLabel(/^Classification/).inputValue()==='Large');
  await page.getByLabel(/^Business Category/).selectOption('Lessor');
  check('a size list that is not about employees (Lessor units) gets no suggestion',await page.getByText(/^Suggested from/).count()===0&&await page.getByLabel(/^Classification/).inputValue()==='1–4 Units');

  await open('SJ-2026-000142');
  check('250 employees: Large is pre-selected',await page.getByLabel(/^Classification/).inputValue()==='Large');
  check('a renewal: the note says the Sticker applies, no Plate or Inspection Fee',await page.getByText(/^Renewal: the Sticker applies/).count()===1);
  check('a renewal starts with Sticker 100, Plate 0, Inspection 0',await amount('Sticker')==='100.00'&&await amount('Plate')==='0.00'&&await amount('Inspection Fee')==='0.00');
  check('no page errors',errors.length===0,errors.join(' | '));
 }finally{await browser.close();}
 console.log(`${checks}/${checks} checks passed`);
})().catch(e=>{console.error('SCRIPT ERROR',e.message);process.exitCode=1;});
