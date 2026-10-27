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
const STUDENT_LOGIN_REQUIRED_ = CFG_.getProperty("STUDENT_LOGIN_REQUIRED") !== "false";
/* 2026-10-27 로그인 필수 결정: 이전 자유 접속 설정은 새 정책에서 관리자가 다시 허용할 때만 적용. */
function publicAccessEnabled_(){ return CFG_.getProperty("PUBLIC_ACCESS_ENABLED") === "true" && CFG_.getProperty("PUBLIC_ACCESS_LOGIN_POLICY") === "2026-10-27"; }
const PUBLIC_ACCESS_ENABLED_ = publicAccessEnabled_();
const NO_LOGIN_TEST_MODE = !STUDENT_LOGIN_REQUIRED_ && String(CFG_.getProperty("NO_LOGIN_TEST_MODE") || "").trim().toLowerCase() === "true";
const SPREADSHEET_ID = CFG_.getProperty("SPREADSHEET_ID") || "";
/* 로그인 없이 둘러보기: 이름·PIN 없이 들어오면 '손님'으로 전체 공개 공지·급식·시간표·학교 일정만 봅니다. 끄려면 스크립트 속성 GUEST_VIEW=false */
const GUEST_VIEW = PUBLIC_ACCESS_ENABLED_ || (!STUDENT_LOGIN_REQUIRED_ && String(CFG_.getProperty("GUEST_VIEW") || "").trim().toLowerCase() !== "false");
/* 2026-10-26 선생님 결정: 로그인 없는 손님도 전체 자료를 읽기 전용으로 봄(명단·출결·팀·자기소개서 포함).
   연락처·주소·PIN·교사 설정·계정·모든 쓰기는 계속 잠금. 스크립트 속성 PUBLIC_VIEW_ALL=false 로 끔. */
const PUBLIC_VIEW_ALL_ = String(CFG_.getProperty("PUBLIC_VIEW_ALL") || "true").trim().toLowerCase() !== "false";
const VIEWER_ACTIONS_ = { load:1, downloadFile:1, noticeImage:1, noticeDownload:1, driveBrowse:1, driveDownload:1, driveMaterialFile:1, photoBrowse:1, photoImage:1, introDocument:1, equipmentLedger:1, legacyAttendance:1, todayTeamFiles:1, resourceLinks:1, timetable:1, meals:1 };
const GUEST_ACTIONS_ = { resourceLinks:1, noticeImage:1, noticeDownload:1, downloadFile:1, driveMaterialFile:1, driveBrowse:1, driveDownload:1, introSubmissionList:1, submitPublicIntro:1, introTemplate:1, load: 1, login: 1, timetable: 1, meals: 1 };

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
  journals: { name: "앱_학습일지자료", head: ["ID","훈련일","훈련구분","제목","작성안내","링크","첨부ID","작성자","수정시각","숨김"] },
  journalChecks: { name: "앱_학습일지확인", head: ["ID","학생","자료ID","HRD작성확인","확인시각","메모"] },
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
var INTRO_AUTH_=false;
const READ_ACTIONS_ = { trainingJournal:1, staffAccounts:1, introDocument:1, introSubmissionList:1, introTemplate:1, equipmentLedger:1, todayTeamFiles:1, studentPrivate:1, purchaseSheetLinks:1, photoBrowse:1, photoImage:1, resourceLinks:1, companySetupInfo:1, companyTemplateFile:1, noticeImage:1, noticeDownload:1, login: 1, load: 1, downloadFile: 1, checkSetup: 1, legacyAttendance: 1 };
const BUMP_ACTIONS_ = { syncCalendar: 1, saveSettings: 1, setAutomation: 1, createCalendar: 1, sendNotifications: 1 };
const ADMIN_ACTIONS_ = {moveStorageFiles:1,relinkStorageFolders:1,setPublicAccess:1,setupStaffAccounts:1,staffAccounts:1,importClass3Students:1,saveSettings:1,setAutomation:1,createCalendar:1,sendNotifications:1};
function api(req) {
  const started=Date.now();
  try {
    req = req || {};
    const action = String(req.action || "");
    USE_CACHE_ = true;
    ensureTabs_();
    if ((action === "load" && !(req.payload && req.payload.homeOnly === true)) || action === "login" || req.withLoad) prefetchLoad_();
    const cred0 = req.cred || {};
    INTRO_AUTH_=!!(cred0.teacher||cred0.name||cred0.pin||cred0.session);
    const me = PUBLIC_ACCESS_ENABLED_&&!INTRO_AUTH_ ? {role:"guest",name:"손님",group:""} : STUDENT_LOGIN_REQUIRED_ ? auth_(cred0) : (action === "submitPublicIntro" || action === "introTemplate" || (action === "introSubmissionList" && !INTRO_AUTH_)) ? {role:"guest",name:"손님"} : INTRO_AUTH_ ? auth_(cred0) : NO_LOGIN_TEST_MODE ? { role: "teacher", name: "선생님" } : (GUEST_VIEW && !cred0.teacher && !String(cred0.name || "").trim() && !String(cred0.pin || "").trim()) ? { role: "guest", name: "손님", group: "" } : auth_(cred0);
    const p = req.payload || {};
    if(ADMIN_ACTIONS_[action])needAdmin_(me);
    if (me.role === "guest") { if(STUDENT_LOGIN_REQUIRED_&&!PUBLIC_VIEW_ALL_&&["introSubmissionList","submitPublicIntro"].indexOf(action)>=0)throw Error("학생 학번으로 로그인해 주세요"); /* 전체 공개(PUBLIC_VIEW_ALL) 동안은 로그인 없이 이름·학년으로 자기소개서 파일 제출(2026-10-27 선생님 지시) */if (!GUEST_ACTIONS_[action] && !(PUBLIC_VIEW_ALL_ && VIEWER_ACTIONS_[action])) throw new Error("로그인하면 이용할 수 있습니다"); req.withLoad = false; }
    if (me.role === 'teacher' && ((action === 'load' && !(req.payload && req.payload.homeOnly === true)) || req.withLoad)) migrateRequestsToAnon_();
    let data;
    const viewer = me.role === "guest" && PUBLIC_VIEW_ALL_ && VIEWER_ACTIONS_[action];
    if (viewer) data = viewerDispatch_(action, p);
    else if (action === "login") data = { me: me, loginDisabled: NO_LOGIN_TEST_MODE && !INTRO_AUTH_, guestView: GUEST_VIEW, session:me.staffAccount?createStaffSession_(me,p.remember===true):STUDENT_LOGIN_REQUIRED_&&me.role==="student"?createStudentSession_(me,p.remember===true):null };
    else if (action === "load") data = load_(me, {deferLinks:p.deferLinks===true,homeOnly:p.homeOnly===true});
    else if (READ_ACTIONS_[action]) data = dispatch_(me, action, p);
    else {
      USE_CACHE_ = false; MEMO_ = {};          // 쓰기 중에는 항상 시트를 직접 읽습니다
      try { data = dispatch_(me, action, p); }
      finally { if (BUMP_ACTIONS_[action]) bumpAll_(); else flushDirty_(); USE_CACHE_ = true; }
    }
    const publicAccess=publicAccessEnabled_(),out = { ok: true, data: data };if(STUDENT_LOGIN_REQUIRED_){out.loginRequired=!publicAccess;out.studentLoginRequired=true;}if(STUDENT_LOGIN_REQUIRED_||publicAccess)out.publicAccess=publicAccess;
    if((action==="load"||action==="login")&&data){data.publicAccess=publicAccess;data.studentLoginRequired=STUDENT_LOGIN_REQUIRED_;}
    if(me.role==="teacher"&&p.profile===true)out.profile={serverMs:Date.now()-started,phases:HOME_TIMING_||[]};
    if (req.withLoad && action !== "load") {out.load = load_(me);out.load.publicAccess=publicAccess;out.load.studentLoginRequired=STUDENT_LOGIN_REQUIRED_;}
    return JSON.parse(JSON.stringify(out));
  } catch (e) {
    return { ok: false, error: String(e && e.message || e),loginRequired:STUDENT_LOGIN_REQUIRED_&&!PUBLIC_ACCESS_ENABLED_,studentLoginRequired:STUDENT_LOGIN_REQUIRED_,publicAccess:PUBLIC_ACCESS_ENABLED_ };
  }
}
function dispatch_(me, action, p) {
  switch (action) {
    case "setPublicAccess": needAdmin_(me);if(!INTRO_AUTH_)throw Error("최고관리자로 로그인해 주세요");CFG_.setProperty("PUBLIC_ACCESS_ENABLED",p.enabled===true?"true":"false");CFG_.setProperty("PUBLIC_ACCESS_LOGIN_POLICY","2026-10-27");return {enabled:p.enabled===true};
    case "moveStorageFiles": return moveStorageFiles_(me,p);
    case "relinkStorageFolders": return relinkStorageFolders_(me,p);
    case "setupStaffAccounts": return setupStaffAccounts_(me,p);
    case "staffAccounts": return staffAccounts_(me);
    case "changeStaffPassword": return changeStaffPassword_(me,p);
    case "importClass3Students": return importClass3Students_(me,p);
    case "changeStudentPassword": return changeStudentPassword_(me,p);
    case "logoutSession": if(p.token){CFG_.deleteProperty("STUDENT_SESSION_"+authDigest_(String(p.token)));CFG_.deleteProperty("STAFF_SESSION_"+authDigest_(String(p.token)));}return true;
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
    case "manageStudents": need_(me, "teacher"); return manageStudents_(p);
    case "trainingJournal": return trainingJournal_(me);
    case "saveTrainingJournal": need_(me,"teacher"); return saveTrainingJournal_(me,p);
    case "deleteTrainingJournal": need_(me,"teacher"); return deleteTrainingJournal_(p);
    case "checkTrainingJournal": return checkTrainingJournal_(me,p);
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
    case "introTemplate": return introTemplate_();
    case "introDocument": return introDocument_(me,p);
    case "introSubmissionList": return introSubmissionList_(me);
    case "submitPublicIntro": if(STUDENT_LOGIN_REQUIRED_&&!(PUBLIC_VIEW_ALL_&&me.role==="guest")){need_(me,"student");p=Object.assign({},p,{name:me.name,grade:me.studentId[0]});}return submitPublicIntro_(p);
    case "introManagement": if(!INTRO_AUTH_)throw new Error("선생님으로 로그인해 주세요"); need_(me,"teacher"); return withLock_(function(){return syncIntroManagement_(true);});
    case "saveExperienceIntro": if(!INTRO_AUTH_)throw new Error("학생 이름과 PIN으로 로그인해 주세요"); need_(me,"student"); return saveExperienceIntro_(me,p);
    case "reviewExperienceIntro": if(!INTRO_AUTH_)throw new Error("선생님으로 로그인해 주세요"); need_(me,"teacher"); return reviewExperienceIntro_(p);
    case "companyTemplateFile": return companyTemplateFile_(me,p);
    case "saveCompany":  need_(me, "teacher"); return saveCompany_(p);
    case "removeCompany": need_(me, "teacher"); return removeCompany_(p.id);
    case "saveAssign":   need_(me, "teacher"); return saveAssign_(p);
    case "icsToken":     return icsToken_(me, p.reset === true);
    case "driveMaterialFile": return driveMaterialFile_(me, String(p.id || ""));
    case "timetable":    return timetable_(me, p);
    case "saveMyHome":   return saveMyHome_(me, p);
    case "meals":        return meals_(dateValid_(p.from), plusDate_(dateValid_(p.from), 6));
    case "resourceLinks": return {driveMaterials:driveMaterials_(me),notionPages:me.role==="guest"?[]:notionPages_()};
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
function staffEnabled_(){return CFG_.getProperty("STAFF_AUTH_INITIALIZED")==="true";}
function needAdmin_(me){if(me.role!=="teacher"||(!me.isAdmin&&staffEnabled_()))throw Error("최고관리자만 할 수 있습니다");}

/* ===================== 로그인 ===================== */
function auth_(cred) {
  if(cred.session){const token=String(cred.session);if(CFG_.getProperty("STAFF_SESSION_"+authDigest_(token)))return staffSessionAuth_(token);return studentSessionAuth_(token);}
  const cache = CacheService.getScriptCache();
  if (cred.teacher) {
    if(staffEnabled_())return namedStaffAuth_(String(cred.teacherName||"").trim(),String(cred.teacher));
    if (TEACHER_PASSWORD === "여기에_비밀번호" || !TEACHER_PASSWORD) throw new Error("선생님 비밀번호가 아직 없습니다. Apps Script 프로젝트 설정 → 스크립트 속성에 TEACHER_PASSWORD를 추가해 주세요");
    const k = "fail_t";
    if (Number(cache.get(k) || 0) >= 8) throw new Error("비밀번호를 여러 번 틀렸습니다. 10분 뒤 다시 시도하세요");
    if (String(cred.teacher) !== TEACHER_PASSWORD) { cache.put(k, String(Number(cache.get(k) || 0) + 1), 600); throw new Error("비밀번호가 맞지 않습니다"); }
    cache.remove(k);
    return { role: "teacher", name: String(cred.teacherName||"").trim()||"선생님", isAdmin:true,staffSetupPending:true };
  }
  const name = String(cred.name || "").trim(), pin = String(cred.pin || "").trim();
  if(STUDENT_LOGIN_REQUIRED_)return class3StudentAuth_(name,pin);
  if (!name || !pin) throw new Error("이름과 PIN을 넣어 주세요");
  const k = "fail_" + name;
  if (Number(cache.get(k) || 0) >= 5) throw new Error("PIN을 여러 번 틀렸습니다. 10분 뒤 다시 시도하세요");
  const st = roster_().filter(function (r) { return r.name === name; })[0];
  if (!st || !st.pin || String(st.pin) !== pin) { cache.put(k, String(Number(cache.get(k) || 0) + 1), 600); throw new Error("이름이나 PIN이 맞지 않습니다. 선생님께 확인하세요"); }
  cache.remove(k);
  return { role: "student", name: st.name, group: st.group, klass: st.klass, afterschool: st.afterschool };
}
function authHex_(bytes){return bytes.map(function(b){return ("0"+(b&255).toString(16)).slice(-2);}).join("");}
function authDigest_(text){return authHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(text),Utilities.Charset.UTF_8));}
function accountKey_(name){return "STUDENT_AUTH_"+authDigest_(name);}
function staffKey_(name){return "STAFF_AUTH_"+authDigest_(name);}
function staffAccount_(name){const raw=CFG_.getProperty(staffKey_(name));return raw?JSON.parse(raw):null;}
function staffPasswordHash_(password,salt){const pepper=CFG_.getProperty("STAFF_AUTH_PEPPER");if(!pepper)throw Error("교사 계정 등록이 필요합니다");return authHex_(Utilities.computeHmacSha256Signature(salt+":"+password,pepper,Utilities.Charset.UTF_8));}
function staffAccountMe_(a){if(!a||!a.active||["admin","teacher"].indexOf(a.access)<0)throw Error("등록된 교사 계정으로 로그인해 주세요");return {role:"teacher",name:a.name,isAdmin:a.access==="admin",staffAccount:true};}
function namedStaffAuth_(name,password){const cache=CacheService.getScriptCache(),key="staff_fail_"+authDigest_(name);if(Number(cache.get(key)||0)>=5)throw Error("비밀번호를 여러 번 틀렸습니다. 10분 뒤 다시 시도하세요");const a=name&&staffAccount_(name);if(!a||!a.active||staffPasswordHash_(password,a.salt)!==a.hash){cache.put(key,String(Number(cache.get(key)||0)+1),600);throw Error("교사 이름이나 비밀번호가 맞지 않습니다");}cache.remove(key);return staffAccountMe_(a);}
function createStaffSession_(me,remember){return withLock_(function(){const a=staffAccount_(me.name);staffAccountMe_(a);const all=CFG_.getProperties(),now=Date.now(),mine=[];Object.keys(all).filter(function(k){return k.indexOf("STAFF_SESSION_")===0;}).forEach(function(k){let s;try{s=JSON.parse(all[k]);}catch(e){}if(!s||s.expires<=now)CFG_.deleteProperty(k);else if(s.name===me.name)mine.push(k);});while(mine.length>=5)CFG_.deleteProperty(mine.shift());const token=Utilities.getUuid().replace(/-/g,"")+Utilities.getUuid().replace(/-/g,"");CFG_.setProperty("STAFF_SESSION_"+authDigest_(token),JSON.stringify({name:a.name,version:a.version,expires:now+(remember?30*86400000:12*3600000)}));return token;});}
function staffSessionAuth_(token){if(!/^[a-f0-9]{64}$/.test(token))throw Error("로그인이 만료되었습니다. 다시 로그인해 주세요");const key="STAFF_SESSION_"+authDigest_(token),raw=CFG_.getProperty(key),s=raw?JSON.parse(raw):null,a=s&&staffAccount_(s.name);if(!s||s.expires<=Date.now()||!a||!a.active||s.version!==a.version){CFG_.deleteProperty(key);throw Error("로그인이 만료되었습니다. 다시 로그인해 주세요");}return staffAccountMe_(a);}
function staffAccounts_(me){needAdmin_(me);return Object.keys(CFG_.getProperties()).filter(function(k){return /^STAFF_AUTH_[a-f0-9]{64}$/.test(k);}).map(function(k){const a=JSON.parse(CFG_.getProperty(k));return {name:a.name,access:a.access,active:a.active};});}
function setupStaffAccounts_(me,p){
 if(!INTRO_AUTH_)throw Error("최고관리자로 로그인해 주세요");needAdmin_(me);const admin=clean_(p.adminName,30).trim(),teachers=p.teachers,password=String(p.password||"");if(!admin||!Array.isArray(teachers)||!teachers.length||teachers.length>30||password.length<5||password.length>64||password.trim()!==password)throw Error("관리자 이름·교사 명단·공통 초기 비밀번호를 확인해 주세요");if(staffEnabled_()&&admin!==me.name)throw Error("최고관리자 변경은 허용하지 않습니다");const seen=Object.create(null);seen[admin]=true;teachers.forEach(function(n){if(typeof n!=="string"||!n.trim()||n.length>30||seen[n.trim()])throw Error("교사 명단의 이름과 중복을 확인해 주세요");seen[n.trim()]=true;});
 const summary=withLock_(function(){if(!CFG_.getProperty("STAFF_AUTH_PEPPER"))CFG_.setProperty("STAFF_AUTH_PEPPER",Utilities.getUuid()+Utilities.getUuid());const updates={},oldAdmin=staffAccount_(admin),adminSalt=oldAdmin?oldAdmin.salt:Utilities.getUuid();if(!oldAdmin&&(TEACHER_PASSWORD==="여기에_비밀번호"||!TEACHER_PASSWORD))throw Error("관리자 비밀번호를 먼저 설정해 주세요");updates[staffKey_(admin)]=JSON.stringify(oldAdmin||{name:admin,access:"admin",active:true,salt:adminSalt,hash:staffPasswordHash_(TEACHER_PASSWORD,adminSalt),version:Utilities.getUuid()});teachers.forEach(function(n){n=n.trim();const old=staffAccount_(n),salt=old?old.salt:Utilities.getUuid(),a=old||{name:n,access:"teacher",active:true,salt:salt,hash:staffPasswordHash_(password,salt),version:Utilities.getUuid()};a.access="teacher";a.active=true;if(p.resetTeachers===true){a.salt=Utilities.getUuid();a.hash=staffPasswordHash_(password,a.salt);a.version=Utilities.getUuid();}updates[staffKey_(n)]=JSON.stringify(a);});const all=CFG_.getProperties();Object.keys(all).filter(function(k){return /^STAFF_AUTH_[a-f0-9]{64}$/.test(k)&&!updates[k];}).forEach(function(k){const a=JSON.parse(all[k]);a.active=false;a.version=Utilities.getUuid();updates[k]=JSON.stringify(a);});CFG_.setProperties(updates);CFG_.setProperty("STAFF_AUTH_INITIALIZED","true");CFG_.setProperty("STAFF_ADMIN_NAME",admin);return {adminName:admin,teachers:teachers.length};});summary.session=createStaffSession_(staffAccountMe_(staffAccount_(admin)),p.remember===true);return summary;
}
function changeStaffPassword_(me,p){need_(me,"teacher");if(!me.staffAccount)throw Error("교사 계정 등록 후 사용할 수 있습니다");const current=String(p.currentPassword||""),next=String(p.password||"");if(next.length<5||next.length>64||next.trim()!==next||next!==p.confirmPassword)throw Error("새 비밀번호와 확인을 5~64자로 일치하게 입력해 주세요");namedStaffAuth_(me.name,current);withLock_(function(){const a=staffAccount_(me.name);if(staffPasswordHash_(current,a.salt)!==a.hash)throw Error("비밀번호가 바뀌었습니다. 다시 로그인해 주세요");a.salt=Utilities.getUuid();a.hash=staffPasswordHash_(next,a.salt);a.version=Utilities.getUuid();CFG_.setProperty(staffKey_(me.name),JSON.stringify(a));});return {session:createStaffSession_(me,p.remember===true)};}
function studentAccount_(name){const s=CFG_.getProperty(accountKey_(name));return s?JSON.parse(s):null;}
function studentPasswordHash_(password,salt){const pepper=CFG_.getProperty("STUDENT_AUTH_PEPPER");if(!pepper)throw Error("학생 계정 등록이 필요합니다");return authHex_(Utilities.computeHmacSha256Signature(salt+":"+password,pepper,Utilities.Charset.UTF_8));}
function studentAccountMe_(a){if(!a||!a.active||!/^[123]03\d{2}$/.test(a.studentId))throw Error("등록된 1~3학년 3반 학생만 로그인할 수 있습니다");const r=roster_().find(function(r){return r.name===a.name;});if(!r)throw Error("학생 계정 등록이 필요합니다");return {role:"student",name:a.name,studentId:a.studentId,group:r.group,klass:a.studentId[0]+"-3",afterschool:r.afterschool};}
function studentLoginAccount_(login){
 if(!/^[123]03\d{2}$/.test(login))return studentAccount_(login);
 const props=CFG_.getProperties(),keys=Object.keys(props).filter(function(k){return /^STUDENT_AUTH_[a-f0-9]{64}$/.test(k);});
 for(let i=0;i<keys.length;i++){const a=JSON.parse(props[keys[i]]);if(a.studentId===login)return a;}return null;
}
function class3StudentAuth_(name,password){
 if(!name||!password)throw Error("학번과 비밀번호를 입력해 주세요");const a=studentLoginAccount_(name),cache=CacheService.getScriptCache(),key="student_fail_"+authDigest_(a?a.name:name);if(Number(cache.get(key)||0)>=5)throw Error("비밀번호를 여러 번 틀렸습니다. 10분 뒤 다시 시도하세요");
 if(!a||!a.active||studentPasswordHash_(password,a.salt)!==a.hash){cache.put(key,String(Number(cache.get(key)||0)+1),600);throw Error("학번 또는 비밀번호가 맞지 않습니다. 초기 비밀번호는 학번입니다");}cache.remove(key);return studentAccountMe_(a);
}
function createStudentSession_(me,remember){return withLock_(function(){const a=studentAccount_(me.name);studentAccountMe_(a);const props=CFG_.getProperties(),now=Date.now(),mine=[];Object.keys(props).filter(function(k){return k.indexOf("STUDENT_SESSION_")===0;}).forEach(function(k){let s;try{s=JSON.parse(props[k]);}catch(e){}if(!s||s.expires<=now)CFG_.deleteProperty(k);else if(s.name===me.name)mine.push(k);});while(mine.length>=5)CFG_.deleteProperty(mine.shift());const token=Utilities.getUuid().replace(/-/g,"")+Utilities.getUuid().replace(/-/g,"");CFG_.setProperty("STUDENT_SESSION_"+authDigest_(token),JSON.stringify({name:a.name,version:a.version,expires:now+(remember?30*86400000:12*3600000)}));return token;});}
function studentSessionAuth_(token){if(!/^[a-f0-9]{64}$/.test(token))throw Error("로그인이 만료되었습니다. 다시 로그인해 주세요");const key="STUDENT_SESSION_"+authDigest_(token),raw=CFG_.getProperty(key),s=raw?JSON.parse(raw):null,a=s&&studentAccount_(s.name);if(!s||s.expires<=Date.now()||!a||!a.active||s.version!==a.version){CFG_.deleteProperty(key);throw Error("로그인이 만료되었습니다. 다시 로그인해 주세요");}return studentAccountMe_(a);}
function changeStudentPassword_(me,p){need_(me,"student");if(!STUDENT_LOGIN_REQUIRED_)throw Error("학생 계정 등록 후 사용할 수 있습니다");const current=String(p.currentPassword||""),next=String(p.password||"");if(next.length<5||next.length>64||next.trim()!==next)throw Error("새 비밀번호는 앞뒤 공백 없이 5~64자로 입력해 주세요");if(next!==p.confirmPassword)throw Error("새 비밀번호 확인이 일치하지 않습니다");class3StudentAuth_(me.name,current);withLock_(function(){const a=studentAccount_(me.name);if(studentPasswordHash_(current,a.salt)!==a.hash)throw Error("비밀번호가 바뀌었습니다. 다시 로그인해 주세요");a.salt=Utilities.getUuid();a.hash=studentPasswordHash_(next,a.salt);a.version=Utilities.getUuid();CFG_.setProperty(accountKey_(me.name),JSON.stringify(a));});return {session:createStudentSession_(me,p.remember===true)};}
function importClass3Students_(me,p){
 if(!INTRO_AUTH_)throw Error("선생님으로 로그인해 주세요");need_(me,"teacher");const students=p.students;if(!Array.isArray(students)||!students.length||students.length>120)throw Error("교사 등록용 학생 파일을 선택해 주세요");
 const names=Object.create(null),ids=Object.create(null);students.forEach(function(s){if(!s||typeof s.name!=="string"||!s.name.trim()||s.name.length>30||!/^[123]03(0[1-9]|[1-9]\d)$/.test(String(s.studentId)))throw Error("1~3학년 3반의 이름·학번만 등록할 수 있습니다");if(names[s.name.trim()]||ids[s.studentId])throw Error("이름 또는 학번이 중복되었습니다");names[s.name.trim()]=true;ids[s.studentId]=true;});
 return withLock_(function(){if(!CFG_.getProperty("STUDENT_AUTH_PEPPER"))CFG_.setProperty("STUDENT_AUTH_PEPPER",Utilities.getUuid()+Utilities.getUuid());const updates={},counts={"1":0,"2":0,"3":0};let added=0;
 students.forEach(function(s){const name=s.name.trim(),id=String(s.studentId),old=studentAccount_(name);if(old&&old.studentId!==id)throw Error("기존 계정의 학번이 다릅니다. 담당교사가 확인해야 합니다");const salt=old?old.salt:Utilities.getUuid(),a=old||{name:name,studentId:id,salt:salt,hash:studentPasswordHash_(id,salt),version:Utilities.getUuid()};a.active=true;updates[accountKey_(name)]=JSON.stringify(a);counts[id[0]]++;if(!old)added++;});
 const roster=roster_();students.forEach(function(s){const row=roster.find(function(r){return r.name===s.name.trim();}),klass=s.studentId[0]+"-3";if(row)sheet_("roster").getRange(row.row,3).setValue(klass);else append_("roster",[s.name.trim(),GROUP_LABEL[s.studentId[0]==="1"?"pre1":s.studentId[0]==="2"?"pre2":"general"],klass,"","","0",""]);});
 const all=CFG_.getProperties();Object.keys(all).filter(function(k){return /^STUDENT_AUTH_[a-f0-9]{64}$/.test(k)&&!updates[k];}).forEach(function(k){const a=JSON.parse(all[k]);a.active=false;updates[k]=JSON.stringify(a);});CFG_.setProperties(updates);CFG_.setProperty("STUDENT_LOGIN_REQUIRED","true");bumpAll_();return {total:students.length,added:added,counts:counts};});
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
  const names = Object.keys(APP_TABS).filter(function(k){return ["equipmentLoans","journals","journalChecks"].indexOf(k)<0;}).map(function (k) { return APP_TABS[k].name; }).concat([TAB_BOM]);
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
function studentPrivateFile_(id){return !!id&&[props_().STUDENT_PRIVATE_SHEET_ID,props_().INTRO_MANAGEMENT_SHEET_ID].some(function(x){return x&&String(id)===String(x);});}
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
  auth_({teacherName:me.name,teacher:String(p.password)});
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
const STUDENT_NAME_COLS_ = { journalChecks: [1], personal: [1], requests: [2], replies: [2], acks: [1], buys: [1], attendance: [2], progress: [1], portfolio: [1], tasks: [3], files: [1], contacts: [0], anon: [2], anonReports: [2], board: [1], boardComments: [2], anonCmt: [3], assign: [0], icsTokens: [0] };
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
    disableStudentAccount_(st.name);
    sheet_("roster").deleteRow(st.row);
    return true;
  });
}
/* 명단 삭제와 학습근로자 제외를 구분합니다. 이전 훈련/제출 기록은 보존합니다. */
function disableStudentAccount_(name){if(!CFG_.getProperty("STUDENT_AUTH_PEPPER"))return;const a=studentAccount_(name);if(a){a.active=false;a.version=Utilities.getUuid();CFG_.setProperty(accountKey_(name),JSON.stringify(a));}}
function manageStudents_(p){
 const input=p.students;if(!Array.isArray(input)||!input.length||input.length>120)throw Error("학생을 선택해 주세요");
 const remove=p.mode==="delete";if(!remove&&(p.mode!=="group"||!GROUP_LABEL[p.group]))throw Error("변경할 학생 구분을 선택해 주세요");
 if(remove&&p.confirm!==true)throw Error("명단 삭제를 확인해 주세요");
 return withLock_(function(){
  const roster=roster_(),seen={};const chosen=input.map(function(x){const r=roster.find(function(r){return r.row===Number(x.row)&&r.name===String(x.name);});if(!r||seen[r.row])throw Error("명단이 바뀌었습니다. 새로고침 후 다시 선택해 주세요");seen[r.row]=true;return r;});
  if(remove){chosen.sort(function(a,b){return b.row-a.row;}).forEach(function(st){
   ["contacts","icsTokens"].forEach(function(key){if(!APP_TABS[key])return;const sh=sheet_(key);rows_(key).filter(function(x){return String(x.v[0]).trim()===st.name;}).sort(function(a,b){return b._row-a._row;}).forEach(function(x){sh.deleteRow(x._row);});});
   disableStudentAccount_(st.name);sheet_("roster").deleteRow(st.row);
  });}else{const sh=sheet_("roster");chosen.forEach(function(st){sh.getRange(st.row,2).setValue(GROUP_LABEL[p.group]);});}
  return {count:chosen.length,mode:p.mode,group:remove?null:p.group};
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
      /* 날짜 행 바로 위의 시간 없는 메모도 그 주의 일반 일정으로 읽습니다. 시각은 추정하지 않습니다. */
      for(let nr=r-2;nr>=0;nr--){
        const note=rows[nr]||[];
        if(hhmm_(cell_(note,c),cell_(note,c+1))||note.some(function(v){return parseDateCell_(v,sy)||String(v).trim()==="시";}))break;
        dayCols.forEach(function(dc){const title=cell_(note,dc.i).replace(/\s+/g," ");if(!title||isAfterschoolTitle_(title)||/^(미운영|-|x|X|[1-3]\s*학년)$/.test(title))return;const key=dc.d+"|"+g+"|"+title;if(!slots[key])slots[key]=[];});
      }
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
    const last = times.length?times[times.length - 1].split(":").map(Number):[0,0], em = last[0] * 60 + last[1] + 50;
    const afterschool = isAfterschoolTitle_(parts[2]);
    return { date: parts[0], grade: +parts[1], title: parts[2], times: times, start: times[0]||"", end: times.length?pad_(Math.floor(em / 60)) + ":" + pad_(em % 60):"", afterschool: afterschool, info: !afterschool, allDay: !times.length||(!afterschool && HOLIDAY_.test(parts[2])) };
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
 const visible=function(target){return T||G||matches_(target,me.group);}; /* 손님(로그인 없음)도 대상과 상관없이 공지·일정을 봄(2026-10-26 선생님 결정) */
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
 const out={me:me,loginDisabled:NO_LOGIN_TEST_MODE && !INTRO_AUTH_,homeOnly:true,today:today,schoolYear:sy,tabsMissing:sheet.tabsMissing,
 notices:enrichNotices_(recent),events:events,afterschool:schedule.filter(function(a){return a.afterschool&&inRange(a);}),sheetEvents:[],sheetCalendar:sheetScheduleEvents_(schedule,T||G?0:({learner:3,pre2:2,pre1:1})[me.group]).filter(inRange),
 common:{target:target,items:sheet.personal.common.filter(inRange)},personalSheet:personalSheet,personalApp:personal,
 noticeCalendar:noticeCalendarEvents_(allNotices.map(function(n){return Object.assign({},n,meta[n.id]||{});})).filter(inRange),
 boardPosts:board,companyEvents:companyEvents,certCalendar:certCalendar,
 requests:[],replies:[],purchases:[],roster:[],acks:[],myAcks:(T||G)?[]:rows_("acks").filter(function(r){return r.v[1]===me.name;}).map(function(r){return r.v[0];}),
 projects:[],tasks:[],materials:[],portfolio:[],units:[],progress:[],attendance:[],assigns:[],companies:[],boardComments:[],anonPosts:[],anonComments:[],anonReports:[],projectFiles:[],folderRequests:[],experienceIntros:[],companyInfo:[],certifications:[],notionPortfolios:[],driveMaterials:[],notionPages:[],linksDeferred:true,
 school:{comciUrl:COMCI_URL_,mealUrl:MEAL_URL_},meals:meals,appUrl:appUrl_(),icsToken:"",lastUpdate:latest,build:APP_BUILD_,guestView:GUEST_VIEW,myHome:G?null:myHome_(me)};
 mark("response");return out;
}

/* 손님 전체 보기: 선생님 화면 자료를 읽기만 하는 '보기 전용' 계정으로 만든 뒤 연락처·PIN·설정·익명 작성자를 지웁니다. */
function viewerDispatch_(action, p){
 const v={role:"teacher",name:"손님",viewer:true,isAdmin:false};INTRO_AUTH_=true;
 const pm=String(p&&p.root||"").match(/^project:(.+)$/);if(pm&&!props_()["PF_"+pm[1]])throw new Error("이 팀의 Drive 폴더가 아직 없습니다");
 if(action==="load"){const d=load_(v,{deferLinks:p.deferLinks===true,homeOnly:p.homeOnly===true});return viewerClean_(d);}
 const d=dispatch_(v,action,p);if(action==="driveBrowse"&&d&&typeof d==="object"){d.canUpload=false;d.canManage=false;}if(action==="photoBrowse"&&d&&typeof d==="object"){d.canUpload=false;d.canManage=false;}return d;
}
function viewerClean_(d){
 d.me={role:"teacher",name:"손님",viewer:true,isAdmin:false};d.viewer=true;d.guestView=true;d.myHome=null;d.icsToken="";
 ["contact","contacts","settings","mailLog","calendarEvents","companyResources","companySourceError","sheetUrl","staff","staffAccounts"].forEach(function(k){delete d[k];});
 (d.roster||[]).forEach(function(r){r.pin="";r.note="";});
 (d.companies||[]).forEach(function(c){c.mentor="";c.phone="";c.email="";c.note="";});
 (d.anonPosts||[]).forEach(function(x){x.author="";x.mine=false;});(d.anonComments||[]).forEach(function(x){x.author="";x.mine=false;});d.anonReports=[];
 (d.requests||[]).forEach(function(x){delete x.unreadStudent;delete x.unreadTeacher;});
 (d.notionPortfolios||[]);
 return d;
}

/* 공개 자료 전용 응답: 개인/팀/교사 전체 응답을 만든 뒤 숨기지 않고 승인된 필드만 구성합니다. */
function publicLoad_(me,options){
 const out=homeLoad_(me);if(options&&options.homeOnly===true)return out;
 const visible=function(){return true;},sheet=scheduleData_(schoolYear_()); /* 2026-10-26 선생님 결정: 손님도 모든 대상의 공지·일정·자료를 봄. 학생 이름이 담긴 자료(명단·개인일정·출결·소개서)는 계속 제외 */
 out.homeOnly=false;
 out.notices=enrichNotices_(rows_("notices").filter(function(r){return r.v[0]&&visible(r.v[2]);}).map(function(r){const v=r.v;return {id:v[0],at:v[1],target:targetKey_(v[2]),title:v[3],body:v[4],pinned:/^(o|y|고정|true)$/i.test(String(v[5]).trim()),due:v[6]};}));
 out.events=rows_("events").filter(function(r){return r.v[0]&&visible(r.v[5])&&r.v[4]!=="OJT"&&r.v[4]!=="OFF";}).map(function(r){const v=r.v;return {id:v[0],date:v[1],endDate:v[2],time:v[3],kind:kindKey_(v[4]),target:targetKey_(v[5]),title:v[6],place:v[7],note:v[8]};});
 const schedule=(sheet.after||[]).map(function(a){const aft=isAfterschoolTitle_(a.title);return Object.assign({},a,{afterschool:aft,info:!aft,allDay:!aft&&HOLIDAY_.test(a.title)});});
 out.afterschool=schedule.filter(function(a){return a.afterschool;});out.sheetEvents=schedule.filter(function(a){return !a.afterschool;});out.sheetCalendar=sheetScheduleEvents_(schedule,0);out.common={target:"all",items:sheet.personal.common};
 const board=boardLoad_(me);out.boardPosts=board.boardPosts.map(function(b){return Object.assign({},b,{author:"공유 작성자",mine:false});});out.boardComments=[];
 Object.assign(out,certificationLoad_());out.companyInfo=companyInfo_(me);const co=companyLoad_(me);out.companyJobs=co.companyJobs;out.companyEvents=co.companyEvents;out.introAuthRequired=true;
 out.materials=rows_("materials").filter(function(r){return r.v[0]&&visible(r.v[2]);}).map(function(r){const v=r.v;return {id:v[0],title:v[1],target:targetKey_(v[2]),category:v[3],body:v[4],link:v[5],file:v[6],at:v[7]};});
 out.folderReady={materials:!!props_().MATERIAL_FOLDER};out.linksDeferred=!!(options&&options.deferLinks);out.driveMaterials=out.linksDeferred?[]:driveMaterials_(me);out.notionPages=[];out.noticeCalendar=noticeCalendarEvents_(out.notices);
 return out;
}

/* ===================== 화면 데이터 한 번에 ===================== */
function load_(me, options) {
  if(me.role==="guest")return publicLoad_(me,options);
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
    me: me, loginDisabled: NO_LOGIN_TEST_MODE && !INTRO_AUTH_, today: today_(), schoolYear: sy, tabsMissing: sheetData.tabsMissing.concat(bom.missing ? [TAB_BOM] : []),
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
 if(!meta||meta.fileIds.indexOf(id)<0||(me.role!=="teacher"&&me.role!=="guest"&&!matches_(targetKey_(notice.v[2]),me.group)))throw new Error("이 공지 첨부를 볼 권한이 없습니다");
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
  odt:"application/vnd.oasis.opendocument.text",doc:"application/msword",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xls:"application/vnd.ms-excel",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",ppt:"application/vnd.ms-powerpoint",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
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
  if(me.role==="guest"&&["notice","board","materials"].indexOf(r.v[5])<0)throw new Error("로그인하면 이 파일을 볼 수 있습니다");
  if(r.v[5]==="portfolio"){const entry=record_("portfolio",r.v[6]);visible=entry.v[7]===id&&(me.role==="teacher"||entry.v[1]===me.name);}
  if(r.v[5]==="materials"){const entry=record_("materials",r.v[6]);visible=entry.v[6]===id&&(me.role==="teacher"||me.role==="guest"||matches_(targetKey_(entry.v[2]),me.group));}
  if(r.v[5]==="project"){project_(me,r.v[6]);visible=true;}
  if(r.v[5]==="board"){const entry=record_("board",r.v[6]);visible=entry.v[12]!=="1"&&boardFileIds_(entry.v[9]).indexOf(id)>=0;}
  if(r.v[5]==="intro"){const entry=record_("experienceIntro",r.v[6]);visible=INTRO_AUTH_&&(entry.v[8]===id||introExtraFiles_(entry).indexOf(id)>=0)&&((me.role==="teacher"&&entry.v[3]!=="초안")||(!String(entry.v[0]).startsWith("introPublic")&&entry.v[1]===me.name));}
  if(r.v[5]==="journal"){journalAccess_(me);const entry=record_("journals",r.v[6]);visible=entry.v[9]!=="1"&&boardFileIds_(entry.v[6]).indexOf(id)>=0;}
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
  if(me.role==="guest"&&root!=="materials"&&!/^(cert|company):/.test(root))throw new Error("로그인하면 이 폴더를 볼 수 있습니다");
  if(root==="photos"){const id=props_().PHOTO_ALBUM_FOLDER;if(!id)throw new Error("사진첩 Drive 폴더를 먼저 연결해 주세요");return {key:root,label:"사진첩",folder:openSharedFolder_(id,"사진첩 Drive"),upload:me.role==="teacher",targets:false};}
  if (root === "materials") {
    const id = props_().MATERIAL_FOLDER; if (!id) throw new Error("자료실 Drive 폴더가 아직 연결되지 않았습니다");
    return { key: root, label: "자료실", folder: openSharedFolder_(id, "자료실 Drive"), upload: me.role === "teacher" || (me.role === "student" && props_().MATERIAL_STUDENT_UPLOAD !== "0"), targets: true };
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
  if (r.targets && me.role !== "teacher" && chain.length > 1) { const t = materialTarget_(chain[1].getName()); if (t && me.role !== "guest" && !matches_(t, me.group)) throw new Error("이 폴더를 볼 권한이 없습니다"); }
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
    if (r.targets && chain.length === 1) { const t = materialTarget_(f.getName()); if (t && !T && me.role !== "guest" && !matches_(t, me.group)) continue; folders.push({ id: f.getId(), name: f.getName(), target: t }); }
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
APP_TABS.experienceIntro={name:"앱_직무체험소개",head:["ID","이름","기업ID","상태","자기소개JSON","수정시각","교사의견","기업전달교사의견","제출파일"]};
STUDENT_NAME_COLS_.experienceIntro=[1];
const COMPANY_PUBLIC_FIELDS_={industry:"업종",products:"주요제품",intro:"기업소개",homepage:"홈페이지",address:"실제근무지",department:"담당부서",contactDesk:"공개연락창구",workHours:"출퇴근시간",breaks:"휴게시간",clothes:"복장",meals:"식사",transportSupport:"기숙사통근버스",commute:"교통안내",firstDay:"첫출근집결",preparation:"준비물",documents:"제출서류",safety:"안전교육",equipment:"보호구",payGuide:"급여수당안내",folderUrl:"자료폴더",checkedAt:"최종확인일"};
const INTRO_FIELDS_={jobInterest:"관심 직무",headline:"나를 소개하는 한 문장",motivation:"관심을 갖게 된 이유",strength:"나의 강점과 근거",experience:"프로젝트 및 실습 경험",skills:"배운 기술과 자격증",teamSafety:"협업 및 안전 태도",goals:"직무체험에서 배우고 싶은 것",portfolio:"포트폴리오 링크",schoolGrade:"학교·학과·학년",course:"참여 예정 과정",skillIndependent:"혼자 수행 가능한 도구·작업",skillGuided:"시범 후 가능한 도구·작업",skillNew:"아직 경험 없는 도구·작업",commute:"통근 방법·시간과 기숙사",availability:"참여 가능한 일정"};
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
function companyLoad_(me){const versions=introVersionInfo_(),info=companyInfo_(me),ids={};info.forEach(function(c){ids[c.id]=c;});const source=companySource_(),T=me.role==="teacher";return {introAuthRequired:!INTRO_AUTH_,companyResources:companyResources_(me),companySourceError:T?source.error||"":"",companyJobs:source.jobs.filter(function(j){return ids[j.company]&&(T||j.open);}),companyEvents:source.events.filter(function(e){return ids[e.company]&&(T||e.open);}).map(function(e){return Object.assign({},e,{title:"기업 · "+ids[e.company].name+" · "+e.title,target:"all"});}),experienceIntros:rows_("experienceIntro").filter(function(r){return INTRO_AUTH_&&(T?r.v[3]!=="초안":!String(r.v[0]).startsWith("introPublic")&&r.v[1]===me.name);}).map(function(r){let a={};try{a=JSON.parse(r.v[4]||"{}");}catch(ignore){}return Object.assign({id:r.v[0],name:r.v[1],company:r.v[2],companyName:(ids[r.v[2]]||{}).name||"이전 선택 기업",status:r.v[3],answers:a,updated:r.v[5],feedback:r.v[6]||"",teacherNote:r.v[7]||"",file:r.v[8]||"",fileName:r.v[8]?((rows_("files").find(function(f){return f.v[0]===r.v[8];})||{v:[]}).v[2]||""):"",extraFiles:introExtraFiles_(r).map(function(fid){return {id:fid,name:(rows_("files").find(function(f){return f.v[0]===fid;})||{v:[]}).v[2]||"추가 파일"};})},versions[r.v[0]]||{isLatest:true,introGroup:r.v[0],version:1,versionCount:1});})};}
function validateCompanyTemplate_(id){const book=SpreadsheetApp.openById(id),sh=book.getSheetByName("작성양식");if(!sh||book.getSheets().length!==1)throw new Error("배포용 빈 작성양식 시트를 연결해 주세요");const rows=sh.getDataRange().getDisplayValues();if(!rows[4]||rows[4][0]!=="항목"||rows[4][1]!=="작성 내용")throw new Error("빈 양식의 항목·작성 내용 열을 확인해 주세요");if(rows.slice(5).some(function(r){return String(r[1]||"").trim();}))throw new Error("원본 양식에 답변이 입력되어 있습니다. 빈 양식을 연결하고 작성본은 별도 사본으로 관리해 주세요");return true;}
function saveCompanyResources_(p){return withLock_(function(){const id=companySheetId_(p.sheetUrl);if(id){const book=SpreadsheetApp.openById(id);companyRows_(book,"기업정보",["기업ID","기업명","학생공개"]);companyRows_(book,"기업직무",["직무ID","기업ID","직무명","학생공개"]);companyRows_(book,"기업일정",["일정ID","기업ID","학생공개","제목","시작일"]);}const links={};["companyTemplate","introTemplate"].forEach(function(k){const v=p[k]||"";if(v){const tid=companySheetId_(v);validateCompanyTemplate_(tid);links[k]="https://docs.google.com/spreadsheets/d/"+tid+"/edit";}else links[k]="";});PropertiesService.getScriptProperties().setProperties({COMPANY_INFO_SHEET:id,COMPANY_REQUEST_TEMPLATE:links.companyTemplate,EXPERIENCE_INTRO_TEMPLATE:links.introTemplate});PROPS_=null;COMPANY_SOURCE_=null;CacheService.getScriptCache().remove("company_source_v1");CacheService.getScriptCache().remove("company_home_v1");return {connected:!!id};});}
function seedCompanySource_(){return withLock_(function(){const id=props_().COMPANY_INFO_SHEET;if(!id)throw new Error("기업정보 관리 시트를 먼저 연결해 주세요");const book=SpreadsheetApp.openById(id),sh=book.getSheetByName("기업정보"),heads=sh.getDataRange().getDisplayValues()[0],have={};companyRows_(book,"기업정보",["기업ID","기업명","학생공개"]).forEach(function(r){have[r["기업ID"]]=true;});let n=0;rows_("companies").forEach(function(r){const v=r.v;if(!v[0]||have[v[0]])return;const vals={"기업ID":v[0],"기업명":v[1],"학생공개":v[11]==="0"?"0":"1","업종":v[7],"기업소개":v[9],"홈페이지":v[10],"실제근무지":v[2],"담당부서":v[8]};writeCells_(sh,sh.getLastRow()+1,heads.map(function(h){return vals[h]||"";}));have[v[0]]=true;n++;});COMPANY_SOURCE_=null;CacheService.getScriptCache().remove("company_source_v1");CacheService.getScriptCache().remove("company_home_v1");return {added:n};});}
function companyFolder_(me,id){const c=companyInfo_(me).find(function(c){return c.id===id;});if(!c)throw new Error("이 기업의 자료를 볼 권한이 없습니다");const fid=driveFolderId_(c.folderUrl);if(!fid)throw new Error("기업 자료실 폴더가 아직 연결되지 않았습니다");return {company:c,folder:openSharedFolder_(fid,c.name+" 자료실")};}
function createCompanyFolder_(id){return withLock_(function(){const me={role:"teacher"},c=companyInfo_(me).find(function(c){return c.id===id;});if(!c)throw new Error("기업을 선택해 주세요");if(c.folderUrl)return {url:companyFolder_(me,id).folder.getUrl()};const f=folderFor_(["기업자료실",id+" · "+c.name]);PropertiesService.getScriptProperties().setProperty("COMPANY_FOLDER_"+id,f.getId());if(props_().COMPANY_INFO_SHEET){const sh=SpreadsheetApp.openById(props_().COMPANY_INFO_SHEET).getSheetByName("기업정보"),grid=sh.getDataRange().getDisplayValues(),head=grid[0],ic=head.indexOf("기업ID"),fc=head.indexOf("자료폴더");if(fc<0)throw new Error("기업정보 시트의 자료폴더 열을 확인해 주세요");grid.slice(1).some(function(row,i){if(row[ic]!==id)return false;sh.getRange(i+2,fc+1).setValue("https://drive.google.com/drive/folders/"+f.getId());return true;});}PROPS_=null;COMPANY_SOURCE_=null;CacheService.getScriptCache().remove("company_source_v1");CacheService.getScriptCache().remove("company_home_v1");return {url:f.getUrl()};});}
/* 제출본 HTML은 인증한 학생·교사만 열며, 초안과 검토 의견은 공유하지 않습니다. */
function introDocument_(me,p){
 if(!INTRO_AUTH_||["student","teacher"].indexOf(me.role)<0)throw Error("학생 또는 선생님으로 로그인해 주세요");
 const entry=record_("experienceIntro",p.id);if(STUDENT_LOGIN_REQUIRED_&&me.role==="student"){const owner=studentAccount_(entry.v[1]);if(!owner||!owner.active)throw Error("등록된 3반 학생의 제출본만 볼 수 있습니다");}if(entry.v[3]==="초안")throw Error("제출된 자기소개서만 볼 수 있습니다");if(!entry.v[8])return {name:entry.v[1]+" 자기소개서",html:introAnswersHtml_(entry)};
 const meta=record_("files",entry.v[8]);if(meta.v[5]!=="intro"||meta.v[6]!==entry.v[0]||!/\.docx$/i.test(meta.v[2]))throw Error("Word .docx 파일만 HTML로 볼 수 있습니다. 원본 파일을 이용해 주세요.");
 const source=DriveApp.getFileById(entry.v[8]);if(source.getSize()>8*1024*1024)throw Error("8MB 이하 Word 파일만 변환할 수 있습니다");const bytes=source.getBlob().getBytes(),f={name:meta.v[2]};
 try{const word=wordHtml_(Utilities.newBlob(bytes,"application/zip",f.name),f.name);let parts=null;try{parts=introDocxParts_(Utilities.newBlob(bytes,"application/zip",f.name));}catch(ignore){}if(parts){if(!parts.name)parts.name=entry.v[1];return {name:f.name,html:introCardHtml_(parts,entry.v[1]+' 자기소개서','Word 제출본에서 자동으로 정리했습니다. 원문 모양은 \'Word 모양\'에서 볼 수 있습니다.'),wordHtml:word,card:true};}return {name:f.name,html:word};}catch(e){throw Error("Word 파일을 변환하지 못했습니다. 암호가 없는 .docx 파일인지 확인하거나 원본 파일을 열어 주세요.");}
}
function wordHtml_(blob,title){
 const parts=Utilities.unzip(blob),files=Object.create(null);let total=0;
 if(parts.length>250)throw Error("too many parts");parts.forEach(function(b){total+=b.getBytes().length;if(total>20*1024*1024)throw Error("too large");files[b.getName()]=b;});
 const ns=XmlService.getNamespace("http://schemas.openxmlformats.org/wordprocessingml/2006/main"),relNs=XmlService.getNamespace("http://schemas.openxmlformats.org/officeDocument/2006/relationships");
 const esc=function(v){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");};
 function parse(name){const b=files[name];if(!b)return null;const text=b.getDataAsString("UTF-8");if(text.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(text))throw Error("invalid xml");return XmlService.parse(text).getRootElement();}
 function child(e,n){return e&&e.getChild(n,ns);}
 function attr(e,n){const a=e&&e.getAttribute(n,ns);return a?a.getValue():"";}
 function val(e,n){return attr(child(e,n),"val");}
 function on(e,n){const c=child(e,n);return !!c&&!/^(0|false|off)$/.test(attr(c,"val"));}
 function num(v,min,max){v=Number(v);return isFinite(v)?Math.max(min,Math.min(max,v)):min;}
 function color(v){return /^[a-f\d]{6}$/i.test(v)?"#"+v:"";}
 const styles=Object.create(null),styleRoot=parse("word/styles.xml");if(styleRoot)styleRoot.getChildren("style",ns).forEach(function(s){styles[attr(s,"styleId")]=s;});
 function styleChain(id,seen){seen=seen||[];if(!id||seen.indexOf(id)>=0||seen.length>10||!styles[id])return [];const s=styles[id];return styleChain(val(s,"basedOn"),seen.concat(id)).concat(s);}
 function format(pr,run){if(!pr)return "";let css="";if(run){if(on(pr,"b"))css+="font-weight:700;";if(on(pr,"i"))css+="font-style:italic;";if(child(pr,"u")&&val(pr,"u")!=="none")css+="text-decoration:underline;";if(on(pr,"strike"))css+="text-decoration:line-through;";const size=val(pr,"sz"),c=color(val(pr,"color"));if(size)css+="font-size:"+num(Number(size)/2,8,48)+"pt;";if(c)css+="color:"+c+";";const vertical=val(pr,"vertAlign");if(vertical==="superscript"||vertical==="subscript")css+="vertical-align:"+(vertical==="superscript"?"super":"sub")+";";}
 else{const align=val(pr,"jc");if(["left","center","right","both"].indexOf(align)>=0)css+="text-align:"+(align==="both"?"justify":align)+";";const space=child(pr,"spacing");["before","after"].forEach(function(k){const v=attr(space,k);if(v)css+="margin-"+(k==="before"?"top":"bottom")+":"+num(Number(v)/20,0,60)+"pt;";});if(on(pr,"pageBreakBefore"))css+="break-before:page;";}
 return css;}
 const relationships=Object.create(null),rels=parse("word/_rels/document.xml.rels");if(rels)rels.getChildren().forEach(function(r){const a=function(k){const x=r.getAttribute(k);return x?x.getValue():"";};if(a("TargetMode")!=="External")relationships[a("Id")]=a("Target");});
 let nodes=0,imageBytes=0;const warnings=Object.create(null);
 function render(e,depth){if(++nodes>25000||depth>35)throw Error("complex document");const name=e.getName();
 if(name==="del"||name==="instrText"||name==="delText")return "";
 if(name==="t")return esc(e.getText());if(name==="tab")return "&emsp;";if(name==="br"||name==="cr")return "<br>";
 if(name==="blip"){const a=e.getAttribute("embed",relNs),target=a&&relationships[a.getValue()],m=target&&target.match(/^media\/([\w .()-]+\.(png|jpe?g|gif|webp))$/i),b=m&&files["word/"+target];if(!b){warnings.image=true;return "";}const bytes=b.getBytes();imageBytes+=bytes.length;if(imageBytes>2*1024*1024){warnings.image=true;return "";}const ext=m[2].toLowerCase();return '<img alt="문서에 포함된 이미지" src="data:image/'+(ext==="jpg"?"jpeg":ext)+';base64,'+Utilities.base64Encode(bytes)+'">';}
 if(name==="p"){const pr=child(e,"pPr"),id=val(pr,"pStyle"),chain=styleChain(id),tag=id==="Title"?"h1":/^Heading[1-6]$/i.test(id)?"h"+id.slice(-1):"p";let css="";chain.forEach(function(s){css+=format(child(s,"pPr"),false)+format(child(s,"rPr"),true);});css+=format(pr,false)+format(child(pr,"rPr"),true);const text=e.getChildren().filter(function(x){return x.getName()!=="pPr";}).map(function(x){return render(x,depth+1);}).join("");return '<'+tag+' style="'+css+'">'+(child(pr,"numPr")?'• ':'')+(text||"<br>")+"</"+tag+">";}
 if(name==="r"){const pr=child(e,"rPr");if(on(pr,"vanish"))return "";let css="";styleChain(val(pr,"rStyle")).forEach(function(s){css+=format(child(s,"rPr"),true);});css+=format(pr,true);return '<span style="'+css+'">'+e.getChildren().filter(function(x){return x.getName()!=="rPr";}).map(function(x){return render(x,depth+1);}).join("")+"</span>";}
 if(name==="tbl"){const grid=child(e,"tblGrid"),widths=grid?grid.getChildren("gridCol",ns).map(function(x){return num(attr(x,"w"),1,20000);}):[],sum=widths.reduce(function(a,b){return a+b;},0),rows=e.getChildren("tr",ns),active=Object.create(null),out=[];
 rows.forEach(function(row){let col=0;const cells=[];row.getChildren("tc",ns).forEach(function(cell){const pr=child(cell,"tcPr"),span=Math.floor(num(val(pr,"gridSpan")||1,1,40)),merge=child(pr,"vMerge");if(merge&&attr(merge,"val")!=="restart"&&active[col]){active[col].rows++;col+=span;return;}const rec={rows:1,span:span,html:cell.getChildren().filter(function(x){return x.getName()!=="tcPr";}).map(function(x){return render(x,depth+1);}).join(""),bg:color(attr(child(pr,"shd"),"fill")),align:val(pr,"vAlign")};for(let j=col;j<col+span;j++)delete active[j];if(merge)active[col]=rec;cells.push(rec);col+=span;});out.push(cells);});
 return '<table>'+(sum?'<colgroup>'+widths.map(function(w){return '<col style="width:'+(w/sum*100).toFixed(2)+'%">';}).join("")+'</colgroup>':'')+'<tbody>'+out.map(function(row){return '<tr>'+row.map(function(c){return '<td colspan="'+c.span+'" rowspan="'+c.rows+'" style="'+(c.bg?'background:'+c.bg+';':'')+(c.align==='center'?'vertical-align:middle;':'')+'">'+c.html+'</td>';}).join("")+'</tr>';}).join("")+'</tbody></table>';}
 if(name==="altChunk"){warnings.extra=true;return "";}if(/Pr$/.test(name)||name==="sectPr")return "";
 return e.getChildren().map(function(x){return render(x,depth+1);}).join("");}
 const doc=parse("word/document.xml"),body=child(doc,"body");if(!body)throw Error("missing body");const html=render(body,0);
 return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src '+"'none'; img-src data:; style-src 'unsafe-inline'"+'"><title>'+esc(title)+'</title><style>body{margin:0;background:#edf0f3;color:#202830;font:11pt/1.65 "Malgun Gothic",sans-serif}.paper{box-sizing:border-box;max-width:210mm;min-height:297mm;margin:20px auto;padding:16mm 18mm;background:white;box-shadow:0 2px 14px #0001}h1{font-size:20pt;text-align:center;color:#172b3a;margin:0 0 18px}h2,h3{color:#172b3a}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 8px}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:12px 0;break-inside:avoid}td{border:1px solid #becbd4;padding:10px 12px;vertical-align:top;overflow-wrap:anywhere}td p:last-child{margin-bottom:0}img{max-width:100%;height:auto}.note{color:#596873;font-size:9pt;margin-bottom:18px}@media(max-width:700px){.paper{margin:0;min-height:100vh;padding:20px 14px;box-shadow:none}td{padding:8px}}@media print{body{background:white}.paper{box-shadow:none;margin:0;padding:0;min-height:0}@page{size:A4;margin:16mm}}</style></head><body><article class="paper">'+((warnings.image||warnings.extra)?'<p class="note">일부 그림·삽입 개체는 원본 파일에서 확인해 주세요.</p>':'')+html+'</article></body></html>';
}
/* 제출한 Word(.docx)를 양식의 6개 질문으로 나눕니다. 양식 제목을 찾지 못하면 null(그때는 Word 모양 그대로 보여 줌). */
const INTRO_CARD_Q_=[["나를 소개하는 한 문장",/나를\s*소개/,"관심 직무와 자신의 특징을 짧게 소개해 주세요."],["지원하거나 관심을 갖게 된 이유",/지원하거나|관심을\s*갖게/,"기업에서 어떤 일을 해 보고 싶은가요?"],["실습·프로젝트 경험",/실습|프로젝트/,"무엇을 만들었고, 본인이 맡은 일은 무엇인가요?"],["배운 기술·사용해 본 도구·자격증",/배운\s*기술|사용해\s*본|자격증/,"사용해 본 공구·장비나 취득·준비 중인 자격증을 적어 주세요."],["나의 장점과 실제 사례",/장점/,"시간 준수·안전·협업 등 실제 경험을 한 가지 적어 주세요."],["기업에서 배우고 싶은 것",/배우고\s*싶은/,"직무체험에서 해 보고 싶은 일이나 궁금한 점을 적어 주세요."]];
function introDocxParts_(blob){
 const parts=Utilities.unzip(blob),files=Object.create(null);let total=0;if(parts.length>250)throw Error("too many parts");
 parts.forEach(function(b){total+=b.getBytes().length;if(total>20*1024*1024)throw Error("too large");files[b.getName()]=b;});
 const doc=files["word/document.xml"];if(!doc)return null;const text=doc.getDataAsString("UTF-8");if(text.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(text))return null;
 const ns=XmlService.getNamespace("http://schemas.openxmlformats.org/wordprocessingml/2006/main"),relNs=XmlService.getNamespace("http://schemas.openxmlformats.org/officeDocument/2006/relationships");
 const rels=Object.create(null),relDoc=files["word/_rels/document.xml.rels"];if(relDoc)XmlService.parse(relDoc.getDataAsString("UTF-8")).getRootElement().getChildren().forEach(function(r){const id=r.getAttribute("Id"),t=r.getAttribute("Target"),m=r.getAttribute("TargetMode");if(id&&t&&!(m&&m.getValue()==="External"))rels[id.getValue()]=t.getValue();});
 const paras=[];let image="",nodes=0;
 function walk(e,acc){if(++nodes>40000)throw Error("complex");const n=e.getName();if(n==="del"||n==="delText"||n==="instrText")return;
  if(n==="t"){acc.push(e.getText());return;}if(n==="tab"){acc.push(" ");return;}if(n==="br"||n==="cr"){acc.push("\n");return;}
  if(n==="blip"&&!image){const a=e.getAttribute("embed",relNs),t=a&&rels[a.getValue()],m=t&&t.match(/^media\/([\w .()-]+\.(png|jpe?g|gif|webp))$/i),b=m&&files["word/"+t];if(b&&b.getBytes().length<=2*1024*1024){const ext=m[2].toLowerCase();image="data:image/"+(ext==="jpg"?"jpeg":ext)+";base64,"+Utilities.base64Encode(b.getBytes());}return;}
  if(n==="p"){const mine=[];e.getChildren().forEach(function(c){walk(c,mine);});paras.push(mine.join(""));return;}
  e.getChildren().forEach(function(c){walk(c,acc);});}
 walk(XmlService.parse(text).getRootElement(),[]);
 const out={name:"",grade:"",company:"",answers:["","","","","",""],image:image};let cur=-1,found=0;
 const blank=function(v){return String(v||"").replace(/_{2,}/g," ").replace(/[ \t ]+/g," ").trim();};
 for(let i=0;i<paras.length;i++){let t=String(paras[i]||"");const plain=t.replace(/\s+/g," ").trim();if(!plain)continue;
  if(/^작성 후 알림판|주민등록번호·상세 주소/.test(plain)&&found){cur=-1;continue;}
  const head=plain.match(/^([1-6])\s*[.)．]\s*/);
  if(head&&INTRO_CARD_Q_[Number(head[1])-1][1].test(plain.slice(0,40))){const q=Number(head[1])-1;cur=q;found++;let rest=plain.slice(head[0].length);const title=INTRO_CARD_Q_[q][0],hint=INTRO_CARD_Q_[q][2];if(rest.indexOf(title)===0)rest=rest.slice(title.length);rest=rest.replace(hint,"").trim();if(rest)out.answers[q]=blank(rest);continue;}
  if(cur<0){const m=plain.match(/이름\s*[:：]\s*(.*?)\s*학년\s*[:：]\s*(.*?)(?:\s*희망\s*기업[^:：]*[:：]\s*(.*))?$/);if(m){out.name=blank(m[1]);out.grade=blank(m[2]);out.company=blank(m[3]||"");}continue;}
  if(plain===INTRO_CARD_Q_[cur][2])continue;
  const v=blank(t.replace(INTRO_CARD_Q_[cur][2],""));if(v)out.answers[cur]=(out.answers[cur]?out.answers[cur]+"\n":"")+v;}
 out.answers=out.answers.map(function(v){return v.slice(0,3000);});
 return found>=3&&out.answers.filter(String).length>=2?out:null;
}
/* 소개서 카드 HTML(작성 가이드와 같은 디자인). 모든 글자는 이스케이프하고, 그림은 data: 주소만 허용합니다. */
function introCardHtml_(d,title,note){
 const esc=function(v){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");};
 const A=d.answers||[],grade=/^[1-3]$/.test(String(d.grade||"").trim())?d.grade+"학년":(d.grade||""),meta=[grade,d.company?"희망 기업: "+d.company:""].filter(String);
 let goals=A[5]||"",ask="";const qm=goals.match(/[^.!?\n]*(\?|궁금)[^.!?\n]*[.!?]?/);if(qm){ask=qm[0].trim();goals=goals.replace(qm[0],"").replace(/\n{2,}/g,"\n").trim();}
 const items=String(A[3]||"").split(/[,，、\n]|\s+및\s+/).map(function(x){return x.trim().replace(/[.。]$/,"");}).filter(String),chips=items.length>=2&&items.length<=10&&items.every(function(x){return x.length<=24;});
 const sec=function(label,body,cls){return body?'<span class="lb">'+label+'</span><p class="'+(cls||"")+'">'+esc(body)+'</p>':"";};
 const left=(A[2]||d.image)?'<section><span class="lb">대표 프로젝트·실습 경험</span>'+(d.image?'<div class="photo"><img alt="소개서에 넣은 사진" src="'+esc(d.image)+'"></div>':"")+(A[2]?'<p>'+esc(A[2]).replace(/\((상황|내가 한 일|결과|배운 점)\)/g,'<b class="mk">$1</b>')+'</p>':"")+'</section>':"";
 const right=sec("지원하거나 관심을 갖게 된 이유",A[1])+sec("나의 장점과 실제 사례",A[4],"ev")+sec("기업에서 배우고 싶은 것",goals)+(!chips&&A[3]?sec("배운 기술·도구·자격증",A[3]):"");
 return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src '+"'none'; img-src data:; style-src 'unsafe-inline'"+'"><title>'+esc(title)+'</title><style>'
 +':root{--paper:#fff;--ink:#18201b;--muted:#5b665f;--line:#d8dfd9;--mask:#1d6b4f;--soft:#e3efe8;--copper:#b5652b;--bg:#f3f5f2}@media(prefers-color-scheme:dark){:root{--paper:#18201b;--ink:#e7ede8;--muted:#9fb0a5;--line:#2c3830;--mask:#5fc49a;--soft:#1d3329;--copper:#e09a62;--bg:#111612}}'
 +'body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 "IBM Plex Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif}main{max-width:900px;margin:0 auto;padding:20px 16px 32px}'
 +'.sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden}.sh{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:baseline;padding:16px 20px;border-bottom:2px solid var(--mask)}.nm{font-weight:800;font-size:22px}.meta{color:var(--muted);font-size:13.5px;display:flex;gap:4px 14px;flex-wrap:wrap}'
 +'.hl{padding:18px 20px 6px;margin:0;font-weight:700;font-size:19px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 20px 16px}.chips span{font-size:12.5px;background:var(--soft);color:var(--mask);padding:4px 9px;border-radius:999px;font-weight:600}'
 +'.grid{display:grid;grid-template-columns:1.25fr 1fr;border-top:1px solid var(--line)}.grid>section{padding:16px 20px;min-width:0;display:grid;gap:8px;align-content:start}.grid>section+section{border-left:1px solid var(--line)}'
 +'.lb{font-size:11.5px;font-weight:700;color:var(--muted);letter-spacing:.04em}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.ev{border-left:3px solid var(--copper);padding-left:12px}.mk{color:var(--copper);font-size:12px;margin:0 2px}'
 +'.photo{border-radius:6px;overflow:hidden;background:var(--soft)}.photo img{display:block;width:100%;max-height:340px;object-fit:contain}.ask{margin:0;padding:14px 20px 18px;border-top:1px dashed var(--line)}.ask b{display:block;font-size:16px}'
 +'.note{color:var(--muted);font-size:12.5px;margin:10px 2px 0}@media(max-width:640px){.grid{grid-template-columns:1fr}.grid>section+section{border-left:0;border-top:1px solid var(--line)}.sh,.hl,.chips,.grid>section,.ask{padding-left:14px;padding-right:14px}}@media print{body{background:#fff}main{padding:0}.note{display:none}}'
 +'</style></head><body><main><article class="sheet"><div class="sh"><span class="nm">'+esc(d.name||"이름 없음")+'</span><div class="meta">'+meta.map(function(m){return '<span>'+esc(m)+'</span>';}).join("")+'</div></div>'
 +(A[0]?'<p class="hl">'+esc(A[0])+'</p>':"")+(chips?'<div class="chips">'+items.map(function(x){return '<span>'+esc(x)+'</span>';}).join("")+'</div>':"")
 +((left||right)?'<div class="grid">'+left+(right?'<section>'+right+'</section>':"")+'</div>':"")+(ask?'<p class="ask"><span class="lb">기업에 묻고 싶은 질문</span><b>'+esc(ask)+'</b></p>':"")
 +'</article><p class="note">'+esc(note||"")+'</p></main></body></html>';
}
function introFolder_(){const props=PropertiesService.getScriptProperties();let id=props.getProperty("INTRO_SUBMISSION_FOLDER");if(id)return DriveApp.getFolderById(id);const f=DriveApp.createFolder("기업 제출용 자기소개서 (교사 보관)");props.setProperty("INTRO_SUBMISSION_FOLDER",f.getId());return f;}
/* 새 제출 행이 뒤에 추가되는 순서를 사용합니다. 교사 검토 수정은 대표본을 바꾸지 않습니다. */
function introVersionInfo_(){
 const groups=Object.create(null),out=Object.create(null),files=Object.create(null);rows_("files").forEach(function(r){files[r.v[0]]=r.v;});
 rows_("experienceIntro").forEach(function(r){if(!r.v[0]||r.v[3]==="초안")return;let a={};try{a=JSON.parse(r.v[4]||"{}");}catch(ignore){}const m=String(a.schoolGrade||"").match(/([123])\s*학년/),grade=m?m[1]+"학년":"학년 미입력",group=JSON.stringify([String(r.v[1]||"").trim(),grade]);(groups[group]||(groups[group]=[])).push(r);});
 Object.keys(groups).forEach(function(group){const items=groups[group];items.forEach(function(r,i){const f=files[r.v[8]],a=JSON.parse(group);out[r.v[0]]={introGroup:group,grade:a[1],version:i+1,versionCount:items.length,isLatest:i===items.length-1,submittedAt:f&&f[5]==="intro"&&f[6]===r.v[0]?f[7]||"":""};});});return out;
}
function introSubmissionList_(me){
 const seen=Object.create(null),list=[],shared=!!(me&&((INTRO_AUTH_&&["student","teacher"].indexOf(me.role)>=0)||(PUBLIC_ACCESS_ENABLED_&&PUBLIC_VIEW_ALL_&&me.role==="guest"))),versions=introVersionInfo_(),files=Object.create(null);rows_("files").forEach(function(r){files[r.v[0]]=r.v;});
 rows_("experienceIntro").forEach(function(r){const v=versions[r.v[0]];if(!v)return;if(STUDENT_LOGIN_REQUIRED_&&me.role==="student"){const owner=studentAccount_(r.v[1]);if(!owner||!owner.active)return;}let item=seen[v.introGroup];if(!item){item={name:String(r.v[1]||""),grade:v.grade,status:"제출 완료"};if(shared){item.documents=[];item.history=[];item.count=v.versionCount;}seen[v.introGroup]=item;list.push(item);}if(!shared)return;
 const f=files[r.v[8]],documents=[];let a={};try{a=JSON.parse(r.v[4]||"{}");}catch(ignore){}
 if(!r.v[8]&&Object.keys(INTRO_FIELDS_).some(function(k){return k!=="schoolGrade"&&String(a[k]||"").trim();}))documents.push({id:r.v[0],label:"이전 온라인 작성본 HTML"});else if(f&&f[5]==="intro"&&f[6]===r.v[0]&&/\.docx$/i.test(f[2]))documents.push({id:r.v[0],label:"Word 제출본 HTML"});
 const entry={id:r.v[0],version:v.version,submittedAt:v.submittedAt,fileName:(f&&f[5]==="intro"&&f[6]===r.v[0]?f[2]:"이전 온라인 작성본")+(introExtraFiles_(r).length?" 외 "+introExtraFiles_(r).length+"개":""),documents:documents};if(v.isLatest){item.latest=entry;item.documents=documents;}else item.history.unshift(entry);
 });return list.sort(function(a,b){return a.grade.localeCompare(b.grade,"ko")||a.name.localeCompare(b.name,"ko");});
}
function introAnswersHtml_(entry){let a={};try{a=JSON.parse(entry.v[4]||"{}");}catch(e){}const g=function(k){return String(a[k]||"").trim();};
 return introCardHtml_({name:entry.v[1],grade:g("schoolGrade"),company:"",answers:[g("headline"),g("motivation"),g("experience"),g("skills"),[g("strength"),g("teamSafety")].filter(String).join("\n"),g("goals")],image:""},entry.v[1]+" 자기소개서","온라인으로 작성한 이전 제출본입니다.");}
function submitPublicIntro_(p){
 if(p.mode!=="file")throw Error("자기소개서는 파일로만 제출할 수 있습니다");
 const name=clean_(p.name,40).trim(),grade=String(p.grade||"");
 if(!name||!['1','2','3'].includes(grade))throw Error("이름과 학년을 입력해 주세요");
 if(!/^[a-zA-Z0-9-]{20,60}$/.test(String(p.submissionKey||"")))throw Error("제출 화면을 다시 열어 주세요");
 const safe={publicKey:String(p.submissionKey),company:"",status:"제출",confirm:p.confirm===true,mode:"file",upload:p.upload,uploads:Array.isArray(p.uploads)?p.uploads.slice(0,INTRO_MAX_FILES_+1):undefined,answers:{schoolGrade:grade+"학년"}};
 saveExperienceIntro_({role:"student",name:name},safe,true);return {submitted:true};
}
const INTRO_MAX_FILES_=5;
function introExtraFiles_(entry){try{const a=JSON.parse(entry.v[4]||"{}");return Array.isArray(a.extraFiles)?a.extraFiles.map(String):[];}catch(e){return [];}}
function saveExperienceIntro_(me,p,newOnly){if(p.mode!=="file")throw Error("자기소개서는 파일로만 제출할 수 있습니다");return withLock_(function(){
 if(newOnly&&rows_("experienceIntro").some(function(r){return r.v[0]==="introPublic"+p.publicKey;}))return true;
 const company=String(p.company||"");if(company&&!companyInfo_(me).some(function(c){return c.id===company;}))throw new Error("공개된 기업을 선택해 주세요");
 const old=newOnly?null:p.id?record_("experienceIntro",p.id):rows_("experienceIntro").find(function(r){return !String(r.v[0]).startsWith("introPublic")&&r.v[1]===me.name&&r.v[2]===company;});if(old&&(String(old.v[0]).startsWith("introPublic")||old.v[1]!==me.name))throw new Error("내 자기소개만 수정할 수 있습니다");
 if(!newOnly&&rows_("experienceIntro").some(function(r){return !String(r.v[0]).startsWith("introPublic")&&r.v[1]===me.name&&r.v[2]===company&&(!old||r.v[0]!==old.v[0]);}))throw new Error("이 기업의 기존 자기소개를 수정해 주세요");
 if(["초안","제출"].indexOf(p.status)<0)throw new Error("저장 상태를 선택해 주세요");
 const state=p.status,answers={},fileMode=p.mode==="file";let prior={};try{prior=JSON.parse(old?old.v[4]||"{}":"{}");}catch(ignore){}
 Object.keys(INTRO_FIELDS_).forEach(function(k){const val=p.answers===undefined?prior[k]:(p.answers||{})[k];answers[k]=k==="portfolio"&&state==="제출"?urlValid_(val):clean_(val,k==="headline"?150:2500).trim();});
 if(state==="제출"&&p.compactVersion&&Object.keys(answers).reduce(function(n,k){return n+answers[k].length;},0)>1200)throw new Error("소개서는 1쪽을 기준으로 답변 전체를 1,200자 이내로 정리해 주세요");
 if(state==="제출"){if(p.confirm!==true)throw new Error("작성 내용을 확인해 주세요");if(!fileMode)["headline","motivation","strength","experience","goals"].forEach(function(k){if(!answers[k])throw new Error(INTRO_FIELDS_[k]+" 항목을 작성해 주세요");});}
 const id=newOnly?"introPublic"+p.publicKey:old?old.v[0]:uid_("intro");let file=old?old.v[8]||"":"";if(Array.isArray(prior.extraFiles))answers.extraFiles=prior.extraFiles;
 if(fileMode){const list=(Array.isArray(p.uploads)&&p.uploads.length?p.uploads:[p.upload]).filter(Boolean);if(!list.length)throw new Error("작성한 파일을 선택해 주세요 (파일당 8MB 이하)");if(list.length>INTRO_MAX_FILES_)throw new Error("파일은 한 번에 "+INTRO_MAX_FILES_+"개까지 낼 수 있습니다");let total=0;
  list.forEach(function(u){if(!u||!u.base64||u.staged)throw new Error("작성한 파일을 선택해 주세요 (파일당 8MB 이하)");if(!/\.(docx?|hwpx?|odt|pdf|xlsx?|txt|png|jpe?g|heic|webp)$/i.test(String(u.name||"")))throw new Error("문서, PDF, 엑셀 또는 사진 파일을 골라 주세요: "+String(u.name||"").slice(0,60));const n=Utilities.base64Decode(u.base64).length;if(String(u.base64).length>8*1024*1024*1.37||n>8*1024*1024)throw new Error("파일을 8MB 이하로 줄여 주세요: "+String(u.name||"").slice(0,60));total+=n;});
  if(total>20*1024*1024)throw new Error("한 번에 내는 파일은 모두 합쳐 20MB 이하로 해 주세요");
  const folder=introFolder_();file=storeFile_(me,list[0],"intro",id,folder);answers.extraFiles=list.slice(1).map(function(u){return storeFile_(me,u,"intro",id,folder);});}
 upsert_("experienceIntro",id,[id,me.name,company,state,JSON.stringify(answers),now_(),old?old.v[6]:"",old?old.v[7]||"":"",file]);syncIntroManagementIfReady_();return id;
});}
function reviewExperienceIntro_(p){return withLock_(function(){const r=record_("experienceIntro",p.id);if(r.v[3]==="초안")throw new Error("제출된 자기소개만 검토할 수 있습니다");if(["확인","보완요청"].indexOf(p.status)<0)throw new Error("검토 상태를 선택해 주세요");const v=r.v.slice(0,9);v[7]=p.teacherNote===undefined?r.v[7]||"":clean_(p.teacherNote,700);v[3]=p.status;v[5]=now_();v[6]=clean_(p.feedback,2000);writeCells_(sheet_("experienceIntro"),r._row,v);syncIntroManagementIfReady_();return true;});}
/* 제출관리 시트는 실행 계정 소유의 별도 비공개 파일이며 학생/자료실 응답에 포함하지 않습니다. */
function syncIntroManagementIfReady_(){if(!PropertiesService.getScriptProperties().getProperty("INTRO_MANAGEMENT_SHEET_ID"))return;try{syncIntroManagement_(false);}catch(e){PropertiesService.getScriptProperties().setProperty("INTRO_MANAGEMENT_SYNC_ERROR","시트 동기화가 필요합니다. 교사 화면에서 취합 시트를 다시 열어 주세요.");}}
function syncIntroManagement_(create){
 const props=PropertiesService.getScriptProperties();let id=props.getProperty("INTRO_MANAGEMENT_SHEET_ID"),book;
 if(id){try{book=SpreadsheetApp.openById(id);}catch(e){throw Error("기존 소개서 취합 시트에 접근할 수 없습니다. 파일 권한을 확인해 주세요.");}}
 else if(create){book=SpreadsheetApp.create("예비도제학생 사전 소개서 제출관리 교사 전용");id=book.getId();props.setProperty("INTRO_MANAGEMENT_SHEET_ID",id);PROPS_=null;}else return null;
 const sh=book.getSheets()[0],keys=Object.keys(INTRO_FIELDS_),head=["기록ID","이름","관심 기업","상태","수정시각"].concat(keys.map(function(k){return INTRO_FIELDS_[k];}),["학생 보완 의견 기업전달 제외","기업 전달용 교사 의견","제출파일","대표구분","제출순서","총제출수"]);
 const companies={};companyInfo_({role:"teacher"}).forEach(function(c){companies[c.id]=c.name;});
 const versions=introVersionInfo_(),submitted=rows_("experienceIntro").filter(function(r){return r.v[0]&&r.v[3]!=="초안";}).sort(function(a,b){const x=versions[a.v[0]],y=versions[b.v[0]];return Number(y.isLatest)-Number(x.isLatest)||x.introGroup.localeCompare(y.introGroup,"ko")||y.version-x.version;}),values=[head];
 submitted.forEach(function(r){let a={};try{a=JSON.parse(r.v[4]||"{}");}catch(ignore){}values.push([r.v[0],r.v[1],r.v[2]?companies[r.v[2]]||"이전 선택 기업":"기업 미정",r.v[3],r.v[5]].concat(keys.map(function(k){return a[k]||"";}),[r.v[6]||"",r.v[7]||"",r.v[8]?"https://drive.google.com/file/d/"+r.v[8]+"/view":"",versions[r.v[0]].isLatest?"최신 대표":"이전 이력",versions[r.v[0]].version,versions[r.v[0]].versionCount]));});
 const old=sh.getLastRow();if(old>values.length)for(let i=values.length;i<old;i++)values.push(head.map(function(){return "";}));
 sh.getRange(1,1,values.length,head.length).setValues(values.map(function(row){return row.map(function(v){return typeof v==="string"&&/^\s*[=+@-]/.test(v)?"'"+v:v;});}));sh.setFrozenRows(1);
 if(typeof sh.setColumnWidths==="function"){sh.setColumnWidths(1,head.length,170);sh.setColumnWidth(1,130);sh.getRange(1,1,1,head.length).setFontWeight("bold").setBackground("#e8eef4");sh.getRange(1,1,Math.max(2,values.length),head.length).setWrap(true);if(!sh.getFilter())sh.getRange(1,1,Math.max(2,values.length),head.length).createFilter();}
 props.deleteProperty("INTRO_MANAGEMENT_SYNC_ERROR");return {url:book.getUrl()+"#gid="+sh.getSheetId(),submitted:submitted.length,confirmed:submitted.filter(function(r){return r.v[3]==="확인";}).length};
}
function companyTemplateFile_(me,p){const key=p.kind==="intro"?"EXPERIENCE_INTRO_TEMPLATE":p.kind==="company"&&me.role==="teacher"?"COMPANY_REQUEST_TEMPLATE":"";if(!key)throw new Error("이 양식을 받을 권한이 없습니다");const id=companySheetId_(props_()[key]);if(!id)throw new Error("양식이 아직 연결되지 않았습니다");validateCompanyTemplate_(id);const response=UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/"+id+"/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet",{headers:{Authorization:"Bearer "+ScriptApp.getOAuthToken()},muteHttpExceptions:true});if(response.getResponseCode()!==200)throw new Error("양식을 내려받지 못했습니다. 실행 계정의 읽기 권한을 확인해 주세요");const bytes=response.getContent();if(bytes.length>MAX_DOWNLOAD_MB_*1024*1024)throw new Error("양식이 너무 큽니다");return {name:p.kind==="intro"?"직무체험_자기소개_빈양식.xlsx":"기업정보_회신_빈양식.xlsx",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",base64:Utilities.base64Encode(bytes)};}

/* ===================== 내 오늘 화면(본인별 할 일·메모·카드·메뉴 설정) ===================== */
APP_TABS.myHome = { name: "앱_내화면", head: ["계정", "설정JSON", "수정시각"] };
const MYHOME_CARDS_ = ["todo", "notices", "meal", "focus", "events", "contests", "details"];
function myHomeKey_(me) { return me.role === "teacher" ? (me.staffAccount&&!me.isAdmin?"teacher:"+me.name:"teacher") : "student:" + me.name; }
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

/* 빈 배포 양식만 포함합니다. 학생 작성 내용은 넣지 않습니다. */
function introTemplate_(){return {name:"기업제출용_자기소개서_양식.docx",mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",base64:"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"};}

/* 학습일지 참고자료와 HRD 작성 확인은 별개로 저장합니다. HRD에 자동 제출하지 않습니다. */
function journalAccess_(me){if(me.role!=="teacher"&&(me.role!=="student"||me.group!=="learner"))throw Error("학습근로자 또는 교사로 로그인해 주세요");}
function trainingJournal_(me){
 journalAccess_(me);const files={};rows_("files").filter(function(r){return r.v[5]==="journal";}).forEach(function(r){files[r.v[0]]={id:r.v[0],name:r.v[2],size:Number(r.v[4])||0,mime:r.v[3]};});
 const entries=rows_("journals").filter(function(r){return r.v[0]&&r.v[9]!=="1";}).map(function(r){const v=r.v;return {id:v[0],date:v[1],kind:v[2],title:v[3],body:v[4],link:v[5],files:boardFileIds_(v[6]).filter(function(id){return files[id];}).map(function(id){return files[id];}),author:v[7],updated:v[8]};}).sort(function(a,b){return b.date.localeCompare(a.date)||b.updated.localeCompare(a.updated);});
 const checks=rows_("journalChecks").filter(function(r){return r.v[0]&&(me.role==="teacher"||r.v[1]===me.name);}).map(function(r){return {name:r.v[1],journal:r.v[2],done:r.v[3]==="1",at:r.v[4],note:r.v[5]};});
 return {entries:entries,checks:checks};
}
function saveTrainingJournal_(me,p){
 const date=dateValid_(p.date),kind=String(p.kind||""),title=required_(p.title,150),body=required_(p.body,6000),link=urlValid_(p.link);if(["OJT","OFF-JT"].indexOf(kind)<0)throw Error("훈련 구분을 선택해 주세요");
 const uploads=p.uploads||[];if(!Array.isArray(uploads)||uploads.length>5)throw Error("첨부는 최대 5개까지 올려 주세요");
 uploads.forEach(function(u){if(!hasUpload_(u))throw Error("첨부를 다시 선택해 주세요");if(u.staged){stagedFile_(me,u);return;}const ext=String(u.name||"").split('.').pop().toLowerCase();if(!MIME_BY_EXT_[ext]||!u.base64||String(u.base64).length>DIRECT_UPLOAD_MB_*1024*1024*1.37+100||!Utilities.base64Decode(String(u.base64)).length)throw Error("첨부 형식이나 크기를 확인해 주세요");});
 return withLock_(function(){const old=p.id?record_("journals",p.id):null;if(old&&old.v[9]==="1")throw Error("보관된 자료입니다");const id=old?old.v[0]:uid_("jl"),prior=old?boardFileIds_(old.v[6]):[],keep=p.keepFiles===undefined?prior:p.keepFiles;
 if(!Array.isArray(keep)||keep.some(function(x){return prior.indexOf(x)<0;})||keep.length+uploads.length>20)throw Error("첨부를 확인해 주세요");
 const made=[];try{const folder=uploads.length?childFolder_(materialStorageFolder_("learner"),"학습일지"):null;uploads.forEach(function(u){made.push(storeFile_(me,u,"journal",id,folder));});upsert_("journals",id,[id,date,kind,title,body,link,JSON.stringify(keep.concat(made)),old?old.v[7]:me.name,now_(),""]);return id;}catch(e){made.forEach(function(fid){try{DriveApp.getFileById(fid).setTrashed(true);}catch(ignored){}});throw e;}
 });
}
function deleteTrainingJournal_(p){return withLock_(function(){const r=record_("journals",p.id);sheet_("journals").getRange(r._row,10).setValue("1");return true;});}
function checkTrainingJournal_(me,p){need_(me,"student");journalAccess_(me);return withLock_(function(){const r=record_("journals",p.id);if(r.v[9]==="1")throw Error("보관된 자료입니다");if(p.done!==true&&p.done!==false)throw Error("작성 상태를 확인해 주세요");const old=rows_("journalChecks").find(function(x){return x.v[1]===me.name&&x.v[2]===r.v[0];}),id=old?old.v[0]:uid_("jc");upsert_("journalChecks",id,[id,me.name,r.v[0],p.done?"1":"0",now_(),clean_(p.note,300)]);return true;});}

/* 저장소 이전은 원본 소유 실행 계정으로 수행하며 파일 ID를 바꾸지 않습니다. */
function storageDriveRequest_(method,id,query){const res=UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(id)+"?supportsAllDrives=true&"+query,{method:method,muteHttpExceptions:true,headers:{Authorization:"Bearer "+ScriptApp.getOAuthToken()},contentType:"application/json",payload:method==="patch"?"{}":undefined});let body;try{body=JSON.parse(res.getContentText());}catch(e){}if(res.getResponseCode()<200||res.getResponseCode()>=300)throw Error(body&&body.error&&body.error.message||"Drive 이전 요청 실패");return body;}
function storageFolderUnder_(id,root){let seen={};for(let n=0;n<30;n++){if(id===root)return true;if(seen[id])return false;seen[id]=true;const it=DriveApp.getFolderById(id).getParents();if(!it.hasNext())return false;id=it.next().getId();}return false;}
function storageMigrationRoots_(me,p){needAdmin_(me);if(!INTRO_AUTH_)throw Error("최고관리자로 로그인해 주세요");const source=driveFolderId_(p.source),target=driveFolderId_(p.target),all=CFG_.getProperties();if(!source||!target||source===target||[all.APP_FOLDER,all.DRIVE_ROOT].indexOf(source)<0)throw Error("현재 업로드 원본 폴더를 확인해 주세요");if(storageFolderUnder_(target,source))throw Error("원본 안으로는 이전할 수 없습니다");const dest=storageDriveRequest_("get",target,"fields=id,mimeType,driveId");if(dest.mimeType!=="application/vnd.google-apps.folder"||!dest.driveId)throw Error("목적지는 학교 공유 드라이브의 폴더여야 합니다");return {source:source,target:target};}
function storageCommonFolder_(id,root){if(id===root)return true;let current=id;for(let n=0;n<30;n++){const f=DriveApp.getFolderById(current),parents=f.getParents();if(!parents.hasNext())return false;const parent=parents.next().getId();if(parent===root)return ["공지자료","사진첩","자격증","프로젝트게시판"].indexOf(f.getName())>=0;current=parent;}return false;}
function moveStorageFiles_(me,p){return withLock_(function(){const roots=storageMigrationRoots_(me,p);if(!Array.isArray(p.files)||!p.files.length||p.files.length>10)throw Error("파일은 한 번에 1~10개씩 이전해 주세요");
 const items=p.files.map(function(x){const file=storageDriveRequest_("get",String(x.id),"fields=id,mimeType,parents");if(file.mimeType==="application/vnd.google-apps.folder")throw Error("폴더는 새로 연결하고 파일만 이전해 주세요");if(!storageFolderUnder_(String(x.target),roots.target))throw Error("목적 폴더가 지정 저장소 밖에 있습니다");if((file.parents||[]).indexOf(String(x.target))>=0)return {id:file.id,already:true};if((file.parents||[]).length!==1||file.parents[0]!==String(x.parent)||!storageCommonFolder_(String(x.parent),roots.source))throw Error("원본 공통 자료의 경로를 확인해 주세요");return {id:file.id,parent:file.parents[0],target:String(x.target)};});
 const moved=[];for(let n=0;n<items.length;n++){const x=items[n];try{if(!x.already)storageDriveRequest_("patch",x.id,"addParents="+encodeURIComponent(x.target)+"&removeParents="+encodeURIComponent(x.parent)+"&fields=id,parents");moved.push(x.id);}catch(e){return {moved:moved,error:String(e.message)};}}return {moved:moved};
 });}
function relinkStorageFolders_(me,p){return withLock_(function(){const roots=storageMigrationRoots_(me,p);if(p.confirm!==true||!Array.isArray(p.folders)||p.folders.length>100)throw Error("파일 이전과 폴더 연결을 확인해 주세요");const map={};map[roots.source]=roots.target;
 p.folders.forEach(function(x){const from=String(x.source),to=String(x.target);if(!storageCommonFolder_(from,roots.source)||!storageFolderUnder_(to,roots.target)||map[from])throw Error("폴더 연결을 확인해 주세요");map[from]=to;});
 Object.keys(map).forEach(function(id){const f=DriveApp.getFolderById(id);if(f.getFiles().hasNext())throw Error("원본 폴더에 남은 파일이 있습니다. 이전 후 연결해 주세요");const children=f.getFolders();while(children.hasNext())if(!map[children.next().getId()])throw Error("이전되지 않은 하위 폴더가 있습니다");});
 const all=CFG_.getProperties(),updates={DRIVE_ROOT:roots.target};Object.keys(all).forEach(function(k){if(/^(APP_FOLDER|DRIVE_ROOT|MATERIAL_FOLDER|PHOTO_ALBUM_FOLDER|DF_.*|PF_.*|CERT_FOLDER_.*|COMPANY_FOLDER_.*)$/.test(k)&&map[all[k]])updates[k]=map[all[k]];});
 CFG_.setProperties(updates);rows_("files").filter(function(x){return x.v[5]==="photos"&&map[x.v[6]];}).forEach(function(x){sheet_("files").getRange(x._row,7).setValue(map[x.v[6]]);});PROPS_=null;bumpAll_();CacheService.getScriptCache().removeAll(["dm_v1","nt_v1"]);return {folderCount:Object.keys(map).length,updatedSettings:Object.keys(updates).length};
 });}
