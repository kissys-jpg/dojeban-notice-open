(() => {
  const SHEETS = window.__SHEETS || {};
  const book = {}; window.__reads = 0;
  const mk = (name, rows) => { const s = { name, id: Object.keys(book).length + 100, data: rows.map(r => r.map(c => c == null ? "" : String(c))), frozen: 0 }; book[name] = s; return s; };
  Object.entries(SHEETS).forEach(([n, rows]) => mk(n, rows));
  const width = s => Math.max(0, ...s.data.map(r => r.length));
  const ensure = (s, r, c) => { while (s.data.length < r) s.data.push([]); const row = s.data[r - 1]; while (row.length < c) row.push(""); };
  const sheetApi = s => ({
    getName: () => s.name,
    getSheetId: () => s.id,
    getLastRow: () => s.data.length,
    getDataRange: () => ({ getDisplayValues: () => { window.__reads++; const w = width(s); return s.data.map(r => { const o = r.slice(); while (o.length < w) o.push(""); return o; }); } }),
    getRange: (r, c, nr = 1, nc = 1) => {
      const rng = {
        setValues: vals => { vals.forEach((row, i) => row.forEach((v, j) => { ensure(s, r + i, c + j); s.data[r + i - 1][c + j - 1] = v == null ? "" : String(v); })); return rng; },
        setValue: v => { ensure(s, r, c); s.data[r - 1][c - 1] = String(v); return rng; },
        getValue: () => (s.data[r - 1] || [])[c - 1] || "",
        clearContent: () => rng,
        setNumberFormat: () => rng };
      return rng;
    },
    appendRow: arr => { let last = s.data.length; while (last > 0 && !s.data[last - 1].some(x => String(x).trim())) last--; s.data.splice(last, 0, arr.map(v => v == null ? "" : String(v))); },
    deleteRow: r => { s.data.splice(r - 1, 1); },
    insertRowAfter: r => { s.data.splice(r, 0, []); },
    setFrozenRows: n => { s.frozen = n; }
  });
  window.__opens = 0;
  const ss = { getSheetByName: n => book[n] ? sheetApi(book[n]) : null, getSheets: () => Object.values(book).map(sheetApi), insertSheet: n => sheetApi(mk(n, [])), getUrl: () => "https://docs.google.com/spreadsheets/d/TEST/edit", getId: () => "TEST", getName: () => "test", setSpreadsheetTimeZone(){}, getSpreadsheetTimeZone: () => "Asia/Seoul" };
  window.SpreadsheetApp = { getActiveSpreadsheet: () => null, openById: () => { window.__opens++; return ss; } };
  const cache = {}; window.__cache = cache;
  const C = { get: k => cache[k] ?? null, getAll: ks => { const o = {}; ks.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; }, put: (k, v) => { cache[k] = String(v); }, putAll: o => Object.assign(cache, o), remove: k => { delete cache[k]; }, removeAll: ks => ks.forEach(k => delete cache[k]) };
  window.CacheService = { getScriptCache: () => C };
  const props = {}; window.__props = props;
  const P = { getProperty: k => props[k] ?? null, getProperties: () => ({ ...props }), setProperty: (k, v) => { props[k] = String(v); return P; }, setProperties: o => { Object.entries(o).forEach(([k, v]) => props[k] = String(v)); return P; }, deleteProperty: k => { delete props[k]; return P; } };
  window.PropertiesService = { getScriptProperties: () => P };
  window.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  window.Session = { getScriptTimeZone: () => "Asia/Seoul" };
  // fake Drive
  let nid = 1; const folders = {}, files = {}; window.__drive = { folders, files };
  const folderApi = f => ({ getId: () => f.id, getName: () => f.name, getUrl: () => "https://drive/" + f.id, isTrashed: () => false, getParents: () => { let d = false; return { hasNext: () => !d && !!folders[f.parent], next: () => { d = true; return folderApi(folders[f.parent]); } }; },
    getFoldersByName: n => { const list = Object.values(folders).filter(x => x.parent === f.id && x.name === n); let i = 0; return { hasNext: () => i < list.length, next: () => folderApi(list[i++]) }; },
    createFolder: n => { const x = { id: "fo" + (nid++) + "xxxxxxxxxx", name: n, parent: f.id, editors: [] }; folders[x.id] = x; return folderApi(x); },
    createFile: blob => { const x = { id: "fi" + (nid++) + "xxxxxxxxxx", name: blob.name, bytes: blob.bytes, mime: blob.mime, parent: f.id }; files[x.id] = x; return fileApi(x); },
    addEditor: e => { if (!/@/.test(e)) throw new Error("bad"); f.editors.push(e); },
    getFiles: () => { const l = Object.values(files).filter(x => x.parent === f.id); let i = 0; return { hasNext: () => i < l.length, next: () => fileApi(l[i++]) }; },
    getFolders: () => { const l = Object.values(folders).filter(x => x.parent === f.id); let i = 0; return { hasNext: () => i < l.length, next: () => folderApi(l[i++]) }; } });
  const fileApi = x => ({ getId: () => x.id, getName: () => x.name, getMimeType: () => x.mime || "application/pdf", getSize: () => (x.bytes || []).length, getLastUpdated: () => new Date(), getAs: m => ({ getBytes: () => [37, 80, 68, 70], getContentType: () => m }), setDescription: d => { x.desc = d; }, setTrashed: t => { x.trashed = t; }, isTrashed: () => !!x.trashed, getDescription: () => x.desc || "", getUrl: () => "https://drive/file/" + x.id, getParents: () => { let d = false; return { hasNext: () => !d && !!folders[x.parent], next: () => { d = true; return folderApi(folders[x.parent]); } }; }, moveTo: f => { x.parent = f.getId(); }, getBlob: () => ({ getBytes: () => x.bytes, getContentType: () => x.mime }) });
  const root = { id: "root", name: "My Drive" }; folders.root = root;
  window.DriveApp = { createFolder: n => folderApi(root).createFolder(n), getFolderById: id => { if (!folders[id]) throw new Error("no folder"); return folderApi(folders[id]); }, getFileById: id => { if (!files[id]) throw new Error("no file"); return fileApi(files[id]); } };
  window.Utilities = {
    formatDate: (d, tz, f) => { const k = new Date(d.getTime() + 9 * 3600e3); const p = n => String(n).padStart(2, "0");
      return f.replace("yyyy", k.getUTCFullYear()).replace("MM", p(k.getUTCMonth() + 1)).replace("dd", p(k.getUTCDate())).replace("HH", p(k.getUTCHours())).replace("mm", p(k.getUTCMinutes())).replace(/^M$/, String(k.getUTCMonth() + 1)); },
    getUuid: () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => (Math.random() * 16 | 0).toString(16)),
    newBlob: (data, mime, name) => ({ getBytes: () => typeof data === "string" ? new TextEncoder().encode(data) : data, bytes: data, mime, name }),
    base64Decode: s => Array.from(atob(s), c => c.charCodeAt(0)),
    base64Encode: b => { if (typeof b === "string") return btoa(b); let t = ""; for (let i = 0; i < b.length; i += 32768) t += String.fromCharCode.apply(null, Array.from(b.slice(i, i + 32768), x => x & 255)); return btoa(t); } };
  window.__batch = 0;
  window.Sheets = { Spreadsheets: { Values: { batchGet: (id, o) => { window.__batch++; return { valueRanges: o.ranges.map(r => { const n = r.slice(1, -1).replace(/''/g, "'"); if (!book[n]) throw new Error("Unable to parse range"); const rows = book[n].data.map(row => { const x = row.slice(); while (x.length && x[x.length-1] === "") x.pop(); return x; }); while (rows.length && !rows[rows.length-1].length) rows.pop(); return { values: rows }; }) }; } } } };
  window.ContentService = { MimeType: { ICAL: "ical" }, createTextOutput: c => { const o = { c, setMimeType() { return o; }, downloadAsFile(n) { o.file = n; return o; }, getContent: () => c }; return o; } };
  window.ScriptApp = { getService: () => ({ getUrl: () => "https:" + "//script.google.com/a/macros/goedu.kr/s/XYZ/exec" }), getScriptId: () => "S" };
  window.UrlFetchApp = { fetch: (u, o) => { window.__nf = (window.__nf || 0) + 1; let body;
    if (/xn--s39aj90b0nb2xw6xh/.test(u)) return { getResponseCode: () => 200, getContentText: () => "<frameset><frame src='http:" + "//comci.net:4082/st'></frameset>" };
    if (/comci\.net:4082\/st$/.test(u)) return { getResponseCode: () => 200, getContentText: () => "<script>function school_ra(sc){$.ajax({ url:'./36179?17384l'+sc,success:function(){}})} function x(){sc_data('73629_',sc,1,'0');}</script>" };
    if (/comci\.net:4082\/36179\?/.test(u)) { window.__comci = (window.__comci || 0) + 1; if (window.__comciDown) return { getResponseCode: () => 500, getContentText: () => "" };
      const q = atob(u.split("?")[1]).split("_"); const week = Number(q[3]) || 1;
      const k = new Date(Date.now() + 9 * 3600e3); const dow = k.getUTCDay(); const mon = new Date(k.getTime() + ((dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow) + (week - 1) * 7) * 864e5);
      const f = d => d.toISOString().slice(0, 10), m1 = new Date(k.getTime() + (dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow) * 864e5), sh = d => f(d).slice(2);
      const subj = Array.from({length: 51}, (_, i) => "과" + i); subj[0] = 50; subj[31] = "프밍"; subj[3] = "영어"; subj[2] = "수학";
      const tch = Array.from({length: 44}, (_, i) => "교" + i + "*"); tch[21] = "가교사*"; tch[5] = "나교사*";
      const day = ch => [6, 31021, ch ? ">3005" : 3005, 2005, 0, 31021, 3005 + week * 1000 * 0];
      const cls = c => [5, [0], day(false), day(true), day(false), day(false), [0]];
      const grade = () => [4, cls(1), cls(2), cls(3), cls(4)];
      const orig = () => [4, ...[1,2,3,4].map(() => [5, [0], day(false), day(false), day(false), day(false), [0]])];
      const body = { 학급수: [12,4,4,4], 분리: 1000, 변경알림: 1, 시작일: f(mon), 일과시간: ["1(08:40)","2(09:40)","3(10:40)","4(11:40)","5(13:20)","6(14:20)","7(15:20)","8(16:20)"],
        일자자료: [[1, sh(m1) + " ~ x"], [2, sh(new Date(m1.getTime() + 7 * 864e5)) + " ~ x"]], 자료244: "2026-10-07 13:32:33", 자료492: subj, 자료446: tch,
        자료147: [0, grade(), grade(), grade()], 자료481: [0, orig(), orig(), orig()] };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) + "\u0000\u0000" }; }
    if (/open\.neis\.go\.kr/.test(u)) { window.__neis = (window.__neis || []).concat([u]); const q = k => (u.match(new RegExp("[?&]" + k + "=([^&]*)")) || [])[1];
      const dates = (a, b) => { const out = []; let d = new Date(a.slice(0,4) + "-" + a.slice(4,6) + "-" + a.slice(6,8) + "T00:00:00"); const e = new Date(b.slice(0,4) + "-" + b.slice(4,6) + "-" + b.slice(6,8) + "T00:00:00"); while (d <= e) { if (d.getDay() % 6) out.push(d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0")); d.setDate(d.getDate() + 1); } return out; };
      if (/mealServiceDietInfo/.test(u)) { const rows = dates(q("MLSV_FROM_YMD"), q("MLSV_TO_YMD")).map(d => ({ MLSV_YMD: d, MMEAL_SC_NM: "중식", CAL_INFO: "800.1 Kcal", DDISH_NM: "참치마요밥 (1.5.6)<br/>미역국 (9)<br/>배추김치* (9)" })).slice(0, q("KEY") ? 1000 : 5);
        body = rows.length ? { mealServiceDietInfo: [{ head: [] }, { row: rows }] } : { RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } }; }
      else { const rows = []; dates(q("TI_FROM_YMD"), q("TI_TO_YMD")).forEach(d => [1,2,3,4,5,6,7].forEach(n => rows.push({ ALL_TI_YMD: d, PERIO: String(n), ITRT_CNTNT: n === 1 ? "-전자회로" : "과목" + n + "-" + q("GRADE") + q("CLASS_NM"), DDDEP_NM: "로봇자동화과" })));
        body = { hisTimetable: [{ head: [] }, { row: rows }] }; }
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) }; }
    if (/databases\//.test(u)) return { getResponseCode: () => 404, getContentText: () => '{"message":"not a db"}' };
    if (/pages\//.test(u)) body = { properties: { title: { type: "title", title: [{ plain_text: "도제반 노션" }] } }, url: "https:" + "//www.notion.so/root", last_edited_time: "2026-10-07T00:00:00Z" };
    else body = { results: [{ type: "child_page", id: "aaaa-bbbb", child_page: { title: "OJT 안내" }, last_edited_time: "2026-10-06T00:00:00Z" }] };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) }; } };
  window.HtmlService = {};
  window.__book = book;
})();
