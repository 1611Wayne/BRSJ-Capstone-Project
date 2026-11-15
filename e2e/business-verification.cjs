require('../tests/register-ts.cjs');
const { chromium } = require('playwright');
const { mockApplications } = require('../data/mockApplications.ts');
const { mockUsers } = require('../data/mockUsers.ts');
const { mockFeeSchedules } = require('../data/mockFeeSchedules.ts');
const original=mockApplications.find(a=>a.clearanceType==='Business Clearance');
const issued={...original,businessName:'FT19 Test Store',status:'Closed - Cleared',clearance:{issueDate:'2026-11-15',generatedAt:'2026-11-15T01:00:00Z'},receipt:{orNumber:'123456',orDate:'2026-11-15',amountPaid:400},simulatedPayment:undefined};
const applications=[issued,{...issued,reference:'HIDDEN',status:'Rejected'},{...issued,reference:'DEMO',simulatedPayment:{amount:400}}];
const seed={users:mockUsers,applications,schedules:mockFeeSchedules,audits:[],notifications:[],currentUserId:null};
(async()=>{
 const channel=process.env.E2E_CHANNEL??'msedge';const browser=await chromium.launch({...(channel?{channel}:{}),headless:true});let passed=0,total=0;
 const check=(label,ok)=>{total++;if(ok)passed++;console.log((ok?'PASS ':'FAIL ')+label);};
 try{const page=await browser.newPage();await page.addInitScript(seed=>sessionStorage.setItem('san-jose-prototype-v2',JSON.stringify(seed)),seed);
 await page.goto((process.env.E2E_BASE||'http://localhost:3100')+'/verify');
 const input=page.getByLabel('Full business name');const submit=page.getByRole('button',{name:'Search business',exact:true});await submit.waitFor();
 await input.fill('ft19 test store');await submit.click();await page.getByRole('heading',{name:'Results for ft19 test store'}).waitFor();
 let section=page.locator('main section');let text=await section.innerText();
 check('exact case-insensitive name finds issued business',text.includes(issued.reference)&&text.includes('FT19 Test Store'));
 check('rejected and simulated records excluded',!text.includes('HIDDEN')&&!text.includes('DEMO'));
 check('private owner and receipt details absent',!text.includes(issued.applicant)&&!text.includes('123456')&&!text.includes(issued.address));
 await input.fill('FT19');await submit.click();await page.getByText('No matching issued business clearances found.',{exact:false}).waitFor();
 check('partial names do not enumerate businesses',!(await section.innerText()).includes(issued.reference));
 await input.fill('FT19 Test Store');await submit.click();await page.getByRole('link',{name:'Open verification',exact:true}).click();await page.getByRole('heading',{name:'Clearance Verification'}).waitFor();
 check('search result opens existing reference verification',page.url().endsWith('/verify/'+issued.reference));
 }finally{await browser.close();}
 console.log(`${passed}/${total} checks passed`);process.exitCode=passed===total?0:1;
})().catch(e=>{console.error('SCRIPT ERROR',e);process.exitCode=1;});
