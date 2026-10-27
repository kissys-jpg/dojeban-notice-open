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

server.__props.STUDENT_LOGIN_REQUIRED='false';
server.__src+='\nfunction storageDriveRequest_(method,id,q){const f=window.__drive.files[id]||window.__drive.folders[id];if(!f)throw Error("가상 파일 없음");if(method==="patch"){if(window.__failMove===id)throw Error("가상 이전 중단");const a=new URLSearchParams(q);f.parent=a.get("addParents");}return {id:f.id,mimeType:window.__drive.folders[id]?"application/vnd.google-apps.folder":f.mime,driveId:window.__drive.folders[id]&&f.school?"fake-shared-drive":undefined,parents:f.parent?[f.parent]:[]};}';
server.URLSearchParams=URLSearchParams;
const ok=(a,p={},c=teacher)=>{const r=api(a,p,c);assert.equal(r.ok,true,r.error);return r.data;};
const source=server.DriveApp.createFolder('가상 이전 원본'),target=server.DriveApp.createFolder('가상 학교 저장소');server.__props.APP_FOLDER=source.getId();server.__drive.folders[target.getId()].school=true;
const src=source.createFolder('사진첩'),dst=target.createFolder('사진첩'),privateFolder=source.createFolder('비공개 소개서'),outside=server.DriveApp.createFolder('가상 외부');
const make=f=>f.createFile(server.Utilities.newBlob([37,80,68,70],'application/pdf','가상 자료.pdf')).getId();
const one=make(src),two=make(src),priv=make(privateFolder),ext=make(outside),roots={source:source.getId(),target:target.getId()},items=[one,two].map(id=>({id,parent:src.getId(),target:dst.getId()}));
server.__props.PHOTO_ALBUM_FOLDER=src.getId();server.__props['DF_사진첩']=src.getId();server.__props.MATERIAL_FOLDER=outside.getId();
ok('saveStudent',{name:'가상이전학생',group:'general',pin:'1234'});const student={name:'가상이전학생',pin:'1234'};
assert.equal(api('moveStorageFiles',{...roots,files:items},student).ok,false);assert.equal(api('relinkStorageFolders',{...roots,confirm:true,folders:[]},student).ok,false);
assert.equal(api('moveStorageFiles',{...roots,files:[{id:priv,parent:privateFolder.getId(),target:dst.getId()}]},teacher).ok,false);
assert.equal(api('moveStorageFiles',{...roots,files:[{id:ext,parent:outside.getId(),target:dst.getId()}]},teacher).ok,false);
assert.equal(api('moveStorageFiles',{...roots,files:[{id:one,parent:src.getId(),target:outside.getId()}]},teacher).ok,false);
server.__failMove=two;const interrupted=ok('moveStorageFiles',{...roots,files:items});assert.deepEqual(Array.from(interrupted.moved),[one]);assert.equal(server.__drive.files[one].parent,dst.getId());assert.equal(server.__drive.files[two].parent,src.getId());assert.match(interrupted.error,/가상 이전 중단/);
assert.equal(api('relinkStorageFolders',{...roots,confirm:true,folders:[{source:src.getId(),target:dst.getId()}]},teacher).ok,false);assert.equal(server.__props.PHOTO_ALBUM_FOLDER,src.getId());
delete server.__failMove;assert.equal(ok('moveStorageFiles',{...roots,files:items}).moved.length,2);assert.equal(server.__drive.files[one].id,one);assert.equal(server.__drive.files[two].id,two);
/* 원본의 비공개 하위 폴더를 포함한 이전은 승인된 공통 자료 범위 밖이므로 마무리도 차단합니다. */
assert.equal(api('relinkStorageFolders',{...roots,confirm:true,folders:[{source:src.getId(),target:dst.getId()},{source:privateFolder.getId(),target:dst.getId()}]},teacher).ok,false);
/* 공통 자료만 있는 별도 가짜 루트에서 연결 치환을 확인합니다. */
const clean=server.DriveApp.createFolder('가상 공통 원본'),photo=clean.createFolder('사진첩');server.__props.APP_FOLDER=clean.getId();server.__props.PHOTO_ALBUM_FOLDER=photo.getId();server.__props['DF_사진첩']=photo.getId();
const r=ok('relinkStorageFolders',{source:clean.getId(),target:target.getId(),confirm:true,folders:[{source:photo.getId(),target:dst.getId()}]});assert.equal(r.folderCount,2);assert.equal(server.__props.APP_FOLDER,target.getId());assert.equal(server.__props.DRIVE_ROOT,target.getId());assert.equal(server.__props.PHOTO_ALBUM_FOLDER,dst.getId());assert.equal(server.__props['DF_사진첩'],dst.getId());assert.equal(server.__props.MATERIAL_FOLDER,outside.getId());
ok('setupStaffAccounts',{adminName:'가상관리교사',teachers:['가상일반교사'],password:'fake-teacher-password'});const staff=ok('login',{}, {teacherName:'가상일반교사',teacher:'fake-teacher-password'});for(const action of ['moveStorageFiles','relinkStorageFolders'])assert.match(api(action,{}, {session:staff.session}).error,/최고관리자/);
console.log('저장소 이전: 최고관리자 제한·원본/목적 경로·비공개 제외·부분 실패/재시도·ID 보존·연결 치환/외부폴더 보존 통과');
