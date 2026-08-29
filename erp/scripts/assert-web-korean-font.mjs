// 웹 한글폰트 단언 — "파일이 있는가"가 아니라 "한글이 Pretendard로 그려질 수 있는가"를 검사한다.
//
// 배경(소방계획서_35 §0 축 1, 2026-08-29):
//   layout.tsx가 Plus Jakarta Sans·Inter를 subsets:["latin"]로만 로드해 **두 폰트에
//   한글 글리프가 없었다**. globals.css 스택의 모든 한글이 system-ui(맑은 고딕)로
//   폴백돼 왔고, 시니어 사용자의 "글씨가 흐리다"의 절반 이상이 그 폴백이었다.
//   저장소 전체 @font-face 0건 · public/ 폰트 0개가 그 증거였다.
//
// ⚠ 이 검사가 항진명제가 되는 길 셋 — 전부 막았다.
//   ① 파일만 세기: 92개가 있어도 CSS가 안 가리키면 아무 글자도 안 바뀐다 → 양방향 대조(B2).
//   ② @font-face 개수만 세기: 조각이 빠지면 그 음절 구간만 조용히 두부가 된다.
//      개수는 그대로인데 unicode-range가 좁아질 수도 있다 → **음절 전수 커버리지**(B3).
//   ③ 스택에 이름만 있으면 통과: 위치가 틀리면(맨 앞) 라틴·숫자까지 Pretendard가 그려
//      tabular-nums 폭이 바뀌고 1.4 세부제원 표 계산이 무너진다 → **순서까지** 단언(B5).
//   서빙 축은 200만 보지 않는다 — 404 HTML도 200으로 올 수 있으므로 **본문 매직**을 본다(C2).
//
// 실행:
//   node scripts/assert-web-korean-font.mjs                # 자산·CSS 축 + (서버 있으면) 서빙 축
//   node scripts/assert-web-korean-font.mjs --files-only   # 자산·CSS 축만 (밀폐, 서버 불필요)
//   node scripts/assert-web-korean-font.mjs --print-manifest  # 폰트 교체 후 핀 값 재산출
//
// 위반 시 exit 1.
import { readFileSync, existsSync, readdirSync } from 'fs'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const filesOnly = argv.includes('--files-only')
const printManifest = argv.includes('--print-manifest')
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000'

const FONT_DIR = join(root, 'public', 'fonts', 'pretendard', 'woff2')
const CSS_PATH = join(root, 'src', 'app', 'pretendard.css')
const GLOBALS = join(root, 'src', 'app', 'globals.css')
const OFL = join(root, 'public', 'fonts', 'pretendard', 'OFL.txt')

// ── 저장소에 박은 폰트의 신원 (Pretendard v1.3.9 variable dynamic-subset, OFL 1.1) ──
// 92개 해시를 나열하는 대신 **정렬된 (파일명,sha256) 목록의 집계 해시** 하나로 고정한다.
// 어느 조각이 바뀌어도 이 값이 달라진다. 교체 시 --print-manifest로 재산출할 것.
const EXPECTED_COUNT = 92
const EXPECTED_MANIFEST_SHA = 'aaba140d7f99327371b679460c01eadfa39289520adcc32cff0de12bb580b6ee'
const EXPECTED_TOTAL_BYTES = 2957724

// 한글 음절 블록 — 이 구간이 하나라도 비면 그 글자는 맑은 고딕으로 남는다.
const HANGUL_LO = 0xac00, HANGUL_HI = 0xd7a3   // 11,172자

let failures = 0
function ok(m) { console.log(`✅ ${m}`) }
function bad(m) { failures++; console.log(`❌ ${m}`) }
function note(m) { console.log(`   ${m}`) }
function head(m) { console.log(`\n[${m}]`) }

// ══ 축 A — 자산 파일 ══════════════════════════════════════════════════════════
head('축 A] 폰트 자산')

if (!existsSync(FONT_DIR)) {
  bad(`폰트 디렉터리 없음: ${FONT_DIR}`)
  process.exit(1)
}
const files = readdirSync(FONT_DIR).filter(f => f.endsWith('.woff2')).sort()

// A1 — 개수는 '이상'이 아니라 '정확히'. 조각이 빠지면 그 음절만 조용히 두부가 된다.
if (files.length === EXPECTED_COUNT) ok(`woff2 조각 ${files.length}개 (정확히 ${EXPECTED_COUNT})`)
else bad(`woff2 조각이 ${files.length}개 — ${EXPECTED_COUNT}개여야 한다`)

// A2 — 매직 넘버. 다운로드가 HTML 오류 페이지로 덮여도 크기는 그럴듯하다.
const perFile = []
let badMagic = 0, totalBytes = 0
for (const f of files) {
  const buf = readFileSync(join(FONT_DIR, f))
  totalBytes += buf.length
  if (buf.toString('latin1', 0, 4) !== 'wOF2') { badMagic++; note(`  매직 불량: ${f}`) }
  perFile.push(`${f}:${createHash('sha256').update(buf).digest('hex')}`)
}
if (badMagic === 0) ok(`전 조각 woff2 매직('wOF2') 정상`)
else bad(`woff2 매직 불량 ${badMagic}개`)

// A3 — 집계 해시
const manifestSha = createHash('sha256').update(perFile.sort().join('\n')).digest('hex')
if (printManifest) {
  console.log(`\n--- 핀 값 재산출 ---`)
  console.log(`EXPECTED_MANIFEST_SHA = '${manifestSha}'`)
  console.log(`EXPECTED_TOTAL_BYTES  = ${totalBytes}`)
  process.exit(0)
}
if (manifestSha === EXPECTED_MANIFEST_SHA) ok(`집계 sha256 일치 (${manifestSha.slice(0, 12)}…)`)
else bad(`집계 sha256 불일치 — 폰트가 바뀌었다\n     기대 ${EXPECTED_MANIFEST_SHA}\n     실측 ${manifestSha}`)

if (totalBytes === EXPECTED_TOTAL_BYTES) ok(`총 용량 ${(totalBytes / 1024 / 1024).toFixed(2)}MB`)
else bad(`총 용량 ${totalBytes} — 기대 ${EXPECTED_TOTAL_BYTES}`)

// A5 — OFL 동봉 (SIL OFL 1.1 재배포 요건)
if (existsSync(OFL) && readFileSync(OFL, 'utf8').includes('SIL OPEN FONT LICENSE')) ok('OFL.txt 동봉')
else bad('OFL.txt 없음 또는 라이선스 본문 아님 — OFL 1.1 재배포 요건 위반')

// ══ 축 B — CSS 배선 ═══════════════════════════════════════════════════════════
head('축 B] CSS 배선')

if (!existsSync(CSS_PATH)) { bad(`pretendard.css 없음`); process.exit(1) }
const css = readFileSync(CSS_PATH, 'utf8')

const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map(m => m[0])
if (faces.length === EXPECTED_COUNT) ok(`@font-face ${faces.length}개`)
else bad(`@font-face가 ${faces.length}개 — ${EXPECTED_COUNT}개여야 한다`)

// B2 — 양방향 대조. "파일이 92개 있다"와 "CSS가 92개를 가리킨다"는 다른 축이고,
//      둘 다 참이어도 **서로 다른 92개**일 수 있다.
const referenced = new Set()
let danglingUrl = 0
for (const face of faces) {
  const m = face.match(/url\(['"]?(\/fonts\/pretendard\/woff2\/([^'")]+))['"]?\)/)
  if (!m) { danglingUrl++; continue }
  referenced.add(m[2])
  if (!existsSync(join(FONT_DIR, m[2]))) { danglingUrl++; note(`  가리키는 파일 없음: ${m[2]}`) }
}
const orphans = files.filter(f => !referenced.has(f))
if (danglingUrl === 0 && orphans.length === 0) ok(`CSS↔파일 양방향 일치 (참조 ${referenced.size} · 고아 0)`)
else bad(`CSS↔파일 불일치 — 끊긴 url ${danglingUrl}개 · 아무도 안 쓰는 파일 ${orphans.length}개`)

// B3 — ⭐ 음절 전수 커버리지. 개수가 맞아도 unicode-range가 좁으면 그 구간만 두부가 된다.
const covered = new Uint8Array(HANGUL_HI - HANGUL_LO + 1)
for (const face of faces) {
  const ur = face.match(/unicode-range:\s*([^;]+);/)
  if (!ur) continue
  for (const part of ur[1].split(',')) {
    const t = part.trim().replace(/^U\+/i, '')
    const [a, b] = t.split('-')
    const lo = parseInt(a, 16), hi = parseInt(b ?? a, 16)
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue
    for (let cp = Math.max(lo, HANGUL_LO); cp <= Math.min(hi, HANGUL_HI); cp++) covered[cp - HANGUL_LO] = 1
  }
}
const missing = []
for (let i = 0; i < covered.length; i++) if (!covered[i]) missing.push(String.fromCodePoint(HANGUL_LO + i))
if (missing.length === 0) ok(`한글 음절 전수 커버 (U+AC00–D7A3, ${covered.length}자)`)
else bad(`한글 음절 ${missing.length}자가 어느 조각에도 없다 — 그 글자는 맑은 고딕으로 남는다\n     예: ${missing.slice(0, 20).join('')}`)

// B4·B5 — globals.css 배선. 이름 존재만으로는 부족하다.
const g = readFileSync(GLOBALS, 'utf8')
if (/@import\s+["']\.\/pretendard\.css["']/.test(g)) ok('globals.css가 pretendard.css를 @import')
else bad('globals.css에 pretendard.css @import 없음 — @font-face가 번들에 안 들어간다')

const bodyStack = g.match(/body\s*\{[^}]*font-family:\s*([^;]+);/)
if (!bodyStack) {
  bad('globals.css body의 font-family를 못 찾음')
} else {
  const stack = bodyStack[1]
  const iPre = stack.indexOf('Pretendard Variable')
  const iJak = stack.indexOf('--font-plus-jakarta-sans')
  const iInt = stack.indexOf('--font-inter')
  if (iPre < 0) {
    bad("body 스택에 'Pretendard Variable'이 없다 — 한글이 여전히 맑은 고딕으로 폴백된다")
  } else if (iJak < 0 || iInt < 0 || iPre < iJak || iPre < iInt) {
    // ⚠ 이 분기가 이 스크립트의 존재 이유 중 하나다. 이름만 보는 검사였다면 통과했을 것이다.
    bad("'Pretendard Variable'이 라틴 폰트보다 앞에 있다 — 숫자·영문까지 Pretendard가 그려\n" +
        '     tabular-nums 폭이 바뀌고 1.4 세부제원 표(44px 열=content 28px) 계산이 무너진다.\n' +
        '     스택 **후미**로 되돌릴 것 (public/fonts/pretendard/README.md 참조)')
  } else {
    ok("body 스택에서 'Pretendard Variable'이 라틴 폰트 **뒤** — 한글만 바뀐다")
  }
}

// ══ 축 C — 서빙 ═══════════════════════════════════════════════════════════════
if (filesOnly) {
  head('축 C] 서빙 — --files-only로 생략')
} else {
  head('축 C] 서빙')
  // preload 대상(실측 상위 3조각)을 표본으로 쓴다 — 가장 많이 쓰이는 조각이다.
  const SAMPLE = [90, 89, 91]
  let served = 0
  for (const n of SAMPLE) {
    const url = `${BASE}/fonts/pretendard/woff2/PretendardVariable.subset.${n}.woff2`
    try {
      const res = await fetch(url)
      if (res.status !== 200) { bad(`subset.${n} — HTTP ${res.status}`); continue }
      const ct = res.headers.get('content-type') || ''
      const cc = res.headers.get('cache-control') || ''
      // C2 — 200이어도 내용이 폰트라는 보장은 없다(오류 페이지가 200으로 오는 경우).
      const buf = Buffer.from(await res.arrayBuffer())
      const magic = buf.toString('latin1', 0, 4)
      if (magic !== 'wOF2') { bad(`subset.${n} — 200이지만 본문이 woff2가 아님(매직 '${magic}')`); continue }
      if (!/font\/woff2/.test(ct)) { bad(`subset.${n} — content-type '${ct}'`); continue }
      if (!/immutable/.test(cc)) { bad(`subset.${n} — Cache-Control '${cc}' (immutable 아님 — next.config.ts 헤더 확인)`); continue }
      served++
    } catch (e) {
      note(`서버 응답 없음(${BASE}) — 서빙 축 생략: ${e.message}`)
      note('  dev 서버를 띄우고 다시 돌리거나 --files-only로 실행할 것')
      served = -1
      break
    }
  }
  if (served === SAMPLE.length) ok(`표본 ${SAMPLE.length}조각 — 200 · font/woff2 · immutable · 본문 매직 정상`)
  else if (served >= 0) bad(`서빙 표본 ${served}/${SAMPLE.length}만 정상`)
}

// ══ 결과 ═════════════════════════════════════════════════════════════════════
console.log('')
if (failures === 0) {
  console.log('✅ 웹 한글폰트 단언 통과 — 한글이 Pretendard로 그려질 수 있다')
  console.log('   (실제로 그렇게 그려졌는지는 렌더 축이다 → scripts/test-plan-readability.mts)')
} else {
  console.log(`❌ 위반 ${failures}건`)
}
// ⚠ process.exit()를 쓰지 않는다. 축 C의 fetch(undici) 소켓이 살아 있는 채로 강제 종료하면
//    Windows에서 libuv가 죽는다 — `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`,
//    종료코드 -1073740791. **검사는 전부 초록인데 종료코드는 실패**라 test:all이 빨개진다.
//    exitCode만 세우고 이벤트 루프가 스스로 마르게 둔다(keepalive 소켓 정리까지 수 초).
process.exitCode = failures === 0 ? 0 : 1
