/**
 * 도제반 알림판 — 구글 시트용 웹페이지 (Apps Script)
 *
 * ▼ 비밀값은 코드에 적지 않습니다. Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에서 넣으세요.
 *   TEACHER_PASSWORD   선생님 비밀번호 (학생에게 알려 주지 마세요)
 *   SPREADSHEET_ID     원본 구글 시트 ID (비우면 setupApp_로 연결한 시트)
 *   NO_LOGIN_TEST_MODE true이면 로그인 없이 교사 권한으로 열립니다 (테스트 전용, 운영에서는 지우거나 false)
 * 설치 방법은 저장소의 docs/직접_설치하기.md 를 보세요.
 */
const CFG_ = PropertiesService.getScriptProperties();
const TEACHER_PASSWORD = CFG_.getProperty("TEACHER_PASSWORD") || "여기에_비밀번호";
const NO_LOGIN_TEST_MODE = String(CFG_.getProperty("NO_LOGIN_TEST_MODE") || "").trim().toLowerCase() === "true";
const SPREADSHEET_ID = CFG_.getProperty("SPREADSHEET_ID") || "";
/* 로그인 없이 둘러보기: 이름·PIN 없이 들어오면 '손님'으로 전체 공개 공지·급식·시간표·학교 일정만 봅니다. 끄려면 스크립트 속성 GUEST_VIEW=false */
const GUEST_VIEW = String(CFG_.getProperty("GUEST_VIEW") || "").trim().toLowerCase() !== "false";
const GUEST_ACTIONS_ = { load: 1, login: 1, timetable: 1, meals: 1 };

/* 기존 탭 이름 (시트와 다르면 고치세요) */
const TAB_AFTER = "일정표";          // 방과후 시간표
const TAB_PERSONAL = "학생별_일정표"; // 학생별·공통 일정
const TAB_BOM = "BOM";               // 실습재료 구매 목록
const APP_BUILD_ = "";              // 화면 버전 (자동 배포가 커밋 번호로 채웁니다. 입구 페이지가 화면 코드와 비교)
const APP_UPDATED_ = "";            // 앱 배포 시각 (자동 배포가 채웁니다. 직접 고치지 마세요)
const SCHOOL_YEAR = 0;               // 0이면 자동(3월~이듬해 2월). 바꾸려면 2026처럼 숫자로.

/* 앱이 새로 만드는 탭 (처음 열 때 자동 생성) */
const APP_TABS = {
  equipmentLoans: { name: "앱_기자재사용", head: ["ID", "기자재ID", "사용자", "수량", "사용일", "반납예정일", "용도", "장소", "등록자", "등록시각", "반납일", "반납처리자", "기자재번호"] },
  roster:   { name: "앱_명단",     head: ["이름", "구분", "학년반", "PIN", "메모", "방과후참여", "노션포트폴리오"] },
  notices:  { name: "앱_공지",     head: ["ID", "작성시각", "대상", "제목", "내용", "고정", "확인기한"] },
  events:   { name: "앱_일정",     head: ["ID", "날짜", "종료일", "시간", "종류", "대상", "제목", "장소", "메모"] },
  personal: { name: "앱_개인일정", head: ["ID", "이름", "날짜", "종료일", "시간", "제목", "메모", "입력"] },
  requests: { name: "앱_요청",     head: ["ID", "시각", "이름", "구분", "분류", "제목", "내용", "상태", "최근시각", "학생안읽음", "교사안읽음"] },
  replies:  { name: "앱_요청글",   head: ["요청ID", "시각", "작성", "내용"] },
  acks:     { name: "앱_확인",     head: ["공지ID", "이름", "시각"] },
  buys:     { name: "앱_구매",     head: ["앱ID", "이름", "시각", "팀명", "부품명"] }
};

const GROUP_LABEL = { learner: "학습근로자", pre2: "예비2", pre1: "예비1", general: "일반학생" };
const TARGET_LABEL = { all: "전체", learner: "학습근로자", pre: "예비전체", pre2: "예비2", pre1: "예비1", general: "일반학생" };
const KIND_LABEL = { OJT: "OJT", OFF: "OFF-JT", PRJ: "팀프로젝트", SCH: "학교수업", EVAL: "평가", EVT: "행사" };
const REQ_STATUS = ["접수", "처리중", "완료"];

/* ===================== 웹페이지 ===================== */
function doGet(e) {
  const q = (e && e.parameter) || {};
  if (q.ics) return icsFeed_(String(q.ics));
  if (q.ev) return icsSingle_(q);
  if (q.raw) return ContentService.createTextOutput(HtmlService.createHtmlOutputFromFile("Index").getContent()).setMimeType(ContentService.MimeType.TEXT);
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("도제반 알림판")
    .setFaviconUrl("https://kissys-jpg.github.io/dojeban/favicon-32.png")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 외부 입구 페이지(GitHub Pages)용: 쿠키 없이 fetch로 부르므로 어떤 구글 계정으로 로그인해 있어도 동작합니다. */
function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    out = body.fn === "api" ? api(body.req) : { ok: false, error: "알 수 없는 요청입니다" };
  } catch (x) { out = { ok: false, error: String((x && x.message) || x) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** 웹페이지가 부르는 단 하나의 입구. 모든 요청은 로그인 정보를 함께 보냅니다.
 *  속도: 읽기는 캐시(최대 90초)를 쓰고, 쓰기 뒤에는 바뀐 탭만 캐시를 지운 다음 화면 데이터를 같은 응답에 담아 돌려줍니다. */
const READ_ACTIONS_ = { equipmentLedger:1, todayTeamFiles:1, studentPrivate:1, purchaseSheetLinks:1, photoBrowse:1, photoImage:1, resourceLinks:1, companySetupInfo:1, companyTemplateFile:1, noticeImage:1, noticeDownload:1, login: 1, load: 1, downloadFile: 1, checkSetup: 1, legacyAttendance: 1 };
const BUMP_ACTIONS_ = { syncCalendar: 1, saveSettings: 1, setAutomation: 1, createCalendar: 1, sendNotifications: 1 };
function api(req) {
  const started=Date.now();
  try {
    req = req || {};
    const action = String(req.action || "");
    USE_CACHE_ = true;
    ensureTabs_();
    if ((action === "load" && !(req.payload && req.payload.homeOnly === true)) || action === "login" || req.withLoad) prefetchLoad_();
    const cred0 = req.cred || {};
    const me = NO_LOGIN_TEST_MODE ? { role: "teacher", name: "선생님" } : (GUEST_VIEW && !cred0.teacher && !String(cred0.name || "").trim() && !String(cred0.pin || "").trim()) ? { role: "guest", name: "손님", group: "" } : auth_(cred0);
    const p = req.payload || {};
    if (me.role === "guest") { if (!GUEST_ACTIONS_[action]) throw new Error("로그인하면 이용할 수 있습니다"); if (action === "load") p.homeOnly = true; req.withLoad = false; }
    if (me.role === 'teacher' && ((action === 'load' && !(req.payload && req.payload.homeOnly === true)) || req.withLoad)) migrateRequestsToAnon_();
    let data;
    if (action === "login") data = { me: me, loginDisabled: NO_LOGIN_TEST_MODE, guestView: GUEST_VIEW };
    else if (action === "load") data = load_(me, {deferLinks:p.deferLinks===true,homeOnly:p.homeOnly===true});
    else if (READ_ACTIONS_[action]) data = dispatch_(me, action, p);
    else {
      USE_CACHE_ = false; MEMO_ = {};          // 쓰기 중에는 항상 시트를 직접 읽습니다
      try { data = dispatch_(me, action, p); }
      finally { if (BUMP_ACTIONS_[action]) bumpAll_(); else flushDirty_(); USE_CACHE_ = true; }
    }
    const out = { ok: true, data: data };
    if(me.role==="teacher"&&p.profile===true)out.profile={serverMs:Date.now()-started,phases:HOME_TIMING_||[]};
    if (req.withLoad && action !== "load") out.load = load_(me);
    return JSON.parse(JSON.stringify(out));
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
function dispatch_(me, action, p) {
  switch (action) {
    case "equipmentLedger": return equipmentLedger_(me);
    case "borrowEquipment": return borrowEquipment_(me, p);
    case "returnEquipment": return returnEquipment_(me, p);
    case "assignEquipmentUnits": return assignEquipmentUnits_(me, p);
    case "ack":          need_(me, "student"); return ack_(me, p.id);
    case "noticeImage": return noticeImage_(me,p);
    case "noticeDownload": return noticeDownload_(me,p);
    case "saveNotice":   need_(me, "teacher"); return saveNotice_(p);
    case "deleteRow":    need_(me, "teacher"); return deleteRow_(p.tab, p.id);
    case "saveEvent":    need_(me, "teacher"); return saveEvent_(p);
    case "addPersonal":  return addPersonal_(me, p);
    case "savePersonal": return savePersonal_(me, p);
    case "delPersonal":  return delPersonal_(me, p.id);
    case "addRequest":   need_(me, "student"); return addRequest_(me, p);
    case "reply":        return reply_(me, p.id, p.text);
    case "setStatus":    need_(me, "teacher"); return setStatus_(p.id, p.status);
    case "markRead":     return markRead_(me, p.id);
    case "todayTeamFiles": return todayTeamFiles_(me,p);
    case "purchaseSheetLinks": need_(me,"teacher"); return purchaseSheetLinks_();
    case "addPurchase":  return addPurchase_(me, p);
    case "studentPrivate": return studentPrivate_(me,p,false);
    case "saveStudentPrivate": return studentPrivate_(me,p,true);
    case "saveStudent":  need_(me, "teacher"); return saveStudent_(p);
    case "deleteStudent": need_(me, "teacher"); return deleteStudent_(p);
    case "makePins":     need_(me, "teacher"); return makePins_();
    case "legacyAttendance": need_(me, "teacher"); { const v = readSheet_("출석부"); return v ? { exists: true, rows: v } : { exists: false, rows: [] }; }
    case "saveNotionPortfolio": return saveNotionPortfolio_(me,p);
    case "saveMaterialsFolder": need_(me,'teacher'); return saveMaterialsFolder_(p);
    case "uploadDriveMaterial": need_(me,'teacher'); return uploadDriveMaterial_(me,p);
    case "anonPost":     return anonPost_(me, p);
    case "anonComment":  return anonComment_(me, p);
    case "anonDelete":   return anonDelete_(me, p);
    case "anonStatus": need_(me,"teacher"); return anonStatus_(p);
    case "anonReport": return anonReport_(me,p);
    case "resolveReport": need_(me,"teacher"); return withLock_(function(){const r=record_("anonReports",p.id);sheet_("anonReports").getRange(r._row,6).setValue("완료");return true;});
    case "saveBoard": return saveBoard_(me,p);
    case "deleteBoard": return deleteBoard_(me,p);
    case "boardComment": return boardComment_(me,p);
    case "deleteBoardComment": return deleteBoardComment_(me,p);
    case "anonHide":     need_(me, "teacher"); return anonHide_(p);
    case "uploadProjectFile": return uploadProjectFile_(me, p);
    case "uploadStart": return uploadStart_(me, p);
    case "saveCertSchedule": need_(me,"teacher"); return saveCertSchedule_(p);
    case "deleteCertSchedule": need_(me,"teacher"); return deleteCertSchedule_(p);
    case "saveCertFolder": need_(me,"teacher"); return saveCertFolder_(p);
    case "photoBrowse": return photoBrowse_(me,p);
    case "photoImage": return photoImage_(me,p);
    case "photoSetup": need_(me,"teacher"); return photoSetup_(p);
    case "photoCreateAlbum": need_(me,"teacher"); return photoCreateAlbum_(me,p);
    case "photoUpload": need_(me,"teacher"); return photoUpload_(me,p);
    case "driveBrowse": return driveBrowse_(me, p);
    case "driveUpload": return driveUpload_(me, p);
    case "driveDownload": return driveDownload_(me, p);
    case "setMaterialUpload": need_(me, 'teacher'); return withLock_(function () { PropertiesService.getScriptProperties().setProperty("MATERIAL_STUDENT_UPLOAD", p.on ? "1" : "0"); PROPS_ = null; return true; });
    case "uploadChunk": return uploadChunk_(me, p);
    case "deleteFile":   return deleteFile_(me, p.id);
    case "shareProjectFolder": need_(me, "teacher"); return shareProjectFolder_(p.id);
    case "projectFolder": need_(me, "teacher"); return projectFolderInfo_(p.id);
    case "saveProjectFolder": need_(me,"teacher"); return saveProjectFolder_(p);
    case "companySetupInfo": need_(me,"teacher"); return companyResources_(me);
    case "saveCompanyResources": need_(me,"teacher"); return saveCompanyResources_(p);
    case "seedCompanySource": need_(me,"teacher"); return seedCompanySource_();
    case "refreshCompanyInfo": need_(me,"teacher"); CacheService.getScriptCache().remove("company_source_v1");CacheService.getScriptCache().remove("company_home_v1"); COMPANY_SOURCE_=null; return true;
    case "createCompanyFolder": need_(me,"teacher"); return createCompanyFolder_(String(p.id||""));
    case "saveExperienceIntro": need_(me,"student"); return saveExperienceIntro_(me,p);
    case "reviewExperienceIntro": need_(me,"teacher"); return reviewExperienceIntro_(p);
    case "companyTemplateFile": return companyTemplateFile_(me,p);
    case "saveCompany":  need_(me, "teacher"); return saveCompany_(p);
    case "removeCompany": need_(me, "teacher"); return removeCompany_(p.id);
    case "saveAssign":   need_(me, "teacher"); return saveAssign_(p);
    case "icsToken":     return icsToken_(me, p.reset === true);
    case "driveMaterialFile": return driveMaterialFile_(me, String(p.id || ""));
    case "timetable":    return timetable_(me, p);
    case "saveMyHome":   return saveMyHome_(me, p);
    case "meals":        return meals_(dateValid_(p.from), plusDate_(dateValid_(p.from), 6));
    case "resourceLinks": return {driveMaterials:driveMaterials_(me),notionPages:notionPages_()};
    case "refreshLinks": need_(me, "teacher"); CacheService.getScriptCache().removeAll(["dm_v1", "nt_v1"]); return true;
    default: return extendedApi_(me, action, p);
  }
}
function ok_(data) { return JSON.parse(JSON.stringify({ ok: true, data: data })); }
/* 기자재는 첫 화면 응답에 넣지 않고 메뉴에서만 조회합니다. 현재 재고는 캐시 없이 확인합니다. */
const EQUIPMENT_ = [{ id: "raspberry-pi", name: "라즈베리파이", unitName: "라즈베리", total: 14 }];
function equipmentNumbers_(value,item,optional) {
  if(optional&&(value===undefined||value===null||value===""))return [];
  const nums=Array.isArray(value)?value:typeof value==="string"?value.split(","):[];
  if(!nums.length||nums.some(function(n){return !/^[1-9][0-9]*$/.test(String(n))||Number(n)>item.total;})||new Set(nums.map(Number)).size!==nums.length)throw new Error("사용할 기자재 번호를 중복 없이 선택해 주세요 (1~"+item.total+"번)");
  return nums.map(Number).sort(function(a,b){return a-b;});
}
function equipmentRows_() {
  USE_CACHE_ = false; MEMO_[APP_TABS.equipmentLoans.name] = null;
  return rows_("equipmentLoans").map(function(r) { const v=r.v,item=EQUIPMENT_.find(function(e){return e.id===v[1];});let units=[];
    try{if(item)units=equipmentNumbers_(v[12],item,true);}catch(e){}
    const qty=Number(v[3]);if(units.length!==qty)units=[];
    return { row:r._row, id:v[0], item:v[1], user:v[2], qty:qty, date:v[4], due:v[5], purpose:v[6], place:v[7], createdBy:v[8], createdAt:v[9], returned:v[10]||"", returnedBy:v[11]||"", units:units }; });
}
function equipmentLedger_(me) {
  const all=equipmentRows_();
  return { items:EQUIPMENT_.map(function(e) {
    const active=all.filter(function(r){return r.item===e.id&&!r.returned;}),used=active.reduce(function(n,r){return n+r.qty;},0),unassigned=active.filter(function(r){return !r.units.length;}).reduce(function(n,r){return n+r.qty;},0);
    return {id:e.id,name:e.name,total:e.total,used:used,available:e.total-used,unassigned:unassigned,
      units:Array.from({length:e.total},function(_,i){const number=i+1,users=active.filter(function(r){return r.units.includes(number);}).map(function(r){return r.user;});return {number:number,label:e.unitName+number,users:users};})};
  }), loans:all.filter(function(r){return me.role==="teacher"||r.user===me.name;}).map(function(r){delete r.row;return r;}).reverse() };
}
function equipmentConflict_(all,item,units,exclude) {
  if(all.some(function(r){return r.id!==exclude&&r.item===item.id&&!r.returned&&r.units.some(function(n){return units.includes(n);});}))throw new Error("선택한 번호는 이미 사용 중입니다. 새로고침 후 확인해 주세요");
}
function equipmentWriteUnits_(sh,row,units) {
  const head=sh.getRange(1,13).getValue();if(head&&head!=="기자재번호")throw new Error("기자재 시트 13열을 확인해 주세요. 기존 내용은 변경하지 않았습니다");
  if(!head)sh.getRange(1,13).setValue("기자재번호");
  sh.getRange(row,13).setNumberFormat("@").setValue(units.join(","));
}
function borrowEquipment_(me,p) {
  return withLock_(function() {
    const item=EQUIPMENT_.find(function(e){return e.id===p.item;}); if(!item)throw new Error("기자재를 확인해 주세요");
    const id=String(p.id||"");if(!/^eq[a-z0-9]{10,40}$/.test(id))throw new Error("등록 요청을 다시 열어 주세요");
    const user=me.role==="teacher"?required_(p.user,80):me.name;
    const qty=Number(p.qty);if(!Number.isInteger(qty)||qty<1||qty>item.total)throw new Error("수량은 1~"+item.total+"대의 정수로 입력해 주세요");
    const date=dateValid_(p.date),due=dateValid_(p.due,true);if(date>today_())throw new Error("사용일은 오늘까지 입력할 수 있습니다");if(due&&due<date)throw new Error("반납예정일은 사용일 이후로 입력해 주세요");
    const purpose=required_(p.purpose,200),place=clean_(p.place,80),all=equipmentRows_(),units=equipmentNumbers_(p.units,item,true);
    const prior=all.find(function(r){return r.id===id;});
    if(prior){if(prior.createdBy!==me.name||prior.user!==user||prior.item!==item.id||prior.qty!==qty||prior.date!==date||prior.due!==due||prior.purpose!==purpose||prior.place!==place||prior.units.join(",")!==units.join(","))throw new Error("이미 처리된 등록 요청입니다. 창을 다시 열어 주세요");return equipmentLedger_(me);}
    if(units.length!==qty)throw new Error("화면을 새로고침하고 사용할 번호를 선택해 주세요. 선택 번호 수와 수량이 같아야 합니다");
    const used=all.filter(function(r){return r.item===item.id&&!r.returned;}).reduce(function(n,r){return n+r.qty;},0);
    if(qty>item.total-used)throw new Error("현재 사용 가능 수량은 "+(item.total-used)+"대입니다. 새로고침 후 확인해 주세요");
    equipmentConflict_(all,item,units,"");
    const sh=sheet_("equipmentLoans"),head=sh.getRange(1,13).getValue();
    if(head&&head!=="기자재번호")throw new Error("기자재 시트 13열을 확인해 주세요. 기존 내용은 변경하지 않았습니다");
    if(!head)sh.getRange(1,13).setValue("기자재번호");
    sh.getRange(sh.getLastRow()+1,1,1,13).setNumberFormat("@");
    append_("equipmentLoans",[id,item.id,user,qty,date,due,purpose,place,me.name,now_(),"","",units.join(",")]);
    SpreadsheetApp.flush();
    return equipmentLedger_(me);
  });
}
function assignEquipmentUnits_(me,p) {
  return withLock_(function(){
    const all=equipmentRows_(),row=all.find(function(r){return r.id===p.id;});if(!row)throw new Error("사용 기록을 찾지 못했습니다");
    if(me.role!=="teacher"&&row.user!==me.name)throw new Error("본인 사용 기록만 번호를 지정할 수 있습니다");
    if(row.returned)throw new Error("반납된 기록의 번호는 바꾸지 않습니다");
    const item=EQUIPMENT_.find(function(e){return e.id===row.item;}),units=equipmentNumbers_(p.units,item,false);
    if(units.length!==row.qty)throw new Error("기존 수량 "+row.qty+"대와 같은 개수의 번호를 선택해 주세요");
    if(row.units.length){if(row.units.join(",")!==units.join(","))throw new Error("이미 번호가 지정된 기록입니다. 새로고침해 주세요");return equipmentLedger_(me);}
    equipmentConflict_(all,item,units,row.id);equipmentWriteUnits_(sheet_("equipmentLoans"),row.row,units);SpreadsheetApp.flush();return equipmentLedger_(me);
  });
}
function returnEquipment_(me,p) {
  return withLock_(function() {
    const row=equipmentRows_().find(function(r){return r.id===p.id;});if(!row)throw new Error("사용 기록을 찾지 못했습니다");
    if(me.role!=="teacher"&&row.user!==me.name)throw new Error("본인 사용 기록만 반납할 수 있습니다");
    if(!row.returned){const date=dateValid_(p.date);if(date<row.date||date>today_())throw new Error("반납일은 사용일부터 오늘 사이로 입력해 주세요");sheet_("equipmentLoans").getRange(row.row,11,1,2).setNumberFormat("@").setValues([[date,me.name]]);SpreadsheetApp.flush();}
    return equipmentLedger_(me);
  });
}
function need_(me, role) { if (me.role !== role) throw new Error(role === "teacher" ? "선생님만 할 수 있습니다" : "학생 계정으로 들어와 주세요"); }

/* ===================== 로그인 ===================== */
function auth_(cred) {
  const cache = CacheService.getScriptCache();
  if (cred.teacher) {
    if (TEACHER_PASSWORD === "여기에_비밀번호" || !TEACHER_PASSWORD) throw new Error("선생님 비밀번호가 아직 없습니다. Apps Script 프로젝트 설정 → 스크립트 속성에 TEACHER_PASSWORD를 추가해 주세요");
    const k = "fail_t";
    if (Number(cache.get(k) || 0) >= 8) throw new Error("비밀번호를 여러 번 틀렸습니다. 10분 뒤 다시 시도하세요");
    if (String(cred.teacher) !== TEACHER_PASSWORD) { cache.put(k, String(Number(cache.get(k) || 0) + 1), 600); throw new Error("비밀번호가 맞지 않습니다"); }
    cache.remove(k);
    return { role: "teacher", name: "선생님" };
  }
  const name = String(cred.name || "").trim(), pin = String(cred.pin || "").trim();
  if (!name || !pin) throw new Error("이름과 PIN을 넣어 주세요");
  const k = "fail_" + name;
  if (Number(cache.get(k) || 0) >= 5) throw new Error("PIN을 여러 번 틀렸습니다. 10분 뒤 다시 시도하세요");
  const st = roster_().filter(function (r) { return r.name === name; })[0];
  if (!st || !st.pin || String(st.pin) !== pin) { cache.put(k, String(Number(cache.get(k) || 0) + 1), 600); throw new Error("이름이나 PIN이 맞지 않습니다. 선생님께 확인하세요"); }
  cache.remove(k);
  return { role: "student", name: st.name, group: st.group, klass: st.klass, afterschool: st.afterschool };
}

/* ===================== 시트 도우미 ===================== */
/* 한 번의 실행(요청) 동안만 유지되는 값 */
var SS_ = null, MEMO_ = {}, DIRTY_ = {}, USE_CACHE_ = false, DV_ = null;
const TAB_TTL_ = 90; // 시트를 직접 고친 내용은 최대 90초 뒤 화면에 반영
function ss_() {
  if (SS_) return SS_;
  const configured = String(SPREADSHEET_ID || "").trim();
  if (configured) return (SS_ = SpreadsheetApp.openById(configured));
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return (SS_ = active);
  const id = PropertiesService.getScriptProperties().getProperty("APP_SPREADSHEET");
  if (!id) throw new Error("연결된 시트가 없습니다. 스크립트 속성에 SPREADSHEET_ID를 넣거나 setupApp_을 실행해 주세요");
  return (SS_ = SpreadsheetApp.openById(id));
}
/** 앱 탭이 있는지 6시간에 한 번만 확인합니다. 없을 때만 잠금을 걸고 만듭니다. */
function ensureTabs_(force) {
  const cache = CacheService.getScriptCache(), key = "tabsOk_" + Object.keys(APP_TABS).length;
  if (!force && cache.get(key)) return;
  const ss = ss_(), have = {};
  ss.getSheets().forEach(function (sh) { have[sh.getName()] = true; });
  const missing = Object.keys(APP_TABS).filter(function (k) { return !have[APP_TABS[k].name]; });
  if (missing.length) withLock_(function () {
    missing.forEach(function (k) {
      const t = APP_TABS[k];
      if (ss.getSheetByName(t.name)) return;
      const sh = ss.insertSheet(t.name);
      sh.getRange(1, 1, 1, t.head.length).setValues([t.head]);
      sh.setFrozenRows(1);
    });
  });
  cache.put(key, "1", 21600);
}
function dv_() { if (DV_ === null) DV_ = CacheService.getScriptCache().get("dv") || "0"; return DV_; }
function tabKey_(name) { return "tab:" + dv_() + ":" + name; }
function readSheet_(name, appTab) {
  let sh = ss_().getSheetByName(name);
  if (!sh && appTab) { ensureTabs_(true); sh = ss_().getSheetByName(name); }
  return sh ? sh.getDataRange().getDisplayValues() : null;
}
/** 탭 전체 값. 읽기 요청에서는 같은 실행 안 재사용 → 캐시 → 시트 순서로 찾습니다. */
function vals_(name, appTab) {
  if (!USE_CACHE_) return readSheet_(name, appTab);
  if (MEMO_[name]) return MEMO_[name];
  const cache = CacheService.getScriptCache(), hit = cache.get(tabKey_(name));
  if (hit) return (MEMO_[name] = JSON.parse(hit));
  const v = readSheet_(name, appTab);
  if (!v) return null;
  MEMO_[name] = v;
  try { const s = JSON.stringify(v); if (Utilities.newBlob(s).getBytes().length < 95000) cache.put(tabKey_(name), s, TAB_TTL_); } catch (x) {}
  return v;
}
/** 여러 탭을 한 번에 가져옵니다: 캐시 → (없는 것만) Sheets API 한 번 호출.
 *  시트를 탭마다 따로 읽으면 탭 하나에 0.5~1초씩 걸려서 처음 열 때 매우 느렸습니다. */
function prefetch_(names) {
  if (!USE_CACHE_) return;
  let need = names.filter(function (n) { return !MEMO_[n]; });
  if (!need.length) return;
  const cache = CacheService.getScriptCache(), got = cache.getAll(need.map(tabKey_));
  need.forEach(function (n) { const s = got[tabKey_(n)]; if (s) try { MEMO_[n] = JSON.parse(s); } catch (x) {} });
  need = need.filter(function (n) { return !MEMO_[n]; });
  if (!need.length || typeof Sheets === "undefined") return;
  const appNames = {}; Object.keys(APP_TABS).forEach(function (k) { appNames[APP_TABS[k].name] = true; });
  let res = batchRead_(need);
  if (!res) { res = batchRead_(need.filter(function (n) { return appNames[n]; })); }   // 없는 원본 탭이 섞였으면 앱 탭만
  if (!res) return;
  const toCache = {};
  Object.keys(res).forEach(function (n) {
    MEMO_[n] = res[n];
    try { const s = JSON.stringify(res[n]); if (Utilities.newBlob(s).getBytes().length < 95000) toCache[tabKey_(n)] = s; } catch (x) {}
  });
  try { if (Object.keys(toCache).length) cache.putAll(toCache, TAB_TTL_); } catch (x) {}
}
function batchRead_(names) {
  if (!names.length) return {};
  try {
    const id = String(SPREADSHEET_ID || "").trim() || ss_().getId();
    const r = Sheets.Spreadsheets.Values.batchGet(id, { ranges: names.map(function (n) { return "'" + n.replace(/'/g, "''") + "'"; }), valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" });
    const out = {};
    (r.valueRanges || []).forEach(function (vr, i) {
      const rows = (vr.values || []).map(function (row) { return row.map(function (c) { return c == null ? "" : String(c); }); });
      const w = rows.reduce(function (m, row) { return Math.max(m, row.length); }, 0);
      rows.forEach(function (row) { while (row.length < w) row.push(""); });
      out[names[i]] = rows.length ? rows : [[]];
    });
    return out;
  } catch (e) { return null; }
}
/** 쓰기 뒤 바뀐 탭의 캐시만 지웁니다. */
function flushDirty_() {
  const names = Object.keys(DIRTY_); if (!names.length) return;
  CacheService.getScriptCache().removeAll(names.map(tabKey_));
  names.forEach(function (n) { delete MEMO_[n]; });
  if (DIRTY_[TAB_AFTER] || DIRTY_[TAB_PERSONAL]) clearCache_();
  DIRTY_ = {};
}
/** 전체 캐시 무효화 (캘린더 동기화처럼 여러 탭을 바꾸는 작업 뒤) */
function bumpAll_() {
  DV_ = String(Date.now());
  const c = CacheService.getScriptCache(); c.put("dv", DV_, 21600); c.remove("sheetData_v1");
  MEMO_ = {}; DIRTY_ = {};
}
function prefetchLoad_() {
  const names = Object.keys(APP_TABS).filter(function(k){return k!=="equipmentLoans";}).map(function (k) { return APP_TABS[k].name; }).concat([TAB_BOM]);
  if (!CacheService.getScriptCache().get("sheetData_v1")) names.push(TAB_AFTER, TAB_PERSONAL);
  prefetch_(names);
}
function rows_(key) {
  const v = vals_(APP_TABS[key].name, true) || [[]];
  return v.slice(1).map(function (r, i) { return { _row: i + 2, v: r }; }).filter(function (x) { return x.v.some(function (c) { return String(c).trim(); }); });
}
function sheet_(key) { const n = APP_TABS[key].name; DIRTY_[n] = true; MEMO_[n] = null; let sh = ss_().getSheetByName(n); if (!sh) { ensureTabs_(true); sh = ss_().getSheetByName(n); } return sh; }
function append_(key, arr) {
  const sh = sheet_(key);
  sh.appendRow(arr.map(function (x) { return typeof x === "string" && /^[=+\-@]/.test(x) ? "'" + x : x; }));
}
function withLock_(fn) { const l = LockService.getScriptLock(); l.waitLock(15000); try { return fn(); } finally { l.releaseLock(); } }
function now_() { return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"); }
function today_() { return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd"); }
function uid_(p) { return (p || "") + Utilities.getUuid().replace(/-/g, "").slice(0, 10); }
function normGroup_(s) { s = String(s || ""); if (/일반|general/.test(s)) return "general"; if (/예비\s*1|1학년|pre1/.test(s)) return "pre1"; if (/예비|2학년|pre2/.test(s)) return "pre2"; return "learner"; }
function matches_(target, g) { return !target || target === "all" || target === g || (target === "pre" && (g === "pre1" || g === "pre2")); }
function targetKey_(s) { s = String(s || "").trim(); for (var k in TARGET_LABEL) if (TARGET_LABEL[k] === s || k === s) return k; return "all"; }
function clean_(s, n) { return String(s == null ? "" : s).replace(/\r/g, "").slice(0, n || 2000); }
function schoolYear_() { if (SCHOOL_YEAR) return SCHOOL_YEAR; const d = new Date(); const m = Number(Utilities.formatDate(d, "Asia/Seoul", "M")); const y = Number(Utilities.formatDate(d, "Asia/Seoul", "yyyy")); return m >= 3 ? y : y - 1; }
function pad_(n) { return (n < 10 ? "0" : "") + n; }

/* ===================== 명단 ===================== */
function roster_() {
  return rows_("roster").map(function (x) {
    return { row: x._row, name: x.v[0].trim(), group: normGroup_(x.v[1]), klass: x.v[2], pin: String(x.v[3]).trim(), note: x.v[4], notion: x.v[6] || "", afterschool: afterschoolParticipant_(x.v[5], normGroup_(x.v[1])) };
  }).filter(function (r) { return r.name; });
}
function afterschoolParticipant_(value, group) {
  const text=String(value == null ? '' : value).trim();
  if (!text) return group === 'pre1' || group === 'pre2';
  return /^(1|true|참여|참여함|예|y|yes)$/i.test(text);
}
function saveStudent_(p) {
  return withLock_(function () {
    const sh = sheet_("roster");
    if (!GROUP_LABEL[p.group]) throw new Error('학생 구분을 선택해 주세요');
    const previous = p.row ? roster_().find(function (r) { return r.row === Number(p.row); }) : null;
    const participating = p.afterschool === undefined ? (previous ? previous.afterschool : afterschoolParticipant_('',p.group)) : p.afterschool === true;
    sh.getRange(1,6,1,2).setValues([['방과후참여','노션포트폴리오']]);
    const vals = [clean_(p.name, 30).trim(), GROUP_LABEL[p.group] || "학습근로자", p.klass === undefined ? (previous ? previous.klass : "") : clean_(p.klass, 20), clean_(p.pin, 8), clean_(p.note, 200), participating ? "1" : "0", p.notion === undefined ? (previous ? previous.notion : "") : notionPortfolioUrl_(p.notion)];
    if (!vals[0]) throw new Error("이름을 넣어 주세요");
    if (vals[3] && !/^\d{4}$/.test(vals[3])) throw new Error("PIN은 숫자 4자리여야 합니다");
    if (p.row) {
      const old = roster_().find(function(r){ return r.row === Number(p.row); });
      if (!old) throw new Error("학생을 찾지 못했습니다");
      if (old.name !== vals[0] && roster_().some(function (r) { return r.name === vals[0]; })) throw new Error("같은 이름이 이미 있습니다. 동명이인은 ‘김하늘2’처럼 구분해 주세요");
      sh.getRange(old.row, 4).setNumberFormat("@"); writeCells_(sh, old.row, vals);
      if (old.name !== vals[0]) renameStudentRecords_(old.name, vals[0]);
      return true;
    }
    if (roster_().some(function (r) { return r.name === vals[0]; })) throw new Error("같은 이름이 이미 있습니다. 동명이인은 ‘김하늘2’처럼 구분해 주세요");
    sh.getRange(sh.getLastRow() + 1, 4).setNumberFormat("@"); append_("roster", vals); return true;
  });
}

/* 개인정보는 공유 운영 시트/일반 로딩/캐시와 분리합니다. 테스트 모드에서도 비밀번호를 다시 확인합니다. */
function studentPrivateFile_(id){return !!id&&String(id)===String(props_().STUDENT_PRIVATE_SHEET_ID||"");}
function denyStudentPrivateFile_(id){if(studentPrivateFile_(id))throw new Error("이 문서는 명단의 개인정보에서 교사 인증 후 확인해 주세요");}
function studentPrivateSheet_(create) {
  const props=PropertiesService.getScriptProperties(), id=String(props.getProperty("STUDENT_PRIVATE_SHEET_ID")||"").trim();
  let book;
  if(id){ try{book=SpreadsheetApp.openById(id);}catch(e){throw new Error("교사용 개인정보 시트에 접근할 수 없습니다. 실행 계정의 권한을 확인해 주세요");} }
  else if(create){
    book=SpreadsheetApp.create("도제 알림판 학생 개인정보 — 교사 전용");
    const sh=book.getSheets()[0];
    sh.getRange(1,1,1,8).setValues([["학생키","이름(최종 저장 시)","이메일","학생 연락처","주소","보호자 연락처","메모","수정시각"]]);
    sh.setFrozenRows(1);
    props.setProperty("STUDENT_PRIVATE_SHEET_ID",book.getId()); PROPS_=null;
  }else return null;
  return {book:book,sheet:book.getSheets()[0]};
}
function studentPrivate_(me,p,write) {
  need_(me,"teacher");
  if(!String(p.password||""))throw new Error("개인정보를 열려면 교사 비밀번호를 입력해 주세요");
  auth_({teacher:String(p.password)});
  const work=function(){
    const current=rows_("roster").find(function(x){return x._row===Number(p.row)&&String(x.v[0]).trim()===String(p.name||"");});
    if(!current)throw new Error("학생 명단이 바뀌었습니다. 새로고침 후 다시 선택해 주세요");
    const roster=ss_().getSheetByName(APP_TABS.roster.name),header=String(roster.getRange(1,8).getValue()||"");
    if(header&&header!=="개인정보키")throw new Error("명단의 8번째 열이 이미 사용 중입니다. 관리자에게 문의해 주세요");
    let key=header==="개인정보키"?String(current.v[7]||""):"";
    const fields=["email","phone","address","guardianPhone","note"],out={};
    fields.forEach(function(k){out[k]="";});
    if(!write&&!key)return {name:String(p.name),fields:out};
    if(write){
      fields.forEach(function(k){out[k]=clean_(p[k],k==="note"?500:k==="address"?300:k==="email"?120:40).trim();});
      if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))throw new Error("이메일 주소를 확인해 주세요");
      ["phone","guardianPhone"].forEach(function(k){if(out[k]&&!/^\+?[\d ()-]{6,40}$/.test(out[k]))throw new Error("연락처는 숫자·공백·괄호·하이픈으로 입력해 주세요");});
      if(!key){
        key=Utilities.getUuid();
        roster.getRange(1,8).setValue("개인정보키");
        roster.getRange(current._row,8).setValue(key);
        DIRTY_[APP_TABS.roster.name]=true;
      }
    }
    const target=studentPrivateSheet_(write);
    if(!target)return {name:String(p.name),fields:out};
    const rows=target.sheet.getDataRange().getDisplayValues();
    const index=key?rows.findIndex(function(r,i){return i>0&&String(r[0])===key;}):-1;
    if(write){
      const values=[key,clean_(p.name,30),out.email,out.phone,out.address,out.guardianPhone,out.note,now_()];
      target.sheet.getRange(index<0?target.sheet.getLastRow()+1:index+1,1,1,8).setNumberFormat("@");
      writeCells_(target.sheet,index<0?target.sheet.getLastRow()+1:index+1,values);
      return {saved:true};
    }
    if(index>=0)fields.forEach(function(k,i){out[k]=String(rows[index][i+2]||"");});
    return {name:String(p.name),fields:out,sheetUrl:target.book.getUrl()};
  };
  return write?withLock_(work):work();
}

/* 학생 이름이 들어가는 칸: 이름을 바꾸면 기록도 함께 바꿔 연결을 유지합니다 (탭 키: 0부터 센 열 번호) */
const STUDENT_NAME_COLS_ = { personal: [1], requests: [2], replies: [2], acks: [1], buys: [1], attendance: [2], progress: [1], portfolio: [1], tasks: [3], files: [1], contacts: [0], anon: [2], anonReports: [2], board: [1], boardComments: [2], anonCmt: [3], assign: [0], icsTokens: [0] };
function renameStudentRecords_(from, to) {
  let n = 0;
  Object.keys(STUDENT_NAME_COLS_).forEach(function (key) {
    if (!APP_TABS[key]) return;
    let sh = null;
    rows_(key).forEach(function (x) {
      STUDENT_NAME_COLS_[key].forEach(function (c) {
        if (String(x.v[c] == null ? "" : x.v[c]).trim() === from) { sh = sh || sheet_(key); sh.getRange(x._row, c + 1).setValue(to); n++; }
      });
    });
  });
  if (APP_TABS.projects) {
    let psh = null;
    rows_("projects").forEach(function (x) {
      let m; try { m = JSON.parse(x.v[3] || "[]"); } catch (e) { return; }
      if (Array.isArray(m) && m.indexOf(from) >= 0) { psh = psh || sheet_("projects"); psh.getRange(x._row, 4).setValue(JSON.stringify(m.map(function (s) { return s === from ? to : s; }))); n++; }
    });
  }
  const ps = ss_().getSheetByName(TAB_PERSONAL);
  if (ps && ps.getLastRow() > 0) {
    ps.getDataRange().getDisplayValues().forEach(function (r, i) {
      if (String(r[0]).trim() === from) { ps.getRange(i + 1, 1).setValue(to); DIRTY_[TAB_PERSONAL] = true; n++; }
    });
  }
  return n;
}
/* 학생 삭제: 명단·메일 수신·캘린더 구독만 지우고, 출결·이수·포트폴리오 등 훈련 기록은 보고용으로 남깁니다 */
function deleteStudent_(p) {
  return withLock_(function () {
    const st = roster_().find(function (r) { return r.row === Number(p.row); });
    if (!st || (p.name && st.name !== String(p.name))) throw new Error("학생을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요");
    ["contacts", "icsTokens"].forEach(function (key) {
      if (!APP_TABS[key]) return;
      const rows = rows_(key).filter(function (x) { return String(x.v[0]).trim() === st.name; }).sort(function (a, b) { return b._row - a._row; });
      if (rows.length) { const sh = sheet_(key); rows.forEach(function (x) { sh.deleteRow(x._row); }); }
    });
    sheet_("roster").deleteRow(st.row);
    return true;
  });
}
function makePins_() {
  return withLock_(function () {
    const sh = sheet_("roster"); let n = 0;
    roster_().forEach(function (r) {
      if (!r.pin) { const pin = String(1000 + Math.floor(Math.random() * 9000)); sh.getRange(r.row, 4).setNumberFormat("@").setValue(pin); n++; }
    });
    return n;
  });
}

/* ===================== 시트 해석: 방과후 · 학생별 일정 · BOM ===================== */
function parseDateCell_(v, sy) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/);
  if (m) return m[1] + "-" + pad_(+m[2]) + "-" + pad_(+m[3]);
  m = s.match(/^(\d{1,2})\s*[.\/]\s*(\d{1,2})$/);
  if (m) return (+m[1] >= 3 ? sy : sy + 1) + "-" + pad_(+m[1]) + "-" + pad_(+m[2]);
  return "";
}
function hhmm_(h, mi) { h = parseInt(h, 10); mi = parseInt(mi || "0", 10) || 0; if (isNaN(h)) return ""; if (h < 10) h += 12; return pad_(h) + ":" + pad_(mi); }
const HOLIDAY_ = /(휴일|공휴일|성탄절|신년|노동절|정기고사|지필|체육대회|종업식|방학|이브|개교기념|국외연수|의무검정|대체공휴)/;
function isAfterschoolTitle_(title) { return /^\([^()\r\n]+\)/.test(String(title || "").trim()); }
function cell_(row, i) { return String((row && row[i]) == null ? "" : row[i]).trim(); }
function parseAfterschool_(rows, sy) {
  const gradeCols = [];
  rows.slice(0, 6).forEach(function (r) { (r || []).forEach(function (c, i) { const m = String(c || "").match(/([1-3])\s*학년/); if (m) gradeCols.push({ col: i, grade: +m[1] }); }); });
  const slots = {};
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const blocks = [];
    row.forEach(function (c, i) { if (cell_(row, i) === "시" && cell_(row, i + 1) === "분") blocks.push(i); });
    if (!blocks.length) continue;
    const dateRow = rows[r - 1] || [];
    blocks.forEach(function (c, bi) {
      const end = bi + 1 < blocks.length ? blocks[bi + 1] : Math.max(row.length, dateRow.length);
      const inBlock = gradeCols.filter(function (x) { return x.col >= c && x.col < end; });
      const g = inBlock.length ? inBlock[0].grade : (bi + 1);
      const dayCols = [];
      for (let i = c + 2; i < end; i++) { const d = parseDateCell_(cell_(dateRow, i), sy); if (d) dayCols.push({ i: i, d: d }); }
      for (let k = r + 1; k < rows.length; k++) {
        const dr = rows[k] || [];
        if (!dr.some(function (v) { return String(v || "").trim(); })) break;
        if (dr.some(function (v, i) { return cell_(dr, i) === "시" && cell_(dr, i + 1) === "분"; })) break;
        const t = hhmm_(cell_(dr, c), cell_(dr, c + 1));
        if (!t) continue;
        dayCols.forEach(function (dc) {
          const title = cell_(dr, dc.i).replace(/\s+/g, " ");
          if (!title || /^(미운영|-|x|X)$/.test(title)) return;
          const key = dc.d + "|" + g + "|" + title;
          slots[key] = slots[key] || [];
          if (slots[key].indexOf(t) < 0) slots[key].push(t);
        });
      }
    });
  }
  return Object.keys(slots).map(function (key) {
    const parts = key.split("|"), times = slots[key].sort();
    const last = times[times.length - 1].split(":").map(Number), em = last[0] * 60 + last[1] + 50;
    const afterschool = isAfterschoolTitle_(parts[2]);
    return { date: parts[0], grade: +parts[1], title: parts[2], times: times, start: times[0], end: pad_(Math.floor(em / 60)) + ":" + pad_(em % 60), afterschool: afterschool, info: !afterschool, allDay: !afterschool && HOLIDAY_.test(parts[2]) };
  }).sort(function (a, b) { return (a.date + a.start + a.grade).localeCompare(b.date + b.start + b.grade); });
}
/* 일반 일정은 학년 열에 반복되더라도 날짜·제목·시간이 같으면 한 일정으로 묶습니다. */
function sheetScheduleEvents_(rows, grade) {
  const byKey = {}, out = [];
  (rows || []).forEach(function(a) {
    if (isAfterschoolTitle_(a.title) || (grade && a.grade !== grade)) return;
    const time = a.allDay ? "" : a.start + "–" + a.end, key = a.date + "|" + String(a.title).trim() + "|" + time;
    if (byKey[key]) { if (byKey[key].grades.indexOf(a.grade) < 0) byKey[key].grades.push(a.grade); return; }
    const id = "sheet-" + icsHash_(key), event = { id: id, uid: id, key: id, date: a.date, title: a.title, time: time, kind: "EVT", grades: [a.grade] };
    byKey[key] = event; out.push(event);
  });
  return out;
}
function parseStudentSheet_(rows, sy) {
  const out = { gradeLabel: "", common: [], byName: {} };
  let hi = -1;
  for (let i = 0; i < rows.length; i++) if ((rows[i] || []).some(function (c) { return /^\d{1,2}\s*월$/.test(String(c || "").trim()); })) { hi = i; break; }
  if (hi < 0) return out;
  const head = rows[hi];
  out.gradeLabel = cell_(head, 0);
  const months = head.map(function (h) { const m = String(h || "").trim().match(/^(\d{1,2})\s*월$/); return m ? +m[1] : 0; });
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = cell_(row, 0);
    if (!name) { if (!row.some(function (v) { return String(v || "").trim(); })) break; continue; }
    const items = [];
    months.forEach(function (mon, i) {
      if (!mon) return;
      const year = mon >= 3 ? sy : sy + 1;
      String(row[i] || "").split(/\n/).map(function (x) { return x.trim(); }).filter(String).forEach(function (line) {
        if (/^ex\)/i.test(line)) return;
        const m = line.match(/^(\d{1,2})\s*(?:[-~]\s*(\d{1,2}))?\s*[.:]?\s+(.+)$/) || line.match(/^(\d{1,2})\s*(?:[-~]\s*(\d{1,2}))?\s*[.:]\s*(.+)$/);
        if (m && +m[1] >= 1 && +m[1] <= 31) items.push({ date: year + "-" + pad_(mon) + "-" + pad_(+m[1]), endDate: m[2] && +m[2] > +m[1] ? year + "-" + pad_(mon) + "-" + pad_(+m[2]) : "", title: m[3].trim(), monthOnly: false });
        else items.push({ date: year + "-" + pad_(mon) + "-01", endDate: "", title: line.replace(/^미정\s*[.:]\s*/, "(날짜 미정) "), monthOnly: true });
      });
    });
    if (name === "공통일정") out.common = out.common.concat(items);
    else if (items.length) out.byName[name] = (out.byName[name] || []).concat(items);
  }
  return out;
}
const BOM_FIELDS_ = { team: ["팀명"], product: ["제품명"], part: ["부품명"], spec: ["규격"], purpose: ["사용 용도", "용도"], qty: ["수량"], unit: ["단위"], price: ["단가"], total: ["합계"],
  done: ["구매완료"], vendor: ["구매처"], wish: ["구매희망"], link: ["구매 링크", "링크"], s2bNo: ["S2B 물품번호", "물품번호"], s2bPrice: ["S2B 가격"], note: ["요청사항", "비고"], appId: ["앱ID"] };
function bomHeader_(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const c = {};
    (rows[i] || []).forEach(function (h, j) { const t = String(h || "").trim(); Object.keys(BOM_FIELDS_).forEach(function (k) { if (c[k] === undefined && BOM_FIELDS_[k].some(function (x) { return t.indexOf(x) === 0; })) c[k] = j; }); });
    if (c.team !== undefined && c.part !== undefined) return { index: i, cols: c };
  }
  return null;
}
function bomState_(done, wish) {
  done = String(done || ""); wish = String(wish || "");
  if (/중지|취소|반려/.test(wish + done)) return "중지";
  if (/^(o|O|ㅇ|완료|구매완료)$/.test(done) || /구매완료/.test(wish + done)) return "구매완료";
  if (/구매중|진행|주문/.test(done + wish)) return "구매중";
  if (wish && wish !== "앱 요청") return "검토";
  return "요청";
}
function bom_() {
  const v = vals_(TAB_BOM);
  if (!v) return { rows: [], missing: true };
  const h = bomHeader_(v);
  if (!h) return { rows: [], missing: true };
  const g = function (r, k) { return h.cols[k] === undefined ? "" : cell_(r, h.cols[k]); };
  const rows = [];
  v.slice(h.index + 1).forEach(function (r) {
    if (!g(r, "part")) return;
    rows.push({ team: g(r, "team") || "미지정", product: g(r, "product"), spec:g(r,"spec"), price:g(r,"price"), s2bNo:g(r,"s2bNo"), part: g(r, "part"), qty: g(r, "qty"), unit: g(r, "unit"), total: g(r, "total"), done: g(r, "done"), vendor: g(r, "vendor"), wish: g(r, "wish"), appId: g(r, "appId"), state: bomState_(g(r, "done"), g(r, "wish")) });
  });
  return { rows: rows };
}

/* 오늘 화면: 연결된 팀 폴더만 사용자가 요청할 때 읽습니다. 폴더/공유 권한은 만들거나 바꾸지 않습니다. */
function todayTeamFiles_(me,p){
  const pr=project_(me,String(p.id||"")),folderId=props_()["PF_"+pr.v[0]];
  if(!folderId)return {project:pr.v[0],connected:false,files:[]};
  const folder=openSharedFolder_(folderId,"팀 Drive"),it=folder.getFiles(),files=[];let count=0;
  while(it.hasNext()&&count<300){
    const f=it.next();count++;
    if(f.isTrashed()||studentPrivateFile_(f.getId()))continue;
    files.push({id:f.getId(),name:f.getName(),mime:f.getMimeType(),at:Utilities.formatDate(f.getLastUpdated(),"Asia/Seoul","yyyy-MM-dd HH:mm")});
  }
  files.sort(function(a,b){return String(b.at).localeCompare(String(a.at));});
  return {project:pr.v[0],connected:true,files:files.slice(0,5),limited:it.hasNext(),checkedAt:now_()};
}

function purchaseSheetLinks_(){
 const book=ss_(),base="https://docs.google.com/spreadsheets/d/"+book.getId()+"/edit",out={};
 [["bom",TAB_BOM],["edufine","BOM_에듀파인"],["projects","BOM_프로젝트별"]].forEach(function(pair){const sh=book.getSheetByName(pair[1]);if(!sh){if(pair[0]==="bom")throw new Error("BOM 시트를 찾을 수 없습니다");return;}const id=sh.getSheetId();out[pair[0]]=base+"?gid="+id+"#gid="+id;});return out;
}
function readTab_(name) { return vals_(name); }

function scheduleData_(sy){
  const cache = CacheService.getScriptCache();
  let sheetData = cache.get("sheetData_v1");
  if (sheetData) sheetData = JSON.parse(sheetData);
  else {
    const ar = readTab_(TAB_AFTER), pr = readTab_(TAB_PERSONAL);
    sheetData = { after: ar ? parseAfterschool_(ar, sy) : [], personal: pr ? parseStudentSheet_(pr, sy) : { common: [], byName: {}, gradeLabel: "" }, tabsMissing: [!ar ? TAB_AFTER : "", !pr ? TAB_PERSONAL : ""].filter(String) };
    try { cache.put("sheetData_v1", JSON.stringify(sheetData), 120); } catch (e) {}
  }
  return sheetData;
}
/* 첫 화면에는 메뉴 관리 자료를 읽지 않습니다. 기존 전체 load는 메뉴 진입 후 사용합니다. */
var HOME_TIMING_=null;
function homeLoad_(me){
 HOME_TIMING_=[];let markAt=Date.now();const mark=function(name){const now=Date.now();HOME_TIMING_.push({phase:name,ms:now-markAt});markAt=now;};
 const T=me.role==="teacher",today=today_(),until=plusDate_(today,14),sy=schoolYear_();
 const G=me.role==="guest",keys=["notices","noticeMeta","files","events","personal","board","certSchedule","companies"];
 if(!T&&!G)keys.push("acks");if(!G)keys.push("myHome");
 const names=keys.map(function(k){return APP_TABS[k].name;});
 if(!CacheService.getScriptCache().get("sheetData_v1"))names.push(TAB_AFTER,TAB_PERSONAL);
 prefetch_(names);mark("prefetch");
 const sheet=scheduleData_(sy),inRange=function(e){return e.date&&e.date<=until&&(e.endDate||e.date)>=today;};
 const visible=function(target){return T||matches_(target,me.group);};
 const allNotices=rows_("notices").map(function(x){const v=x.v;return {id:v[0],at:v[1],target:targetKey_(v[2]),title:v[3],body:v[4],pinned:/^(o|y|고정|true)$/i.test(String(v[5]).trim()),due:v[6]};}).filter(function(n){return n.id&&visible(n.target);});
 const recent=allNotices.filter(function(n){return !n.due||n.due>=today;}).sort(function(a,b){return String(b.at).localeCompare(String(a.at));}).slice(0,3),meta=noticeMeta_();
 const gm=String(sheet.personal.gradeLabel||"").match(/([1-3])/),target=gm?({1:"pre1",2:"pre2",3:"learner"})[gm[1]]:"all";
 const schedule=(sheet.after||[]).map(function(a){const aft=isAfterschoolTitle_(a.title);return Object.assign({},a,{afterschool:aft,info:!aft,allDay:!aft&&HOLIDAY_.test(a.title)});});
 const events=rows_("events").map(function(x){const v=x.v;return {id:v[0],date:v[1],endDate:v[2],time:v[3],kind:kindKey_(v[4]),target:targetKey_(v[5]),title:v[6],place:v[7],note:v[8]};}).filter(function(e){return e.id&&visible(e.target)&&inRange(e)&&e.kind!=="OJT"&&e.kind!=="OFF";});
 const personal=G?[]:rows_("personal").map(function(x){const v=x.v;return {id:v[0],name:v[1],date:v[2],endDate:v[3],time:v[4],title:v[5],note:v[6],by:v[7]};}).filter(function(e){return e.id&&inRange(e);});
 const personalSheet={};Object.keys(G?{}:(sheet.personal.byName||{})).forEach(function(name){const items=sheet.personal.byName[name].filter(inRange);if(items.length)personalSheet[name]=items;});
 const board=rows_("board").filter(function(r){return r.v[0]&&r.v[2]==="대회"&&r.v[12]!=="1";}).map(function(r){const v=r.v;return {id:v[0],category:v[2],subject:v[3],title:v[4],date:v[7],organizer:v[13]||"",place:v[14]||"",applyStart:v[15]||"",applyEnd:v[16]||"",eventEnd:v[17]||"",files:[]};});
 mark("core");const source=companyHomeSource_(),companyIds={};rows_("companies").forEach(function(r){if(r.v[0]&&(T||r.v[11]!=="0"))companyIds[r.v[0]]=r.v[1];});
 source.companies.forEach(function(c){if(T||c.open)companyIds[c.id]=c.name;else delete companyIds[c.id];});
 const companyEvents=source.error&&!T?[]:source.events.filter(function(e){return companyIds[e.company]&&(T||e.open)&&inRange(e);}).map(function(e){return Object.assign({},e,{title:"기업 · "+companyIds[e.company]+" · "+e.title,target:"all"});});
 mark("company");const certCalendar=certificationLoad_().certCalendar.filter(inRange);mark("certificates");const meals=meals_(today,plusDate_(today,6));mark("meals");
 let latest={at:APP_UPDATED_||"",what:"앱 업데이트"};recent.forEach(function(n){const at=(meta[n.id]||{}).updated||n.at;if(at>latest.at)latest={at:at,what:"새 공지"};});
 const out={me:me,loginDisabled:NO_LOGIN_TEST_MODE,homeOnly:true,today:today,schoolYear:sy,tabsMissing:sheet.tabsMissing,
 notices:enrichNotices_(recent),events:events,afterschool:schedule.filter(function(a){return a.afterschool&&inRange(a);}),sheetEvents:[],sheetCalendar:sheetScheduleEvents_(schedule,T?0:({learner:3,pre2:2,pre1:1})[me.group]).filter(inRange),
 common:{target:target,items:sheet.personal.common.filter(inRange)},personalSheet:personalSheet,personalApp:personal,
 noticeCalendar:noticeCalendarEvents_(allNotices.map(function(n){return Object.assign({},n,meta[n.id]||{});})).filter(inRange),
 boardPosts:board,companyEvents:companyEvents,certCalendar:certCalendar,
 requests:[],replies:[],purchases:[],roster:[],acks:[],myAcks:(T||G)?[]:rows_("acks").filter(function(r){return r.v[1]===me.name;}).map(function(r){return r.v[0];}),
 projects:[],tasks:[],materials:[],portfolio:[],units:[],progress:[],attendance:[],assigns:[],companies:[],boardComments:[],anonPosts:[],anonComments:[],anonReports:[],projectFiles:[],folderRequests:[],experienceIntros:[],companyInfo:[],certifications:[],notionPortfolios:[],driveMaterials:[],notionPages:[],linksDeferred:true,
 school:{comciUrl:COMCI_URL_,mealUrl:MEAL_URL_},meals:meals,appUrl:appUrl_(),icsToken:"",lastUpdate:latest,build:APP_BUILD_,guestView:GUEST_VIEW,myHome:G?null:myHome_(me)};
 mark("response");return out;
}

/* ===================== 화면 데이터 한 번에 ===================== */
function load_(me, options) {
  if(options&&options.homeOnly===true)return homeLoad_(me);
  const T = me.role === "teacher";
  const sy = schoolYear_();
  prefetchLoad_();
  const sheetData=scheduleData_(sy);
  /* 배포 전 캐시에 남은 기존 분류도 제목 기준으로 다시 판단합니다. 원본 시트는 수정하지 않습니다. */
  const scheduleRows = (sheetData.after || []).map(function(a) { const afterschool = isAfterschoolTitle_(a.title); return Object.assign({}, a, { afterschool: afterschool, info: !afterschool, allDay: !afterschool && HOLIDAY_.test(a.title) }); });
  const gm = String(sheetData.personal.gradeLabel || "").match(/([1-3])/);
  const commonTarget = gm ? ({ 1: "pre1", 2: "pre2", 3: "learner" })[gm[1]] : "all";

  const notices = rows_("notices").map(function (x) { return { id: x.v[0], at: x.v[1], target: targetKey_(x.v[2]), title: x.v[3], body: x.v[4], pinned: /^(o|O|y|Y|고정|true|TRUE)$/.test(String(x.v[5]).trim()), due: x.v[6] }; })
    .filter(function (n) { return n.id && (T || matches_(n.target, me.group)); });
  const events = rows_("events").map(function (x) { return { id: x.v[0], date: x.v[1], endDate: x.v[2], time: x.v[3], kind: kindKey_(x.v[4]), target: targetKey_(x.v[5]), title: x.v[6], place: x.v[7], note: x.v[8] }; })
    .filter(function (e) { return e.id && e.date && (T || matches_(e.target, me.group)); });
  const acksAll = rows_("acks").map(function (x) { return { id: x.v[0], name: x.v[1], at: x.v[2] }; });
  const personalApp = rows_("personal").map(function (x) { return { id: x.v[0], name: x.v[1], date: x.v[2], endDate: x.v[3], time: x.v[4], title: x.v[5], note: x.v[6], by: x.v[7] }; })
    .filter(function (e) { return e.id && e.date; });
  const reqs = rows_("requests").map(function (x) { return { id: x.v[0], at: x.v[1], name: x.v[2], group: normGroup_(x.v[3]), cat: x.v[4], title: x.v[5], body: x.v[6], status: x.v[7] || "접수", updated: x.v[8], unreadStudent: x.v[9] === "1", unreadTeacher: x.v[10] === "1" }; })
    .filter(function (r) { return r.id && (T || r.name === me.name); });
  const reqIds = {}; reqs.forEach(function (r) { reqIds[r.id] = true; });
  const replies = rows_("replies").map(function (x) { return { id: x.v[0], at: x.v[1], by: x.v[2], text: x.v[3] }; }).filter(function (r) { return reqIds[r.id]; });
  const buys = rows_("buys").map(function (x) { return { id: x.v[0], name: x.v[1], at: x.v[2], team: x.v[3], part: x.v[4] }; }).filter(function (b) { return b.id && (T || b.name === me.name); });
  const bom = bom_();
  const byId = {}; bom.rows.forEach(function (r) { if (r.appId) byId[r.appId] = r; });
  const purchases = buys.map(function (b) { const r = byId[b.id]; return { id: b.id, name: b.name, at: b.at, team: r ? r.team : b.team, part: r ? r.part : b.part, qty: r ? r.qty : "", unit: r ? r.unit : "", total: r ? r.total : "", state: r ? r.state : "시트에서 지워짐", done: r ? r.done : "", wish: r ? r.wish : "" }; });

  const out = {
    me: me, loginDisabled: NO_LOGIN_TEST_MODE, today: today_(), schoolYear: sy, tabsMissing: sheetData.tabsMissing.concat(bom.missing ? [TAB_BOM] : []),
    notices: enrichNotices_(notices), events: events, afterschool: scheduleRows.filter(function(a) { return a.afterschool; }), sheetEvents: scheduleRows.filter(function(a) { return !a.afterschool; }), sheetCalendar: sheetScheduleEvents_(scheduleRows, T ? 0 : ({learner:3,pre2:2,pre1:1})[me.group]),
    common: { target: commonTarget, items: sheetData.personal.common },
    personalSheet: sheetData.personal.byName,
    personalApp: personalApp, requests: reqs, replies: replies, purchases: purchases
  };
  if (T) {
    out.roster = roster_().map(function (r) { return { row: r.row, name: r.name, group: r.group, klass: r.klass, pin: r.pin, note: r.note, notion: r.notion, afterschool: r.afterschool }; });
    out.acks = acksAll;
    out.bom = bom.rows;
    out.sheetUrl = SPREADSHEET_ID ? "https://docs.google.com/spreadsheets/d/" + SPREADSHEET_ID + "/edit" : ss_().getUrl();
  } else {
    out.myAcks = acksAll.filter(function (a) { return a.name === me.name; }).map(function (a) { return a.id; });
  }
  Object.assign(out, extendedLoad_(me), anonLoad_(me), trainLoad_(me), boardLoad_(me), certificationLoad_());
  out.noticeCalendar=noticeCalendarEvents_(out.notices);
  out.appUrl = appUrl_();
  out.linksDeferred=!!(options&&options.deferLinks);
  out.driveMaterials = out.linksDeferred?[]:driveMaterials_(me);
  out.notionPages = out.linksDeferred?[]:notionPages_();
  out.notionPortfolios = roster_().filter(function(r){return T || r.name===me.name;}).map(function(r){return {name:r.name,url:r.notion};});
  out.school = { comciUrl: COMCI_URL_, mealUrl: MEAL_URL_ };
  out.meals = meals_(today_(), plusDate_(today_(), 6));
  out.icsToken = (rows_("icsTokens").filter(function (x) { return x.v[0] === who_(me); })[0] || { v: [] }).v[1] || "";
  out.companyInfo = companyInfo_(me);
  Object.assign(out,companyLoad_(me));
  out.lastUpdate = lastUpdate_();
  out.build = APP_BUILD_;
  out.guestView = GUEST_VIEW;
  out.myHome = myHome_(me);
  return out;
}
function kindKey_(s) { s = String(s || "").trim(); for (var k in KIND_LABEL) if (KIND_LABEL[k] === s || k === s) return k; return "EVT"; }

/* ===================== 쓰기 ===================== */
function findRow_(key, id) { const r = rows_(key).filter(function (x) { return x.v[0] === String(id); })[0]; return r ? r._row : 0; }
function ack_(me, id) {
  return withLock_(function () {
    const n=record_("notices",id);if(!matches_(targetKey_(n.v[2]),me.group))throw new Error("이 공지의 확인 대상이 아닙니다");
    if (rows_("acks").some(function (x) { return x.v[0] === String(id) && x.v[1] === me.name; })) return true;
    append_("acks", [String(id), me.name, now_()]); return true;
  });
}
/* 공지의 원래 7개 열은 유지하고 전달 자료·연결·첨부는 별도 탭에 둡니다. */
APP_TABS.noticeMeta={name:"앱_공지자료",head:["공지ID","분류","주제","연결","연결이름","링크목록","첨부목록","일정일","일정종료","장소","수정시각"]};
const NOTICE_CATEGORIES_=["일반 안내","프로젝트·설계","행사·견학","자격증·시험","준비물·구매","학습 자료"];
function noticeMeta_(){const out={};rows_("noticeMeta").forEach(function(r){const v=r.v;out[v[0]]={category:v[1]||"일반 안내",subject:v[2]||"",relation:v[3]||"",relationLabel:v[4]||"",links:boardFileIds_(v[5]),fileIds:boardFileIds_(v[6]),eventDate:v[7]||"",eventEnd:v[8]||"",place:v[9]||"",updated:v[10]||""};});return out;}
function enrichNotices_(notices){
 const meta=noticeMeta_(),files={};rows_("files").filter(function(r){return r.v[5]==="notice";}).forEach(function(r){files[r.v[0]]={id:r.v[0],name:r.v[2],mime:r.v[3],size:Number(r.v[4])||0,notice:r.v[6]};});
 return notices.map(function(n){const m=meta[n.id]||{category:"일반 안내",subject:"",relation:"",relationLabel:"",links:[],fileIds:[],eventDate:"",eventEnd:"",place:""};const o=Object.assign({},n,m);o.files=m.fileIds.filter(function(id){return files[id]&&files[id].notice===n.id;}).map(function(id){return files[id];});delete o.fileIds;return o;});
}
function noticeRelationLabel_(value,old){
 if(!value)return "";
 if(old&&value===old.relation)return old.relationLabel;
 if(value.indexOf("cert:")===0)return certification_(value.slice(5)).name;
 if(value.indexOf("project:")===0){const r=record_("projects",value.slice(8));return r.v[1]+" · "+r.v[2];}
 if(value.indexOf("contest:")===0){const r=record_("board",value.slice(8));if(r.v[2]!=="대회"||r.v[12]==="1")throw new Error("연결할 대회를 확인해 주세요");return r.v[3]||r.v[4];}
 throw new Error("연결 대상을 확인해 주세요");
}
function saveNotice_(p){return withLock_(function(){
 const old=p.id?record_("notices",p.id):null,id=old?old.v[0]:uid_("n"),prior=noticeMeta_()[id]||{};
 const val=function(k,fallback){return p[k]===undefined?(prior[k]===undefined?fallback:prior[k]):p[k];};
 const title=required_(p.title,120),body=clean_(p.body,5000),target=targetValid_(p.target||"all"),due=dateValid_(p.due,true);
 const category=String(val("category","일반 안내"));if(NOTICE_CATEGORIES_.indexOf(category)<0)throw new Error("공지 분류를 선택해 주세요");
 const subject=clean_(val("subject",""),100),relation=clean_(val("relation",""),100),label=noticeRelationLabel_(relation,prior);
 const eventDate=dateValid_(val("eventDate",""),true),eventEnd=dateValid_(val("eventEnd",""),true),place=clean_(val("place",""),150);
 if(eventEnd&&(!eventDate||eventEnd<eventDate))throw new Error("일정 종료일은 시작일 이후로 입력해 주세요");
 const rawLinks=val("links",[]);if(!Array.isArray(rawLinks)||rawLinks.length>8)throw new Error("관련 링크는 최대 8개까지 넣어 주세요");const links=Array.from(new Set(rawLinks.map(function(s){return urlValid_(s);}).filter(Boolean)));
 const previous=prior.fileIds||[],keep=p.keepFiles===undefined?previous:p.keepFiles;
 if(!Array.isArray(keep)||keep.some(function(id){return previous.indexOf(id)<0;}))throw new Error("다른 공지의 첨부는 연결할 수 없습니다");
 const uploads=Array.isArray(p.uploads)?p.uploads:[],kept=Array.from(new Set(keep));if(uploads.length>10||kept.length+uploads.length>20)throw new Error("새 첨부는 한 번에 10개, 공지당 총 20개까지 올릴 수 있습니다");
 const me={role:"teacher",name:"선생님"};uploads.forEach(function(u){if(u&&u.staged){stagedFile_(me,u);return;}if(!u||!u.base64)throw new Error("첨부파일을 다시 선택해 주세요");const name=required_(u.name,180),ext=name.split('.').pop().toLowerCase();if(!MIME_BY_EXT_[ext]||String(u.base64).length>DIRECT_UPLOAD_MB_*1024*1024*1.37+100||!Utilities.base64Decode(String(u.base64)).length)throw new Error("첨부파일 형식과 크기를 확인해 주세요");});
 const created=[];try{
  const folder=uploads.length?folderFor_(["공지자료",id]):null;uploads.forEach(function(u){created.push(storeFile_(me,u,"notice",id,folder));});
  const at=old?old.v[1]:now_();upsert_("noticeMeta",id,[id,category,subject,relation,label,JSON.stringify(links),JSON.stringify(kept.concat(created)),eventDate,eventEnd,place,now_()]);
  upsert_("notices",id,[id,at,TARGET_LABEL[target],title,body,p.pinned?"고정":"",due]);return id;
 }catch(e){created.forEach(function(fid){try{DriveApp.getFileById(fid).setTrashed(true);}catch(ignore){}});throw e;}
});}
function noticeFile_(me,id){
 const r=record_("files",id);if(r.v[5]!=="notice")throw new Error("공지 첨부가 아닙니다");
 const notice=record_("notices",r.v[6]),meta=noticeMeta_()[notice.v[0]];
 if(!meta||meta.fileIds.indexOf(id)<0||(me.role!=="teacher"&&!matches_(targetKey_(notice.v[2]),me.group)))throw new Error("이 공지 첨부를 볼 권한이 없습니다");
 return r;
}
function noticeImage_(me,p){
 const r=noticeFile_(me,p.id),file=DriveApp.getFileById(r.v[0]);
 if(!/^image\/(png|jpeg|gif|webp|heic)$/.test(r.v[3]))throw new Error("사진 첨부만 미리 볼 수 있습니다");
 let blob=p.original===true?null:(typeof file.getThumbnail==="function"?file.getThumbnail():null);
 if(!blob){if(file.getSize()>3*1024*1024)throw new Error("사진이 큽니다. 원본 받기를 이용해 주세요");blob=file.getBlob();}
 const mime=blob.getContentType(),bytes=blob.getBytes();if(!/^image\/(png|jpeg|gif|webp)$/.test(mime)||bytes.length>3*1024*1024)throw new Error("미리 보기 대신 원본 받기를 이용해 주세요");
 return {name:r.v[2],mime:mime,base64:Utilities.base64Encode(bytes)};
}
function noticeDownload_(me,p){const r=noticeFile_(me,p.id),f=DriveApp.getFileById(r.v[0]);return driveFilePart_(r.v[0],{name:r.v[2],mime:r.v[3],size:f.getSize()},p.offset);}
function noticeCalendarEvents_(notices){return (notices||[]).filter(function(n){return n.eventDate;}).map(function(n){return {id:"notice-"+n.id,key:"notice:"+n.id,uid:"notice-"+n.id,notice:n.id,title:n.title,date:n.eventDate,endDate:n.eventEnd||"",place:n.place||"",note:[n.body].concat(n.links||[]).filter(Boolean).join("\n"),target:n.target};});}

function saveEvent_(p) {
  return withLock_(function () {
    const vals = [p.id || uid_("e"), clean_(p.date, 10), clean_(p.endDate, 10), clean_(p.time, 30), KIND_LABEL[p.kind] || "행사", TARGET_LABEL[p.target] || "전체", clean_(p.title, 80), clean_(p.place, 80), clean_(p.note, 1000)];
    if (!vals[1] || !vals[6]) throw new Error("날짜와 일정명을 넣어 주세요");
    const row = p.id ? findRow_("events", p.id) : 0;
    if (row) writeCells_(sheet_("events"), row, vals); else append_("events", vals);
    return vals[0];
  });
}
function deleteRow_(tab, id) {
  if (["notices", "events"].indexOf(tab) < 0) throw new Error("지울 수 없는 항목입니다");
  return withLock_(function () { const row = findRow_(tab, id); if (row) sheet_(tab).deleteRow(row); if(tab==="notices"){const m=findRow_("noticeMeta",id);if(m)sheet_("noticeMeta").deleteRow(m);} return true; });
}
function addPersonal_(me, p) {
  return withLock_(function () {
    const names = me.role === "teacher" ? (p.names || []) : [me.name];
    if (!names.length) throw new Error("학생을 한 명 이상 고르세요");
    validatePersonal_(p);
    const valid = {}; roster_().forEach(function (r) { valid[r.name] = true; });
    names.forEach(function (n) {
      if (!valid[n]) return;
      append_("personal", [uid_("p"), n, clean_(p.date, 10), clean_(p.endDate, 10), clean_(p.time, 30), clean_(p.title, 80), clean_(p.note, 300), me.role === "teacher" ? "선생님" : "학생"]);
    });
    return true;
  });
}
function savePersonal_(me,p){
 return withLock_(function(){
  const r=rows_("personal").filter(function(x){return x.v[0]===String(p.id);})[0];
  if(!r)throw new Error("개인일정을 찾을 수 없습니다");
  if(me.role!=="teacher"&&(r.v[1]!==me.name||r.v[7]!=="학생"))throw new Error("내가 넣은 일정만 수정할 수 있습니다");
  validatePersonal_(p);
  writeCells_(sheet_("personal"),r._row,[r.v[0],r.v[1],clean_(p.date,10),clean_(p.endDate,10),clean_(p.time,30),clean_(p.title,80),clean_(p.note,300),r.v[7]]);return true;
 });
}
function validatePersonal_(p){
 if(!dateValid_(p.date)||!String(p.title||"").trim())throw new Error("올바른 날짜와 일정명을 넣어 주세요");
 if(p.endDate&&(!dateValid_(p.endDate)||p.endDate<p.date))throw new Error("끝나는 날은 시작일 이후로 입력하세요");
}
function delPersonal_(me, id) {
  return withLock_(function () {
    const r = rows_("personal").filter(function (x) { return x.v[0] === String(id); })[0];
    if (!r) return true;
    if (me.role !== "teacher" && (r.v[1] !== me.name || r.v[7] !== "학생")) throw new Error("내가 넣은 일정만 지울 수 있습니다");
    sheet_("personal").deleteRow(r._row); return true;
  });
}
function addRequest_(me, p) {
  return withLock_(function () {
    if (!String(p.title || "").trim()) throw new Error("제목을 넣어 주세요");
    const id = uid_("r"), t = now_();
    append_("requests", [id, t, me.name, GROUP_LABEL[me.group] || "", clean_(p.cat, 20), clean_(p.title, 100), clean_(p.body, 3000), "접수", t, "0", "1"]);
    return id;
  });
}
function reqRow_(me, id) {
  const r = rows_("requests").filter(function (x) { return x.v[0] === String(id); })[0];
  if (!r) throw new Error("요청을 찾을 수 없습니다");
  if (me.role !== "teacher" && r.v[2] !== me.name) throw new Error("내 요청만 볼 수 있습니다");
  return r;
}
function reply_(me, id, text) {
  return withLock_(function () {
    text = clean_(text, 3000).trim(); if (!text) throw new Error("내용을 넣어 주세요");
    const r = reqRow_(me, id), t = now_(), sh = sheet_("requests"), T = me.role === "teacher";
    append_("replies", [String(id), t, T ? "선생님" : me.name, text]);
    sh.getRange(r._row, 9).setValue(t);
    if (T) { sh.getRange(r._row, 10).setValue("1"); if ((r.v[7] || "접수") === "접수") sh.getRange(r._row, 8).setValue("처리중"); }
    else sh.getRange(r._row, 11).setValue("1");
    return true;
  });
}
function setStatus_(id, status) {
  if (REQ_STATUS.indexOf(status) < 0) throw new Error("상태 값이 올바르지 않습니다");
  return withLock_(function () { const r = reqRow_({ role: "teacher" }, id); const sh = sheet_("requests"); sh.getRange(r._row, 8).setValue(status); sh.getRange(r._row, 9).setValue(now_()); sh.getRange(r._row, 10).setValue("1"); return true; });
}
function markRead_(me, id) {
  return withLock_(function () { const r = reqRow_(me, id); sheet_("requests").getRange(r._row, me.role === "teacher" ? 11 : 10).setValue("0"); return true; });
}
/** 구매요청: BOM 탭의 마지막 품목 바로 아래에 한 줄을 끼워 넣습니다 (합계 줄 위). */
function addPurchase_(me, p) {
  return withLock_(function () {
    if (!String(p.part || "").trim() || !String(p.purpose || "").trim()) throw new Error("부품명과 사용 용도를 넣어 주세요");
    if (!/^https?:\/\//i.test(String(p.link || "").trim())) throw new Error("구매 링크는 https:// 로 시작해야 합니다");
    const sh = ss_().getSheetByName(TAB_BOM); DIRTY_[TAB_BOM] = true;
    if (!sh) throw new Error("‘" + TAB_BOM + "’ 탭을 찾을 수 없습니다");
    const v = sh.getDataRange().getDisplayValues();
    const h = bomHeader_(v);
    if (!h) throw new Error("BOM 탭에서 머리글(팀명·부품명)을 찾지 못했습니다");
    if (h.cols.appId === undefined) { const col = Math.max((v[h.index] || []).length, 16); sh.getRange(h.index + 1, col + 1).setValue("앱ID"); h.cols.appId = col; }
    let last = h.index;
    v.forEach(function (r, i) { if (i > h.index && cell_(r, h.cols.team) && cell_(r, h.cols.part)) last = i; });
    sh.insertRowAfter(last + 1);
    const id = uid_("b"), qty = Number(p.qty) || 1, price = Number(p.price) || 0;
    const width = Math.max((v[h.index] || []).length, h.cols.appId + 1);
    const row = new Array(width).fill("");
    const set = function (k, val) { if (h.cols[k] !== undefined) row[h.cols[k]] = val; };
    set("team", clean_(p.team, 40)); set("product", clean_(p.product, 60)); set("part", clean_(p.part, 100)); set("spec", clean_(p.spec, 200)); set("purpose", clean_(p.purpose, 150));
    set("qty", qty); set("unit", clean_(p.unit, 10)); set("price", price || ""); set("total", price ? price * qty : "");
    set("vendor", clean_(p.vendor, 40)); set("wish", "앱 요청"); set("link", clean_(p.link, 500)); set("s2bNo", clean_(p.s2bNo, 30));
    set("note", [clean_(p.note, 200), "요청: " + me.name].filter(String).join(" / ")); set("appId", id);
    sh.getRange(last + 2, 1, 1, width).setValues([row.map(function (x) { return typeof x === "string" && /^[=+\-@]/.test(x) ? "'" + x : x; })]);
    append_("buys", [id, me.name, now_(), clean_(p.team, 40), clean_(p.part, 100)]);
    return id;
  });
}

/** 시트 내용을 바로 다시 읽게 함 (선생님이 시트를 고친 직후 사용) */
function clearCache_() { CacheService.getScriptCache().remove("sheetData_v1"); }
function onEdit(e) { try { const n = e && e.range && e.range.getSheet().getName(); if (n === TAB_AFTER || n === TAB_PERSONAL) clearCache_(); } catch (x) {} }

/* ===================== 추가 기능 v2 =====================
 * 기존 앱_ 탭과 데이터는 유지합니다. 확장 탭은 자동 생성합니다.
 * 최초 배포 전 Apps Script 편집기에서 setupApp_()을 1회 실행하세요.
 */
Object.assign(APP_TABS, {
  attendance: {name:"앱_출결",head:["ID","날짜","이름","구분","수업","상태","메모","기록시각","실제시간(분)"]},
  units: {name:"앱_능력단위",head:["ID","코드","단위명","대상","필요시간","설명","사용"]},
  progress: {name:"앱_이수",head:["ID","이름","단위ID","상태","이수시간","평가일","피드백","기록시각"]},
  portfolio: {name:"앱_포트폴리오",head:["ID","이름","날짜","제목","능력단위ID","내용","링크","파일ID","피드백","확인상태","수정시각"]},
  projects: {name:"앱_팀프로젝트",head:["ID","팀명","제품명","구성원JSON","목표","마감일","상태","링크","수정시각"]},
  tasks: {name:"앱_팀과제",head:["ID","프로젝트ID","제목","담당","마감일","완료","메모","수정시각"]},
  materials: {name:"앱_자료실",head:["ID","제목","대상","분류","설명","링크","파일ID","등록시각"]},
  files: {name:"앱_파일",head:["ID","이름","파일명","종류","크기","용도","기록ID","시각"]},
  contacts: {name:"앱_알림연락처",head:["이름","이메일","메일수신"]},
  mailLog: {name:"앱_알림기록",head:["ID","시각","수신자","종류","대상ID","결과"]},
  calendarMap: {name:"앱_캘린더연결",head:["ID","캘린더ID","이벤트ID","내용JSON","시각"]},
  calendarIn: {name:"앱_캘린더가져오기",head:["ID","날짜","종료일","시간","제목","장소","내용"]}
});
Object.assign(APP_TABS, {
  anon: {name:"앱_익명게시판",head:["ID","시각","작성자","제목","내용","숨김","구분","이전요청ID","처리상태"]},
  anonReports: {name:"앱_익명신고",head:["ID","게시글ID","신고자","사유","시각","처리"]},
  board: {name:"앱_프로젝트게시판",head:["ID","작성자","구분","프로젝트자격증명","제목","내용","진행상태","관련일","링크","첨부목록","등록시각","수정시각","삭제","주최기관","장소","접수시작","접수마감","대회종료"]},
  boardComments: {name:"앱_프로젝트댓글",head:["ID","게시글ID","작성자","내용","시각","삭제"]},
  anonCmt: {name:"앱_익명댓글",head:["ID","글ID","시각","작성자","내용","숨김","이전답변ID"]},
  companies: {name:"앱_기업",head:["ID","기업명","주소","기업현장교사","연락처","이메일","메모","업종","주요업무","소개","홈페이지","학생공개"]},
  assign: {name:"앱_훈련배정",head:["이름","기업ID","OJT요일","훈련시작","훈련종료","메모","OJT시간"]},
  icsTokens: {name:"앱_캘린더구독",head:["이름","토큰","만든시각"]}
});
const ATT_STATUS_ = ["출석","지각","조퇴","결석","공결"];
const PROGRESS_STATUS_ = ["미시작","진행중","이수","보완필요"];
function writeCells_(sh, row, vals) {
  sh.getRange(row,1,1,vals.length).setValues([vals.map(function(x){return typeof x === "string" && /^[=+\-@]/.test(x) ? "'"+x : x;})]);
}
function upsert_(key, id, vals) { const r = findRow_(key,id); if(r) writeCells_(sheet_(key),r,vals); else append_(key,vals); }
function record_(key,id) { const r = rows_(key).find(function(x){return x.v[0] === String(id);}); if(!r) throw new Error("기록을 찾지 못했습니다"); return r; }
function student_(name) { const s = roster_().find(function(x){return x.name === String(name);}); if(!s) throw new Error("명단에 없는 학생입니다"); return s; }
function dateValid_(s, optional) {
  s = String(s || ""); if(!s && optional) return "";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("날짜를 확인해 주세요");
  const d = new Date(s+"T12:00:00+09:00"); if(isNaN(d) || Utilities.formatDate(d,"Asia/Seoul","yyyy-MM-dd") !== s) throw new Error("존재하지 않는 날짜입니다"); return s;
}
function numValid_(n,max) { n = Number(n); if(!isFinite(n)||n<0||n>max) throw new Error("숫자 범위를 확인해 주세요"); return n; }
function targetValid_(t) { if(!Object.prototype.hasOwnProperty.call(TARGET_LABEL,t)) throw new Error("대상을 확인해 주세요"); return t; }
function required_(s,max) { s = clean_(s,max).trim(); if(!s) throw new Error("필수 항목을 입력해 주세요"); return s; }
function urlValid_(s) { s = clean_(s,1000).trim(); if(s && !/^https:\/\/[^\s]+$/i.test(s)) throw new Error("링크는 https://로 시작해야 합니다"); return s; }
function project_(me,id) {
  const r = record_("projects",id), members = JSON.parse(r.v[3]||"[]");
  if(me.role !== "teacher" && members.indexOf(me.name)<0) throw new Error("내 팀의 자료만 볼 수 있습니다"); return r;
}
var PROPS_ = null;
function props_() { if (!PROPS_) PROPS_ = PropertiesService.getScriptProperties().getProperties(); return PROPS_; }
var APP_ACCOUNT_MEMO_=null;
function appAccount_() { if(APP_ACCOUNT_MEMO_!==null)return APP_ACCOUNT_MEMO_;const cache=CacheService.getScriptCache(),key="execution_account_v1",saved=cache.get(key);if(saved)return APP_ACCOUNT_MEMO_=saved;let email="";try { email=Session.getEffectiveUser().getEmail()||""; } catch(e) {} if(!email)try { email=DriveApp.getRootFolder().getOwner().getEmail()||""; }catch(e){}if(email)try{cache.put(key,email,3600);}catch(e){}return APP_ACCOUNT_MEMO_=email; }
/* 다른 구글 계정의 드라이브 폴더도, 그 폴더를 알림판 배포 계정에 '편집자'로 공유하면 연결할 수 있습니다. */
function openSharedFolder_(id, label) {
  try { const f = DriveApp.getFolderById(id); f.getName(); return f; }
  catch (e) { throw new Error(label + " 폴더를 열 수 없습니다. 그 폴더를 가진 계정의 드라이브에서 폴더 공유 → " + (appAccount_() || "알림판 배포 계정") + " 을(를) ‘편집자’로 추가한 뒤 다시 연결해 주세요"); }
}
function settings_() {
  const p = props_(), g = function (k) { return p[k] || ""; };
  const root = g("DRIVE_ROOT") || g("APP_FOLDER");
  return {appAccount:appAccount_(),calendarId:g("CALENDAR_ID"),calendarImport:g("CALENDAR_IMPORT")==="1",calendarPersonal:g("CALENDAR_PERSONAL")==="1",mailEnabled:g("MAIL_ENABLED")==="1",teacherEmail:g("TEACHER_EMAIL"),webUrl:g("APP_WEB_URL"),auto:g("APP_AUTO")==="1",lastRun:g("APP_LAST_RUN"),lastError:g("APP_LAST_ERROR"),driveRoot:root,driveRootUrl:root?"https://drive.google.com/drive/folders/"+root:"",driveCustom:!!g("DRIVE_ROOT"),materialFolder:g("MATERIAL_FOLDER"),materialFolderUrl:g("MATERIAL_FOLDER")?"https://drive.google.com/drive/folders/"+g("MATERIAL_FOLDER"):"",notionSet:!!g("NOTION_TOKEN"),notionRoot:g("NOTION_ROOT"),neisSet:!!g("NEIS_KEY")};
}
function extendedApi_(me,action,p) {
  switch(action) {
    case "saveAttendance": need_(me,"teacher"); return saveAttendance_(p);
    case "saveUnit": need_(me,"teacher"); return saveUnit_(p);
    case "saveProgress": need_(me,"teacher"); return saveProgress_(p);
    case "savePortfolio": return savePortfolio_(me,p);
    case "reviewPortfolio": need_(me,"teacher"); return reviewPortfolio_(p);
    case "saveProject": need_(me,"teacher"); return saveProject_(p);
    case "saveTask": return saveTask_(me,p);
    case "saveMaterial": need_(me,"teacher"); return saveMaterial_(me,p);
    case "removeExtended": return removeExtended_(me,p);
    case "downloadFile": return downloadFile_(me,p.id);
    case "saveContact": return saveContact_(me,p);
    case "requestFolderAccess": return requestFolderAccess_(me,p);
    case "decideFolderAccess": need_(me,"teacher"); return decideFolderAccess_(p);
    case "saveSettings": need_(me,"teacher"); return saveSettings_(p);
    case "createCalendar": need_(me,"teacher"); return createCalendar_();
    case "syncCalendar": need_(me,"teacher"); return syncCalendar_();
    case "sendNotifications": need_(me,"teacher"); return sendNotifications_();
    case "setAutomation": need_(me,"teacher"); return setAutomation_(p.enabled === true);
    case "checkSetup": need_(me,"teacher"); return checkSetup_();
    default: throw new Error("알 수 없는 요청입니다");
  }
}
function extendedLoad_(me) {
  const T = me.role === "teacher";
  const units = rows_("units").map(function(x){const v=x.v;return {id:v[0],code:v[1],title:v[2],target:targetKey_(v[3]),hours:v[4],note:v[5],active:v[6]!=="0"};}).filter(function(x){return T||(x.active&&matches_(x.target,me.group));});
  const visibleUnits = {}; units.forEach(function(x){visibleUnits[x.id]=true;});
  const projects = rows_("projects").map(function(x){const v=x.v;let members=[];try{members=JSON.parse(v[3]||"[]");}catch(e){}return {id:v[0],team:v[1],product:v[2],members:members,goal:v[4],due:v[5],status:v[6],link:v[7],at:v[8]};}).filter(function(x){return T||x.members.indexOf(me.name)>=0;});
  const projectIds={}; projects.forEach(function(x){projectIds[x.id]=true;});
  const pp=props_(); projects.forEach(function(x){if(pp["PF_"+x.id])x.folderUrl="https://drive.google.com/drive/folders/"+pp["PF_"+x.id];});
  const projectFiles=rows_("files").filter(function(x){return x.v[5]==="project"&&projectIds[x.v[6]];}).map(function(x){const v=x.v;return {id:v[0],by:v[1],name:v[2],mime:v[3],size:Number(v[4])||0,project:v[6],at:v[7],memo:v[8]||""};});
  const out={
    attendance:rows_("attendance").map(function(x){const v=x.v;return {id:v[0],date:v[1],name:v[2],group:normGroup_(v[3]),lesson:v[4],status:v[5],note:v[6],at:v[7],minutes:v[8]===""||v[8]==null?null:Number(v[8])};}).filter(function(x){return T||x.name===me.name;}),
    units:units,
    progress:rows_("progress").map(function(x){const v=x.v;return {id:v[0],name:v[1],unit:v[2],status:v[3],hours:v[4],date:v[5],feedback:v[6],at:v[7],grade:v[8]||""};}).filter(function(x){return (T||x.name===me.name)&&visibleUnits[x.unit];}),
    portfolio:rows_("portfolio").map(function(x){const v=x.v;return {id:v[0],name:v[1],date:v[2],title:v[3],unit:v[4],body:v[5],link:v[6],file:v[7],feedback:v[8],status:v[9],at:v[10]};}).filter(function(x){return T||x.name===me.name;}),
    projects:projects,
    tasks:rows_("tasks").map(function(x){const v=x.v;return {id:v[0],project:v[1],title:v[2],assignee:v[3],due:v[4],done:v[5]==="1",note:v[6],at:v[7]};}).filter(function(x){return projectIds[x.project];}),
    materials:rows_("materials").map(function(x){const v=x.v;return {id:v[0],title:v[1],target:targetKey_(v[2]),category:v[3],body:v[4],link:v[5],file:v[6],at:v[7]};}).filter(function(x){return T||matches_(x.target,me.group);}),
    projectFiles:projectFiles,
    contact:rows_("contacts").filter(function(x){return x.v[0]===me.name;}).map(function(x){return {email:x.v[1],enabled:x.v[2]==="1"};})[0]||{email:"",enabled:false}
  };
  if(T) {
    out.settings=settings_(); out.contacts=rows_("contacts").map(function(x){return {name:x.v[0],email:x.v[1],enabled:x.v[2]==="1"};});
    out.mailLog=rows_("mailLog").slice(-50).map(function(x){return {at:x.v[1],name:x.v[2],kind:x.v[3],result:x.v[5]};});
    out.calendarEvents=rows_("calendarIn").map(function(x){const v=x.v;return {id:v[0],date:v[1],endDate:v[2],time:v[3],title:v[4],place:v[5],note:v[6],kind:"EVT",target:"all",srcLabel:"교사 캘린더 · 교사만 표시"};});
  }  out.folderReady={materials:!!props_().MATERIAL_FOLDER};
  out.folderRequests=folderRequests_(me,T);

  return out;
}
function saveAttendance_(p) {
  return withLock_(function(){const date=dateValid_(p.date),lesson=required_(p.lesson,80);
    const items=Array.isArray(p.items)?p.items:[]; if(!items.length||items.length>200) throw new Error("학생을 선택해 주세요");
    const existing=rows_("attendance");
    const validated=items.map(function(x){const st=student_(x.name);if(/^방과후/.test(lesson)&&!st.afterschool&&!existing.some(function(r){return r.v[1]===date&&r.v[2]===st.name&&r.v[4]===lesson;}))throw new Error("방과후 미참여 학생은 방과후 출결을 새로 기록할 수 없습니다");if(ATT_STATUS_.indexOf(x.status)<0) throw new Error("출결 상태를 확인해 주세요");const old=existing.find(function(r){return r.v[1]===date&&r.v[2]===st.name&&r.v[4]===lesson;});let minutes=x.hours===undefined?(old&&old.v[8]!==undefined?old.v[8]:""):(String(x.hours).trim()===""?"":Number(x.hours)*60);if(minutes!==""&&(!isFinite(minutes)||minutes<0||minutes>1440||Math.abs(Math.round(minutes)-minutes)>0.00001))throw new Error("실제 시간은 0~24시간, 분 단위로 입력해 주세요");if(x.status==="결석"&&minutes!==""&&Number(minutes)!==0)throw new Error("결석 시간은 0시간으로 기록해 주세요");return {st:st,status:x.status,note:clean_(x.note,300),minutes:minutes===""?"":Math.round(minutes)};});
    sheet_("attendance").getRange(1,9).setValue("실제시간(분)");
    validated.forEach(function(x){const old=existing.find(function(r){return r.v[1]===date&&r.v[2]===x.st.name&&r.v[4]===lesson;});const id=old?old.v[0]:uid_("a");upsert_("attendance",id,[id,date,x.st.name,GROUP_LABEL[x.st.group],lesson,x.status,x.note,now_(),x.minutes]);}); return validated.length;
  });
}
function saveUnit_(p) { return withLock_(function(){const id=p.id?record_("units",p.id).v[0]:uid_("u");upsert_("units",id,[id,clean_(p.code,80),required_(p.title,150),TARGET_LABEL[targetValid_(p.target)],numValid_(p.hours,2000),clean_(p.note,2000),p.active===false?"0":"1"]);return id;}); }
function saveProgress_(p) { return withLock_(function(){const st=student_(p.name),unit=record_("units",p.unit);if(!matches_(targetKey_(unit.v[3]),st.group)) throw new Error("이 학생의 대상 능력단위가 아닙니다");if(PROGRESS_STATUS_.indexOf(p.status)<0) throw new Error("이수 상태를 확인해 주세요");const old=rows_("progress").find(function(x){return x.v[1]===st.name&&x.v[2]===p.unit;});const id=old?old.v[0]:uid_("c");const psh=sheet_("progress");if(!String(psh.getRange(1,9).getValue()).trim())psh.getRange(1,9).setValue("평가결과");upsert_("progress",id,[id,st.name,p.unit,p.status,numValid_(p.hours,2000),dateValid_(p.date,true),clean_(p.feedback,2000),now_(),clean_(p.grade,30)]);return id;}); }
/* ===================== 구글 드라이브 =====================
 * 모든 첨부는 선생님 Drive의 한 폴더 아래에 정리됩니다.
 *   (루트) / 자료실 · 포트폴리오/학생이름 · 팀프로젝트/팀명 · 제품명
 * 설정에서 원하는 Drive 폴더 주소를 넣으면 그 폴더를 루트로 씁니다. 파일은 비공개(선생님만)로 저장되고,
 * 학생은 앱을 통해서만 내려받습니다. */
const MAX_FILE_MB_ = 1024;          /* 파일 하나 최대 1GB (큰 파일은 나눠 올리기) */
const DIRECT_UPLOAD_MB_ = 8;         /* 이보다 작은 파일은 한 번에 보냄, 큰 파일은 uploadStart/uploadChunk로 Drive에 직접 이어 올림 */
const MAX_DOWNLOAD_MB_ = 30;         /* 앱 안에서 바로 내려받기(base64)는 30MB까지, 그 이상은 Drive에서 열기 */
const UPLOAD_CHUNK_ = 4 * 1024 * 1024;
const MIME_BY_EXT_ = {pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",heic:"image/heic",txt:"text/plain",csv:"text/csv",md:"text/markdown",zip:"application/zip",
  doc:"application/msword",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xls:"application/vnd.ms-excel",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",ppt:"application/vnd.ms-powerpoint",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
  hwp:"application/x-hwp",hwpx:"application/hwp+zip",mp4:"video/mp4",mov:"video/quicktime",mp3:"audio/mpeg",
  stl:"application/octet-stream",step:"application/octet-stream",stp:"application/octet-stream",dxf:"application/octet-stream",dwg:"application/octet-stream",f3d:"application/octet-stream",gbr:"application/octet-stream",kicad_pcb:"application/octet-stream",
  ino:"text/plain",py:"text/plain",c:"text/plain",cpp:"text/plain",h:"text/plain",json:"application/json"};
function driveFolderId_(s) { s = clean_(s, 500).trim(); if (!s) return ""; const m = s.match(/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || s.match(/^([A-Za-z0-9_-]{10,})$/); if (!m) throw new Error("Drive 폴더 주소를 확인해 주세요"); return m[1]; }
function driveRoot_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("DRIVE_ROOT") || props.getProperty("APP_FOLDER");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { if (props.getProperty("DRIVE_ROOT")) throw new Error("설정한 Drive 폴더에 접근할 수 없습니다"); } }
  const f = DriveApp.createFolder("도제반 알림판 자료 (비공개)"); props.setProperty("APP_FOLDER", f.getId()); return f;
}
/* ---------- 큰 파일 나눠 올리기: Drive 이어 올리기(resumable) 세션을 서버가 열고, 4MB씩 받아 그대로 전달 ---------- */
function uploadStart_(me, p) {
  const name = required_(p.name, 180).replace(/[\\\/]/g, "_"), ext = name.split(".").pop().toLowerCase(), mime = MIME_BY_EXT_[ext];
  if (!mime) throw new Error("올릴 수 없는 파일 형식입니다 (." + ext + ")");
  const size = Number(p.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_MB_ * 1024 * 1024) throw new Error("파일은 0바이트 초과, " + MAX_FILE_MB_ + "MB 이하여야 합니다");
  const stage = withLock_(function () { return folderFor_(["업로드 임시"]); });
  try { const old = Date.now() - 2 * 86400000, it = stage.getFiles(); let n = 0; while (it.hasNext() && n < 20) { const f = it.next(); if (f.getDateCreated().getTime() < old) { f.setTrashed(true); n++; } } } catch (e) {}
  const res = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
    method: "post", contentType: "application/json; charset=UTF-8", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size) },
    payload: JSON.stringify({ name: name, parents: [stage.getId()], description: "도제반 알림판 · 올리는 중 · " + me.name })
  });
  const h = res.getAllHeaders(), url = h.Location || h.location;
  if (res.getResponseCode() !== 200 || !url) throw new Error("Drive 업로드를 시작하지 못했습니다 (" + res.getResponseCode() + ")");
  const id = uid_("up");
  CacheService.getScriptCache().put("up_" + id, JSON.stringify({ url: url, size: size, name: name, mime: mime, user: me.name, got: 0 }), 21600);
  return { id: id, chunk: UPLOAD_CHUNK_ };
}
function uploadChunk_(me, p) {
  const cache = CacheService.getScriptCache(), key = "up_" + String(p.id || ""), raw = cache.get(key);
  if (!raw) throw new Error("업로드 시간이 지났습니다. 다시 올려 주세요");
  const u = JSON.parse(raw); if (u.user !== me.name) throw new Error("내가 시작한 업로드만 이어 올릴 수 있습니다");
  const offset = Number(p.offset); if (offset !== u.got) throw new Error("업로드 순서가 맞지 않습니다. 다시 올려 주세요");
  const bytes = Utilities.base64Decode(String(p.base64 || "")), len = bytes.length, last = offset + len >= u.size;
  if (!len || len > UPLOAD_CHUNK_ || (!last && len % (256 * 1024)) || offset + len > u.size) throw new Error("업로드 조각 크기가 맞지 않습니다");
  const res = UrlFetchApp.fetch(u.url, { method: "put", muteHttpExceptions: true, contentType: u.mime, payload: bytes,
    headers: { "Content-Range": "bytes " + offset + "-" + (offset + len - 1) + "/" + u.size } });
  const code = res.getResponseCode();
  if (code === 308) { const r = (res.getAllHeaders().Range || res.getAllHeaders().range || ""), m = String(r).match(/-(\d+)$/); u.got = m ? Number(m[1]) + 1 : offset + len; cache.put(key, JSON.stringify(u), 21600); return { got: u.got }; }
  if (code === 200 || code === 201) {
    const fileId = JSON.parse(res.getContentText()).id; cache.remove(key);
    cache.put("stg_" + fileId, JSON.stringify({ user: me.name, name: u.name, size: u.size }), 21600);
    return { got: u.size, staged: fileId };
  }
  throw new Error("Drive 업로드가 중단되었습니다 (" + code + "). 다시 올려 주세요");
}
function stagedFile_(me, upload) {
  const raw = CacheService.getScriptCache().get("stg_" + String(upload.staged || ""));
  if (!raw) throw new Error("올린 파일을 찾지 못했습니다. 다시 올려 주세요");
  const s = JSON.parse(raw); if (s.user !== me.name) throw new Error("내가 올린 파일만 연결할 수 있습니다");
  return { file: DriveApp.getFileById(String(upload.staged)), name: s.name, size: s.size };
}
const hasUpload_ = function (u) { return !!(u && (u.base64 || u.staged)); };
function childFolder_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
/** 경로(예: ["팀프로젝트","A팀 · 스마트팜"])의 폴더를 찾거나 만들고, ID를 속성에 기억합니다. */
function folderFor_(path, propKey) {
  const props = PropertiesService.getScriptProperties();
  const key = propKey || ("DF_" + path.join("/")).slice(0, 200);
  const known = props.getProperty(key);
  if (known) { try { const f = DriveApp.getFolderById(known); if (!f.isTrashed()) return f; } catch (e) {} }
  let f = driveRoot_();
  path.forEach(function (n) { f = childFolder_(f, String(n).replace(/[\\\/]/g, "_").slice(0, 100) || "기타"); });
  props.setProperty(key, f.getId()); return f;
}
function projectFolder_(projectRow) {
  const known=props_()["PF_"+projectRow.v[0]];if(known){const f=openSharedFolder_(known,"프로젝트 Drive");if(f.isTrashed())throw new Error("연결된 프로젝트 폴더가 휴지통에 있습니다");return f;}
  const name = (projectRow.v[1] + " · " + projectRow.v[2]).slice(0,60) + " [" + projectRow.v[0] + "]";
  const folder = folderFor_(["팀프로젝트", name], "PF_" + projectRow.v[0]); PROPS_ = null; return folder;
}
function projectFolderInfo_(id) { return withLock_(function(){return {url:projectFolder_(record_("projects",id)).getUrl()};}); }
function saveProjectFolder_(p){return withLock_(function(){
  const pr=record_("projects",p.id),id=driveFolderId_(p.url);if(!id)throw new Error("팀 Drive 폴더 주소를 입력해 주세요");
  const folder=openSharedFolder_(id,"프로젝트 Drive");if(folder.isTrashed())throw new Error("휴지통의 폴더는 연결할 수 없습니다");
  const pp=props_();rows_("projects").forEach(function(x){if(x.v[0]!==pr.v[0]&&pp["PF_"+x.v[0]]===id)throw new Error("다른 팀에 연결된 폴더입니다. 팀별로 별도 폴더를 사용해 주세요");});
  PropertiesService.getScriptProperties().setProperty("PF_"+pr.v[0],id);PROPS_=null;return {url:folder.getUrl()};
});}
function materialStorageFolder_(target){
 const id=props_().MATERIAL_FOLDER;let folder=id?openSharedFolder_(id,"자료실 Drive"):folderFor_(["자료실"],"MATERIAL_FOLDER");
 if(folder.isTrashed())throw new Error("연결된 자료실 폴더가 휴지통에 있습니다");
 if(target&&target!=="all")folder=childFolder_(folder,TARGET_LABEL[target]);PROPS_=null;return folder;
}
function attachmentFolder_(kind){return kind==="materials"?materialStorageFolder_("all"):folderFor_([kind==="portfolio"?"포트폴리오":"기타"]);}
function storeFile_(me,upload,kind,ref,folder,memo) {
  if(!hasUpload_(upload)) return "";
  if(upload.staged){
    const st=stagedFile_(me,upload),ext=st.name.split(".").pop().toLowerCase();if(!MIME_BY_EXT_[ext]) throw new Error("올릴 수 없는 파일 형식입니다 (."+ext+")");
    const sdir=folder||attachmentFolder_(kind);
    st.file.moveTo(sdir);st.file.setDescription("도제반 알림판 · 올린 사람: "+me.name+(memo?" · "+memo:""));CacheService.getScriptCache().remove("stg_"+upload.staged);
    append_("files",[st.file.getId(),me.name,st.name,MIME_BY_EXT_[ext],st.size,kind,ref,now_(),clean_(memo,300)]);return st.file.getId();
  }
  const name=required_(upload.name,180).replace(/[\\\/]/g,"_");
  const ext=name.split(".").pop().toLowerCase(),mime=MIME_BY_EXT_[ext];if(!mime) throw new Error("올릴 수 없는 파일 형식입니다 (."+ext+")");
  if(String(upload.base64).length>DIRECT_UPLOAD_MB_*1024*1024*1.37+100) throw new Error("큰 파일은 나눠 올리기로 보내야 합니다. 화면을 새로고침한 뒤 다시 올려 주세요");
  const bytes=Utilities.base64Decode(String(upload.base64));if(!bytes.length) throw new Error("빈 파일은 올릴 수 없습니다");
  const dir=folder||attachmentFolder_(kind);
  const f=dir.createFile(Utilities.newBlob(bytes,mime,name));
  try{f.setDescription("도제반 알림판 · 올린 사람: "+me.name+(memo?" · "+memo:""));append_("files",[f.getId(),me.name,name,mime,bytes.length,kind,ref,now_(),clean_(memo,300)]);return f.getId();}catch(e){f.setTrashed(true);throw e;}
}
function uploadProjectFile_(me,p) {
  return withLock_(function(){
    const pr=project_(me,p.project);
    if(!hasUpload_(p.upload)) throw new Error("올릴 파일을 골라 주세요");
    const sh=sheet_("files"); if(!String(sh.getRange(1,9).getValue()).trim()) sh.getRange(1,9).setValue("메모");
    return storeFile_(me,p.upload,"project",pr.v[0],projectFolder_(pr),clean_(p.memo,300));
  });
}
function deleteFile_(me,id) {
  return withLock_(function(){
    const r=record_("files",id);
    if(r.v[5]!=="project") throw new Error("이 파일은 해당 기록의 수정 화면에서 바꿔 주세요");
    project_(me,r.v[6]);
    if(me.role!=="teacher"&&r.v[1]!==me.name) throw new Error("내가 올린 파일만 지울 수 있습니다");
    try{DriveApp.getFileById(id).setTrashed(true);}catch(e){}
    sheet_("files").deleteRow(r._row); return true;
  });
}
/** 팀원 이메일(앱_알림연락처)로 프로젝트 Drive 폴더를 편집자 공유합니다. 구글 계정 이메일만 가능합니다. */
function shareProjectFolder_(id) {
  return withLock_(function(){
  const pr=record_("projects",id),members=JSON.parse(pr.v[3]||"[]"),folder=projectFolder_(pr);
  const mail={};rows_("contacts").forEach(function(x){if(x.v[1])mail[x.v[0]]=x.v[1];});
  const res={shared:[],failed:[],missing:[],url:folder.getUrl()};
  members.forEach(function(n){if(!mail[n]){res.missing.push(n);return;}try{folder.addEditor(mail[n]);res.shared.push(n);}catch(e){res.failed.push(n);}});
  return res;
  });
}
function savePortfolio_(me,p) {
  return withLock_(function(){const old=p.id?record_("portfolio",p.id):null;if(old&&me.role!=="teacher"&&old.v[1]!==me.name) throw new Error("내 포트폴리오만 수정할 수 있습니다");
    const name=old?old.v[1]:(me.role==="teacher"?student_(p.name).name:me.name),id=old?old.v[0]:uid_("pf");
    const date=dateValid_(p.date),title=required_(p.title,150),link=urlValid_(p.link);let unit="";
    if(p.unit){const u=record_("units",p.unit);if(!matches_(targetKey_(u.v[3]),student_(name).group)) throw new Error("대상 능력단위를 확인해 주세요");unit=u.v[0];}
    const file=storeFile_(me,p.upload,"portfolio",id,hasUpload_(p.upload)?folderFor_(["포트폴리오",name]):null)||(old?old.v[7]:"");
    upsert_("portfolio",id,[id,name,date,title,unit,clean_(p.body,6000),link,file,old?old.v[8]:"","제출",now_()]);return id;
  });
}
function reviewPortfolio_(p) { return withLock_(function(){const r=record_("portfolio",p.id),v=r.v.slice(0,11);if(["확인","보완요청"].indexOf(p.status)<0) throw new Error("확인 상태를 선택해 주세요");v[8]=clean_(p.feedback,3000);v[9]=p.status;v[10]=now_();writeCells_(sheet_("portfolio"),r._row,v);return true;}); }
function saveProject_(p) { return withLock_(function(){const id=p.id?record_("projects",p.id).v[0]:uid_("prj");const members=Array.from(new Set(Array.isArray(p.members)?p.members:[]));if(!members.length) throw new Error("구성원을 한 명 이상 선택하세요");members.forEach(student_);if(["준비","진행중","완료","중지"].indexOf(p.status)<0) throw new Error("프로젝트 상태를 확인해 주세요");upsert_("projects",id,[id,required_(p.team,60),required_(p.product,120),JSON.stringify(members),clean_(p.goal,3000),dateValid_(p.due,true),p.status,urlValid_(p.link),now_()]);return id;}); }
function saveTask_(me,p) { return withLock_(function(){const old=p.id?record_("tasks",p.id):null,project=project_(me,old?old.v[1]:p.project),members=JSON.parse(project.v[3]);
  const assignee=clean_(p.assignee,30);if(assignee&&members.indexOf(assignee)<0) throw new Error("담당자는 팀 구성원이어야 합니다");const id=old?old.v[0]:uid_("task");upsert_("tasks",id,[id,project.v[0],required_(p.title,150),assignee,dateValid_(p.due,true),p.done===true?"1":"0",clean_(p.note,2000),now_()]);return id;}); }
function saveMaterial_(me,p) { return withLock_(function(){const old=p.id?record_("materials",p.id):null,id=old?old.v[0]:uid_("m");const title=required_(p.title,150),target=targetValid_(p.target),link=urlValid_(p.link);if(old&&old.v[6]&&targetKey_(old.v[2])!==target)DriveApp.getFileById(old.v[6]).moveTo(materialStorageFolder_(target));const file=storeFile_(me,p.upload,"materials",id,hasUpload_(p.upload)?materialStorageFolder_(target):null)||(old?old.v[6]:"");CacheService.getScriptCache().remove("dm_v1");if(!link&&!file&&!String(p.body||"").trim()) throw new Error("설명, 링크, 파일 중 하나 이상 넣어 주세요");upsert_("materials",id,[id,title,TARGET_LABEL[target],clean_(p.category,50),clean_(p.body,5000),link,file,old?old.v[7]:now_()]);return id;}); }
function removeExtended_(me,p) {
  return withLock_(function(){const allowed=["portfolio","materials","tasks","projects"];if(allowed.indexOf(p.key)<0) throw new Error("삭제할 수 없는 종류입니다");const r=record_(p.key,p.id);
    if(p.key==="portfolio"){if(me.role!=="teacher"&&r.v[1]!==me.name) throw new Error("내 포트폴리오만 삭제할 수 있습니다");}
    else if(p.key==="tasks") project_(me,r.v[1]);else need_(me,"teacher");
    if(p.key==="projects") rows_("tasks").filter(function(x){return x.v[1]===p.id;}).sort(function(a,b){return b._row-a._row;}).forEach(function(x){sheet_("tasks").deleteRow(x._row);});
    sheet_(p.key).deleteRow(r._row);return true;
  });
}
function downloadFile_(me,id) {
  denyStudentPrivateFile_(id);
  const r=record_("files",id); let visible=false;
  if(r.v[5]==="portfolio"){const entry=record_("portfolio",r.v[6]);visible=entry.v[7]===id&&(me.role==="teacher"||entry.v[1]===me.name);}
  if(r.v[5]==="materials"){const entry=record_("materials",r.v[6]);visible=entry.v[6]===id&&(me.role==="teacher"||matches_(targetKey_(entry.v[2]),me.group));}
  if(r.v[5]==="project"){project_(me,r.v[6]);visible=true;}
  if(r.v[5]==="board"){const entry=record_("board",r.v[6]);visible=entry.v[12]!=="1"&&boardFileIds_(entry.v[9]).indexOf(id)>=0;}
  if(r.v[5]==="notice"){noticeFile_(me,id);visible=true;}
  if(!visible) throw new Error("이 첨부파일을 볼 권한이 없습니다");
  const df=DriveApp.getFileById(id);if(df.getSize()>MAX_DOWNLOAD_MB_*1024*1024) throw new Error("파일이 커서("+MAX_DOWNLOAD_MB_+"MB 초과) 앱에서 바로 내려받을 수 없습니다. 선생님께 Drive 공유를 요청하세요");const blob=df.getBlob(),bytes=blob.getBytes();if(bytes.length>MAX_DOWNLOAD_MB_*1024*1024) throw new Error("파일이 커서("+MAX_DOWNLOAD_MB_+"MB 초과) 앱에서 바로 내려받을 수 없습니다. 선생님께 Drive 공유를 요청하세요");return {name:r.v[2],mime:r.v[3],base64:Utilities.base64Encode(bytes)};
}
function emailValid_(s) { s=clean_(s,254).trim();if(s&&!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s)) throw new Error("이메일 주소를 확인해 주세요");return s; }
function saveContact_(me,p) { return withLock_(function(){const name=me.role==="teacher"?student_(p.name).name:me.name,email=emailValid_(p.email);if(p.enabled&&!email) throw new Error("수신할 이메일 주소를 입력해 주세요");const r=rows_("contacts").find(function(x){return x.v[0]===name;});const v=[name,email,p.enabled===true?"1":"0"];if(r)writeCells_(sheet_("contacts"),r._row,v);else append_("contacts",v);return true;}); }
function saveSettings_(p) {
  return withLock_(function(){const email=emailValid_(p.teacherEmail),url=urlValid_(p.webUrl),cal=clean_(p.calendarId,300).trim();
    const props=PropertiesService.getScriptProperties();if(cal!==settings_().calendarId && rows_("calendarMap").length)throw new Error("이미 내보낸 일정이 있습니다. 캘린더 변경 전 기존 전용 캘린더와 앱_캘린더연결을 별도로 정리해 주세요");
    const driveId=driveFolderId_(p.driveRoot);
    if(driveId!==(props_().DRIVE_ROOT||"")){
      if(driveId)openSharedFolder_(driveId,"업로드 저장");
      Object.keys(props_()).forEach(function(k){if(/^(DF_|PF_)/.test(k))props.deleteProperty(k);});
      if(driveId)props.setProperty("DRIVE_ROOT",driveId);else props.deleteProperty("DRIVE_ROOT");
    }
    const mf=driveFolderId_(p.materialFolder);
    if(mf!==(props_().MATERIAL_FOLDER||"")){ if(mf)openSharedFolder_(mf,"자료실 Drive"); if(mf)props.setProperty("MATERIAL_FOLDER",mf);else props.deleteProperty("MATERIAL_FOLDER"); }
    const nt=clean_(p.notionToken,200).trim(); if(nt==="삭제")props.deleteProperty("NOTION_TOKEN"); else if(nt){ if(!/^(secret_|ntn_)[A-Za-z0-9]{20,}$/.test(nt)) throw new Error("노션 토큰 형식이 아닙니다 (secret_ 또는 ntn_ 으로 시작)"); props.setProperty("NOTION_TOKEN",nt); }
    const nr=notionId_(p.notionRoot); if(nr)props.setProperty("NOTION_ROOT",nr); else props.deleteProperty("NOTION_ROOT");
    const nk=clean_(p.neisKey,100).trim(); if(nk==="삭제")props.deleteProperty("NEIS_KEY"); else if(nk){ if(!/^[A-Za-z0-9]{20,64}$/.test(nk)) throw new Error("NEIS 인증키 형식을 확인해 주세요"); props.setProperty("NEIS_KEY",nk); }
    CacheService.getScriptCache().removeAll(["dm_v1","nt_v1"]);
    props.setProperties({CALENDAR_ID:cal,CALENDAR_IMPORT:p.calendarImport===true?"1":"0",CALENDAR_PERSONAL:p.calendarPersonal===true?"1":"0",MAIL_ENABLED:p.mailEnabled===true?"1":"0",TEACHER_EMAIL:email,APP_WEB_URL:url});PROPS_=null;return true;
  });
}
/** 편집기에서 한 번 실행하면 시트 연결·확장 탭을 준비합니다. 실제 알림/캘린더 쓰기는 하지 않습니다. */
function setupApp_() { ensureTabs_(true); const ss=ss_(); ss.setSpreadsheetTimeZone("Asia/Seoul"); PropertiesService.getScriptProperties().setProperty("APP_SPREADSHEET", ss.getId()); bumpAll_(); return checkSetup_(); }
function checkSetup_() {
  const ss=ss_();return {sheet:ss.getName(),timezone:ss.getSpreadsheetTimeZone(),scriptTimezone:Session.getScriptTimeZone(),tabs:Object.keys(APP_TABS).map(function(k){return {name:APP_TABS[k].name,ok:!!ss.getSheetByName(APP_TABS[k].name)};}),legacy:[TAB_AFTER,TAB_PERSONAL,TAB_BOM,"출석부"].map(function(n){const sh=ss.getSheetByName(n);return {name:n,exists:!!sh,rows:sh?sh.getLastRow():0};}),passwordSet:!!TEACHER_PASSWORD&&TEACHER_PASSWORD!=="여기에_비밀번호"};
}
function createCalendar_() {
  return withLock_(function(){const p=PropertiesService.getScriptProperties();if(p.getProperty("CALENDAR_ID")) throw new Error("캘린더 ID가 이미 설정되어 있습니다");const c=CalendarApp.createCalendar("경기항공고 도제반 알림판",{timeZone:"Asia/Seoul"});p.setProperty("CALENDAR_ID",c.getId());return c.getId();});
}
function plusDate_(s,n) {const d=new Date(s+"T12:00:00+09:00");d.setDate(d.getDate()+n);return Utilities.formatDate(d,"Asia/Seoul","yyyy-MM-dd");}
function calendarDates_(e) {
  const date=dateValid_(e.date),end=dateValid_(e.endDate||date);
  if(end<date) throw new Error("일정 종료일을 확인해 주세요");
  const m=String(e.time||"").match(/^(\d{1,2}):([0-5]\d)\s*[-–~]\s*(\d{1,2}):([0-5]\d)$/);
  if(m&&+m[1]<24&&+m[3]<24){const start=new Date(date+"T"+pad_(+m[1])+":"+m[2]+":00+09:00"),finish=new Date(end+"T"+pad_(+m[3])+":"+m[4]+":00+09:00");if(finish<=start)throw new Error("시간 범위를 확인해 주세요: "+e.title);return {allDay:false,start:start,end:finish};}
  return {allDay:true,start:new Date(date+"T00:00:00+09:00"),end:new Date(plusDate_(end,1)+"T00:00:00+09:00")};
}
function syncCalendar_() {
  return withLock_(function(){const s=settings_();if(!s.calendarId) throw new Error("설정에서 전용 캘린더를 만들거나 ID를 입력해 주세요");const cal=CalendarApp.getCalendarById(s.calendarId);if(!cal) throw new Error("캘린더 접근 권한 또는 ID를 확인해 주세요");
    if(cal.getTimeZone()!=="Asia/Seoul"||Session.getScriptTimeZone()!=="Asia/Seoul")throw new Error("캘린더와 Apps Script 프로젝트 시간대를 Asia/Seoul로 설정해 주세요");
    const sy=schoolYear_(),start=sy+"-03-01",end=(sy+1)+"-03-01",data=load_({role:"teacher",name:"선생님"}),list=[];
    if(data.tabsMissing.indexOf(TAB_AFTER)>=0||data.tabsMissing.indexOf(TAB_PERSONAL)>=0)throw new Error("일정 원본 탭을 찾지 못했습니다. 탭 이름을 확인한 뒤 동기화하세요");
    const calendarEvents=cal.getEvents(new Date(start+"T00:00:00+09:00"),new Date(end+"T00:00:00+09:00")),existingEvents={};
    calendarEvents.forEach(function(ev){existingEvents[ev.getId()]=ev;});
    boardContestEvents_(data.boardPosts).forEach(function(e){list.push(e);});
    certificationCalendarEvents_(data.certSchedule).forEach(function(e){list.push(e);});
    noticeCalendarEvents_(data.notices).forEach(function(e){list.push(e);});
    (data.companyEvents||[]).forEach(function(e){list.push(e);});
    data.events.forEach(function(e){list.push(Object.assign({},e,{key:"event:"+e.id,title:"[도제] "+e.title}));});
    data.afterschool.filter(function(a){return !a.info;}).forEach(function(a){list.push({key:"after:"+a.date+":"+a.grade+":"+a.title,date:a.date,time:a.start+"–"+a.end,title:"[도제 방과후 "+a.grade+"학년] "+a.title});});
    sheetScheduleEvents_(data.sheetEvents).forEach(function(e){list.push(Object.assign({},e,{title:"[도제 일정] "+e.title}));});
    data.common.items.forEach(function(e,i){list.push(Object.assign({},e,{key:"common:"+e.date+":"+e.title+":"+i,title:"[도제 공통] "+e.title}));});
    if(s.calendarPersonal){data.personalApp.forEach(function(e){list.push(Object.assign({},e,{key:"personal:"+e.id,title:"[도제 개인 "+e.name+"] "+e.title}));});Object.keys(data.personalSheet).forEach(function(name){data.personalSheet[name].forEach(function(e,i){list.push(Object.assign({},e,{key:"sheetpersonal:"+name+":"+e.date+":"+i,title:"[도제 개인 "+name+"] "+e.title}));});});}
    const desired={};list.filter(function(e){return e.date>=start&&e.date<end;}).forEach(function(e){desired[e.key]=e;});
    const mappings=rows_("calendarMap").filter(function(x){return x.v[1]===s.calendarId;});const map={};mappings.forEach(function(x){map[x.v[0]]=x;});
    let changed=0,pending=0;const appId=ScriptApp.getScriptId();
    Object.keys(desired).forEach(function(key){const e=desired[key],signature=JSON.stringify(e),old=map[key];let ev=old?existingEvents[old.v[2]]:null;if(old&&old.v[3]===signature&&ev)return;if(changed>=40){pending++;return;}
      const dates=calendarDates_(e);
      if(ev&&ev.getTag("dojebanApp")!==appId)throw new Error("연결된 이벤트의 소유 표식이 다릅니다. 캘린더연결 탭을 확인해 주세요");
      const desc=[e.note||"",e.time?"시간: "+e.time:"",e.target?"대상: "+(TARGET_LABEL[e.target]||e.target):"","도제반 앱에서 관리 · 앱 수정 후 동기화"].filter(String).join("\n");
      if(!ev)ev=dates.allDay?cal.createAllDayEvent(e.title,dates.start,dates.end,{description:desc,location:e.place||""}):cal.createEvent(e.title,dates.start,dates.end,{description:desc,location:e.place||""});
      else{ev.setTitle(e.title).setDescription(desc).setLocation(e.place||"");if(dates.allDay)ev.setAllDayDates(dates.start,dates.end);else ev.setTime(dates.start,dates.end);}
      ev.setTag("dojebanApp",appId);ev.setVisibility(CalendarApp.Visibility.PRIVATE);upsert_("calendarMap",key,[key,s.calendarId,ev.getId(),signature,now_()]);changed++;
    });
    // 이 앱이 만든 표식이 있는 이벤트만 삭제합니다. 다른 캘린더 일정은 건드리지 않습니다.
    mappings.filter(function(x){let saved;try{saved=JSON.parse(x.v[3]);}catch(e){return false;}return saved.date>=start&&saved.date<end&&!desired[x.v[0]];}).sort(function(a,b){return b._row-a._row;}).forEach(function(x){if(changed>=40){pending++;return;}const ev=cal.getEventById(x.v[2]);if(ev&&ev.getTag("dojebanApp")===appId)ev.deleteEvent();sheet_("calendarMap").deleteRow(x._row);changed++;});
    if(s.calendarImport){
      const incoming=calendarEvents.filter(function(ev){return ev.getTag("dojebanApp")!==appId;}).map(function(ev){const st=ev.isAllDayEvent()?ev.getAllDayStartDate():ev.getStartTime(),en=ev.isAllDayEvent()?ev.getAllDayEndDate():ev.getEndTime();const d=Utilities.formatDate(st,"Asia/Seoul","yyyy-MM-dd"),last=Utilities.formatDate(new Date(en.getTime()-1),"Asia/Seoul","yyyy-MM-dd");return [ev.getId()+":"+st.getTime(),d,last!==d?last:"",ev.isAllDayEvent()?"":Utilities.formatDate(st,"Asia/Seoul","HH:mm")+"–"+Utilities.formatDate(en,"Asia/Seoul","HH:mm"),ev.getTitle(),ev.getLocation(),clean_(ev.getDescription(),3000)];});
      const sh=sheet_("calendarIn");if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,7).clearContent();incoming.forEach(function(v){append_("calendarIn",v);});
    }else{const sh=sheet_("calendarIn");if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,7).clearContent();}
    PropertiesService.getScriptProperties().setProperty("CALENDAR_LAST",now_());return {changed:changed,pending:pending};
  });
}
function sendNotifications_() {
  return withLock_(function(){const s=settings_();if(!s.mailEnabled)throw new Error("설정에서 이메일 알림을 켜 주세요");
    const sent={};rows_("mailLog").filter(function(x){return x.v[5]==="발송";}).forEach(function(x){sent[x.v[0]]=true;});
    const contacts=rows_("contacts").filter(function(x){return x.v[2]==="1"&&x.v[1];});const students=roster_(),candidates=[];
    function add(name,email,kind,id,title){if(!email)return;const key=kind+":"+id+":"+name;if(!sent[key])candidates.push({key:key,name:name,email:emailValid_(email),kind:kind,id:id,title:title});}
    const notices=rows_("notices"),reqs=rows_("requests"),acks=rows_("acks"),portfolios=rows_("portfolio");
    const tomorrow=plusDate_(today_(),1),agenda=load_({role:"teacher",name:"선생님"});
    contacts.forEach(function(c){const st=students.find(function(x){return x.name===c.v[0];});if(!st)return;
      notices.forEach(function(n){if(matches_(targetKey_(n.v[2]),st.group)&&!acks.some(function(a){return a.v[0]===n.v[0]&&a.v[1]===st.name;}))add(st.name,c.v[1],"공지",n.v[0],n.v[3]);});
      reqs.filter(function(r){return r.v[2]===st.name&&r.v[9]==="1";}).forEach(function(r){add(st.name,c.v[1],"요청답변",r.v[0]+":"+r.v[8],"선생님 답변을 확인해 주세요");});
      portfolios.filter(function(r){return r.v[1]===st.name&&r.v[9]!=="제출";}).forEach(function(r){add(st.name,c.v[1],"포트폴리오",r.v[0]+":"+r.v[10],"포트폴리오 확인 결과가 있습니다");});
      const nextDay=function(e){return e.date<=tomorrow&&(e.endDate||e.date)>=tomorrow;};
      const grade=({learner:3,pre2:2,pre1:1})[st.group];
      const relevant=agenda.events.some(function(e){return matches_(e.target,st.group)&&nextDay(e);})||(st.afterschool&&agenda.afterschool.some(function(e){return !e.info&&e.date===tomorrow&&grade===e.grade;}))||sheetScheduleEvents_(agenda.sheetEvents,grade).some(nextDay)||agenda.personalApp.some(function(e){return e.name===st.name&&nextDay(e);})||(agenda.personalSheet[st.name]||[]).some(nextDay)||(matches_(agenda.common.target,st.group)&&agenda.common.items.some(nextDay));
      if(relevant)add(st.name,c.v[1],"다음날일정",tomorrow,"내일 일정을 확인해 주세요");
    });
    if(s.teacherEmail){reqs.filter(function(r){return r.v[10]==="1";}).forEach(function(r){add("선생님",s.teacherEmail,"학생요청",r.v[0]+":"+r.v[8],"새 학생 요청이 있습니다");});portfolios.filter(function(r){return r.v[9]==="제출";}).forEach(function(r){add("선생님",s.teacherEmail,"학생제출",r.v[0]+":"+r.v[10],"새 포트폴리오 제출이 있습니다");});}
    let count=0,failed=0;const quota=MailApp.getRemainingDailyQuota();
    candidates.slice(0,Math.min(30,quota)).forEach(function(c){try{MailApp.sendEmail({to:c.email,subject:"[경기항공고 도제반] "+c.title,body:"도제반 알림판에 확인할 내용이 있습니다.\n종류: "+c.kind+"\n\n"+(s.webUrl?"알림판 열기: "+s.webUrl:"선생님께 받은 알림판 주소로 접속하세요.")+"\n\n이름과 PIN으로 로그인하여 확인해 주세요.",name:"경기항공고 도제반"});append_("mailLog",[c.key,now_(),c.name,c.kind,c.id,"발송"]);count++;}catch(e){append_("mailLog",[c.key,now_(),c.name,c.kind,c.id,"실패: "+clean_(e.message,300)]);failed++;}});
    return {sent:count,failed:failed,pending:Math.max(0,candidates.length-count),quota:quota};
  });
}
function setAutomation_(enabled) {
  ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==="runAppJobs_";}).forEach(function(t){ScriptApp.deleteTrigger(t);});
  if(enabled){ss_();ScriptApp.newTrigger("runAppJobs_").timeBased().everyMinutes(10).create();}
  PropertiesService.getScriptProperties().setProperty("APP_AUTO",enabled?"1":"0");return enabled;
}
function runAppJobs_() {
  ensureTabs_();const s=settings_(),errors=[];
  if(s.calendarId)try{syncCalendar_();}catch(e){errors.push("캘린더: "+e.message);}
  if(s.mailEnabled)try{const r=sendNotifications_();if(r.failed)errors.push("메일 발송 실패 "+r.failed+"건 · 앱_알림기록을 확인하세요");}catch(e){errors.push("메일: "+e.message);}
  PropertiesService.getScriptProperties().setProperties({APP_LAST_RUN:now_(),APP_LAST_ERROR:errors.join(" / ")});
  bumpAll_();
}


/* ===================== 익명 게시판 =====================
 * 학생 화면에는 이름 없이 '익명'(댓글은 익명1·익명2·글쓴이)으로 보입니다.
 * 부적절한 글 대응을 위해 작성자는 시트(앱_익명게시판·앱_익명댓글)에 저장되고 선생님 화면에서만 보입니다.
 * 숨김 칸에 1이 있으면 학생에게 보이지 않습니다. */

// 사용자의 2026-10-07 승인: 기존 요청 글과 답변을 익명으로 전체 공개합니다.
// 원본 요청 시트는 보존하며, 이전 ID로 중복 복사를 방지합니다.
function migrateRequestsToAnon_() {
  const props = PropertiesService.getScriptProperties(), flag = 'REQUESTS_TO_ANON_20261007';
  if (props.getProperty(flag) === 'done') return;
  const previousCache = USE_CACHE_; USE_CACHE_ = false; MEMO_ = {};
  try {
    withLock_(function () {
      if (props.getProperty(flag) === 'done') return;
      const postSheet = sheet_('anon'), commentSheet = sheet_('anonCmt');
      postSheet.getRange(1,7,1,2).setValues([['구분','이전요청ID']]);
      commentSheet.getRange(1,7).setValue('이전답변ID');
      const copied = {}, copiedComments = {}, requestMap = {};
      rows_('anon').forEach(function (r) { if (r.v[7]) copied[r.v[7]] = r.v[0]; });
      rows_('anonCmt').forEach(function (r) { if (r.v[6]) copiedComments[r.v[6]] = true; });
      rows_('requests').forEach(function (r) {
        const v=r.v; if (!v[0]) return;
        const id=copied[v[0]] || ('legacy_request_' + v[0]);
        requestMap[v[0]]=id;
        if (!copied[v[0]]) {
          const category=/방과후/.test(String(v[4]))?'after':normGroup_(v[3])==='learner'?'learner':'pre';
          append_('anon',[id,v[1],v[2],v[5],v[6],'',category,v[0]]);
        }
      });
      rows_('replies').forEach(function (r) {
        const v=r.v, post=requestMap[v[0]], marker=String(v[0]) + ':' + r._row;
        if (post && !copiedComments[marker]) append_('anonCmt',['legacy_reply_' + r._row,post,v[1],v[2],v[3],'',marker]);
      });
      props.setProperty(flag,'done');
    });
  } finally { flushDirty_(); USE_CACHE_ = previousCache; MEMO_ = {}; PROPS_ = null; }
}

function who_(me) { return me.role === "teacher" ? "선생님" : me.name; }
function anonLoad_(me) {
  const T = me.role === "teacher", who = who_(me);
  const posts = rows_("anon").map(function (x) { const v = x.v; return { id: v[0], at: v[1], author: v[2], title: v[3], body: v[4], hidden: v[5] === "1", category: v[6] || "", status:v[8]||"접수" }; })
    .filter(function (p) { return p.id && (T || !p.hidden); });
  const byId = {}; posts.forEach(function (p) { byId[p.id] = p; p.comments = 0; p.labels = {}; p.n = 0; });
  const comments = rows_("anonCmt").map(function (x) { const v = x.v; return { id: v[0], post: v[1], at: v[2], author: v[3], body: v[4], hidden: v[5] === "1" }; })
    .filter(function (c) { return c.id && byId[c.post] && (T || !c.hidden); })
    .sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
  comments.forEach(function (c) {
    const p = byId[c.post]; p.comments++;
    if (c.author === "선생님") c.label = "선생님";
    else if (c.author === p.author) c.label = "글쓴이";
    else { if (!p.labels[c.author]) p.labels[c.author] = "익명" + (++p.n); c.label = p.labels[c.author]; }
  });
  const strip = function (o, extra) { const r = Object.assign({}, extra); r.mine = o.author === who; if (T) r.author = o.author; return r; };
  return {
    anonReports:T?rows_("anonReports").map(function(r){return {id:r.v[0],post:r.v[1],reason:r.v[3],at:r.v[4],done:r.v[5]==="완료"};}):[],
    anonPosts: posts.map(function (p) { return strip(p, { id: p.id, at: p.at, title: p.title, body: p.body, hidden: p.hidden, category: p.category, status:p.status, comments: p.comments, label: p.author === "선생님" ? "선생님" : "익명" }); }),
    anonComments: comments.map(function (c) { return strip(c, { id: c.id, post: c.post, at: c.at, body: c.body, hidden: c.hidden, label: c.label }); })
  };
}
function anonRate_(me, kind, sec) {
  const c = CacheService.getScriptCache(), k = "anonrl_" + kind + "_" + who_(me);
  if (me.role !== "teacher" && c.get(k)) throw new Error("너무 빨리 올리고 있어요. " + sec + "초 뒤에 다시 해 주세요");
  c.put(k, "1", sec);
}
function anonPost_(me, p) {
  const category = String(p.category || '');
  if (['pre','after','learner'].indexOf(category) < 0) throw new Error('예비·방과후·학습근로자 중 글 구분을 선택해 주세요');
  const title = required_(p.title, 80), body = clean_(p.body, 3000).trim();
  if (!body) throw new Error("내용을 넣어 주세요");
  anonRate_(me, "post", 30);
  return withLock_(function () { const id = uid_("an"); append_("anon", [id, now_(), who_(me), title, body, "", category, ""]); return id; });
}
function anonComment_(me, p) {
  const body = clean_(p.body, 1000).trim(); if (!body) throw new Error("댓글을 넣어 주세요");
  return withLock_(function () {
    const post = record_("anon", p.post);
    if (post.v[5] === "1" && me.role !== "teacher") throw new Error("숨겨진 글입니다");
    anonRate_(me, "cmt", 5);
    const id = uid_("ac"); append_("anonCmt", [id, String(p.post), now_(), who_(me), body, ""]); return id;
  });
}
function anonDelete_(me, p) {
  return withLock_(function () {
    const key = p.kind === "comment" ? "anonCmt" : "anon", r = record_(key, p.id), author = key === "anon" ? r.v[2] : r.v[3];
    if (me.role !== "teacher" && author !== who_(me)) throw new Error("내가 쓴 글만 지울 수 있습니다");
    if (key === "anon") rows_("anonCmt").filter(function (x) { return x.v[1] === String(p.id); }).sort(function (a, b) { return b._row - a._row; }).forEach(function (x) { sheet_("anonCmt").deleteRow(x._row); });
    sheet_(key).deleteRow(r._row); return true;
  });
}

function anonStatus_(p){if(["접수","확인 중","처리 완료"].indexOf(p.status)<0)throw new Error("처리 상태를 확인해 주세요");return withLock_(function(){const r=record_("anon",p.id);sheet_("anon").getRange(1,9).setValue("처리상태");sheet_("anon").getRange(r._row,9).setValue(p.status);return true;});}
function anonReport_(me,p){const reason=required_(p.reason,500);return withLock_(function(){const post=record_("anon",p.id);if(post.v[5]==="1")throw new Error("숨겨진 글입니다");if(rows_("anonReports").some(function(r){return r.v[1]===p.id&&r.v[2]===who_(me)&&r.v[5]!=="완료";}))throw new Error("이미 신고한 글입니다. 선생님이 확인 중입니다");append_("anonReports",[uid_("rp"),p.id,who_(me),reason,now_(),""]);return true;});}

/* 자격증별 시험 일정과 Drive 자료실. 일정은 공통 공개, 관리와 업로드는 교사만 합니다. */
const CERTIFICATIONS_ = [
  {id:"printing3d",name:"3D프린터운용기능사"}, {id:"electronics",name:"전자기능사"},
  {id:"automation",name:"자동화설비기능사"}, {id:"electricity",name:"전기기능사"},
  {id:"elevator",name:"승강기기능사"}, {id:"itq",name:"ITQ"}
];
APP_TABS.certSchedule = {name:"앱_자격증일정",head:["ID","자격증ID","구분","회차과목","시작일","종료일","장소","안내","링크","수정시각"]};
const CERT_PHASES_ = ["필기 접수","필기 시험","실기 접수","실기 시험","시험 접수","시험","합격 발표","준비 수업","기타"];
function certification_(id) {
  const c = CERTIFICATIONS_.find(function(c){return c.id === String(id);});
  if (!c) throw new Error("자격증을 선택해 주세요"); return c;
}
function certificationLoad_() {
  const pp=props_();
  const certifications=CERTIFICATIONS_.map(function(c){const id=pp["CERT_FOLDER_"+c.id]||"";return {id:c.id,name:c.name,folderUrl:id?"https://drive.google.com/drive/folders/"+id:""};});
  const certSchedule=rows_("certSchedule").filter(function(r){return r.v[0];}).map(function(r){const v=r.v;return {id:v[0],cert:v[1],phase:v[2],title:v[3],date:v[4],endDate:v[5],place:v[6],note:v[7],link:v[8],updated:v[9]};});
  return {certifications:certifications,certSchedule:certSchedule,certCalendar:certificationCalendarEvents_(certSchedule)};
}
function saveCertSchedule_(p) {return withLock_(function(){
  const cert=certification_(p.cert),phase=String(p.phase||"");if(CERT_PHASES_.indexOf(phase)<0)throw new Error("일정 구분을 선택해 주세요");
  const date=dateValid_(p.date),end=dateValid_(p.endDate,true);if(end&&end<date)throw new Error("종료일은 시작일 이후로 입력해 주세요");
  const title=required_(p.title,120),place=clean_(p.place,150),note=clean_(p.note,2000),link=urlValid_(p.link);
  const id=p.id?record_("certSchedule",p.id).v[0]:uid_("ce");
  upsert_("certSchedule",id,[id,cert.id,phase,title,date,end,place,note,link,now_()]);return id;
});}
function deleteCertSchedule_(p){return withLock_(function(){const r=record_("certSchedule",p.id);sheet_("certSchedule").deleteRow(r._row);return true;});}
function certificationCalendarEvents_(items){return (items||[]).map(function(e){
 const c=certification_(e.cert),exam=["필기 시험","실기 시험","시험"].indexOf(e.phase)>=0,period=exam&&e.endDate&&e.endDate>e.date;
 let date=e.date,endDate=e.endDate||"",hint="";
 if(period){
  let weekend="";for(let i=0;i<7;i++){const day=plusDate_(e.date,i);if(day>e.endDate)break;const dow=new Date(day+"T00:00:00Z").getUTCDay();if(dow===6||dow===0){weekend=day;break;}}
  date=weekend||e.date;endDate="";hint="공식 시험 기간: "+e.date+" ~ "+e.endDate+"\n달력에는 "+(weekend?"기간 중 첫 주말":"주말이 없어 시작일")+"에 한 번만 표시합니다. 개인별 확정 시험일은 수험표에서 확인하세요.";
 }
 return {id:"cert-"+e.id,key:"cert:"+e.id,uid:"cert-"+e.id,cert:c.id,title:"자격증 · "+c.name+" · "+e.phase+" · "+e.title+(period?" (기간 안내)":""),date:date,endDate:endDate,place:e.place||"",note:[hint,e.note,e.link].filter(Boolean).join("\n")};
});}

function saveCertFolder_(p){return withLock_(function(){
  const cert=certification_(p.cert),props=PropertiesService.getScriptProperties(),key="CERT_FOLDER_"+cert.id;
  let f;
  if(p.create===true){const old=props.getProperty(key);f=old?openSharedFolder_(old,cert.name+" 자료실"):folderFor_(["자격증",cert.name]);}
  else {const id=driveFolderId_(p.url);if(!id)throw new Error("연결할 Drive 폴더 주소를 입력해 주세요");f=openSharedFolder_(id,cert.name+" 자료실");}
  props.setProperty(key,f.getId());PROPS_=null;return {url:f.getUrl()};
});}

/* 프로젝트·자격증 전체 공유 게시판 */
function boardFileIds_(s){try{const a=JSON.parse(s||"[]");return Array.isArray(a)?a.filter(function(x){return typeof x==="string";}):[];}catch(e){return [];}}
function boardLoad_(me){
 const files={};rows_("files").filter(function(r){return r.v[5]==="board";}).forEach(function(r){files[r.v[0]]={id:r.v[0],name:r.v[2],size:Number(r.v[4])||0};});
 const posts=rows_("board").filter(function(r){return r.v[0]&&r.v[12]!=="1";}).map(function(r){const v=r.v;return {id:v[0],author:v[1],category:v[2],subject:v[3],title:v[4],body:v[5],status:v[6],date:v[7],link:v[8],files:boardFileIds_(v[9]).filter(function(id){return files[id];}).map(function(id){return files[id];}),at:v[10],updated:v[11],mine:v[1]===me.name,organizer:v[13]||"",place:v[14]||"",applyStart:v[15]||"",applyEnd:v[16]||"",eventEnd:v[17]||""};});
 const ids={};posts.forEach(function(p){ids[p.id]=true;});return {boardPosts:posts,boardComments:rows_("boardComments").filter(function(r){return ids[r.v[1]]&&r.v[5]!=="1";}).map(function(r){return {id:r.v[0],post:r.v[1],author:r.v[2],body:r.v[3],at:r.v[4],mine:r.v[2]===me.name};})};
}

function boardContestEvents_(posts){const out=[];(posts||[]).filter(function(p){return p.category==="대회";}).forEach(function(p){const title=p.subject||p.title;const add=function(part,date,label,end){if(date)out.push({key:"contest:"+p.id+":"+part,uid:"contest-"+p.id+"-"+part,title:"대회 · "+title+" · "+label,date:date,endDate:end||"",place:p.place||"",note:[p.organizer,p.link].filter(Boolean).join("\n")});};if(p.applyStart!==p.applyEnd)add("apply-start",p.applyStart,"접수 시작");add("apply-end",p.applyEnd,"접수 마감");add("event",p.date,"개최",p.eventEnd);});return out;}

function boardOwned_(me,r){if(r.v[12]==="1")throw new Error("삭제된 게시글입니다");if(me.role!=="teacher"&&r.v[1]!==me.name)throw new Error("내가 쓴 글만 수정하거나 삭제할 수 있습니다");}
function saveBoard_(me,p){return withLock_(function(){
 const old=p.id?record_("board",p.id):null;if(old)boardOwned_(me,old);
 const category=String(p.category||"");if(["프로젝트","자격증","대회"].indexOf(category)<0)throw new Error("프로젝트·자격증·대회 중 구분을 선택해 주세요");
 const title=required_(p.title,150),subject=clean_(p.subject,100),body=required_(p.body,6000),link=urlValid_(p.link),date=dateValid_(p.date,true),status=String(p.status||"자료 공유");if(["준비","진행 중","완료","자료 공유"].indexOf(status)<0)throw new Error("진행 상태를 선택해 주세요");
 const contest=category==="대회",organizer=contest?clean_(p.organizer,100):"",place=contest?clean_(p.place,150):"",applyStart=contest?dateValid_(p.applyStart,true):"",applyEnd=contest?dateValid_(p.applyEnd,true):"",eventEnd=contest?dateValid_(p.eventEnd,true):"";
 if(applyStart&&applyEnd&&applyEnd<applyStart)throw new Error("접수 마감일은 시작일 이후로 입력해 주세요");if(eventEnd&&(!date||eventEnd<date))throw new Error("대회 종료일은 개최일 이후로 입력해 주세요");
 const prior=old?boardFileIds_(old.v[9]):[],keep=p.keepFiles===undefined?prior:(Array.isArray(p.keepFiles)?Array.from(new Set(p.keepFiles)):[]);if(keep.some(function(id){return prior.indexOf(id)<0;}))throw new Error("다른 글의 첨부는 연결할 수 없습니다");
 const uploads=Array.isArray(p.uploads)?p.uploads:[];if(uploads.length>5||keep.length+uploads.length>20)throw new Error("새 파일은 한 번에 5개, 글당 총 20개까지 올릴 수 있습니다");
 uploads.forEach(function(u){if(u&&u.staged){stagedFile_(me,u);return;}const name=required_(u.name,180),ext=name.split('.').pop().toLowerCase();if(!MIME_BY_EXT_[ext])throw new Error("올릴 수 없는 파일 형식입니다");if(!u.base64||String(u.base64).length>DIRECT_UPLOAD_MB_*1024*1024*1.37+100)throw new Error("파일을 다시 골라 주세요");const n=Utilities.base64Decode(String(u.base64)).length;if(!n)throw new Error("파일 크기를 확인해 주세요");});
 const id=old?old.v[0]:uid_("bd"),created=[];try{const folder=uploads.length?folderFor_(["프로젝트게시판",category]):null;uploads.forEach(function(u){created.push(storeFile_(me,u,"board",id,folder));});const t=now_();upsert_("board",id,[id,old?old.v[1]:me.name,category,subject,title,body,status,date,link,JSON.stringify(keep.concat(created)),old?old.v[10]:t,t,"",organizer,place,applyStart,applyEnd,eventEnd]);sheet_("board").getRange(1,14,1,5).setValues([["주최기관","장소","접수시작","접수마감","대회종료"]]);return id;}catch(e){created.forEach(function(fid){try{DriveApp.getFileById(fid).setTrashed(true);}catch(ignored){}});throw e;}
 });}
function deleteBoard_(me,p){return withLock_(function(){const r=record_("board",p.id);boardOwned_(me,r);sheet_("board").getRange(r._row,13).setValue("1");return true;});}
function boardComment_(me,p){const body=required_(p.body,1500);return withLock_(function(){const r=record_("board",p.post);if(r.v[12]==="1")throw new Error("삭제된 게시글입니다");anonRate_(me,"boardcmt",5);const id=uid_("bc");append_("boardComments",[id,r.v[0],me.name,body,now_(),""]);return id;});}
function deleteBoardComment_(me,p){return withLock_(function(){const r=record_("boardComments",p.id);if(me.role!=="teacher"&&r.v[2]!==me.name)throw new Error("내 댓글만 삭제할 수 있습니다");sheet_("boardComments").getRange(r._row,6).setValue("1");return true;});}

function anonHide_(p) {
  return withLock_(function () {
    const key = p.kind === "comment" ? "anonCmt" : "anon", r = record_(key, p.id);
    sheet_(key).getRange(r._row, 6).setValue(p.hidden ? "1" : ""); return true;
  });
}

/* ===================== 도제 훈련 (학습근로자) =====================
 * 앱_기업: 훈련 기업과 기업현장교사 연락처
 * 앱_훈련배정: 학습근로자별 훈련 기업, OJT 요일(예: 월,화,수), 훈련 기간
 * 학습근로자는 자기 기업·배정만 받습니다. */
const DOW_KO_ = ["일","월","화","수","목","금","토"];
function trainLoad_(me) {
  const T = me.role === "teacher";
  if (!T && me.group !== "learner") return { companies: [], assigns: [] };
  let assigns = rows_("assign").map(function (x) { const v = x.v; return { name: v[0], company: v[1], ojtDays: v[2], start: v[3], end: v[4], note: v[5], ojtTime: v[6] || "" }; })
    .filter(function (a) { return a.name && (T || a.name === me.name); });
  const mine = {}; assigns.forEach(function (a) { mine[a.company] = true; });
  const companies = rows_("companies").map(function (x) { const v = x.v; return { id: v[0], name: v[1], address: v[2], mentor: v[3], phone: v[4], email: v[5], note: v[6], industry: v[7] || "", jobs: v[8] || "", intro: v[9] || "", homepage: v[10] || "", open: v[11] !== "0" }; })
    .filter(function (c) { return c.id && (T || mine[c.id]); });
  return { companies: companies, assigns: assigns };
}
function daysValid_(s) {
  const out = []; String(s || "").split(/[,\s·/]+/).forEach(function (d) { d = d.trim().replace(/요일$/, ""); if (!d) return; if (DOW_KO_.indexOf(d) < 0) throw new Error("OJT 요일은 월,화,수처럼 적어 주세요"); if (out.indexOf(d) < 0) out.push(d); });
  return out.sort(function (a, b) { return DOW_KO_.indexOf(a) - DOW_KO_.indexOf(b); }).join(",");
}
function saveCompany_(p) {
  return withLock_(function () {
    const id = p.id ? record_("companies", p.id).v[0] : uid_("co");
    sheet_("companies").getRange(1, 8, 1, 5).setValues([["업종", "주요업무", "소개", "홈페이지", "학생공개"]]);
    upsert_("companies", id, [id, required_(p.name, 80), clean_(p.address, 200), clean_(p.mentor, 40), clean_(p.phone, 40), emailValid_(p.email), clean_(p.note, 500), clean_(p.industry, 60), clean_(p.jobs, 300), clean_(p.intro, 2000), p.homepage ? urlValid_(p.homepage) : "", p.open === false ? "0" : "1"]);
    return id;
  });
}
function removeCompany_(id) {
  return withLock_(function () {
    const r = record_("companies", id);
    if (rows_("assign").some(function (x) { return x.v[1] === String(id); })) throw new Error("이 기업에 배정된 학습근로자가 있습니다. 배정을 먼저 바꿔 주세요");
    sheet_("companies").deleteRow(r._row); return true;
  });
}
function saveAssign_(p) {
  return withLock_(function () {
    const st = student_(p.name);
    if (st.group !== "learner") throw new Error("학습근로자만 훈련 기업을 배정할 수 있습니다");
    const company = p.company ? record_("companies", p.company).v[0] : "";
    const start = dateValid_(p.start, true), end = dateValid_(p.end, true);
    if (start && end && end < start) throw new Error("훈련 종료일을 확인해 주세요");
    const time=clean_(p.ojtTime,30).trim();
    if(time){const m=time.match(/^(\d{1,2}):(\d{2})\s*[-–~]\s*(\d{1,2}):(\d{2})$/);if(!m || +m[1]>23 || +m[3]>23 || +m[2]>59 || +m[4]>59 || (+m[1]*60 + +m[2]) >= (+m[3]*60 + +m[4]))throw new Error('OJT 시간은 09:00–17:00 형식으로 입력해 주세요');}
    sheet_('assign').getRange(1,7).setValue('OJT시간');
    const vals = [st.name, company, daysValid_(p.ojtDays), start, end, clean_(p.note, 300), time];
    const r = rows_("assign").find(function (x) { return x.v[0] === st.name; });
    if (r) writeCells_(sheet_("assign"), r._row, vals); else append_("assign", vals);
    return true;
  });
}

/* ===================== 휴대폰 캘린더 (구독·일정 추가) =====================
 * ?ics=토큰  → 그 사람이 앱에서 보는 일정 전체를 iCalendar(.ics) 구독 피드로 제공 (알림 포함)
 * ?ev=1&t=제목&d=날짜…  → 일정 하나를 .ics 파일로 내려받아 휴대폰 기본 캘린더에 추가
 * 토큰은 사람마다 무작위로 만들고, '새 주소로 바꾸기'를 하면 이전 주소는 더 이상 열리지 않습니다. */
function appUrl_() {
  let u = "";
  try { u = settings_().webUrl || ScriptApp.getService().getUrl() || ""; } catch (x) {}
  return u.replace(/\/a\/macros\/[^/]+\/s\//, "/macros/s/");
}
function icsToken_(me, reset) {
  return withLock_(function () {
    const name = who_(me), r = rows_("icsTokens").filter(function (x) { return x.v[0] === name; })[0];
    if (r && !reset) return r.v[1];
    const tok = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
    if (r) writeCells_(sheet_("icsTokens"), r._row, [name, tok, now_()]); else append_("icsTokens", [name, tok, now_()]);
    return tok;
  });
}
function icsEsc_(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function icsFold_(line) { const out = []; while (line.length > 70) { out.push(line.slice(0, 70)); line = " " + line.slice(70); } out.push(line); return out.join("\r\n"); }
function icsDate_(s) { return String(s).replace(/-/g, ""); }
function icsHash_(s) { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
function icsEvent_(ev, stamp) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || ""))) return [];
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(ev.endDate || "")) && ev.endDate > ev.date ? ev.endDate : ev.date;
  const t = String(ev.time || ""), m = t.match(/(\d{1,2}):(\d{2})\s*[-–~]\s*(\d{1,2}):(\d{2})/), s = t.match(/^\s*(\d{1,2}):(\d{2})\s*$/);
  const L = ["BEGIN:VEVENT", "UID:" + (ev.uid || icsHash_(ev.date + ev.title + t)) + "@dojeban", "DTSTAMP:" + stamp];
  let trigger;
  if (m || s) {
    const sh = +(m || s)[1], sm = +(m || s)[2];
    let eh = m ? +m[3] : sh + 1, em = m ? +m[4] : sm; if (eh > 23) { eh = 23; em = 59; }
    L.push("DTSTART;TZID=Asia/Seoul:" + icsDate_(ev.date) + "T" + pad_(sh) + pad_(sm) + "00", "DTEND;TZID=Asia/Seoul:" + icsDate_(end) + "T" + pad_(eh) + pad_(em) + "00");
    trigger = "-PT30M";
  } else {
    L.push("DTSTART;VALUE=DATE:" + icsDate_(ev.date), "DTEND;VALUE=DATE:" + icsDate_(plusDate_(end, 1)));
    trigger = "-PT15H";   // 하루 종일 일정: 전날 오전 9시
  }
  L.push("SUMMARY:" + icsEsc_(ev.title));
  if (ev.place) L.push("LOCATION:" + icsEsc_(ev.place));
  const desc = [ev.note || "", t && !(m || s) ? "시간: " + t : "", "도제반 알림판"].filter(String).join("\n");
  L.push("DESCRIPTION:" + icsEsc_(desc), "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc_(ev.title), "TRIGGER:" + trigger, "END:VALARM", "END:VEVENT");
  return L;
}
function icsCalendar_(name, events) {
  const stamp = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmss'Z'");
  let L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//dojeban//notice//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + icsEsc_(name), "X-WR-TIMEZONE:Asia/Seoul", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    "BEGIN:VTIMEZONE", "TZID:Asia/Seoul", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0900", "TZOFFSETTO:+0900", "TZNAME:KST", "END:STANDARD", "END:VTIMEZONE"];
  events.forEach(function (ev) { L = L.concat(icsEvent_(ev, stamp)); });
  L.push("END:VCALENDAR");
  return L.map(icsFold_).join("\r\n") + "\r\n";
}
const KIND_PREFIX_ = { OJT: "OJT", OFF: "OFF-JT", EVAL: "평가", PRJ: "팀프로젝트", SCH: "학교", EVT: "" };
function isPublicHoliday_(title){
 return /^(?:(?:대체)?공휴일|대체휴일|임시공휴일|휴일|휴업일|재량휴업일|개교기념일|설날(?:연휴)?|설연휴|추석(?:연휴)?|부처님오신날|석가탄신일|신정|새해첫날|삼일절|어린이날|현충일|광복절|개천절|한글날|성탄절|크리스마스)(?:\s*[（(][^）)]*[）)])?$/.test(String(title||"").trim());
}
function icsFeed_(token) {
  USE_CACHE_ = true;
  const r = /^[a-f0-9]{20,}$/.test(token) ? rows_("icsTokens").filter(function (x) { return x.v[1] === token; })[0] : null;
  if (!r) return ContentService.createTextOutput(icsCalendar_("도제반 알림판", [])).setMimeType(ContentService.MimeType.ICAL);
  const name = r.v[0];
  let me;
  if (name === "선생님") me = { role: "teacher", name: "선생님" };
  else { const st = roster_().filter(function (x) { return x.name === name; })[0]; if (!st) return ContentService.createTextOutput(icsCalendar_("도제반 알림판", [])).setMimeType(ContentService.MimeType.ICAL); me = { role: "student", name: st.name, group: st.group, klass: st.klass, afterschool: st.afterschool }; }
  prefetchLoad_();
  const d = load_(me), T = me.role === "teacher", from = plusDate_(today_(), -31), to = plusDate_(today_(), 366), out = [];
  const inRange = function (x) { return x.date && (x.endDate || x.date) >= from && x.date <= to; };
  d.events.filter(function(e){return inRange(e)&&!isPublicHoliday_(e.title);}).forEach(function (e) { const pre = KIND_PREFIX_[e.kind]; out.push({ uid: "ev-" + e.id, title: (pre ? pre + " · " : "") + e.title, date: e.date, endDate: e.endDate, time: e.time, place: e.place, note: e.note }); });
  boardContestEvents_(d.boardPosts).filter(inRange).forEach(function(e){out.push(e);});
  certificationCalendarEvents_(d.certSchedule).filter(inRange).forEach(function(e){out.push(e);});
  noticeCalendarEvents_(d.notices).filter(inRange).forEach(function(e){out.push(e);});
  (d.companyEvents||[]).filter(inRange).forEach(function(e){out.push(e);});
  const sheetGrade = T ? 0 : ({ learner: 3, pre2: 2, pre1: 1 })[me.group];
  sheetScheduleEvents_(d.sheetEvents, sheetGrade).filter(inRange).forEach(function(e){out.push(e);});
  {
    const g = T ? 0 : ({ learner: 3, pre2: 2, pre1: 1 })[me.group];
    d.afterschool.filter(function (a) { return (T || (me.afterschool && a.grade === g)) && !a.info && inRange(a); }).forEach(function (a) { out.push({ uid: "aft-" + a.date + "-" + icsHash_(a.title + a.start), title: "방과후 " + a.title, date: a.date, time: a.start + "–" + a.end }); });
    if (T || matches_(d.common.target, me.group)) d.common.items.filter(function (e) { return inRange(e) && !e.monthOnly; }).forEach(function (e) { out.push({ uid: "sc-" + e.date + "-" + icsHash_(e.title), title: e.title, date: e.date, endDate: e.endDate, time: e.time }); });
    d.personalApp.filter(inRange).forEach(function (e) { out.push({ uid: "pe-" + e.id, title: "["+e.name+"] "+e.title, date: e.date, endDate: e.endDate, time: e.time, note: e.note }); });
    Object.keys(d.personalSheet||{}).forEach(function(n){(d.personalSheet[n]||[]).filter(function(e){return inRange(e)&&!e.monthOnly;}).forEach(function(e){out.push({uid:"ps-"+icsHash_(n+e.date+e.title),title:"["+n+"] "+e.title,date:e.date,endDate:e.endDate,time:e.time});});});
    (d.assigns || []).forEach(function (a) {
      if (!a.ojtDays) return; const set = a.ojtDays.split(","), co = (d.companies || []).filter(function (c) { return c.id === a.company; })[0];
      for (let s = today_(), i = 0; i < 366; i++, s = plusDate_(s, 1)) {
        if ((a.start && s < a.start) || (a.end && s > a.end)) continue;
        const dow = DOW_KO_[new Date(s + "T12:00:00+09:00").getUTCDay()];
        if (set.indexOf(dow) >= 0) out.push({ uid: "ojt-" + icsHash_(a.name+s), title: "OJT" + (co ? " · " + co.name : ""), date: s, time:a.ojtTime||"", place: co ? co.address : "" });
      }
    });
  }
  const seen={};
  const filtered=out.filter(function(e){if(isPublicHoliday_(e.title)||seen[e.uid])return false;seen[e.uid]=true;return true;});
  return ContentService.createTextOutput(icsCalendar_("도제반 · " + name, filtered)).setMimeType(ContentService.MimeType.ICAL);
}
function icsSingle_(q) {
  const ev = { title: clean_(q.t, 120) || "도제반 일정", date: clean_(q.d, 10), endDate: clean_(q.e, 10), time: clean_(q.tm, 30), place: clean_(q.p, 120), note: clean_(q.n, 500) };
  ev.uid = "one-" + icsHash_(ev.date + ev.title + ev.time);
  return ContentService.createTextOutput(icsCalendar_("도제반 알림판", [ev])).setMimeType(ContentService.MimeType.ICAL).downloadAsFile("dojeban-event.ics");
}

/* ===================== 자료실 ↔ 구글 드라이브 폴더 =====================
 * 설정의 '자료실 드라이브 폴더'에 파일을 넣기만 하면 자료실에 자동으로 보입니다 (10분마다 갱신, '새로고침'으로 즉시).
 * 폴더 구조
 *   자료실 폴더 / 파일                     → 전체 공개
 *   자료실 폴더 / 학습근로자|예비|예비2|예비1|전체 / 파일   → 그 대상에게만
 *   위 폴더 / 하위폴더 / 파일              → 하위폴더 이름이 '분류'
 *   그 밖의 이름의 폴더                   → 전체 공개 + 폴더 이름이 '분류'
 * 학생은 앱을 통해 내려받습니다 (구글 계정 불필요). 구글 문서·시트·슬라이드는 PDF로 변환됩니다. */
function materialTarget_(name) {
  const n = String(name).replace(/\s/g, "");
  if (/^(전체|공통|모두)$/.test(n)) return "all";
  if (/^(일반|일반학생)$/.test(n)) return "general";
  if (/^(학습근로자|도제|3학년)$/.test(n)) return "learner";
  if (/^(예비|예비전체)$/.test(n)) return "pre";
  if (/^(예비2|예비2학년|2학년)$/.test(n)) return "pre2";
  if (/^(예비1|예비1학년|1학년)$/.test(n)) return "pre1";
  return "";
}
function driveListAll_() {
  const cache = CacheService.getScriptCache(), hit = cache.get("dm_v1");
  if (hit) return JSON.parse(hit);
  const id = props_().MATERIAL_FOLDER; if (!id) return [];
  const out = []; let n = 0;
  const push = function (f, target, category) {
    if (studentPrivateFile_(f.getId())||n++ >= 300) return;
    out.push({ id: f.getId(), name: f.getName(), mime: f.getMimeType(), size: f.getSize(), updated: Utilities.formatDate(f.getLastUpdated(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), target: target, category: category });
  };
  const walk = function (folder, target, category, depth) {
    const fi = folder.getFiles(); while (fi.hasNext()) push(fi.next(), target, category);
    if (depth >= 2) return;
    const fo = folder.getFolders();
    while (fo.hasNext()) {
      const sub = fo.next(), t = materialTarget_(sub.getName());
      if (depth === 0 && t) walk(sub, t, "", 1);
      else walk(sub, target, category ? category + " / " + sub.getName() : sub.getName(), depth + 1);
    }
  };
  try { walk(DriveApp.getFolderById(id), "all", "", 0); } catch (e) { return [{ error: "자료실 Drive 폴더를 읽지 못했습니다: " + e.message }]; }
  out.sort(function (a, b) { return String(b.updated).localeCompare(String(a.updated)); });
  try { cache.put("dm_v1", JSON.stringify(out), 600); } catch (e) {}
  return out;
}
function driveMaterials_(me) {
  const all = driveListAll_();
  return all.filter(function(f){return !studentPrivateFile_(f.id)&&(me.role==="teacher"||f.error||matches_(f.target,me.group));});
}
function driveMaterialFile_(me, id) {
  denyStudentPrivateFile_(id);
  const f0 = driveMaterials_(me).filter(function (f) { return f.id === id; })[0];
  if (!f0) throw new Error("이 자료를 볼 권한이 없습니다");
  const file = DriveApp.getFileById(id);
  let blob, name = f0.name;
  if (/^application\/vnd\.google-apps\./.test(f0.mime)) { blob = file.getAs("application/pdf"); name = name + ".pdf"; }
  else { if (file.getSize() > MAX_DOWNLOAD_MB_ * 1024 * 1024) throw new Error("파일이 커서(" + MAX_DOWNLOAD_MB_ + "MB 초과) 앱에서 바로 내려받을 수 없습니다. 선생님께 링크 공유를 요청하세요"); blob = file.getBlob(); }
  const bytes = blob.getBytes();
  if (bytes.length > MAX_DOWNLOAD_MB_ * 1024 * 1024) throw new Error("파일이 커서(" + MAX_DOWNLOAD_MB_ + "MB 초과) 앱에서 바로 내려받을 수 없습니다. 선생님께 링크 공유를 요청하세요");
  return { name: name, mime: blob.getContentType(), base64: Utilities.base64Encode(bytes) };
}

/* ===================== 노션 =====================
 * 설정에 노션 통합 토큰과 노션 페이지(또는 데이터베이스) 주소를 넣으면, 그 아래 페이지 목록이 자료실에 보입니다.
 * 노션에서: 설정 → 연결(통합) 만들기 → 토큰 복사 → 해당 페이지 ··· → 연결 추가에서 그 통합 선택.
 * 노션 계정이 없는 학생도 보려면 각 페이지를 '웹에 게시'해 두세요. */

function notionPortfolioUrl_(value){
  const url=clean_(value,1000).trim();if(!url)return '';
  if(!new RegExp('^https://(?:www[.])?notion[.]so/','i').test(url)&&!new RegExp('^https://(?:[a-z0-9-]+[.])*notion[.]site/','i').test(url))throw new Error('노션 페이지의 https 주소를 넣어 주세요');
  return url;
}
function saveNotionPortfolio_(me,p){
  if(me.role!=='teacher'&&p.name&&p.name!==me.name)throw new Error('내 노션 포트폴리오만 수정할 수 있습니다');
  const name=me.role==='teacher'?p.name:me.name,url=notionPortfolioUrl_(p.url);
  return withLock_(function(){const st=student_(name),sh=sheet_('roster');sh.getRange(1,7).setValue('노션포트폴리오');sh.getRange(st.row,7).setValue(url);return true;});
}
/* ===================== Drive 폴더형 사진첩 ===================== */
function photoMime_(mime){return /^image\/(jpeg|png|gif|webp|heic|heif)$/.test(String(mime||""));}
function photoSetup_(p){return withLock_(function(){
 let id=driveFolderId_(p.url),folder;
 if(p.create===true){id=props_().PHOTO_ALBUM_FOLDER;folder=id?openSharedFolder_(id,"사진첩 Drive"):folderFor_(["사진첩"]);}
 else{if(!id)throw new Error("사진첩 Drive 폴더 주소를 넣어 주세요");folder=openSharedFolder_(id,"사진첩 Drive");}
 PropertiesService.getScriptProperties().setProperty("PHOTO_ALBUM_FOLDER",folder.getId());PROPS_=null;return {folder:folder.getId(),url:folder.getUrl()};
});}
function photoCreateAlbum_(me,p){return withLock_(function(){const r=driveRoot2_(me,"photos"),chain=drivePath_(me,r,p.folder),folder=childFolder_(chain[chain.length-1],required_(p.name,80));return {folder:folder.getId()};});}
function photoBrowse_(me,p){
 if(!props_().PHOTO_ALBUM_FOLDER)return {connected:false};
 const d=driveBrowse_(me,{root:"photos",folder:p.folder});
 const photos=d.files.filter(function(f){return photoMime_(f.mime);});
 return {connected:true,folder:d.folder,path:d.path,folders:d.folders,photos:photos,canUpload:d.canUpload,url:d.url,limited:d.files.length>=300||d.folders.length>=200};
}
function photoFile_(me,p){
 const r=driveRoot2_(me,"photos");let file;
 if(p.album){const chain=drivePath_(me,r,p.album),it=chain[chain.length-1].getFiles();let checked=0;while(it.hasNext()&&checked++<80){const f=it.next();if(!f.isTrashed()&&photoMime_(f.getMimeType())){file=f;break;}}if(!file)return null;}
 else{try{file=DriveApp.getFileById(String(p.id||""));}catch(e){throw new Error("사진을 찾을 수 없습니다");}}
 if(file.isTrashed()||!photoMime_(file.getMimeType()))throw new Error("사진 파일만 볼 수 있습니다");
 const parents=file.getParents();if(!parents.hasNext())throw new Error("사진첩 안의 사진만 볼 수 있습니다");drivePath_(me,r,parents.next().getId());return file;
}
function photoImage_(me,p){
 const file=photoFile_(me,p);if(!file)return {empty:true};
 let blob=null,original=false;
 if(p.original===true&&file.getSize()<=6*1024*1024){blob=file.getBlob();original=true;}
 else if(typeof file.getThumbnail==="function")blob=file.getThumbnail();
 if(!blob&&file.getSize()<=3*1024*1024){blob=file.getBlob();original=true;}
 if(!blob)throw new Error("Drive가 미리보기를 준비 중입니다. 잠시 후 새로고침하거나 원본을 받으세요");
 const mime=blob.getContentType(),bytes=blob.getBytes();if(!/^image\/(png|jpeg|gif|webp)$/.test(mime)||bytes.length>6*1024*1024)throw new Error("이 사진은 원본 받기로 확인해 주세요");
 return {id:file.getId(),name:file.getName(),mime:mime,base64:Utilities.base64Encode(bytes),original:original};
}
function photoUpload_(me,p){return withLock_(function(){
 const r=driveRoot2_(me,"photos"),chain=drivePath_(me,r,p.folder);if(!hasUpload_(p.upload))throw new Error("사진을 골라 주세요");
 const name=p.upload.staged?stagedFile_(me,p.upload).name:String(p.upload.name||""),mime=MIME_BY_EXT_[name.split(".").pop().toLowerCase()];
 if(!photoMime_(mime))throw new Error("사진 파일만 올릴 수 있습니다 (JPG·PNG·GIF·WEBP·HEIC)");
 return storeFile_(me,p.upload,"photos",chain[chain.length-1].getId(),chain[chain.length-1]);
});}

/* ===================== 페이지 안 Drive 탐색 =====================
 * 학생에게 공유한 Drive 폴더(자료실, 프로젝트 자료실)를 알림판 안에서 폴더째 보고, 올리고, 받습니다.
 * root: "materials" = 자료실 폴더(대상 폴더 규칙 적용), "project:<ID>" = 그 프로젝트 팀원·선생님만.
 * 학생 올리기: 자료실은 설정 MATERIAL_STUDENT_UPLOAD가 "0"이 아니면 허용(기본 허용), 프로젝트는 팀원 모두 허용. */
function driveRoot2_(me, root) {
  root = String(root || "");
  if(root==="photos"){const id=props_().PHOTO_ALBUM_FOLDER;if(!id)throw new Error("사진첩 Drive 폴더를 먼저 연결해 주세요");return {key:root,label:"사진첩",folder:openSharedFolder_(id,"사진첩 Drive"),upload:me.role==="teacher",targets:false};}
  if (root === "materials") {
    const id = props_().MATERIAL_FOLDER; if (!id) throw new Error("자료실 Drive 폴더가 아직 연결되지 않았습니다");
    return { key: root, label: "자료실", folder: openSharedFolder_(id, "자료실 Drive"), upload: me.role === "teacher" || props_().MATERIAL_STUDENT_UPLOAD !== "0", targets: true };
  }
  if(root.indexOf("cert:")===0){const cert=certification_(root.slice(5)),id=props_()["CERT_FOLDER_"+cert.id];if(!id)throw new Error("자격증 자료실이 아직 연결되지 않았습니다");return {key:root,label:cert.name+" 자료실",folder:openSharedFolder_(id,cert.name+" 자료실"),upload:me.role==="teacher",targets:false};}
  if(root.indexOf("company:")===0){const info=companyFolder_(me,root.slice(8));return {key:root,label:info.company.name+" 자료실",folder:info.folder,upload:me.role==="teacher",targets:false};}
  const m = root.match(/^project:([A-Za-z0-9_-]{1,40})$/);
  if (m) { const pr = project_(me, m[1]); return { key: root, label: pr.v[1] + " · " + pr.v[2], folder: withLock_(function () { return projectFolder_(pr); }), upload: true, targets: false }; }
  throw new Error("폴더를 확인해 주세요");
}
/* folderId가 root 안에 있는지 부모를 따라 올라가며 확인하고, root부터의 경로를 돌려줍니다. */
function drivePath_(me, r, folderId) {
  const rootId = r.folder.getId(); if (!folderId || folderId === rootId) return [r.folder];
  let f; try { f = DriveApp.getFolderById(String(folderId)); } catch (e) { throw new Error("폴더를 찾을 수 없습니다"); }
  const chain = [f];
  for (let i = 0; i < 12; i++) {
    const ps = chain[0].getParents(); if (!ps.hasNext()) break;
    const parent = ps.next(); if (parent.getId() === rootId) { chain.unshift(r.folder); break; } chain.unshift(parent);
  }
  if (chain[0].getId() !== rootId) throw new Error("이 폴더를 볼 권한이 없습니다");
  if (r.targets && me.role !== "teacher" && chain.length > 1) { const t = materialTarget_(chain[1].getName()); if (t && !matches_(t, me.group)) throw new Error("이 폴더를 볼 권한이 없습니다"); }
  return chain;
}
/** 알림판 밖(Drive에서 직접)에서 올린 파일의 올린 사람: Drive API 한 번으로 소유자/마지막 수정자 이름을 가져옵니다(5분 캐시). 배포 계정이면 '선생님'. 이메일은 화면에 보내지 않습니다. */
function driveUploaders_(folderId) {
  const cache = CacheService.getScriptCache(), key = "dwho_" + folderId, hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const out = {};
  try {
    let me = ""; try { me = String(Session.getEffectiveUser().getEmail() || "").toLowerCase(); } catch (e) {}
    let token = "", n = 0;
    do {
      const url = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000&fields=" + encodeURIComponent("nextPageToken,files(id,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress))") + "&q=" + encodeURIComponent("'" + folderId + "' in parents and trashed=false") + (token ? "&pageToken=" + encodeURIComponent(token) : "");
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } });
      if (res.getResponseCode() !== 200) break;
      const j = JSON.parse(res.getContentText());
      (j.files || []).forEach(function (f) { const u = (f.owners && f.owners[0]) || f.lastModifyingUser; if (!u) return; out[f.id] = me && String(u.emailAddress || "").toLowerCase() === me ? "선생님" : String(u.displayName || "").slice(0, 40); });
      token = j.nextPageToken || "";
    } while (token && ++n < 3);
  } catch (e) {}
  try { cache.put(key, JSON.stringify(out), 300); } catch (e) {}
  return out;
}
function driveWho_(desc) { const m = String(desc || "").match(/올린 사람: ([^·]+)/); return m ? m[1].trim() : ""; }
function driveBrowse_(me, p) {
  const r = driveRoot2_(me, p.root), chain = drivePath_(me, r, p.folder), cur = chain[chain.length - 1], T = me.role === "teacher";
  const folders = [], files = [];
  const fo = cur.getFolders(); while (fo.hasNext() && folders.length < 200) { const f = fo.next(); if (f.isTrashed()) continue;
    if (r.targets && chain.length === 1) { const t = materialTarget_(f.getName()); if (t && !T && !matches_(t, me.group)) continue; folders.push({ id: f.getId(), name: f.getName(), target: t }); }
    else folders.push({ id: f.getId(), name: f.getName() }); }
  const fi = cur.getFiles(); while (fi.hasNext() && files.length < 300) { const f = fi.next(); if (f.isTrashed()||studentPrivateFile_(f.getId())) continue;
    files.push({ id: f.getId(), name: f.getName(), mime: f.getMimeType(), size: f.getSize(), updated: Utilities.formatDate(f.getLastUpdated(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), by: driveWho_(f.getDescription()) }); }
  if (files.some(function (f) { return !f.by; })) { const who = driveUploaders_(cur.getId()); files.forEach(function (f) { if (!f.by && who[f.id]) f.by = who[f.id]; }); }
  folders.sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); });
  files.sort(function (a, b) { return String(b.updated).localeCompare(String(a.updated)); });
  return { root: r.key, label: r.label, folder: cur.getId(), path: chain.map(function (f, i) { return { id: f.getId(), name: i ? f.getName() : r.label }; }), folders: folders, files: files, canUpload: r.upload, studentUpload: r.key === "materials" ? props_().MATERIAL_STUDENT_UPLOAD !== "0" : true, url: T ? cur.getUrl() : "" };
}
function driveUpload_(me, p) {
  const r = driveRoot2_(me, p.root); if (!r.upload) throw new Error("이 폴더에는 선생님만 올릴 수 있습니다");
  const chain = drivePath_(me, r, p.folder), cur = chain[chain.length - 1];
  if (!hasUpload_(p.upload)) throw new Error("올릴 파일을 골라 주세요");
  CacheService.getScriptCache().remove("dwho_" + cur.getId());
  const id = withLock_(function () { return storeFile_(me, p.upload, r.key === "materials" ? "drive" : r.key.indexOf("cert:")===0 ? "cert" : r.key.indexOf("company:")===0 ? "company" : "project", r.key === "materials" ? "" : r.key.indexOf("cert:")===0 ? r.key.slice(5) : r.key.slice(8), cur); });
  CacheService.getScriptCache().remove("dm_v1"); return id;
}
const DL_CHUNK_ = 4 * 1024 * 1024;
function driveDownload_(me, p) {
  denyStudentPrivateFile_(p.id);
  const id = String(p.id || ""), cache = CacheService.getScriptCache(), ok = "dl_" + me.name + "_" + String(p.root||"") + "_" + id;
  if(p.root){const r=driveRoot2_(me,p.root),f=DriveApp.getFileById(id),parents=f.getParents();if(!parents.hasNext())throw new Error("이 파일을 받을 권한이 없습니다");drivePath_(me,r,parents.next().getId());}
  let info = cache.get(ok); info = info ? JSON.parse(info) : null;
  if (!info) {
    const r = driveRoot2_(me, p.root); let f; try { f = DriveApp.getFileById(id); } catch (e) { throw new Error("파일을 찾을 수 없습니다"); }
    const ps = f.getParents(); if (!ps.hasNext()) throw new Error("이 파일을 받을 권한이 없습니다");
    drivePath_(me, r, ps.next().getId());
    info = { name: f.getName(), mime: f.getMimeType(), size: f.getSize() }; cache.put(ok, JSON.stringify(info), 3600);
  }
  return driveFilePart_(id,info,p.offset);
}
function driveFilePart_(id,info,offset){
  denyStudentPrivateFile_(id);
  if (/^application\/vnd\.google-apps\./.test(info.mime)) {
    const b = DriveApp.getFileById(id).getAs("application/pdf"), bytes = b.getBytes();
    if (bytes.length > MAX_DOWNLOAD_MB_ * 1024 * 1024) throw new Error("문서가 너무 커서 PDF로 바꿀 수 없습니다");
    return { name: info.name + ".pdf", mime: "application/pdf", size: bytes.length, base64: Utilities.base64Encode(bytes), done: true };
  }
  const off = Number(offset) || 0; if (off < 0 || off >= Math.max(1, info.size)) throw new Error("받기 위치가 맞지 않습니다");
  if (!info.size) return { name: info.name, mime: info.mime, size: 0, base64: "", done: true };
  const end = Math.min(info.size, off + DL_CHUNK_) - 1;
  const res = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media&supportsAllDrives=true", { muteHttpExceptions: true, headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), Range: "bytes=" + off + "-" + end } });
  const code = res.getResponseCode(); if (code !== 206 && code !== 200) throw new Error("파일을 받지 못했습니다 (" + code + ")");
  const bytes = res.getContent(), part = code === 200 ? bytes.slice(off, end + 1) : bytes;
  return { name: info.name, mime: info.mime, size: info.size, base64: Utilities.base64Encode(part), done: end + 1 >= info.size };
}
function saveMaterialsFolder_(p){
  const id=driveFolderId_(p.url);if(!id)throw new Error('자료실 Drive 폴더 주소를 넣어 주세요');
  openSharedFolder_(id,'자료실 Drive');
  PropertiesService.getScriptProperties().setProperty('MATERIAL_FOLDER',id);PROPS_=null;CacheService.getScriptCache().remove('dm_v1');return true;
}
function uploadDriveMaterial_(me,p){
  const target=targetValid_(p.target||'all');
  if(!hasUpload_(p.upload))throw new Error('올릴 파일을 선택해 주세요');
  return withLock_(function(){
    const folder=materialStorageFolder_(target);
    const file=storeFile_(me,p.upload,'drive','',folder);PROPS_=null;CacheService.getScriptCache().remove('dm_v1');return file;
  });
}

function notionId_(s) {
  s = clean_(s, 500).trim(); if (!s) return "";
  const m = s.replace(/-/g, "").match(/([0-9a-f]{32})(?:\?|$|#)/i) || s.replace(/-/g, "").match(/([0-9a-f]{32})/i);
  if (!m) throw new Error("노션 페이지 주소를 확인해 주세요");
  return m[1].toLowerCase();
}
function notionFetch_(path, method, body) {
  const r = UrlFetchApp.fetch("https://api.notion.com/v1/" + path, { method: method || "get", contentType: "application/json", payload: body ? JSON.stringify(body) : undefined, muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + props_().NOTION_TOKEN, "Notion-Version": "2022-06-28" } });
  const code = r.getResponseCode(), j = JSON.parse(r.getContentText() || "{}");
  if (code >= 300) throw new Error((j && j.message) || ("노션 응답 " + code));
  return j;
}
function notionTitle_(page) {
  const props = page.properties || {};
  for (const k in props) if (props[k].type === "title") return (props[k].title || []).map(function (t) { return t.plain_text; }).join("") || "제목 없음";
  return "제목 없음";
}
function notionPages_() {
  const pp = props_(); if (!pp.NOTION_TOKEN || !pp.NOTION_ROOT) return [];
  const cache = CacheService.getScriptCache(), hit = cache.get("nt_v1");
  if (hit) return JSON.parse(hit);
  const out = [];
  try {
    let isDb = false;
    try { notionFetch_("databases/" + pp.NOTION_ROOT); isDb = true; } catch (e) {}
    if (isDb) {
      const q = notionFetch_("databases/" + pp.NOTION_ROOT + "/query", "post", { page_size: 100, sorts: [{ timestamp: "last_edited_time", direction: "descending" }] });
      (q.results || []).forEach(function (pg) { out.push({ title: notionTitle_(pg), url: pg.public_url || pg.url, edited: String(pg.last_edited_time || "").slice(0, 10), icon: pg.icon && pg.icon.emoji || "" }); });
    } else {
      const root = notionFetch_("pages/" + pp.NOTION_ROOT);
      out.push({ title: notionTitle_(root) + " (메인)", url: root.public_url || root.url, edited: String(root.last_edited_time || "").slice(0, 10), icon: root.icon && root.icon.emoji || "" });
      const ch = notionFetch_("blocks/" + pp.NOTION_ROOT + "/children?page_size=100");
      (ch.results || []).forEach(function (b) {
        if (b.type === "child_page") out.push({ title: b.child_page.title || "제목 없음", url: "https://www.notion.so/" + b.id.replace(/-/g, ""), edited: String(b.last_edited_time || "").slice(0, 10), icon: "" });
        if (b.type === "child_database") out.push({ title: (b.child_database.title || "데이터베이스") + " (표)", url: "https://www.notion.so/" + b.id.replace(/-/g, ""), edited: String(b.last_edited_time || "").slice(0, 10), icon: "" });
      });
    }
  } catch (e) { return [{ error: "노션을 읽지 못했습니다: " + e.message }]; }
  try { cache.put("nt_v1", JSON.stringify(out), 600); } catch (e) {}
  return out;
}

/* ===================== 시간표·급식 (NEIS 교육정보 개방 포털) =====================
 * 급식: 인증키 없이도 됩니다(한 번에 5건). 시간표: 반별로 7교시라 NEIS 인증키가 필요합니다(open.neis.go.kr 무료 발급).
 * 학생 시간표는 명단의 '학년반'(예: 2-3)을 학교의 실제 학년-반으로 보고 가져옵니다.
 * 시간표 변경은 컴시간알리미가 더 빠르므로 화면에 바로가기 버튼을 둡니다. */
const NEIS_OFFICE_ = "J10", NEIS_SCHOOL_ = "7531382";   // 경기도교육청 · 경기항공고등학교
const COMCI_URL_ = "http://xn--s39aj90b0nb2xw6xh.kr/";
const MEAL_URL_ = "https://gahs-h.goegm.kr/gahs-h/ad/fm/foodmenu/selectFoodMenuView.do?mi=5740";
function neis_(service, params, ttl) {
  const key = props_().NEIS_KEY || "";
  const q = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
  const ck = "neis:" + service + ":" + icsHash_(q + key);
  const cache = CacheService.getScriptCache(), hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  const url = "https://open.neis.go.kr/hub/" + service + "?Type=json&pIndex=1&pSize=" + (key ? 1000 : 5) + "&ATPT_OFCDC_SC_CODE=" + NEIS_OFFICE_ + "&SD_SCHUL_CODE=" + NEIS_SCHOOL_ + (key ? "&KEY=" + key : "") + "&" + q;
  let rows = [];
  try {
    const j = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText() || "{}");
    const body = j[service];
    if (body) rows = (body[1] && body[1].row) || [];
    else if (j.RESULT && j.RESULT.CODE !== "INFO-200") throw new Error(j.RESULT.MESSAGE);
  } catch (e) { return { error: "NEIS 연결 오류: " + e.message }; }
  try { cache.put(ck, JSON.stringify(rows), ttl || 3600); } catch (e) {}
  return rows;
}
function ymd8_(s) { return String(s).replace(/-/g, ""); }
function meals_(from, to) {
  const rows = neis_("mealServiceDietInfo", { MLSV_FROM_YMD: ymd8_(from), MLSV_TO_YMD: ymd8_(to) }, 3 * 3600);
  if (rows.error) return [{ error: rows.error }];
  return rows.map(function (r) {
    const d = String(r.MLSV_YMD);
    return { date: d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8), kind: r.MMEAL_SC_NM, cal: r.CAL_INFO,
      dishes: String(r.DDISH_NM || "").split(/<br\s*\/?>/i).map(function (x) { return x.replace(/\s*\([\d.]+\)\s*/g, "").replace(/\*/g, "").trim(); }).filter(String),
      allergy: String(r.DDISH_NM || "").split(/<br\s*\/?>/i).map(function (x) { const m = x.match(/\(([\d.]+)\)/); return m ? m[1] : ""; }) };
  });
}
function timetable_(me, p) {
  let grade = p.grade, cls = p.cls;
  if (me.role !== "teacher" && me.role !== "guest") { const m = String(me.klass || "").match(/(\d)\D+(\d+)/); if (!m) return { error: "명단의 학년반이 비어 있어 시간표를 찾을 수 없습니다. 선생님께 ‘2-3’처럼 등록해 달라고 하세요." }; grade = m[1]; cls = m[2]; }
  grade = String(grade || "").replace(/\D/g, ""); cls = String(cls || "").replace(/\D/g, "");
  if (!grade || !cls) return { error: "학년과 반을 고르세요" };
  const from = dateValid_(p.from);
  let r;
  try { r = comciTimetable_(Number(grade), Number(cls), from); } catch (e) { r = { error: "컴시간알리미 연결 오류: " + e.message }; }
  if (!r.error) return r;
  if (props_().NEIS_KEY) { const n = neisTimetable_(me, { grade: grade, cls: cls, from: from }); if (!n.error) { n.source = "나이스"; n.note = r.error; return n; } }
  r.grade = grade; r.cls = cls; return r;
}
function neisTimetable_(me, p) {
  let grade = p.grade, cls = p.cls;
  if (me.role !== "teacher" && me.role !== "guest") { const m = String(me.klass || "").match(/(\d)\D+(\d+)/); if (!m) return { error: "명단의 학년반이 비어 있어 시간표를 찾을 수 없습니다. 선생님께 ‘2-3’처럼 등록해 달라고 하세요." }; grade = m[1]; cls = m[2]; }
  grade = String(grade || "").replace(/\D/g, ""); cls = String(cls || "").replace(/\D/g, "");
  if (!grade || !cls) return { error: "학년과 반을 고르세요" };
  if (!props_().NEIS_KEY) return { error: "시간표를 보려면 설정에서 NEIS 인증키를 넣어야 합니다 (open.neis.go.kr 무료 발급).", grade: grade, cls: cls };
  const from = dateValid_(p.from), to = plusDate_(from, 6);
  const rows = neis_("hisTimetable", { GRADE: grade, CLASS_NM: cls, TI_FROM_YMD: ymd8_(from), TI_TO_YMD: ymd8_(to) }, 1800);
  if (rows.error) return { error: rows.error, grade: grade, cls: cls };
  const days = {};
  rows.forEach(function (r) { const d = String(r.ALL_TI_YMD), k = d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8); (days[k] = days[k] || [])[Number(r.PERIO) - 1] = String(r.ITRT_CNTNT || "").replace(/^-/, ""); });
  return { grade: grade, cls: cls, from: from, days: days, dept: rows[0] ? rows[0].DDDEP_NM : "" };
}

/* ===================== 컴시간알리미 실시간 시간표 =====================
 * 컴시간알리미 웹(컴시간학생.kr)이 쓰는 자료를 그대로 읽습니다. 교사가 컴시간에서 바꾼 시간표가
 * 몇 분 안에 반영됩니다(5분 캐시). 컴시간은 이번 주와 다음 주만 제공합니다.
 * 컴시간 페이지 구조가 바뀌면 이 부분만 고치면 되고, 그동안은 NEIS 인증키가 있으면 나이스 시간표로 대신합니다. */
const COMCI_SCHOOL_ = 76823;                 // 컴시간 학교코드 (경기항공고등학교)
const COMCI_HOST_ = "http://comci.net:4082";
function comciCfg_() {
  const cache = CacheService.getScriptCache(), hit = cache.get("cc_cfg2");
  if (hit) return JSON.parse(hit);
  let cfg = { base: COMCI_HOST_, path: "36179", prefix: "73629_", tail: "1" };
  try {
    const top = UrlFetchApp.fetch(COMCI_URL_, { muteHttpExceptions: true }).getContentText("EUC-KR");
    const fr = (top.match(/<frame[^>]*src=['"]([^'"]+)['"]/i) || [])[1] || (COMCI_HOST_ + "/st");
    const page = UrlFetchApp.fetch(fr, { muteHttpExceptions: true }).getContentText("EUC-KR");
    const ra = page.match(/school_ra\(sc\)\s*\{\s*\$\.ajax\(\{\s*url:\s*'\.\/(\d+)\?/), sc = page.match(/sc_data\('([^']*)'\s*,\s*sc\s*,\s*'?(\d+)/);
    const base = (fr.match(/^https?:\/\/[^\/]+/) || [])[0];
    if (ra && sc && base) cfg = { base: base, path: ra[1], prefix: sc[1], tail: sc[2] };
  } catch (e) {}
  try { cache.put("cc_cfg2", JSON.stringify(cfg), 6 * 3600); } catch (e) {}
  return cfg;
}
function comciData_(week) {
  const c = comciCfg_();
  const url = c.base + "/" + c.path + "?" + Utilities.base64Encode(c.prefix + COMCI_SCHOOL_ + "_0_" + (week || 1));
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("응답 " + res.getResponseCode());
  let t = res.getContentText("UTF-8"); t = t.slice(0, t.lastIndexOf("}") + 1);
  return JSON.parse(t);
}
function comciName_(n) { n = String(n || ""); return (n.indexOf("*") > 0 && n.slice(-1) !== "*") || (n.length === 2 && n.charAt(1) === "*") ? n : n.replace("*", ""); }
function comciTimetable_(grade, cls, from) {
  const cache = CacheService.getScriptCache(), ck = "cc_tt:" + grade + "-" + cls + ":" + from, hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  let j = comciData_(1);
  const weeks = (j["일자자료"] || []).map(function (w) { const m = String(w[1]).match(/(\d\d)-(\d\d)-(\d\d)/); return { n: w[0], start: m ? "20" + m[1] + "-" + m[2] + "-" + m[3] : "", label: w[1] }; });
  if (j["시작일"] !== from) {
    const w = weeks.filter(function (x) { return x.start === from; })[0];
    if (!w) return { error: "컴시간알리미에는 " + weeks.map(function (x) { return x.label; }).join(", ") + " 시간표만 있습니다.", weeks: weeks.map(function (x) { return x.start; }) };
    j = comciData_(w.n);
    if (j["시작일"] !== from) return { error: "컴시간알리미에서 이 주 시간표를 찾지 못했습니다." };
  }
  const now = j["자료147"], org = j["자료481"], subj = j["자료492"] || [], tch = j["자료446"] || [], div = Number(j["분리"]) || 100;
  if (!now || !now[grade] || !now[grade][cls]) return { error: grade + "학년 " + cls + "반은 컴시간알리미에 없습니다." };
  const days = {};
  for (let d = 1; d <= 5; d++) {
    const date = plusDate_(from, d - 1), a = now[grade][cls][d] || [0], o = (org && org[grade] && org[grade][cls] && org[grade][cls][d]) || [], list = [];
    for (let k = 1; k <= 8; k++) {
      const v = a[k]; if (v === undefined || v === null) continue;
      const s = String(v), num = Number(s.replace(/^>/, "")) || 0;
      if (!num) { list[k - 1] = ""; continue; }
      const th = num % 1000, sb = Math.floor(num / 1000);
      const changed = Number(j["변경알림"]) === 1 ? s.charAt(0) === ">" : String(o[k]) !== s;
      list[k - 1] = { s: String(subj[sb % div] || ""), t: comciName_(tch[th]), ch: changed };
    }
    days[date] = list;
  }
  const out = { grade: String(grade), cls: String(cls), from: from, days: days, times: j["일과시간"] || [], classes: j["학급수"] || [], updated: j["자료244"] || "", source: "컴시간알리미", weeks: weeks.map(function (x) { return x.start; }) };
  try { cache.put(ck, JSON.stringify(out), 300); } catch (e) {}
  return out;
}

/* ===================== Drive 폴더 접근 신청 =====================
 * 학생이 자기 구글 계정(이메일)으로 자료실·프로젝트 자료실 폴더를 열 수 있게 신청하고, 선생님이 승인하면 공유됩니다.
 * 다른 사람 이메일로 잘못 공유되는 일을 막기 위해 자동 공유하지 않고 선생님 승인을 거칩니다. */
APP_TABS.folderReq = {name:"앱_폴더신청",head:["ID","시각","이름","이메일","대상","상태","처리시각","메모"]};
function folderTarget_(target) {
  target = String(target || "");
  if (target === "materials") {
    const id = props_().MATERIAL_FOLDER; if (!id) throw new Error("자료실 Drive 폴더가 아직 연결되지 않았습니다");
    return { label: "자료실", folder: function () { return DriveApp.getFolderById(id); }, role: "viewer" };
  }
  if(target.indexOf("cert:")===0){const cert=certification_(target.slice(5)),id=props_()["CERT_FOLDER_"+cert.id];if(!id)throw new Error("자격증 자료실이 아직 연결되지 않았습니다");return {label:cert.name+" 자료실",folder:function(){return DriveApp.getFolderById(id);},role:"viewer"};}
  if(target.indexOf("company:")===0){const info=companyFolder_({role:"student"},target.slice(8));return {label:info.company.name+" 자료실",folder:function(){return info.folder;},role:"viewer"};}
  const m = target.match(/^team:(.+)$/); if (!m) throw new Error("신청할 폴더를 골라 주세요");
  const pr = record_("projects", m[1]); let members = []; try { members = JSON.parse(pr.v[3] || "[]"); } catch (e) {}
  return { label: "프로젝트 자료실 · " + pr.v[1], members: members, folder: function () { return projectFolder_(pr); }, role: "editor" };
}
function requestFolderAccess_(me, p) {
  if (me.role === "teacher") throw new Error("학생 계정에서 신청하는 기능입니다");
  const email = emailValid_(p.email); if (!email) throw new Error("내 구글 계정 이메일을 넣어 주세요");
  const target = String(p.target || ""), info = folderTarget_(target);
  if (info.members && info.members.indexOf(me.name) < 0) throw new Error("내 프로젝트의 자료실만 신청할 수 있습니다");
  return withLock_(function () {
    const dup = rows_("folderReq").some(function (x) { return x.v[2] === me.name && x.v[4] === target && x.v[3].toLowerCase() === email.toLowerCase() && (x.v[5] === "대기" || x.v[5] === "완료"); });
    if (dup) throw new Error("이미 신청했거나 공유된 폴더입니다");
    append_("folderReq", [uid_("fq"), now_(), me.name, email, target, "대기", "", clean_(p.note, 200)]);
    const c = rows_("contacts").find(function (x) { return x.v[0] === me.name; });
    if (!c) append_("contacts", [me.name, email, "0"]); else if (!c.v[1]) sheet_("contacts").getRange(c._row, 2).setValue(email);
    return true;
  });
}
function decideFolderAccess_(p) {
  return withLock_(function () {
    const r = record_("folderReq", p.id); if (r.v[5] !== "대기" && r.v[5] !== "실패") throw new Error("이미 처리한 신청입니다");
    let status = "거절", memo = r.v[7];
    if (p.approve === true) {
      try { const info = folderTarget_(r.v[4]), f = info.folder(); if (info.role === "editor") f.addEditor(r.v[3]); else f.addViewer(r.v[3]); status = "완료"; }
      catch (e) { status = "실패"; memo = "공유 실패: " + String(e.message || e).slice(0, 150); }
    }
    writeCells_(sheet_("folderReq"), r._row, [r.v[0], r.v[1], r.v[2], r.v[3], r.v[4], status, now_(), memo]);
    if (status === "실패") throw new Error(memo + " (폴더가 앱 계정 소유이거나 앱 계정에 편집 권한이 있는지, 공유 드라이브라면 외부 공유가 허용되는지 확인해 주세요)");
    return true;
  });
}
function folderRequests_(me, T) {
  const teams = {}; rows_("projects").forEach(function (x) { teams[x.v[0]] = x.v[1] + " · " + x.v[2]; });
  return rows_("folderReq").filter(function (x) { return T || x.v[2] === me.name; }).map(function (x) {
    const v = x.v, m = String(v[4]).match(/^team:(.+)$/);
    return { id: v[0], at: v[1], name: v[2], email: v[3], target: v[4], label: String(v[4]).indexOf("company:")===0 ? "기업 자료실" : v[4] === "materials" ? "자료실" : String(v[4]).indexOf("cert:")===0 ? ((CERTIFICATIONS_.find(function(c){return "cert:"+c.id===v[4];})||{}).name||"자격증")+" 자료실" : "프로젝트 자료실 · " + (m && teams[m[1]] || "삭제된 팀"), status: v[5], doneAt: v[6], note: v[7] };
  }).reverse().slice(0, 100);
}

/* ===================== 최근 업데이트 표시 =====================
 * 공지·게시판·익명게시판·자료실의 가장 최근 글 시각과 앱 배포 시각 중 늦은 것을 화면 머리에 작게 보여 줍니다. */
function lastUpdate_() {
  let best = { at: "", what: "" };
  const take = function (at, what) { at = String(at || "").trim().slice(0, 16); if (/^\d{4}-\d{2}-\d{2}/.test(at) && at > best.at) best = { at: at, what: what }; };
  const scan = function (key, col, what, skip) { if (!APP_TABS[key]) return; rows_(key).forEach(function (x) { if (skip && skip(x.v)) return; take(x.v[col], what); }); };
  scan("notices", 1, "새 공지");
  scan("noticeMeta",10,"공지·전달 자료");
  scan("certSchedule",9,"자격증 일정");
  scan("board", 10, "프로젝트 게시판", function (v) { return v[12] === "1"; });
  scan("board", 11, "프로젝트 게시판", function (v) { return v[12] === "1"; });
  scan("boardComments", 4, "게시판 댓글", function (v) { return v[5] === "1"; });
  scan("anon", 1, "익명게시판", function (v) { return v[5] === "1"; });
  scan("anonCmt", 2, "익명게시판 댓글", function (v) { return v[5] === "1"; });
  scan("materials", 7, "자료실");
  take(APP_UPDATED_, "앱 업데이트");
  return best;
}

/* ===================== 기업정보 (메뉴) =====================
 * 모든 학생: 공개로 둔 기업의 업종·주요업무·소개·주소·홈페이지와 배정 인원 수.
 * 기업현장교사·연락처·이메일·메모는 선생님과 그 기업에 배정된 학습근로자만 봅니다(trainLoad_). */
/* 기업 안내는 별도 Google Sheets에서 읽고, 자기소개는 기존 운영 시트에 비공개로 저장합니다. */
APP_TABS.experienceIntro={name:"앱_직무체험소개",head:["ID","이름","기업ID","상태","자기소개JSON","수정시각","교사의견"]};
STUDENT_NAME_COLS_.experienceIntro=[1];
const COMPANY_PUBLIC_FIELDS_={industry:"업종",products:"주요제품",intro:"기업소개",homepage:"홈페이지",address:"실제근무지",department:"담당부서",contactDesk:"공개연락창구",workHours:"출퇴근시간",breaks:"휴게시간",clothes:"복장",meals:"식사",transportSupport:"기숙사통근버스",commute:"교통안내",firstDay:"첫출근집결",preparation:"준비물",documents:"제출서류",safety:"안전교육",equipment:"보호구",payGuide:"급여수당안내",folderUrl:"자료폴더",checkedAt:"최종확인일"};
const INTRO_FIELDS_={jobInterest:"관심 직무",headline:"나를 소개하는 한 문장",motivation:"관심을 갖게 된 이유",strength:"나의 강점과 근거",experience:"프로젝트 및 실습 경험",skills:"배운 기술과 자격증",teamSafety:"협업 및 안전 태도",goals:"직무체험에서 배우고 싶은 것",portfolio:"포트폴리오 링크"};
var COMPANY_SOURCE_=null;
function companySheetId_(value){const s=clean_(value,1000).trim();if(!s)return "";const m=s.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{15,})/)||s.match(/^([A-Za-z0-9_-]{15,})$/);if(!m)throw new Error("구글 시트 주소를 확인해 주세요");return m[1];}
function companyResources_(me){const p=props_(),out={companyTemplate:p.COMPANY_REQUEST_TEMPLATE||"",introTemplate:p.EXPERIENCE_INTRO_TEMPLATE||""};if(me.role==="teacher"){out.sheetUrl=p.COMPANY_INFO_SHEET?"https://docs.google.com/spreadsheets/d/"+p.COMPANY_INFO_SHEET+"/edit":"";out.appAccount=appAccount_();}return out;}
function companyRows_(book,title,required){const sh=book.getSheetByName(title);if(!sh)throw new Error(title+" 탭이 없습니다");const v=sh.getDataRange().getDisplayValues(),head=v[0]||[];required.forEach(function(k){if(head.indexOf(k)<0)throw new Error(title+" 탭의 "+k+" 열을 확인해 주세요");});return v.slice(1).filter(function(r){return r.some(function(x){return String(x).trim();});}).map(function(r){const o={};head.forEach(function(k,i){o[k]=clean_(r[i],3000).trim();});return o;});}
/* 첫 화면은 기업의 공개 판정·이름과 일정만 읽습니다. 직무/자기소개/연락처는 읽지 않습니다. */
function companyHomeSource_(){
 const id=props_().COMPANY_INFO_SHEET;if(!id)return {companies:[],events:[]};
 const cache=CacheService.getScriptCache(),saved=cache.get("company_home_v1");if(saved)try{const x=JSON.parse(saved);if(x.id===id)return x.data;}catch(ignore){}
 try{
  let companies,events;
  const parse=function(values,required){const head=values[0]||[];required.forEach(function(k){if(head.indexOf(k)<0)throw Error(k+" 열이 없습니다");});return values.slice(1).map(function(r){const o={};head.forEach(function(k,i){o[k]=clean_(r[i],3000).trim();});return o;});};
  try{const batch=Sheets.Spreadsheets.Values.batchGet(id,{ranges:["'기업정보'","'기업일정'"],valueRenderOption:"FORMATTED_VALUE",majorDimension:"ROWS"});const tables=batch.valueRanges||[];companies=parse((tables[0]||{}).values||[],["기업ID","기업명","학생공개"]);events=parse((tables[1]||{}).values||[],["일정ID","기업ID","학생공개","제목","시작일"]);}
  catch(ignore){const book=SpreadsheetApp.openById(id);companies=companyRows_(book,"기업정보",["기업ID","기업명","학생공개"]);events=companyRows_(book,"기업일정",["일정ID","기업ID","학생공개","제목","시작일"]);}
  companies=companies.filter(function(r){return r["기업ID"]&&r["기업명"];}).map(function(r){return {id:r["기업ID"],name:r["기업명"],open:r["학생공개"]==="1"};});
  const seen={};companies.forEach(function(c){if(seen[c.id])throw Error("기업ID가 중복되어 있습니다");seen[c.id]=true;});
  events=events.filter(function(r){return r["일정ID"]&&r["기업ID"]&&r["제목"];}).map(function(r){try{const date=dateValid_(r["시작일"]),end=dateValid_(r["종료일"],true);if(end&&end<date)return null;return {id:"company-"+r["일정ID"],key:"company:"+r["일정ID"],uid:"company-"+r["일정ID"],company:r["기업ID"],open:r["학생공개"]==="1",title:r["제목"],date:date,endDate:end,place:r["장소"],note:r["안내"],link:r["링크"]};}catch(ignore){return null;}}).filter(Boolean);
  const data={companies:companies,events:events};try{const text=JSON.stringify({id:id,data:data});if(Utilities.newBlob(text).getBytes().length<95000)cache.put("company_home_v1",text,60);}catch(ignore){}return data;
 }catch(e){return {companies:[],events:[],error:String(e.message||e)};}
}
function companySource_(){
 if(COMPANY_SOURCE_)return COMPANY_SOURCE_;
 const id=props_().COMPANY_INFO_SHEET;if(!id)return COMPANY_SOURCE_={companies:[],jobs:[],events:[]};
 const cache=CacheService.getScriptCache(),saved=cache.get("company_source_v1");if(saved){try{const x=JSON.parse(saved);if(x.id===id)return COMPANY_SOURCE_=x.data;}catch(ignore){}}
 try{const book=SpreadsheetApp.openById(id),seen={};const companies=companyRows_(book,"기업정보",["기업ID","기업명","학생공개"]).filter(function(r){return r["기업ID"]&&r["기업명"];}).map(function(r){const key=r["기업ID"];if(seen[key])throw new Error("기업ID가 중복되어 있습니다");seen[key]=true;const c={id:key,name:r["기업명"],open:r["학생공개"]==="1"};Object.keys(COMPANY_PUBLIC_FIELDS_).forEach(function(k){c[k]=r[COMPANY_PUBLIC_FIELDS_[k]]||"";});["homepage","folderUrl"].forEach(function(k){try{c[k]=urlValid_(c[k]);}catch(ignore){c[k]="";}});return c;});
 const jobs=companyRows_(book,"기업직무",["직무ID","기업ID","직무명","학생공개"]).filter(function(r){return r["직무ID"]&&r["기업ID"];}).map(function(r){return {id:r["직무ID"],company:r["기업ID"],name:r["직무명"],open:r["학생공개"]==="1",work:r["주요업무"],skills:r["배우는기술"],tools:r["장비프로그램"],certs:r["관련자격증"],basics:r["필요기초역량"],experience:r["직무체험내용"],period:r["체험가능시기"],capacity:r["수용인원"],preparation:r["준비사항"],folderUrl:r["자료폴더"]};});
 const events=companyRows_(book,"기업일정",["일정ID","기업ID","학생공개","제목","시작일"]).filter(function(r){return r["일정ID"]&&r["기업ID"]&&r["제목"];}).map(function(r){try{const date=dateValid_(r["시작일"]),end=dateValid_(r["종료일"],true);if(end&&end<date)return null;return {id:"company-"+r["일정ID"],key:"company:"+r["일정ID"],uid:"company-"+r["일정ID"],company:r["기업ID"],open:r["학생공개"]==="1",title:r["제목"],date:date,endDate:end,place:r["장소"],note:r["안내"],link:r["링크"]};}catch(ignore){return null;}}).filter(Boolean);
 const data={companies:companies,jobs:jobs,events:events};try{cache.put("company_source_v1",JSON.stringify({id:id,data:data}),60);}catch(ignore){}return COMPANY_SOURCE_=data;
 }catch(e){return COMPANY_SOURCE_={companies:[],jobs:[],events:[],error:String(e.message||e)};}
}
function companyInfo_(me){
 const T=me.role==="teacher",count={},out={};rows_("assign").forEach(function(x){if(x.v[0]&&x.v[1])count[x.v[1]]=(count[x.v[1]]||0)+1;});
 rows_("companies").forEach(function(x){const v=x.v;if(v[0])out[v[0]]={id:v[0],name:v[1],address:v[2],industry:v[7]||"",jobs:v[8]||"",intro:v[9]||"",homepage:v[10]||"",open:v[11]!=="0",learners:count[v[0]]||0};});
 const source=companySource_();if(source.error&&!T)return [];
 source.companies.forEach(function(c){out[c.id]=Object.assign({},out[c.id]||{},c,{learners:count[c.id]||0,fromSource:true});});
 return Object.keys(out).map(function(k){const c=out[k];if(!c.folderUrl&&!c.fromSource&&props_()["COMPANY_FOLDER_"+c.id])c.folderUrl="https://drive.google.com/drive/folders/"+props_()["COMPANY_FOLDER_"+c.id];return c;}).filter(function(c){return T||c.open;});
}
function companyLoad_(me){const info=companyInfo_(me),ids={};info.forEach(function(c){ids[c.id]=c;});const source=companySource_(),T=me.role==="teacher";return {companyResources:companyResources_(me),companySourceError:T?source.error||"":"",companyJobs:source.jobs.filter(function(j){return ids[j.company]&&(T||j.open);}),companyEvents:source.events.filter(function(e){return ids[e.company]&&(T||e.open);}).map(function(e){return Object.assign({},e,{title:"기업 · "+ids[e.company].name+" · "+e.title,target:"all"});}),experienceIntros:rows_("experienceIntro").filter(function(r){return T?r.v[3]!=="초안":r.v[1]===me.name;}).map(function(r){let a={};try{a=JSON.parse(r.v[4]||"{}");}catch(ignore){}return {id:r.v[0],name:r.v[1],company:r.v[2],companyName:(ids[r.v[2]]||{}).name||"이전 선택 기업",status:r.v[3],answers:a,updated:r.v[5],feedback:r.v[6]||""};})};}
function validateCompanyTemplate_(id){const book=SpreadsheetApp.openById(id),sh=book.getSheetByName("작성양식");if(!sh||book.getSheets().length!==1)throw new Error("배포용 빈 작성양식 시트를 연결해 주세요");const rows=sh.getDataRange().getDisplayValues();if(!rows[4]||rows[4][0]!=="항목"||rows[4][1]!=="작성 내용")throw new Error("빈 양식의 항목·작성 내용 열을 확인해 주세요");if(rows.slice(5).some(function(r){return String(r[1]||"").trim();}))throw new Error("원본 양식에 답변이 입력되어 있습니다. 빈 양식을 연결하고 작성본은 별도 사본으로 관리해 주세요");return true;}
function saveCompanyResources_(p){return withLock_(function(){const id=companySheetId_(p.sheetUrl);if(id){const book=SpreadsheetApp.openById(id);companyRows_(book,"기업정보",["기업ID","기업명","학생공개"]);companyRows_(book,"기업직무",["직무ID","기업ID","직무명","학생공개"]);companyRows_(book,"기업일정",["일정ID","기업ID","학생공개","제목","시작일"]);}const links={};["companyTemplate","introTemplate"].forEach(function(k){const v=p[k]||"";if(v){const tid=companySheetId_(v);validateCompanyTemplate_(tid);links[k]="https://docs.google.com/spreadsheets/d/"+tid+"/edit";}else links[k]="";});PropertiesService.getScriptProperties().setProperties({COMPANY_INFO_SHEET:id,COMPANY_REQUEST_TEMPLATE:links.companyTemplate,EXPERIENCE_INTRO_TEMPLATE:links.introTemplate});PROPS_=null;COMPANY_SOURCE_=null;CacheService.getScriptCache().remove("company_source_v1");CacheService.getScriptCache().remove("company_home_v1");return {connected:!!id};});}
function seedCompanySource_(){return withLock_(function(){const id=props_().COMPANY_INFO_SHEET;if(!id)throw new Error("기업정보 관리 시트를 먼저 연결해 주세요");const book=SpreadsheetApp.openById(id),sh=book.getSheetByName("기업정보"),heads=sh.getDataRange().getDisplayValues()[0],have={};companyRows_(book,"기업정보",["기업ID","기업명","학생공개"]).forEach(function(r){have[r["기업ID"]]=true;});let n=0;rows_("companies").forEach(function(r){const v=r.v;if(!v[0]||have[v[0]])return;const vals={"기업ID":v[0],"기업명":v[1],"학생공개":v[11]==="0"?"0":"1","업종":v[7],"기업소개":v[9],"홈페이지":v[10],"실제근무지":v[2],"담당부서":v[8]};writeCells_(sh,sh.getLastRow()+1,heads.map(function(h){return vals[h]||"";}));have[v[0]]=true;n++;});COMPANY_SOURCE_=null;CacheService.getScriptCache().remove("company_source_v1");CacheService.getScriptCache().remove("company_home_v1");return {added:n};});}
function companyFolder_(me,id){const c=companyInfo_(me).find(function(c){return c.id===id;});if(!c)throw new Error("이 기업의 자료를 볼 권한이 없습니다");const fid=driveFolderId_(c.folderUrl);if(!fid)throw new Error("기업 자료실 폴더가 아직 연결되지 않았습니다");return {company:c,folder:openSharedFolder_(fid,c.name+" 자료실")};}
function createCompanyFolder_(id){return withLock_(function(){const me={role:"teacher"},c=companyInfo_(me).find(function(c){return c.id===id;});if(!c)throw new Error("기업을 선택해 주세요");if(c.folderUrl)return {url:companyFolder_(me,id).folder.getUrl()};const f=folderFor_(["기업자료실",id+" · "+c.name]);PropertiesService.getScriptProperties().setProperty("COMPANY_FOLDER_"+id,f.getId());if(props_().COMPANY_INFO_SHEET){const sh=SpreadsheetApp.openById(props_().COMPANY_INFO_SHEET).getSheetByName("기업정보"),grid=sh.getDataRange().getDisplayValues(),head=grid[0],ic=head.indexOf("기업ID"),fc=head.indexOf("자료폴더");if(fc<0)throw new Error("기업정보 시트의 자료폴더 열을 확인해 주세요");grid.slice(1).some(function(row,i){if(row[ic]!==id)return false;sh.getRange(i+2,fc+1).setValue("https://drive.google.com/drive/folders/"+f.getId());return true;});}PROPS_=null;COMPANY_SOURCE_=null;CacheService.getScriptCache().remove("company_source_v1");CacheService.getScriptCache().remove("company_home_v1");return {url:f.getUrl()};});}
function saveExperienceIntro_(me,p){return withLock_(function(){const company=String(p.company||"");if(company&&!companyInfo_(me).some(function(c){return c.id===company;}))throw new Error("공개된 기업을 선택해 주세요");const old=p.id?record_("experienceIntro",p.id):rows_("experienceIntro").find(function(r){return r.v[1]===me.name&&r.v[2]===company;});if(old&&old.v[1]!==me.name)throw new Error("내 자기소개만 수정할 수 있습니다");if(rows_("experienceIntro").some(function(r){return r.v[1]===me.name&&r.v[2]===company&&(!old||r.v[0]!==old.v[0]);}))throw new Error("이 기업의 기존 자기소개를 수정해 주세요");if(["초안","제출"].indexOf(p.status)<0)throw new Error("저장 상태를 선택해 주세요");const state=p.status,answers={};Object.keys(INTRO_FIELDS_).forEach(function(k){answers[k]=k==="portfolio"?urlValid_((p.answers||{})[k]):clean_((p.answers||{})[k],k==="headline"?150:2500).trim();});if(state==="제출"){if(p.confirm!==true)throw new Error("작성 내용을 확인해 주세요");["headline","motivation","strength","experience","goals"].forEach(function(k){if(!answers[k])throw new Error(INTRO_FIELDS_[k]+" 항목을 작성해 주세요");});}const id=old?old.v[0]:uid_("intro");upsert_("experienceIntro",id,[id,me.name,company,state,JSON.stringify(answers),now_(),old?old.v[6]:""]);return id;});}
function reviewExperienceIntro_(p){return withLock_(function(){const r=record_("experienceIntro",p.id);if(r.v[3]==="초안")throw new Error("제출된 자기소개만 검토할 수 있습니다");if(["확인","보완요청"].indexOf(p.status)<0)throw new Error("검토 상태를 선택해 주세요");const v=r.v.slice(0,7);v[3]=p.status;v[5]=now_();v[6]=clean_(p.feedback,2000);writeCells_(sheet_("experienceIntro"),r._row,v);return true;});}
function companyTemplateFile_(me,p){const key=p.kind==="intro"?"EXPERIENCE_INTRO_TEMPLATE":p.kind==="company"&&me.role==="teacher"?"COMPANY_REQUEST_TEMPLATE":"";if(!key)throw new Error("이 양식을 받을 권한이 없습니다");const id=companySheetId_(props_()[key]);if(!id)throw new Error("양식이 아직 연결되지 않았습니다");validateCompanyTemplate_(id);const response=UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/"+id+"/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet",{headers:{Authorization:"Bearer "+ScriptApp.getOAuthToken()},muteHttpExceptions:true});if(response.getResponseCode()!==200)throw new Error("양식을 내려받지 못했습니다. 실행 계정의 읽기 권한을 확인해 주세요");const bytes=response.getContent();if(bytes.length>MAX_DOWNLOAD_MB_*1024*1024)throw new Error("양식이 너무 큽니다");return {name:p.kind==="intro"?"직무체험_자기소개_빈양식.xlsx":"기업정보_회신_빈양식.xlsx",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",base64:Utilities.base64Encode(bytes)};}

/* ===================== 내 오늘 화면(본인별 할 일·메모·카드·메뉴 설정) ===================== */
APP_TABS.myHome = { name: "앱_내화면", head: ["계정", "설정JSON", "수정시각"] };
const MYHOME_CARDS_ = ["todo", "notices", "meal", "focus", "events", "contests", "details"];
function myHomeKey_(me) { return me.role === "teacher" ? "teacher" : "student:" + me.name; }
function emptyMyHome_() { return { todos: [], memo: "", cards: [], hidden: [], tabs: [], hiddenTabs: [] }; }
function myHome_(me) {
  if (!me || (me.role !== "student" && me.role !== "teacher")) return null;
  const r = rows_("myHome").filter(function (x) { return x.v[0] === myHomeKey_(me); })[0];
  if (!r) return emptyMyHome_();
  try { return cleanMyHome_(JSON.parse(String(r.v[1] || "{}"))); } catch (e) { return emptyMyHome_(); }
}
function cleanMyHome_(x) {
  x = x || {};
  const ids = function (a, ok) { return (Array.isArray(a) ? a : []).map(String).filter(function (k, i, all) { return /^[a-z]{2,20}$/.test(k) && all.indexOf(k) === i && (!ok || ok.indexOf(k) >= 0); }).slice(0, 30); };
  const todos = (Array.isArray(x.todos) ? x.todos : []).slice(0, 60).map(function (t) { return { id: String(t && t.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 16) || uid_("t"), t: clean_(t && t.t, 200).trim(), d: !!(t && t.d), due: t && /^\d{4}-\d{2}-\d{2}$/.test(String(t.due || "")) ? String(t.due) : "" }; }).filter(function (t) { return t.t; });
  return { todos: todos, memo: clean_(x.memo, 2000), cards: ids(x.cards, MYHOME_CARDS_), hidden: ids(x.hidden, MYHOME_CARDS_), tabs: ids(x.tabs), hiddenTabs: ids(x.hiddenTabs).filter(function (k) { return k !== "today" && k !== "me"; }) };
}
function saveMyHome_(me, p) {
  if (me.role !== "student" && me.role !== "teacher") throw new Error("로그인하면 내 오늘 화면을 꾸밀 수 있습니다");
  const v = cleanMyHome_(p && p.home), json = JSON.stringify(v);
  if (json.length > 40000) throw new Error("할 일·메모가 너무 깁니다");
  withLock_(function () { const key = myHomeKey_(me), r = rows_("myHome").filter(function (x) { return x.v[0] === key; })[0]; const row = [key, json, now_()]; if (r) writeCells_(sheet_("myHome"), r._row, row); else append_("myHome", row); });
  return v;
}
