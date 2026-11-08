// FT-4: day-by-day and monthly collection reports use saved assessments, not pending FT-1 fee policy.
require('../tests/register-ts.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {mockApplications}=require('../data/mockApplications.ts');
const {mockUsers}=require('../data/mockUsers.ts');
const {mockFeeSchedules}=require('../data/mockFeeSchedules.ts');
const {manilaDate}=require('../lib/workflow.ts');
const BASE=process.env.E2E_BASE||'http://localhost:3100',CHANNEL=process.env.E2E_CHANNEL??'msedge',KEY='san-jose-prototype-v2';
const receiptPhoto={requirement:'Official Receipt',name:'receipt.jpg',size:100,type:'image/jpeg',status:'Verified'};
const issued=(ref,date,type,category,items,changes={})=>{
 const total=items.reduce((sum,item)=>sum+Math.round(item.amount*100),0)/100;
 return {...mockApplications[0],reference:ref,dateRequested:'2026-08-15T00:00:00.000Z',status:'Ready for Download',applicationType:type,
  assessment:{items,total,category,classification:'',scheduleId:'saved',assessedBy:'Staff',assessedAt:'2026-08-15T01:00:00.000Z'},
  receipt:{orNumber:ref,orDate:'2026-08-31',amountPaid:total,recordedAt:date,encodedBy:'Staff',receiptPhoto},
  paymentVerification:{status:'Verified',checkedAt:date,submittedAt:date,checkedBy:'Staff'},clearance:{issueDate:manilaDate(date),generatedAt:date},...changes};
};
const newFees=[{name:'Clearance Fee',amount:100},{name:'Plate',amount:50},{name:'Inspection Fee',amount:25}];
const first=issued('new-1','2026-08-31T16:00:00.000Z','New Application','Ambulant / Mobile Vendor',newFees);
const invalid=issued('excluded','2026-09-01T00:00:00.000Z','Renewal','Lessor',[{name:'Sticker',amount:9999}]);
const applications=[first,
 issued('renew-1','2026-09-01T03:00:00.000Z','Renewal','Ambulant / Mobile Vendor',[{name:'Sticker',amount:40}]),
 issued('new-2','2026-09-02T00:00:00.000Z','New Application','Ambulant / Mobile Vendor',newFees,{status:'Closed - Cleared'}),
 issued('lessor','2026-09-02T03:00:00.000Z','Renewal','Lessor',[{name:'Sticker',amount:60}]),
 issued('electrical','2026-09-03T00:00:00.000Z','New Application','',[{name:'Electrical Clearance',amount:100}],{clearanceType:'Electrical Clearance'}),
 ...['Rejected','Void','Under Review','For Checking','Draft'].map((status,i)=>({...invalid,reference:'excluded-'+i,status})),
 {...invalid,reference:'simulated',simulatedPayment:{method:'GCash',amount:9999,paidAt:'2026-09-01',referenceNumber:'SIM-test',note:'Simulation'}},
 {...invalid,reference:'unverified',paymentVerification:{...invalid.paymentVerification,status:'Pending'}},
 {...invalid,reference:'legacy',receipt:{...invalid.receipt,receiptPhoto:undefined}},
 {...invalid,reference:'october',clearance:{issueDate:'2026-10-01',generatedAt:'2026-09-30T16:00:00.000Z'}},
];
const seed={users:mockUsers,applications,schedules:mockFeeSchedules,audits:[],notifications:[],currentUserId:'admin'};
let checks=0;const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log('PASS '+name)};
(async()=>{
 const browser=await chromium.launch({...(CHANNEL?{channel:CHANNEL}:{}),headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(([key,value])=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,value)},[KEY,JSON.stringify(seed)]);
  await page.goto(BASE+'/admin/reports/monthly-collection');
  await page.getByRole('heading',{name:'Monthly Collection Report',exact:true}).waitFor();
  await page.getByLabel(/^Month/).selectOption('09');await page.getByLabel('Year').fill('2026');
  await page.getByRole('button',{name:'Apply Filter',exact:true}).click();
  check('Daily Breakdown is the default view',await page.getByRole('heading',{name:'Daily Breakdown',exact:true}).count()===1);
  const headers=await page.locator('thead th').allTextContents();
  check('daily report includes date, subcategory, application type, fee components, and peak marker',['Date','Peak Day','Subcategory','Application Type','Plate','Sticker','Total Recorded OR Amount'].every(name=>headers.includes(name)));
  const rows=page.locator('tbody tr');
  check('five eligible transactions appear as five daily groups plus a total row',await rows.count()===6);
  const footer=await rows.last().getByRole('cell').allTextContents();
  check('Rejected, Void, unverified, legacy, simulated and out-of-month records do not inflate totals',footer[headers.indexOf('Transaction Count')]==='5'&&footer[headers.indexOf('Total Recorded OR Amount')].includes('550.00'));
  check('an August UTC issuance is counted on September 1 in Manila',await rows.filter({hasText:'2026-09-01'}).count()===2);
  check('both tied peak days are marked',await rows.filter({hasText:'Peak day'}).count()===4&&(await page.locator('body').innerText()).includes('2026-09-01, 2026-09-02'));
  check('New and Renewal are separate rows',await rows.filter({hasText:'New Application'}).count()===3&&await rows.filter({hasText:'Renewal'}).count()===2);
  check('saved subcategory values are displayed',await rows.filter({hasText:'Lessor'}).count()===1&&await rows.filter({hasText:'Ambulant / Mobile Vendor'}).count()===3);
  let promise=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();
  let csv=fs.readFileSync(await(await promise).path(),'utf8');
  check('daily CSV exports the displayed split, peak markers, and reconciled total',csv.includes('"Date"')&&csv.includes('"Renewal"')&&csv.includes('"Peak day"')&&csv.includes('550.00')&&csv.trim().split(/\r?\n/).length===7);
  fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});await page.screenshot({path:path.join(__dirname,'shots','ft4-daily-collections.png'),fullPage:true});
  await page.getByLabel(/^Clearance Type/).selectOption('Business Clearance');
  await page.getByLabel('Report View').selectOption('monthly');await page.getByRole('button',{name:'Apply Filter',exact:true}).click();
  check('Monthly Summary aggregates matching groups across days',await page.getByRole('heading',{name:'Monthly Summary',exact:true}).count()===1&&await rows.count()===4);
  const group=rows.filter({hasText:'Ambulant / Mobile Vendor'}).filter({hasText:'New Application'});
  const monthlyHeaders=await page.locator('thead th').allTextContents(),cells=await group.getByRole('cell').allTextContents();
  check('monthly New group has two transactions and the saved fee totals',cells[monthlyHeaders.indexOf('Transaction Count')]==='2'&&cells[monthlyHeaders.indexOf('Plate')].includes('100.00')&&cells[monthlyHeaders.indexOf('Total Recorded OR Amount')].includes('350.00'));
  const total=await rows.last().getByRole('cell').allTextContents();
  check('clearance filter recalculates monthly totals',total[monthlyHeaders.indexOf('Transaction Count')]==='4'&&total[monthlyHeaders.indexOf('Total Recorded OR Amount')].includes('450.00'));
  promise=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();csv=fs.readFileSync(await(await promise).path(),'utf8');
  check('monthly CSV matches the selected view and clearance filter',!csv.includes('"Date"')&&!csv.includes('Electrical Clearance')&&csv.includes('450.00')&&csv.trim().split(/\r?\n/).length===5);
  await page.emulateMedia({media:'print'});
  check('print retains the selected report context and table while hiding controls',!await page.locator('main form.no-print').isVisible()&&await page.getByRole('heading',{name:'Monthly Summary',exact:true}).isVisible()&&await page.locator('table').isVisible());
  check('print fits all fee columns within the report table',await page.locator('table').evaluate(el=>getComputedStyle(el).tableLayout==='fixed'&&el.scrollWidth<=el.clientWidth+1));
  await page.emulateMedia({media:'screen'});await page.setViewportSize({width:390,height:844});
  check('wide fee breakdown scrolls within its table on mobile',await page.locator('.table-wrap').evaluate(el=>getComputedStyle(el).overflowX==='auto'&&el.getBoundingClientRect().right<=window.innerWidth));
  await page.getByLabel(/^Month/).selectOption('08');await page.getByRole('button',{name:'Apply Filter',exact:true}).click();
  check('request month does not count issuance from a later month',(await page.locator('body').innerText()).includes('No released receipt-photo payments for this month and clearance type.')&&await page.locator('tbody tr').count()===1);
  check('no browser errors',errors.length===0);console.log(`\n${checks}/${checks} checks passed`);
 }finally{await browser.close()}
})().catch(error=>{console.error('SCRIPT ERROR',error);process.exitCode=1});
