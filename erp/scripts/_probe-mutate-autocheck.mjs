// 변이 실험 — 점검표 → 1.4 자동 체크 검사가 무는가 (소방계획서_49 §9, 2026-09-11)
//
// 🚨 이 축은 **시스템이 법정 대장에 쓰는** 자리다. 검사가 안 물면 없는 설비가 조용히 인쇄된다.
// ⚠ 이 파일을 **커밋한다** — 종전엔 untracked라 워크트리 clean 한 번에 사라졌고,
//   변이 결과가 커밋 메시지에만 남아 재현할 수단이 없어졌다(2026-09-11 실제로 잃었다).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const LIB = 'src/lib/facility-autocheck.ts'
const ORIG = fs.readFileSync(LIB, 'utf8')
// 줄바꿈에 둔감하게 — CRLF면 여러 줄 앵커가 조용히 안 맞아 「안 돌았다」를 「통과」로 읽게 된다
const EOL = ORIG.includes('\r\n') ? '\r\n' : '\n'
const fit = (s) => s.replace(/\r?\n/g, EOL)

const mutants = [
  ['설계서 원안으로 되돌린다(후보 전체를 켠다) ← 스프링클러/ESFR 사고',
    `    if (candidates.length === 1) {
      confirmed.add(candidates[0])
      continue
    }`,
    `    if (candidates.length >= 1) {
      for (const c of candidates) confirmed.add(c)
      continue
    }`],
  ['／도 트리거로 삼는다(규칙 ① 폐기)',
    'if (!stat.o && !stat.x) continue', 'if (!stat.any) continue'],
  ['이미 설치된 형제가 있어도 나머지를 켠다(규칙 ③ 폐기)',
    'if (installedHere.length > 0) continue', 'if (false) continue'],
  ['모호한 갈래를 조용히 버린다(사람에게 안 묻는다)',
    'ambiguous.push({ sheet, group, candidates })', 'void candidates'],
  // ⚠ 「이미 설치된 설비도 다시 쓴다」는 **동등 변이**라 뺐다 — 바로 위 가드가 이미 걸러서
  //   동작이 같다. 동작이 같은 변이는 어떤 검사도 못 잡고, 목록에 두면 거짓 「구멍」 신호가 된다.
  ['모호 판정 경계를 어긋내기(후보 2개를 그냥 켠다)',
    'if (candidates.length === 1) {', 'if (candidates.length <= 2) {'],
  ['모호할 때 첫 번째를 골라 켠다(추측해서 법정 대장에 적는다)',
    'ambiguous.push({ sheet, group, candidates })',
    'confirmed.add(candidates[0]); ambiguous.push({ sheet, group, candidates })'],
]

let bit = 0, skipped = 0
try {
  for (const [name, rawFrom, rawTo] of mutants) {
    const from = fit(rawFrom), to = fit(rawTo)
    if (!ORIG.includes(from)) { console.log(`  ⚠ 기준 줄 못 찾음 — ${name}`); skipped++; continue }
    fs.writeFileSync(LIB, ORIG.replace(from, to), 'utf8')
    let red = false
    try { execFileSync('npx', ['tsx', '--conditions=react-server', 'scripts/test-facility-autocheck.mts'], { stdio: 'pipe', shell: true }) }
    catch { red = true }
    if (red) bit++
    console.log(`  ${red ? '✅ 빨강' : '❌ 초록(안 문다)'} — ${name}`)
    fs.writeFileSync(LIB, ORIG, 'utf8')
  }
} finally { fs.writeFileSync(LIB, ORIG, 'utf8') }

console.log(`\n변이 ${bit}/${mutants.length} 가 잡혔다${skipped ? `  (건너뜀 ${skipped})` : ''}`)
console.log('원복 일치: ' + (fs.readFileSync(LIB, 'utf8') === ORIG))
process.exit(bit === mutants.length && skipped === 0 ? 0 : 1)
