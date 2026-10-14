// 제출 전 자동 점검: node tools/check.js
// 1) 문법 오류  2) 구글이 잘라내는 '//' 문제  3) 비밀번호·실제 시트 ID 유출
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
if (!fs.existsSync(path.join(root, "src/Code.gs"))) { console.log("src/Code.gs가 없습니다."); process.exit(process.env.REQUIRE_SRC ? 1 : 0); }
const code = fs.readFileSync(path.join(root, "src/Code.gs"), "utf8");
const html = fs.readFileSync(path.join(root, "src/Index.html"), "utf8");
const errors = [];

try { new Function(code); } catch (e) { errors.push("Code.gs 문법 오류: " + e.message); }

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) errors.push("Index.html에서 <script>를 찾지 못했습니다");
scripts.forEach((s, i) => { try { new Function(s); } catch (e) { errors.push(`Index.html 스크립트 ${i + 1} 문법 오류: ${e.message}`); } });

// 구글 Apps Script는 화면 코드에서 '//' 뒤를 주석으로 보고 잘라냅니다 → 페이지가 하얗게 멈춤
const start = html.indexOf("<script>");
html.slice(start).split("\n").forEach((line, i) => {
  const t = line.trim();
  if (!line.includes("//") || t.startsWith("//")) return;
  if (line.includes("https?:\\/\\/") || line.includes('placeholder="https://"')) return;
  const no = html.slice(0, start).split("\n").length + i;
  errors.push(`Index.html ${no}번째 줄에 '//'가 있습니다. 주소는 "https:\\/\\/..." 처럼, 주석은 /* */ 로 쓰세요:\n    ${t.slice(0, 120)}`);
});

// 비밀값은 스크립트 속성에만 둡니다. 코드에 직접 적으면 실패
if (!code.includes('const TEACHER_PASSWORD = CFG_.getProperty("TEACHER_PASSWORD") || "여기에_비밀번호";')) errors.push("TEACHER_PASSWORD 줄을 바꾸지 마세요. 비밀번호는 스크립트 속성 TEACHER_PASSWORD에 넣습니다");
if (!code.includes('const SPREADSHEET_ID = CFG_.getProperty("SPREADSHEET_ID") || "";')) errors.push("SPREADSHEET_ID 줄을 바꾸지 마세요. 시트 ID는 스크립트 속성 SPREADSHEET_ID에 넣습니다");
const all = code + "\n" + html;
[[/\b(secret_|ntn_)[A-Za-z0-9]{20,}/, "노션 토큰"], [/["'][0-9a-f]{32}["']/, "인증키(32자리)"], [/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{30,}/, "실제 시트 주소"]]
  .forEach(([re, what]) => { if (re.test(all)) errors.push(what + "로 보이는 값이 코드에 있습니다. 지우고 설정 화면이나 스크립트 속성에 넣으세요"); });

if (errors.length) { console.error("✗ 점검 실패\n- " + errors.join("\n- ")); process.exit(1); }
console.log("✓ 점검 통과: 문법 OK, '//' 문제 없음, 비밀값 없음");
