/* 실제 시트/학생 정보 없이 서버 재고·권한 및 390/1280px 사용/반납 검증 */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
try{
 const server=await browser.newPage();await server.setContent('<html></html>');
 await server.evaluate(s=>window.__SHEETS=s,JSON.parse(read('tests/sample-sheet.json')));
 await server.addScriptTag({content:read('tests/fakegas.js')});
 await server.evaluate(src=>{window.__src=src;Object.assign(window.__props,{TEACHER_PASSWORD:'fake-password',NO_LOGIN_TEST_MODE:'false',SPREADSHEET_ID:'TEST'});window.SpreadsheetApp.flush=()=>{};window.api=r=>new Function(window.__src+'\nreturn api;')()(r);},read('src/Code.gs'));
 const T={teacher:'fake-password'},A={name:'가상기자재학생',pin:'1111'},B={name:'가상다른학생',pin:'2222'};
 const api=(action,payload={},cred=T)=>server.evaluate(r=>window.api(r),{action,payload,cred});
 const ok=async(...args)=>{const r=await api(...args);assert.equal(r.ok,true,r.error);return r.data;};
 for(const c of [A,B])await ok('saveStudent',{name:c.name,group:'pre2',pin:c.pin});
 const day=await server.evaluate(()=>new Function(window.__src+'\nreturn today_();')());
 let v=await ok('equipmentLedger');assert.equal(v.items[0].total,14);assert.equal(v.items[0].units.length,14);assert.equal(v.items[0].units[13].label,'라즈베리14');assert.equal(v.loans.length,0);
 const loan={id:'eqtest00000001',item:'raspberry-pi',qty:10,units:[1,2,3,4,5,6,7,8,9,10],date:day,due:day,purpose:'가상 수업',place:'가상 실습실',user:B.name};
 v=await ok('borrowEquipment',loan,A);assert.equal(v.items[0].available,4);assert.equal(v.loans[0].user,A.name,'사용자 위조 무시');
 assert.equal((await ok('borrowEquipment',loan,A)).loans.length,1,'재시도 중복 등록 방지');
 for(const p of [{...loan,id:'eqtest00000002',qty:5},{...loan,id:'eqtest00000003',qty:0},{...loan,id:'eqtest00000004',qty:1.5},{...loan,id:'eqtest00000005',date:'2099-01-01',due:''},{...loan,id:'eqtest00000006',due:'2000-01-01'},{...loan,id:'eqtest00000007',item:'unknown'},{...loan,qty:2}])assert.equal((await api('borrowEquipment',p,A)).ok,false,JSON.stringify(p));
 v=await ok('equipmentLedger',{},B);assert.equal(v.loans.length,0,'타인 사용 기록 비공개');assert.equal(v.items[0].used,10);assert.deepEqual(v.items[0].units[0].users,[A.name],'로그인한 다른 학생도 번호별 현재 사용자 이름 확인');assert.ok(!JSON.stringify(v.items).includes('가상 실습실'),'다른 학생 현황에는 장소/용도/인증정보 없음');
 assert.equal((await api('returnEquipment',{id:loan.id,date:day},B)).ok,false,'타인 반납 차단');
 assert.equal((await api('returnEquipment',{id:loan.id,date:'2099-01-01'},A)).ok,false);
 v=await ok('returnEquipment',{id:loan.id,date:day},T);assert.equal(v.items[0].available,14);assert.equal(v.loans[0].returnedBy,'선생님');
 assert.equal((await ok('returnEquipment',{id:loan.id,date:day},A)).items[0].available,14,'중복 반납 불변');
 for(const action of ['equipmentLedger','borrowEquipment','returnEquipment','assignEquipmentUnits'])assert.equal((await api(action,{},{})).ok,false,'손님 차단');
 assert.ok(!JSON.stringify(await ok('load',{homeOnly:true})).includes('equipmentLoans'),'첫 화면에 대장 없음');
 const stale=await ok('borrowEquipment',{...loan,id:'eqtest00000008',qty:14,units:Array.from({length:14},(_,i)=>i+1),user:'가상 교사 등록'});assert.equal(stale.items[0].available,0);
 assert.equal((await api('borrowEquipment',{...loan,id:'eqtest00000009',qty:1},A)).ok,false,'이전 재고 화면으로 초과 등록 차단');
 await ok('returnEquipment',{id:'eqtest00000008',date:day});

 const one={...loan,id:'equnit00000001',qty:1,units:[14]};
 await ok('borrowEquipment',one,A);
 for(const units of [[14],[0],[15],[1,1],[1.5],[],['1x']])assert.equal((await api('borrowEquipment',{...one,id:'equnit00000002',units,qty:units.length||1},B)).ok,false,'중복/잘못된 번호 차단');
 assert.equal((await api('borrowEquipment',{...one,units:[13]},A)).ok,false,'동일요청의 다른 번호 차단');
 assert.equal((await ok('equipmentLedger',{},B)).items[0].units[13].users[0],A.name);
 await ok('returnEquipment',{id:one.id,date:day},A);
 await ok('borrowEquipment',{...one,id:'equnit00000003'},B);
 await ok('returnEquipment',{id:'equnit00000003',date:day},B);
 /* 기존12열 기록은 그대로 보존하고 임의 번호 없이 표시 */
 const legacyId='eqlegacy0000001';
 await server.evaluate(({id,day})=>{const d=window.__book['앱_기자재사용'].data;d.push([id,'raspberry-pi','가상기자재학생','2',day,'','가상 예전 용도','가상 예전 장소','가상기자재학생',day,'','']);}, {id:legacyId,day});
 v=await ok('equipmentLedger');assert.equal(v.items[0].unassigned,2);assert.ok(v.items[0].units.every(u=>!u.users.length));assert.equal(v.items[0].available,12);
 assert.equal((await api('assignEquipmentUnits',{id:legacyId,units:[2,3]},B)).ok,false);
 assert.equal((await api('assignEquipmentUnits',{id:legacyId,units:[2]},A)).ok,false);
 const before=await server.evaluate(id=>window.__book['앱_기자재사용'].data.find(r=>r[0]===id).slice(0,12),legacyId);
 v=await ok('assignEquipmentUnits',{id:legacyId,units:[2,3]},A);assert.equal(v.items[0].unassigned,0);assert.equal(v.items[0].used,2);
 assert.deepEqual(await server.evaluate(id=>window.__book['앱_기자재사용'].data.find(r=>r[0]===id).slice(0,12),legacyId),before,'원래12열 기록 보존');
 await ok('assignEquipmentUnits',{id:legacyId,units:[3,2]},A);
 assert.equal((await api('assignEquipmentUnits',{id:legacyId,units:[4,5]},A)).ok,false);
 await ok('returnEquipment',{id:legacyId,date:day},A);
 assert.equal((await api('assignEquipmentUnits',{id:legacyId,units:[2,3]},A)).ok,false);
 fs.mkdirSync(path.join(root,'tests/out'),{recursive:true});
 for(const width of [390,1280])for(const [viewer,role] of [[A,"student"],[T,"teacher"]]){
  const ctx=await browser.newContext({viewport:{width,height:900}}),errors=[];let fullLoads=0,ledgerReads=0;
  await ctx.route('**/*',r=>r.request().url()==='http://equipment.test/'?r.fulfill({body:read('src/Index.html'),contentType:'text/html'}):r.abort());
  await ctx.exposeFunction('__serverApi',async req=>{if(req.action==='load'&&!req.payload?.homeOnly)fullLoads++;if(req.action==='equipmentLedger')ledgerReads++;return server.evaluate(r=>window.api(r),req);});
  await ctx.addInitScript(c=>{localStorage.setItem('dj.cred',JSON.stringify(c));const run=(ok,fail)=>new Proxy({},{get:(_,k)=>k==='withSuccessHandler'?f=>run(f,fail):k==='withFailureHandler'?f=>run(ok,f):r=>window.__serverApi(r).then(x=>ok&&ok(x)).catch(e=>fail&&fail(e))});window.google={script:{run:run(null,null)}};},viewer);
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto('http://equipment.test/');await p.locator('#tabs [data-tab=equipment]').click();await p.locator('[data-equipment-borrow]').waitFor();assert.equal(fullLoads,0,'기자재 진입에서 명단/BOM 전체 조회 없음');assert.equal(ledgerReads,1,'기자재 자료 1회만 조회');
  await p.locator('[data-equipment-borrow]').click();if(role==='teacher')await p.locator('#dlg [name=user]').fill('가상 교사 입력');await p.locator('#dlg [name=eqUnit_1]').check();await p.locator('#dlg [name=eqUnit_14]').check();assert.match(await p.locator('[data-equipment-selected]').innerText(),/선택 2대/);await p.locator('#dlg [name=purpose]').fill('가상 실습 확인');await p.locator('#dlgOk').click();await p.locator('#dlg').waitFor({state:'hidden'});
  assert.match(await p.locator('#main').innerText(),/사용 가능\s*12대/);if(role==='student')assert.doesNotMatch(await p.locator('#main').innerText(),/가상 교사 등록/);else assert.match(await p.locator('#main').innerText(),/가상 교사 입력/);
  await p.locator('[data-equipment-details] summary').click();assert.equal(await p.locator('#main .equipment-unit').count(),14);assert.equal(await p.locator('#main .equipment-unit input:checked').count(),2);assert.match(await p.locator('#main .equipment-unit').first().innerText(),role==='student'?/가상기자재학생/:/가상 교사 입력/);
  await p.screenshot({path:path.join(root,'tests/out/equipment-'+role+'-'+width+'.png'),fullPage:true});
  await p.reload();await p.locator('#tabs [data-tab=equipment]').click();await p.locator('[data-equipment-borrow]').waitFor();assert.match(await p.locator('#main').innerText(),/가상 실습 확인/);
  await p.locator('[data-equipment-return]').first().click();await p.locator('#dlgOk').click();await p.locator('#dlg').waitFor({state:'hidden'});assert.match(await p.locator('#main').innerText(),/사용 가능\s*14대/);
  /* 다른 사용자는 현재 이름만 보이고 상세 이력·반납 권한은 유지 */
  await ok('borrowEquipment',{...one,id:'equicurrent'+width+role,units:[7],user:B.name,purpose:'가상 타인 비공개 용도'},B);
  await p.locator('[data-equipment-refresh]').click();await p.locator('[data-equipment-borrow]').waitFor();
  if(!await p.locator('[data-equipment-details]').evaluate(e=>e.open))await p.locator('[data-equipment-details] summary').click();
  assert.match(await p.locator('#main .equipment-unit').nth(6).innerText(),/가상다른학생/);
  if(role==='student')assert.doesNotMatch(await p.locator('#main').innerText(),/가상 타인 비공개 용도/);
  await p.locator('[data-equipment-borrow]').click();assert.equal(await p.locator('#dlg [name=eqUnit_7]').isDisabled(),true);await p.locator('#dlg [data-close]').click();
  await ok('returnEquipment',{id:'equicurrent'+width+role,date:day},B);
  /* 번호 없는 기존기록을 화면에서 지정해도 새 대여로 중복되지 않음 */
  await server.evaluate(({day})=>{window.__book['앱_기자재사용'].data.push(['equilegacyui001','raspberry-pi','가상기자재학생','1',day,'','가상 기존 기록','','가상기자재학생',day,'','']);},{day});
  await p.locator('[data-equipment-refresh]').click();await p.locator('[data-equipment-assign]').waitFor();assert.match(await p.locator('.equipment-warning').innerText(),/번호 미지정 1대/);
  await p.locator('[data-equipment-assign]').click();await p.locator('#dlg [name=eqUnit_8]').check();await p.locator('#dlgOk').click();await p.locator('#dlg').waitFor({state:'hidden'});
  assert.equal(await p.locator('[data-equipment-assign]').count(),0);assert.equal((await ok('equipmentLedger')).items[0].used,1);assert.match(await p.locator('#main .equipment-unit').nth(7).innerText(),/가상기자재학생/);
  await ok('returnEquipment',{id:'equilegacyui001',date:day});await server.evaluate(()=>{const d=window.__book['앱_기자재사용'].data;d.splice(d.findIndex(r=>r[0]==='equilegacyui001'),1);});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'가로 넘침 없음');assert.deepEqual(errors,[]);
  await ctx.close();
 }
 console.log('PASS 개별번호1~14/타인 현재이름·이력비공개/중복번호·잘못된번호/기존12열보존·번호지정UI/반납재사용 · 기자재: 총14/초과·소수·날짜·중복 요청/반납/권한·손님/첫 화면 제외/재고 재검증/메뉴 전체조회0 · 교사/학생 390/1280px 등록·반납·재접속·가로넘침·JS오류');
}finally{await browser.close();}
