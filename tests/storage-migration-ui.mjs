import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
/* 실제 학생 자료/인증값 없이 관리자 UI의 시작 확인·배치·오류 중단·재시도를 검증합니다. */
const html=read('src/Index.html');
const server=vm.createContext({TextEncoder,TextDecoder,atob,btoa,console});server.window=server;server.__SHEETS=JSON.parse(read('tests/sample-sheet.json'));vm.runInContext(read('tests/fakegas.js'),server);Object.assign(server.__props,{TEACHER_PASSWORD:'fake-password',SPREADSHEET_ID:'TEST',NO_LOGIN_TEST_MODE:'false'});server.__src=read('src/Code.gs');vm.runInContext("window.api=r=>new Function(window.__src+'\\nreturn api;')()(r)",server);
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const plan={source:'fake-source-root',target:'fake-target-root',folders:[{source:'fake-child-source',target:'fake-child-target'}],files:Array.from({length:147},(_,i)=>({id:'fake-file-'+i,parent:'fake-child-source',target:'fake-child-target'}))};
try{
 for(const width of [390,1280])for(const mode of ['success','partial','invalid','locked','ordinary']){
  const ctx=await browser.newContext({viewport:{width,height:900}}),p=await ctx.newPage(),calls=[],movedIds=new Set(),errors=[];let release,entered;const hold=new Promise(r=>release=r),started=new Promise(r=>entered=r);p.on('pageerror',e=>errors.push(e.message));await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await p.exposeFunction('__fakeApi',async r=>{if(r.action==='moveStorageFiles'){calls.push(r);if(mode==='locked'&&calls.length===1){entered();await hold;}const fail=mode==='partial'&&calls.filter(x=>x.action==='moveStorageFiles').length===2,done=(fail?r.payload.files.slice(0,1):r.payload.files).map(f=>f.id);done.forEach(id=>movedIds.add(id));return {ok:true,data:{moved:done,...(fail?{error:'가상 이전 중단'}:{})}};}if(r.action==='relinkStorageFolders'){calls.push(r);return {ok:true,data:{folderCount:2,updatedSettings:1}};}const out=server.api(r);if(mode==='ordinary'&&out.ok&&out.data?.me)out.data.me.isAdmin=false;return out;});
  await ctx.addInitScript(()=>{localStorage.setItem('dj.cred',JSON.stringify({teacher:'fake-password'}));const run=(ok,fail)=>new Proxy({},{get:(_,k)=>k==='withSuccessHandler'?f=>run(f,fail):k==='withFailureHandler'?f=>run(ok,f):r=>window.__fakeApi(r).then(x=>ok&&ok(x)).catch(e=>fail&&fail(e))});window.google={script:{run:run()}};});
  await ctx.route('http://migration.test/',r=>r.fulfill({body:html,contentType:'text/html'}));await p.goto('http://migration.test/');await p.locator('#shell').waitFor({state:'visible'});await p.locator('#profileTop').click();
  if(mode==='ordinary'){assert.equal(await p.locator('[data-storage-migrate]').count(),0);assert.equal(calls.length,0);}else{
   await p.locator('[data-storage-migrate]').click();await p.locator('#storagePlanFile').setInputFiles({name:'fake-plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(mode==='invalid'?{...plan,files:[]}:plan))});await p.getByText('계획: 파일 '+(mode==='invalid'?0:147)+'개 · 하위 폴더 1개',{exact:true}).waitFor();assert.equal(calls.length,0,'계획 선택만으로 이동하면 안 됨');await p.locator('#dlgOk').click();
   if(mode==='locked'){await started;await p.getByText('파일 이전 중 0 / 147개',{exact:true}).waitFor();assert.equal(await p.locator('#storagePlanFile').isDisabled(),true);assert.equal(await p.locator('[data-close]').isDisabled(),true);await p.keyboard.press('Escape');assert.equal(await p.locator('#dlg').isVisible(),true);assert.equal(calls.length,1);release();}
   if(mode==='partial'){await p.getByText(/이전 확인 11개 · 가상 이전 중단/).waitFor();assert.equal(calls.filter(x=>x.action==='moveStorageFiles').length,2);assert.equal(calls.filter(x=>x.action==='relinkStorageFolders').length,0);assert.equal(await p.locator('#dlg').isVisible(),true);assert.equal(await p.locator('#storagePlanFile').isEnabled(),true);assert.equal(await p.locator('[data-close]').isEnabled(),true);await p.locator('#dlgOk').click();await p.locator('#dlg').waitFor({state:'hidden'});assert.equal(movedIds.size,147);assert.equal(calls.filter(x=>x.action==='moveStorageFiles').length,17);assert.equal(calls.filter(x=>x.action==='relinkStorageFolders').length,1);assert.equal(calls.at(-1).action,'relinkStorageFolders');}else if(mode==='invalid'){await p.getByText(/이전 계획 형식이나 범위를 확인/).waitFor();assert.equal(calls.length,0);assert.equal(await p.locator('#dlg').isVisible(),true);await p.keyboard.press('Escape');await p.locator('#dlg').waitFor({state:'hidden'});}else{await p.locator('#dlg').waitFor({state:'hidden'});const batches=calls.filter(x=>x.action==='moveStorageFiles');assert.equal(batches.length,15);assert.ok(batches.every(x=>x.payload.files.length<=10));assert.equal(batches.reduce((n,x)=>n+x.payload.files.length,0),147);assert.equal(calls.at(-1).action,'relinkStorageFolders');assert.equal(calls.at(-1).payload.confirm,true);}
  }
  assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await ctx.close();console.log('PASS '+width+'px '+mode);
 }
}finally{await browser.close();}
