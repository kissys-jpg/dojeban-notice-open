import {nav} from './nav-helper.mjs';
/* 모든 계정은 가상입니다. 실제 명렬표·비밀번호는 이 테스트에 넣지 않습니다. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const server=vm.createContext({TextEncoder,TextDecoder,atob,btoa,console});server.window=server;server.__SHEETS=JSON.parse(read('tests/sample-sheet.json'));vm.runInContext(read('tests/fakegas.js'),server);
server.Utilities.computeDigest=(_a,s)=>[...createHash('sha256').update(s).digest()];server.Utilities.computeHmacSha256Signature=(s,k)=>[...createHmac('sha256',k).update(s).digest()];server.Utilities.DigestAlgorithm={SHA_256:'SHA_256'};server.Utilities.Charset={UTF_8:'UTF-8'};server.Utilities.getUuid=randomUUID;
Object.assign(server.__props,{TEACHER_PASSWORD:'fake-password',NO_LOGIN_TEST_MODE:'true',GUEST_VIEW:'true',SPREADSHEET_ID:'TEST',UNCHANGED_SETTING:'preserve'});delete server.__props.STUDENT_LOGIN_REQUIRED;
server.__src=read('src/Code.gs');vm.runInContext("window.api=r=>new Function(window.__src+'\\nreturn api;')()(r);window.raw=(f,args=[])=>new Function(window.__src+'\\nreturn '+f+';')()(...args);",server);
const api=(action,payload={},cred)=>server.api({action,payload,cred}),teacher={teacher:'fake-password'};

const students=[{name:'가상일지학생일',studentId:'30391'},{name:'가상일지학생이',studentId:'30392'},{name:'가상일지일반',studentId:'20391'}];
const ok=(action,payload={},cred=teacher)=>{const r=api(action,payload,cred);assert.equal(r.ok,true,r.error);return r.data;};
ok('importClass3Students',{students});
assert.equal(ok('load').roster.find(r=>r.name===students[0].name).group,'general','학년만으로 학습근로자를 지정하지 않음');
const initial=ok('load').roster.filter(r=>students.slice(0,2).some(s=>s.name===r.name)).map(r=>({row:r.row,name:r.name}));ok('manageStudents',{students:initial,mode:'group',group:'learner'});
const login=i=>ok('login',{},{name:students[i].studentId,pin:students[i].studentId});
let learner={session:login(0).session},other={session:login(1).session},general={session:login(2).session};
const roster=()=>ok('load').roster,pick=n=>{const r=roster().find(r=>r.name===n);return {row:r.row,name:r.name};};
assert.equal(api('manageStudents',{students:[pick(students[0].name)],mode:'group',group:'general'},learner).ok,false);
assert.equal(api('manageStudents',{students:[pick(students[0].name),{row:999,name:'가상누락'}],mode:'group',group:'general'},teacher).ok,false);
assert.equal(roster().find(r=>r.name===students[0].name).group,'learner');
ok('manageStudents',{students:[pick(students[0].name)],mode:'group',group:'general'});
assert.equal(ok('load',{},learner).me.group,'general');assert.equal(login(0).me.group,'general');assert.equal(api('trainingJournal',{},learner).ok,false);
ok('manageStudents',{students:[pick(students[0].name)],mode:'group',group:'learner'});
const upload={name:'가상학습안내.pdf',base64:Buffer.from('%PDF fake journal').toString('base64')};
assert.equal(api('saveTrainingJournal',{date:'2026-10-27',kind:'OJT',title:'가상기록',body:'가상내용'},learner).ok,false);
const id=ok('saveTrainingJournal',{date:'2026-10-27',kind:'OJT',title:'가상 일지 안내',body:'가상 훈련 내용\n확인하기',uploads:[upload]});
let journal=ok('trainingJournal',{},learner);assert.equal(journal.entries.length,1);assert.equal(journal.entries[0].files.length,1);
const fid=journal.entries[0].files[0].id;assert.equal(ok('downloadFile',{id:fid},learner).name,upload.name);assert.equal(api('downloadFile',{id:fid},general).ok,false);
ok('checkTrainingJournal',{id,done:true,name:students[1].name},learner);ok('checkTrainingJournal',{id,done:true},learner);
assert.equal(ok('trainingJournal',{},learner).checks.length,1);assert.equal(ok('trainingJournal',{},other).checks.length,0);assert.equal(ok('trainingJournal').checks[0].name,students[0].name);
assert.equal(api('checkTrainingJournal',{id,done:true},teacher).ok,false);
ok('checkTrainingJournal',{id,done:false},learner);assert.equal(ok('trainingJournal',{},learner).checks[0].done,false);ok('checkTrainingJournal',{id,done:true},learner);
ok('saveTrainingJournal',{id,date:'2026-10-27',kind:'OFF-JT',title:'가상 일지 안내 수정',body:'가상 안내 수정'});assert.equal(ok('trainingJournal',{},learner).entries[0].files[0].id,fid);
ok('deleteTrainingJournal',{id});assert.equal(ok('trainingJournal',{},learner).entries.length,0);assert.equal(ok('trainingJournal',{},learner).checks.length,1);assert.equal(api('downloadFile',{id:fid},learner).ok,false);
assert.equal(api('manageStudents',{students:[pick(students[0].name)],mode:'delete'},teacher).ok,false);
const before=ok('trainingJournal').checks.length;
ok('manageStudents',{students:[pick(students[0].name),pick(students[2].name)],mode:'delete',confirm:true});
assert.equal(api('load',{},learner).ok,false);assert.equal(api('login',{},{name:students[0].studentId,pin:students[0].studentId}).ok,false);assert.equal(ok('trainingJournal').checks.length,before);assert.equal(login(1).me.group,'learner');
/* 계정/학년 보존과 기능 진입을 실제 모바일/PC에서 확인합니다. */
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
try{for(const width of [390,1280]){
 const ctx=await browser.newContext({viewport:{width,height:900}}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));await p.exposeFunction('__api',r=>api(r.action,r.payload,r.cred));await p.addInitScript(()=>{const run=(ok,fail)=>new Proxy({},{get:(_,k)=>k==='withSuccessHandler'?f=>run(f,fail):k==='withFailureHandler'?f=>run(ok,f):r=>window.__api(r).then(x=>ok&&ok(x)).catch(e=>fail&&fail(e))});window.google={script:{run:run()}};});await ctx.route('http://localhost:8054/',r=>r.fulfill({body:read('src/Index.html'),contentType:'text/html'}));await p.goto('http://localhost:8054/');await p.locator('[data-mode=teacher]').click();await p.locator('#lg-teacher-name').fill('가상관리자');await p.locator('#lg-pw').fill('fake-password');await p.locator('#loginForm button[type=submit]').click();await p.locator('#shell').waitFor({state:'visible'});
 await nav(p,'roster');await p.getByRole('heading',{name:'학생 명단',exact:true}).waitFor();await p.locator('[data-roster-all]').click();await p.locator('#rosterNewGroup').selectOption('general');await p.locator('[data-roster-group]').click();await p.locator('#dlg').waitFor({state:'visible'});await p.locator('#dlg button[type=submit]').click();await p.locator('#dlg').waitFor({state:'hidden'});assert.equal(login(1).me.group,'general');
 await p.locator('[data-roster-all]').click();await p.locator('#rosterNewGroup').selectOption('learner');await p.locator('[data-roster-group]').click();await p.locator('#dlg button[type=submit]').click();await p.locator('#dlg').waitFor({state:'hidden'});
 await nav(p,'journal');await p.getByRole('heading',{name:'학습일지',exact:true}).waitFor();await p.locator('[data-journal-new]').click();await p.locator('#dlg input[name=title]').fill('가상 모바일 일지');await p.locator('#dlg textarea[name=body]').fill('가상 훈련 안내');await p.locator('#pickFiles').setInputFiles({name:'가상.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF fake')});await p.locator('#dlg button[type=submit]').click();await p.locator('#dlg').waitFor({state:'hidden'});await p.getByRole('heading',{name:'가상 모바일 일지'}).last().waitFor();
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);await ctx.close();
}}finally{await browser.close();}
console.log('명단 구분/일괄 삭제·계정 중지·기록 보존·일지 권한/Drive/누적·390/1280px 통과');
