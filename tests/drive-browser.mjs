/* 페이지 안 Drive 탐색기: 폴더 보기·대상 폴더 권한·올리기·나눠 받기 (가짜 구글 환경) */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const code=fs.readFileSync(path.join(root,'src/Code.gs'),'utf8'),html=fs.readFileSync(path.join(root,'src/Index.html'),'utf8'),fake=fs.readFileSync(path.join(root,'tests/fakegas.js'),'utf8'),sheets=JSON.parse(fs.readFileSync(path.join(root,'tests/sample-sheet.json'),'utf8'));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
try{
 const server=await browser.newPage();await server.setContent('<html><body></body></html>');await server.evaluate(s=>{window.__SHEETS=s;},sheets);await server.addScriptTag({content:fake});await server.evaluate(()=>{window.__props.TEACHER_PASSWORD='fake-password';window.__props.NO_LOGIN_TEST_MODE='true';window.__props.SPREADSHEET_ID='TEST';});await server.evaluate(src=>{window.__src=src;window.api=req=>new Function(window.__src+'\nreturn api;')()(req);window.raw=expr=>new Function(window.__src+'\nreturn ('+expr+');')();},code);
 /* 가짜 자료실: 루트 파일 1, '학습근로자' 대상 폴더, '회의자료' 일반 폴더, 큰 파일(9MB) 1 */
 await server.evaluate(()=>{
  const r=window.DriveApp.createFolder('도제 자료실');window.__props.MATERIAL_FOLDER=r.getId();
  r.createFile({name:'공통안내.pdf',bytes:[1,2,3],mime:'application/pdf'});
  r.createFolder('학습근로자').createFile({name:'근로자전용.pdf',bytes:[4,5],mime:'application/pdf'});
  const m=r.createFolder('회의자료');m.createFile({name:'회의록.pdf',bytes:[6],mime:'application/pdf'});
  const big=new Array(9*1024*1024+7);for(let i=0;i<big.length;i++)big[i]=i%251;m.createFile({name:'큰영상.mp4',bytes:big,mime:'video/mp4'});
  window.ScriptApp.getOAuthToken=()=>'tok';
  const orig=window.UrlFetchApp.fetch;window.__ranges=0;
  window.UrlFetchApp.fetch=(u,o)=>{const m=u.match(/drive\/v3\/files\/([^?]+)\?alt=media/);if(m){window.__ranges++;const f=window.__drive.files[decodeURIComponent(m[1])],g=o.headers.Range.match(/bytes=(\d+)-(\d+)/),a=+g[1],b=+g[2];return {getResponseCode:()=>206,getContent:()=>f.bytes.slice(a,b+1),getContentText:()=>''};}return orig(u,o);};
 });
 /* 학생 권한: 예비2 학생은 학습근로자 폴더가 안 보이고 열 수도 없음 */
 const stu=await server.evaluate(()=>{const me={name:'가상학생',role:'student',group:'pre2'},d=window.raw("driveBrowse_")(me,{root:'materials'});let blocked='';try{const lf=d.folders.find(f=>f.name==='학습근로자');const id=Object.values(window.__drive.folders).find(f=>f.name==='학습근로자').id;window.raw("driveBrowse_")(me,{root:'materials',folder:id});}catch(e){blocked=e.message;}return {folders:d.folders.map(f=>f.name),files:d.files.map(f=>f.name),blocked,canUpload:d.canUpload};});
 assert.deepEqual(stu.folders,['회의자료']);assert.deepEqual(stu.files,['공통안내.pdf']);assert.match(stu.blocked,/권한/);assert.equal(stu.canUpload,true);
 const ctx=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.exposeFunction('__serverApi',r=>server.evaluate(req=>window.api(req),r));await p.addInitScript(()=>{const run=(ok,fail)=>new Proxy({},{get:(_,k)=>k==='withSuccessHandler'?f=>run(f,fail):k==='withFailureHandler'?f=>run(ok,f):r=>window.__serverApi(r).then(x=>ok&&ok(x)).catch(e=>fail&&fail(e))});window.google={script:{run:run(null,null)}};});await ctx.route('http://drv.test/',r=>r.fulfill({body:html,contentType:'text/html'}));await p.goto('http://drv.test/');await p.locator('#shell').waitFor({state:'visible'});
 await p.locator('[data-tab=projects]').click();await p.locator('[data-projsub=materials]').click();
 const drv=p.locator('[data-drv="materials"]');await drv.getByText('공통안내.pdf').waitFor();
 await drv.locator('[data-drv-go]').filter({hasText:'회의자료'}).click();await drv.getByText('큰영상.mp4').waitFor();
 const dl=p.waitForEvent('download',{timeout:30000}).catch(async e=>{console.log('TOAST',await p.locator('#toast').innerText());throw e;});await drv.locator('[data-drv-dl]').last().click();const d=await dl;const fp=await d.path();const got=fs.readFileSync(fp);
 const want=(()=>{const b=Buffer.alloc(9*1024*1024+7);for(let i=0;i<b.length;i++)b[i]=i%251;return b;})();
 const name=d.suggestedFilename();
 await drv.locator('[data-drv-file]').setInputFiles([{name:'새자료.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1 new')}]);
 await drv.getByText('새자료.pdf').waitFor({timeout:20000});
 const placed=await server.evaluate(()=>{const f=Object.values(window.__drive.files).find(x=>x.name==='새자료.pdf');return window.__drive.folders[f.parent].name;});
 await p.screenshot({path:path.join(root,'tests/out/drive-browser-mobile.png'),fullPage:true});
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 const ranges=await server.evaluate(()=>window.__ranges);
 assert.equal(got.length,want.length);assert.ok(got.equals(want));assert.equal(ranges,3);assert.equal(placed,'회의자료');assert.equal(overflow,false);assert.deepEqual(errors,[]);
 console.log('PASS 학생 대상 폴더 권한·폴더 이동·9MB 나눠 받기(3조각, 내용 일치)·현재 폴더에 올리기·390px');
}finally{await browser.close();}
