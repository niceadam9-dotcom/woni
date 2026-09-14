// 점검달력 데이 패널 「계획 일정」 행 — 정기(monthly)에서 점검 레코드 입구 2개를 없앤 축 (2026-09-14)
//
// 무엇을 지켰나: 정기는 더 이상 점검표 입력을 하지 않는다(사용자 확정). ▶[점검 시작·완료]와
// [점검 보기]는 **둘 다** 점검 레코드 = 점검표 입력 화면으로 가는 입구라 정기 행에서 함께 없앴다.
//
// 🎯 이 검사의 핵심은 「정기에서 껐는가」가 아니라 **「일반(event)에서 끄지 않았는가」**다.
//    음성 단언만 넣으면 `return {startComplete:false, viewInspection:false}` 한 줄로 전부 초록이 되고,
//    그 변경은 이 차수가 막으려는 과잉 삭제 그 자체다. [A4][A5]가 그 양성 대조다.
//
// 🚨 소스 단언은 **주석을 먼저 걷어낸다**(codeOnly) — 이 차수의 설명 주석에 '점검 보기'·'시작·완료'가
//    그대로 적혀 있어, 걷어내지 않으면 코드를 지워도 주석에 걸려 초록으로 통과한다.
//
// 서버·DB 없이 순수 함수 + 소스로만 판정한다.
// 실행: npx tsx scripts/test-calendar-plan-row-entry.mts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planRowInspectionEntry } from '../src/lib/calendar-plan-row.ts'
import { codeOnly, strippedStats } from './_code-only.mts'

const ROOT = process.cwd()
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// 🚨 2026-09-14: 여기 있던 사본이 **CRLF에서 한 줄도 안 걷어내고 있었다**(이 파일 소스는 전부 CRLF).
//    즉 이 검사가 머리말에 적어 둔 "주석을 먼저 걷어낸다"는 방어가 **죽어 있었다**.
//    공유 모듈로 올리고 아래 [B-1]에서 계측기 자체를 단언한다.

console.log('▶ 점검달력 계획 행 — 정기 점검 입구 폐지')

// ── A. 순수 함수 ────────────────────────────────────────────────
const M = (inspection_id: string | null = null) => ({ plan_type: 'monthly' as const, inspection_id })
const E = (inspection_id: string | null = null) => ({ plan_type: 'event' as const, inspection_id })
const ACT = { canAct: true, moveSelectMode: false }

check('[A1] 정기·미시작·권한 있음 → ▶[시작·완료] 없음',
  planRowInspectionEntry(M(), ACT).startComplete === false)
check('[A2] 정기·시작됨 → [점검 보기] 없음',
  planRowInspectionEntry(M('insp-1'), { canAct: false, moveSelectMode: false }).viewInspection === false)
check('[A3] 정기는 어떤 상태에서도 입구가 0개',
  [M(), M('insp-1')].every(p =>
    [true, false].every(canAct => [true, false].every(moveSelectMode => {
      const r = planRowInspectionEntry(p, { canAct, moveSelectMode })
      return r.startComplete === false && r.viewInspection === false
    }))))

check('[A4] 일반(event)·미시작·권한 있음 → ▶[시작·완료] **남아 있다** (과잉 삭제 방지)',
  planRowInspectionEntry(E(), ACT).startComplete === true)
check('[A5] 일반(event)·시작됨 → [점검 보기] **남아 있다** (과잉 삭제 방지)',
  planRowInspectionEntry(E('insp-2'), { canAct: false, moveSelectMode: false }).viewInspection === true)
check('[A6] 일반·날짜 이동 선택 모드에서는 ▶ 숨김 (종전 규약 보존)',
  planRowInspectionEntry(E(), { canAct: true, moveSelectMode: true }).startComplete === false)
check('[A7] 일반·권한 없음 → ▶ 없음 (종전 규약 보존)',
  planRowInspectionEntry(E(), { canAct: false, moveSelectMode: false }).startComplete === false)
check('[A8] 시작된 일반 건에는 ▶와 [점검 보기]가 동시에 뜨지 않는다',
  (() => { const r = planRowInspectionEntry(E('insp-3'), ACT); return !(r.startComplete && r.viewInspection) })())

// ── B. 배선 — 달력이 실제로 이 함수를 쓰는가 ─────────────────────
// 순수 함수만 단언하면 「함수는 옳은데 화면은 옛 조건 그대로」가 초록으로 통과한다.
const CAL_RAW = read('src', 'components', 'inspections', 'inspection-calendar-client.tsx')
const CAL = codeOnly(CAL_RAW)

// 계측기 자기 검사 — **걷어냈다고 믿는 것**과 **걷어낸 것**은 다르다.
// 이게 없어서 CRLF 불발을 넉 달 가까이 아무도 몰랐다(2026-09-14 발견).
{
  const s = strippedStats(CAL_RAW)
  check('[B-1] codeOnly가 줄 주석을 실제로 걷어냈다 (계측기 자기 검사)',
    s.leftover === 0 && s.removed > 0, `남은 줄주석 ${s.leftover}줄 · 지운 글자 ${s.removed}`)
}

check('[B1] 달력이 planRowInspectionEntry를 import한다',
  /import \{[^}]*planRowInspectionEntry[^}]*\} from '@\/lib\/calendar-plan-row'/.test(CAL))

// 계획 행 블록만 잘라 본다 — 파일 전체에서 세면 단계 패널·일괄 모달의 같은 문자열에 걸린다
const from = CAL.indexOf('{panelPlans.map(p => {')
const to = CAL.indexOf('{panelSteps.length === 0 && panelPlans.length === 0 &&')
const ROW = from >= 0 && to > from ? CAL.slice(from, to) : ''
check('[B0] 계획 행 블록을 잘라냈다 (앵커 생존)', ROW.length > 0, `${ROW.length}자`)

check('[B2] 행이 entry = planRowInspectionEntry(...)를 세운다',
  /const entry = planRowInspectionEntry\(p, \{ canAct, moveSelectMode \}\)/.test(ROW))

// 🎯 핵심: 두 입구가 **entry 판정 아래에만** 있다. 문자열 존재가 아니라 '가드가 앞에 있는가'를 묻는다.
const guarded = (label: string, guard: string, window = 400) => {
  const hits = [...ROW.matchAll(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map(m => m.index!)
  if (hits.length === 0) return { ok: false, why: '문자열이 아예 없다' }
  const bad = hits.filter(i => !ROW.slice(Math.max(0, i - window), i).includes(guard))
  return { ok: bad.length === 0, why: `${hits.length}곳 중 ${bad.length}곳이 ${guard} 밖` }
}
const g1 = guarded('점검 시작·완료 처리', 'entry.startComplete')
check('[B3] ▶[점검 시작·완료] 버튼은 entry.startComplete 아래에만 있다', g1.ok, g1.why)
const g2 = guarded('점검 보기', 'entry.viewInspection')
check('[B4] [점검 보기] 링크는 entry.viewInspection 아래에만 있다', g2.ok, g2.why)

// 음성: 폐지한 옛 조건이 되살아나면 잡는다 (정기를 다시 켜는 가장 그럴듯한 되돌림 형태)
check('[B5] 계획 행에 옛 `p.inspection_id ? (…점검 보기…)` 3분기가 남아 있지 않다',
  !/\{p\.inspection_id \? \(/.test(ROW))

// ── C. 잃지 않은 것 — [날짜 이동]은 정기 전용으로 그대로 ─────────
check('[C1] 정기 행의 [날짜 이동]은 isMovablePlan 단일 원천을 쓴다',
  /const showMove = movable && !moveSelectMode/.test(ROW))
check('[C2] PanelMoveButton이 showMove 아래에 살아 있다',
  /\{showMove && \(\s*<PanelMoveButton/.test(ROW))

// ── D. 규칙이 화면 밖 순수 모듈에 있는가 ─────────────────────────
const LIB = read('src', 'lib', 'calendar-plan-row.ts')
check('[D1] lib 모듈이 React·DB를 끌고 오지 않는다 (순수)',
  !/from '(react|next|@supabase)/.test(codeOnly(LIB)))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
