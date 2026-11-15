require('../tests/register-ts.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {mockApplications}=require('../data/mockApplications.ts');
const {mockUsers}=require('../data/mockUsers.ts');
const {mockFeeSchedules}=require('../data/mockFeeSchedules.ts');
const BASE=process.env.E2E_BASE||'http://localhost:3100',KEY='san-jose-prototype-v2';
const date='2026-09-06',at=date+'T02:00:00.000Z',ref='SJ-2026-000123';
const photo={requirement:'Official Receipt',name:'receipt.jpg',size:100,type:'image/jpeg',status:'Verified'};
const issued={...mockApplications[0],reference:ref,status:'Closed - Cleared',clearanceType:'Business Clearance',
 assessment:{items:[{name:'Clearance Fee',amount:100}],total:100,category:'Sari-Sari Store',classification:'',assessedBy:'Staff',assessedAt:at,scheduleId:'saved'},
 receipt:{orNumber:'FT21-RECEIPT',orDate:date,amountPaid:100,recordedAt:at,encodedBy:'Maria Staff',receiptPhoto:photo},
 paymentVerification:{status:'Verified',submittedAt:at,checkedAt:at,checkedBy:'Maria Staff'},clearance:{issueDate:date,generatedAt:at}};
const seed={users:mockUsers,applications:[issued,{...issued,reference:'VOID-EXCLUDED',status:'Void'}],schedules:mockFeeSchedules,audits:[],notifications:[],currentUserId:'staff-maria'};
let count=0;const check=(label,ok)=>{assert.ok(ok,label);count++;console.log('PASS '+label);};
(async()=>{
 const channel=process.env.E2E_CHANNEL??'msedge',browser=await chromium.launch({...(channel?{channel}:{}),headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(([key,seed])=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,JSON.stringify(seed));window.print=()=>{window.__printed=true;};},[KEY,seed]);
 await page.goto(BASE+'/staff/dashboard');await page.getByRole('navigation',{name:'staff navigation'}).getByRole('link',{name:'Reports',exact:true}).click();
 await page.getByRole('heading',{name:'Reports',exact:true}).waitFor();
 check('Staff menu opens Reports with only Daily OR and Monthly Collection',await page.locator('main a').filter({hasText:'View Report'}).count()===2&&!(await page.locator('#main-content').innerText()).includes('Reversion Audit'));
 await page.locator('.content-card').filter({has:page.getByRole('heading',{name:'Daily OR Summary',exact:true})}).getByRole('link',{name:'View Report'}).click();
 await page.getByLabel(/^Date/).fill(date);await page.getByRole('button',{name:'Apply Filter',exact:true}).click();
 check('Staff daily report shows issued receipt and excludes Void',(await page.locator('table').innerText()).includes('FT21-RECEIPT')&&!(await page.locator('table').innerText()).includes('VOID-EXCLUDED'));
 const dailyRows=await page.locator('table').innerText();
 async function csv(){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();const download=await pending;return fs.readFileSync(await download.path(),'utf8');}
 const dailyCsv=await csv();check('Staff daily CSV contains the filtered receipt',dailyCsv.includes('FT21-RECEIPT')&&!dailyCsv.includes('VOID-EXCLUDED'));
 await page.getByRole('button',{name:'Print',exact:true}).click();check('Staff Print invokes browser print',await page.evaluate(()=>window.__printed===true));
 await page.getByRole('link',{name:'← Reports',exact:true}).click();await page.waitForURL(BASE+'/staff/reports');check('Daily back link stays in Staff portal',page.url().endsWith('/staff/reports'));
 await page.locator('.content-card').filter({has:page.getByRole('heading',{name:'Monthly Collection Report',exact:true})}).getByRole('link',{name:'View Report'}).click();
 async function month(){await page.getByLabel(/^Month/).selectOption('09');await page.getByLabel(/^Year/).fill('2026');await page.getByRole('button',{name:'Apply Filter',exact:true}).click();}
 await month();check('Staff monthly daily breakdown includes saved fees',(await page.locator('table').innerText()).includes(date)&&(await page.locator('table').innerText()).includes('₱100.00'));
 await page.getByLabel(/^Report View/).selectOption('monthly');await page.getByRole('button',{name:'Apply Filter',exact:true}).click();
 const monthlyRows=await page.locator('table').innerText(),monthlyCsv=await csv();check('Staff monthly summary exports fee components',monthlyCsv.includes('Clearance Fee')&&monthlyCsv.includes('100.00'));
 await page.getByRole('link',{name:'← Reports',exact:true}).click();await page.waitForURL(BASE+'/staff/reports');check('Monthly back link stays in Staff portal',page.url().endsWith('/staff/reports'));
 async function actor(id){await page.evaluate(([key,id])=>{const state=JSON.parse(sessionStorage.getItem(key));state.currentUserId=id;sessionStorage.setItem(key,JSON.stringify(state));},[KEY,id]);}
 await actor('admin');await page.goto(BASE+'/admin/reports/daily-or');await page.getByLabel(/^Date/).fill(date);await page.getByRole('button',{name:'Apply Filter',exact:true}).click();
 check('Admin and Staff daily rows match',await page.locator('table').innerText()===dailyRows);check('Admin back link remains Admin',await page.getByRole('link',{name:'← Reports',exact:true}).getAttribute('href')==='/admin/reports');
 await page.goto(BASE+'/admin/reports/monthly-collection');await month();await page.getByLabel(/^Report View/).selectOption('monthly');await page.getByRole('button',{name:'Apply Filter',exact:true}).click();
 check('Admin and Staff monthly rows and CSV match',await page.locator('table').innerText()===monthlyRows&&await csv()===monthlyCsv);
 await actor('resident-maria');await page.goto(BASE+'/staff/reports/daily-or');await page.getByRole('heading',{name:'This area is for staff accounts'}).waitFor();check('Applicant cannot open Staff reports',await page.getByRole('button',{name:'Export',exact:true}).count()===0);
 await actor('staff-maria');await page.goto(BASE+'/admin/reports/reversion-audit');await page.getByRole('heading',{name:'This area is for admin accounts'}).waitFor();check('Staff cannot open Admin reversion reports',await page.getByRole('button',{name:'Export',exact:true}).count()===0);
 }finally{await browser.close();}
 console.log(`${count}/${count} checks passed`);
})().catch(e=>{console.error('SCRIPT ERROR',e);process.exitCode=1;});
