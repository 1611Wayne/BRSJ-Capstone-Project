// DB-10: the Admin Reports page shows the Database Export card; in sample mode the button is disabled (there is no real
// database to export), and Staff Reports has no such button. The real export is checked against Supabase separately.
require('../tests/register-ts.cjs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mockApplications}=require('../data/mockApplications.ts'),{mockUsers}=require('../data/mockUsers.ts'),{mockFeeSchedules}=require('../data/mockFeeSchedules.ts');
const KEY='san-jose-prototype-v2',BASE=process.env.E2E_BASE||'http://localhost:3100',CHANNEL=process.env.E2E_CHANNEL??'msedge';
const seed=id=>({users:mockUsers,applications:mockApplications,schedules:mockFeeSchedules,audits:[],notifications:[],currentUserId:id});
let checks=0;const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log('PASS '+name)};
(async()=>{
 const browser=await chromium.launch({...(CHANNEL?{channel:CHANNEL}:{}),headless:true});
 try{
  const open=async(id,url)=>{const page=await browser.newPage();await page.addInitScript(([key,value])=>sessionStorage.setItem(key,value),[KEY,JSON.stringify(seed(id))]);await page.goto(BASE+url);return page;};
  const admin=await open('admin','/admin/reports');
  await admin.getByRole('heading',{name:'Database Export',exact:true}).waitFor();
  check('Admin Reports shows the Database Export card',await admin.getByText(/Monthly backup of every record, logged in the Audit Trail/).count()===1);
  check('in sample mode the export button is disabled and says why',await admin.getByRole('button',{name:'Not available in sample mode',exact:true}).first().isDisabled());
  check('the card warns that the export holds personal data',await admin.getByText(/It contains personal data/).count()===1);
  await admin.getByRole('heading',{name:'Remove Exported Files',exact:true}).waitFor();
  check('Admin Reports shows Remove Exported Files with its rule (month + 14 days, finished requests only, IDs and records stay)',await admin.getByText('Only finished requests (closed, rejected, void) lose their files; valid IDs and all records stay.',{exact:false}).count()===1);
  check('in sample mode its Preview button is disabled',await admin.getByRole('button',{name:'Not available in sample mode'}).nth(1).isDisabled());
  check('the month list offers months whose grace period is over, newest first',(await admin.getByLabel('Month',{exact:true}).locator('option').count())>0);
  const staff=await open('staff-maria','/staff/reports');
  await staff.getByRole('heading',{name:'Reports',exact:true}).waitFor();
  check('Staff Reports has no Database Export and no file removal',await staff.getByText('Database Export',{exact:true}).count()===0&&await staff.getByText('Remove Exported Files',{exact:true}).count()===0);
 }finally{await browser.close();}
 console.log(`${checks}/${checks} checks passed`);
})().catch(e=>{console.error('SCRIPT ERROR',e.message);process.exitCode=1;});
