/* 가짜 제출본만 사용. 최신 대표·이전 이력·원본/권한/검토·동일 시각·재시도·학년 구분을 검증합니다. */
import {chromium} from 'playwright';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {nav} from './nav-helper.mjs';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
try{
 const server=await browser.newPage();await server.setContent('<html></html>');await server.evaluate(s=>window.__SHEETS=s,JSON.parse(read('tests/sample-sheet.json')));await server.addScriptTag({content:read('tests/fakegas.js')});
 await server.evaluate(src=>{
  Object.assign(window.__props,{TEACHER_PASSWORD:'fake-password',NO_LOGIN_TEST_MODE:'false',PUBLIC_ACCESS_ENABLED:'false',PUBLIC_VIEW_ALL:'false',SPREADSHEET_ID:'TEST'});window.__src=src;window.api=r=>new Function(window.__src+'\nreturn api;')()(r);window.raw=(f,args=[])=>new Function(window.__src+'\nfunction seed_(...args){upsert_(...args);flushDirty_();bumpAll_();}\nreturn '+f+';')()(...args);
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';const wrap=e=>({getName:()=>e.localName,getText:()=>e.textContent,getChildren:(name,n)=>[...e.children].filter(c=>!name||(c.localName===name&&(!n||c.namespaceURI===n))).map(wrap),getChild:(name,n)=>{const c=[...e.children].find(c=>c.localName===name&&(!n||c.namespaceURI===n));return c?wrap(c):null;},getAttribute:(name,n)=>{const v=n?e.getAttributeNS(n,name):e.getAttribute(name);return v===null?null:{getValue:()=>v};}});
  window.XmlService={getNamespace:s=>s,parse:s=>({getRootElement:()=>wrap(new DOMParser().parseFromString(s,'application/xml').documentElement)})};
  Utilities.unzip=blob=>{const text='가상 제출 내용 '+blob.getBytes().at(-1),xml='<w:document xmlns:w="'+ns+'"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>';return [{getName:()=> 'word/document.xml',getBytes:()=>[...new TextEncoder().encode(xml)],getDataAsString:()=>xml}];};
 },read('src/Code.gs'));
 const api=(action,payload={},cred={})=>server.evaluate(r=>window.api(r),{action,payload,cred}),teacher={teacher:'fake-password'},student={name:'가상재제출학생',pin:'1234'};
 assert.equal((await api('saveStudent',{name:student.name,group:'pre2',pin:student.pin},teacher)).ok,true);
 const legacy='fake-history-legacy';await server.evaluate(({id,name})=>window.raw('seed_',['experienceIntro',id,[id,name,'','확인',JSON.stringify({schoolGrade:'2학년',headline:'가상 온라인 이전 답변'}),'2099-12-30','가상 이전 의견','','']]),{id:legacy,name:student.name});
 const payload=n=>({name:student.name,grade:'2',submissionKey:'fake-history-submission-key-00'+n,confirm:true,mode:'file',upload:{name:'가상'+n+'.docx',base64:Buffer.from([80,75,n]).toString('base64')}});
 for(const n of [1,2])assert.equal((await api('submitPublicIntro',payload(n))).ok,true);
 const id1='introPublic'+payload(1).submissionKey,id2='introPublic'+payload(2).submissionKey;
 const get=async()=> (await api('load',{},teacher)).data.experienceIntros;
 let entries=await get();assert.equal(entries.length,3);assert.equal(entries.find(i=>i.isLatest).id,id2);assert.equal(entries.find(i=>i.id===id2).version,3);assert.equal(entries.find(i=>i.id===legacy).version,1);
 const originalFiles=entries.filter(i=>i.file).map(i=>i.file);for(const id of [legacy,id1,id2])assert.equal((await api('introDocument',{id},teacher)).ok,true,id);
 assert.equal((await api('submitPublicIntro',payload(2))).ok,true);assert.equal((await get()).length,3,'통신 재시도는 새 이력이 아님');
 assert.equal((await api('reviewExperienceIntro',{id:legacy,status:'보완요청',feedback:'가상 수정 의견'},teacher)).ok,true);assert.equal((await get()).find(i=>i.isLatest).id,id2,'이전본 검토 시각이 바뀌어도 대표가 바뀌지 않음');
 let list=(await api('introSubmissionList',{},student)).data,group=list.find(i=>i.name===student.name);assert.equal(group.latest.id,id2);assert.deepEqual(group.history.map(i=>i.id),[id1,legacy]);assert.deepEqual(group.documents.map(i=>i.id),[id2]);assert.ok(!JSON.stringify(group).includes('가상 수정 의견'));
 assert.deepEqual(Object.keys((await api('introSubmissionList')).data[0]).sort(),['grade','name','status'],'인증 없는 기존 요약 범위 보존');
 assert.equal((await api('submitPublicIntro',{...payload(3),grade:'1',upload:{name:'가상1학년.pdf',base64:Buffer.from('%PDF fake').toString('base64')}})).ok,true);assert.equal((await api('introSubmissionList',{},teacher)).data.filter(i=>i.name===student.name).length,2,'동일 이름의 다른 학년은 별도 그룹');
 for(const width of [390,1280])for(const role of ['teacher','student','viewer']){
  await server.evaluate(v=>{window.__props.PUBLIC_ACCESS_ENABLED=v?'true':'false';window.__props.PUBLIC_VIEW_ALL=v?'true':'false';},role==='viewer');
  const cred=role==='teacher'?teacher:role==='student'?student:{},ctx=await browser.newContext({viewport:{width,height:950}}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));await ctx.route('http://history.test/',r=>r.fulfill({body:read('src/Index.html'),contentType:'text/html'}));await p.exposeFunction('__api',r=>api(r.action,r.payload,cred));await p.addInitScript(()=>{const run=(ok,fail)=>new Proxy({},{get:(_,k)=>k==='withSuccessHandler'?f=>run(f,fail):k==='withFailureHandler'?f=>run(ok,f):r=>window.__api(r).then(x=>ok&&ok(x)).catch(e=>fail&&fail(e))});window.google={script:{run:run()}};});
  await p.goto('http://history.test/');await p.locator('#shell').waitFor({state:'visible'});await nav(p,'intro');
  if(role!=='student'){
   const latest=p.locator('[data-intro-record="'+id2+'"]'),old=p.locator('[data-intro-record="'+id1+'"]');await latest.waitFor();assert.equal(await latest.isVisible(),true);assert.equal(await old.isVisible(),false);const history=p.locator('[data-intro-group="'+id2+'"] [data-intro-history]');assert.equal(await history.getAttribute('open'),null);await history.locator(':scope > summary').click();assert.equal(await old.isVisible(),true);await history.locator(':scope > summary').click();
  }
  await p.locator('[data-intro-list]').click();await p.locator('[data-intro-version="'+id2+'"]').waitFor({timeout:5000}).catch(async e=>{console.log(JSON.stringify({role,width,errors,dialog:await p.locator('#dlg').innerText()}));throw e;});const oldVersion=p.locator('[data-intro-version="'+id1+'"]');assert.equal(await oldVersion.isVisible(),false);await p.locator('[data-intro-list-history] summary').click();assert.equal(await oldVersion.isVisible(),true);await oldVersion.locator('[data-intro-shared]').click();await p.frameLocator('[data-intro-document-content] iframe').getByText('가상 제출 내용 1').waitFor();await p.locator('#dlgOk').click();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await p.screenshot({path:path.join(root,'tests/out/intro-history-'+role+'-'+width+'.png'),fullPage:true});await ctx.close();
 }
 await server.evaluate(()=>{window.__props.PUBLIC_ACCESS_ENABLED='false';window.__props.PUBLIC_VIEW_ALL='false';});
 assert.equal((await api('submitPublicIntro',{...payload(4),upload:{name:'가상최신.pdf',base64:Buffer.from('%PDF final fake').toString('base64')}})).ok,true);
 group=(await api('introSubmissionList',{},student)).data.find(i=>i.grade==='2학년');assert.equal(group.latest.id,'introPublic'+payload(4).submissionKey);assert.equal(group.documents.length,0,'최신 PDF를 이전 Word로 대체하지 않음');assert.equal(group.history.length,3);
 entries=await get();for(const f of originalFiles)assert.equal((await api('downloadFile',{id:f},teacher)).ok,true,'이전 파일 보존');
 await server.evaluate(()=>{let data=[];const sh={getLastRow:()=>data.length,getSheetId:()=>9,setFrozenRows(){},getRange:(r,c)=>({setValues:rows=>rows.forEach((row,i)=>{data[r-1+i]=data[r-1+i]||[];row.forEach((v,j)=>data[r-1+i][c-1+j]=v);})})};const book={getId:()=> 'fake-history-management',getUrl:()=> 'https://docs.google.com/spreadsheets/d/fake-history-management/edit',getSheets:()=>[sh]};window.__management=()=>data;const open=SpreadsheetApp.openById;SpreadsheetApp.openById=id=>id==='fake-history-management'?book:open(id);SpreadsheetApp.create=()=>book;});
 const management=await api('introManagement',{},teacher);assert.equal(management.ok,true,management.error);assert.equal(management.data.submitted,5);const rows=await server.evaluate(()=>window.__management());const col=rows[0].indexOf('대표구분');assert.ok(col>0);assert.equal(rows.slice(1).filter(r=>r[col]==='최신 대표').length,2);assert.equal(rows.slice(1).filter(r=>r[col]==='이전 이력').length,3);assert.equal(rows[1][col],'최신 대표');
 console.log('PASS 3회 제출 최신 대표·이전본 접힘/펼침·검토 후 대표 보존·재시도 중복 방지·학년 분리·이전 HTML/원본·최신 PDF·취합 대표구분/전체 이력·학생/보기전용/교사 390/1280px');
}finally{await browser.close();}
