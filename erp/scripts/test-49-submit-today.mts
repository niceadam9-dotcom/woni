// 소방계획서_49 §12 — ④⑥ 제출일 「오늘 기본값 + 1클릭」(A안) 정적 검사
//
// 발단(2026-09-11 사용자): "4단계~6단계 제출일을 달력을 선택 아니고 그냥 완료버튼(클릭한날)
// 만드는 것이 어떨까 … 단지 실행했다는 목적입니다".
//
// 채택은 **A안**이다 — 기본값을 오늘로 두어 평시 조작을 버튼 한 번으로 줄이되,
// **달력은 남긴다.** 이 날짜는 「실행했다」는 표시가 아니라 법정 일자이자 기산점이기 때문이다:
//   · 별지 9호·10호에 인쇄 (`annexReportDateISO()` — 수기값 > ④ 제출일 > 오늘)
//   · ⑤ 총 이행기간의 시작 기준
//   · ⑥ 완료일이 그 기간 종료일에서 파생 (`lib/action-period-derive.ts`)
// → 하루 틀리면 문서 3장이 함께 밀린다. 금요일에 내고 월요일에 입력하는 일이 흔하다.
//
// 🎯 그래서 이 검사의 **가장 중요한 단언은 [C] 「달력이 여전히 있는가」**다.
//    「기본값이 오늘인가」만 물으면, 달력을 없애 클릭일로 고정하는 변경도 초록으로 통과한다.
//
// 실행: npx tsx scripts/test-49-submit-today.mts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src', 'components', 'inspections', 'inspection-workbench.tsx'), 'utf8')
/** 주석을 걷어낸 소스 — 주석이 설계 의도를 길게 설명하므로 날 것 grep은 오탐한다 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log('— 소방계획서_49 §12 ④⑥ 제출일 오늘 기본값')

// ── A. 계측기 자기검증 ─────────────────────────────────────────────────────────
check('[A1] 주석 제거가 실제로 줄였다', CODE.length < SRC.length, `${SRC.length} → ${CODE.length}자`)
check('[A2] 대상 상태 두 개를 찾았다', /subDate9/.test(CODE) && /subDate11/.test(CODE))

// ── B. 기본값이 오늘이다 (양성) ────────────────────────────────────────────────
for (const [n, v] of [['9', 'submit9'], ['11', 'submit11']] as const) {
  const line = CODE.match(new RegExp(`const \\[subDate${n}, setSubDate${n}\\] = useState\\([^)]*\\)`))?.[0] ?? ''
  check(`[B${n}] subDate${n} 기본값이 todayIso`, /\?\?\s*todayIso/.test(line), line.slice(0, 90))
  // 저장값이 있으면 그것이 우선 — 기본값이 저장값을 덮으면 정정 이력이 사라진다
  check(`[B${n}b] 저장값(data.${v}.submittedAt)이 왼쪽`, new RegExp(`data\\.${v}\\.submittedAt\\s*\\?\\?`).test(line))
  // 폐지된 빈 문자열 기본값이 되살아나지 않았다 (음성 — B와 쌍)
  check(`[B${n}c] 빈 문자열 기본값이 아니다`, !/\?\?\s*''/.test(line))
}

// ── C. 🎯 달력을 없애지 않았다 (이 차수의 핵심 단언) ───────────────────────────
// 여기가 물지 않으면 「클릭일 고정」 설계가 조용히 들어와 법정 일자를 망가뜨린다.
check('[C1] 🎯 ④ 제출일 달력(DateInput)이 남아 있다',
  /<DateInput value=\{subDate9\}/.test(CODE))
check('[C2] 🎯 ⑥ 제출일 달력(DateInput)이 남아 있다',
  /<DateInput value=\{subDate11\}/.test(CODE))
check('[C3] 🎯 두 달력이 onChange로 수정 가능하다',
  /value=\{subDate9\}\s+onChange=/.test(CODE) && /value=\{subDate11\}\s+onChange=/.test(CODE))
// 서버도 임의 날짜를 받아야 한다 — 액션이 date 인자를 그대로 쓰는지(클릭 시각을 서버에서 찍지 않는지)
const ACT = readFileSync(
  join(process.cwd(), 'src', 'app', '(dashboard)', 'inspections', 'timeline-actions.ts'), 'utf8')
check('[C4] recordSubmissionAction이 date 인자를 받는다 (서버가 오늘로 덮지 않는다)',
  /recordSubmissionAction\(\s*[\s\S]{0,120}?date:\s*string \| null/.test(ACT))

// ── D. 라벨이 날짜를 따라간다 — 버튼이 거짓말하지 않는다 ───────────────────────
for (const n of ['9', '11'] as const) {
  check(`[D${n}] 라벨이 subDate${n} === todayIso로 갈린다`,
    new RegExp(`subDate${n} === todayIso \\? '오늘 제출로 기록' : '제출일 기록'`).test(CODE))
}
check('[D3] 「기록」만 있는 옛 라벨이 남아 있지 않다',
  !/className=\{btn\}>기록<\/button>/.test(CODE))

// ── E. 「오늘」이 세션 내 고정이다 ─────────────────────────────────────────────
// 모듈 최상단 상수로 두면 **하루가 지나도 안 바뀐다**(장시간 열어 둔 탭). 렌더마다 호출하면
// 라벨이 자정에 깜빡인다. useState 초기화가 두 문제를 모두 피한다.
check('[E1] todayIso가 useState(todayKst)로 고정', /const \[todayIso\] = useState\(todayKst\)/.test(CODE))
check('[E2] todayKst를 import한다', /import \{[^}]*todayKst[^}]*\} from '@\/lib\/kst-date'/.test(CODE))

// ── F. 형제 대칭 — 한쪽만 고치는 실수를 막는다 ────────────────────────────────
const n9 = (CODE.match(/subDate9 === todayIso/g) ?? []).length
const n11 = (CODE.match(/subDate11 === todayIso/g) ?? []).length
check('[F1] ④⑥ 양쪽이 같은 수로 처리됐다', n9 === n11 && n9 === 1, `④=${n9} ⑥=${n11}`)

// ── G. 변이 자기검증 ──────────────────────────────────────────────────────────
{
  // ⑴ 기본값을 빈 문자열로 되돌리는 변이
  const m1 = CODE.replace(/data\.submit9\.submittedAt \?\? todayIso/, "data.submit9.submittedAt ?? ''")
  const l1 = m1.match(/const \[subDate9, setSubDate9\] = useState\([^)]*\)/)?.[0] ?? ''
  check('[G1] 변이(기본값 → 빈 문자열)를 잡는다', !/\?\?\s*todayIso/.test(l1) && /\?\?\s*''/.test(l1))
  // ⑵ 달력을 없애는 변이 — [C]가 물어야 한다
  const m2 = CODE.replace(/<DateInput value=\{subDate9\}/, '<span')
  check('[G2] 변이(④ 달력 제거)를 잡는다', !/<DateInput value=\{subDate9\}/.test(m2))
}

console.log(`\n결과: ${pass} pass / ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
