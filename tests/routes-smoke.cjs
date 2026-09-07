const fs = require('node:fs');
const path = require('node:path');
function pages(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?pages(path.join(dir,entry.name)):entry.name==='page.tsx'?[path.join(dir,entry.name)]:[]); }
const origin = process.argv[2] || 'http://localhost:3001';
(async()=>{
 const routes=pages('app').map(file=>'/'+path.relative('app',file).replace(/\\/g,'/').replace(/\/?page\.tsx$/,'').replace(/\[id\]/g,'SJ-2026-000123').replace(/\[reference\]/g,'SJ-2026-000125'));
 const assets = new Set();const failed=[];
 for(const route of routes){
  const response=await fetch(origin+route);
  if(response.status!==200)failed.push(route+': '+response.status);
  const html=await response.text();
  for(const match of html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g))assets.add(match[1]);
 }
 const results=await Promise.all([...assets].map(async asset=>{const r=await fetch(new URL(asset,origin));return r.status===200?null:asset+': '+r.status;}));
 failed.push(...results.filter(Boolean));
 if(failed.length){console.error(failed.join('\n'));process.exitCode=1;}else console.log(routes.length+' routes and '+assets.size+' JavaScript/CSS assets returned HTTP 200.');
})().catch(error=>{console.error(error);process.exitCode=1;});
