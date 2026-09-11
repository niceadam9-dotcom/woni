// 변이 실험 — 1.4 확인 게이트 검사가 무는가 (소방계획서_49 §6, 2026-09-11)
//
// 🚨 관문을 ⓑ(경고만)로 정했으므로 이 보류가 **유일한 그물**인 경우가 있다: 점검표를 전부 ／로만
//    채우면 따라잡기도 안 돌아 대장이 빈 채 남고, 분모가 0이라 다른 안전장치가 동시에 침묵한다.
//    그래서 이 검사가 안 물면 그 회차는 아무 데도 안 걸린 채 completed로 박힌다.
//
// ⚠ 이 파일을 **커밋한다.** 종전엔 untracked라 워크트리 clean 한 번에 사라졌다 —
//   변이 결과는 커밋 메시지에만 남고 재현할 수단이 없어졌다(2026-09-11 실제로 한 번 잃었다).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const LIB = 'src/lib/facility-verify-gate.ts'
const SYNC = 'src/lib/inspection-step-sync.ts'
const O_LIB = fs.readFileSync(LIB, 'utf8')
const O_SYNC = fs.readFileSync(SYNC, 'utf8')
// 줄바꿈에 둔감하게 — 체크아웃 직후 CRLF면 여러 줄 앵커가 조용히 안 맞고,
// 그러면 「변이가 줄었다」가 「검사에 구멍」이 아니라 「실험이 안 돌았다」인데 정반대로 읽게 된다.
const eol = (s, src) => s.replace(/\r?\n/g, src.includes('\r\n') ? '\r\n' : '\n')

const mutants = [
  [LIB, '확인했어도 막는다(설비 0건 건물이 영영 못 끝낸다)',
    'return s.total > 0 && s.unverified === s.total', 'return s.total > 0'],
  [LIB, '일부만 미확인이어도 막는다(다동에서 되돌릴 길이 없다)',
    'return s.total > 0 && s.unverified === s.total', 'return s.unverified > 0'],
  [LIB, '아예 안 막는다(최후 방어 폐기)',
    'return s.total > 0 && s.unverified === s.total', 'return false'],
  [LIB, '건물 0동도 막는다',
    'return s.total > 0 && s.unverified === s.total', 'return s.unverified === s.total'],
  [LIB, '경고를 끈다(막는데 안 알린다)',
    'return s.total > 0 && s.unverified > 0', 'return false'],
  [SYNC, '보류 축을 OR에서 빼 버린다(조용히 무력화)',
    '(!!holdCompletion && holdCompletion.required > 0) || !!holdFacilitiesUnverified',
    '(!!holdCompletion && holdCompletion.required > 0)'],
]

let bit = 0, skipped = 0
try {
  for (const [file, name, rawFrom, rawTo] of mutants) {
    const orig = file === LIB ? O_LIB : O_SYNC
    const from = eol(rawFrom, orig), to = eol(rawTo, orig)
    if (!orig.includes(from)) { console.log(`  ⚠ 기준 줄 못 찾음 — ${name}`); skipped++; continue }
    fs.writeFileSync(file, orig.replace(from, to), 'utf8')
    let red = false
    try { execFileSync('npx', ['tsx', '--conditions=react-server', 'scripts/test-facility-verify-gate.mts'], { stdio: 'pipe', shell: true }) }
    catch { red = true }
    if (red) bit++
    console.log(`  ${red ? '✅ 빨강' : '❌ 초록(안 문다)'} — ${name}`)
    fs.writeFileSync(file, orig, 'utf8')
  }
} finally { fs.writeFileSync(LIB, O_LIB, 'utf8'); fs.writeFileSync(SYNC, O_SYNC, 'utf8') }

console.log(`\n변이 ${bit}/${mutants.length} 가 잡혔다${skipped ? `  (건너뜀 ${skipped})` : ''}`)
console.log('원복 일치: ' + (fs.readFileSync(LIB, 'utf8') === O_LIB && fs.readFileSync(SYNC, 'utf8') === O_SYNC))
// 건너뛴 변이는 실패로 친다 — 「안 돌았다」를 「통과」로 읽지 않기 위해서다
process.exit(bit === mutants.length && skipped === 0 ? 0 : 1)
