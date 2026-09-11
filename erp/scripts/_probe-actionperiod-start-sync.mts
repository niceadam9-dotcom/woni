/** 총 이행기간 위젯 — **시작일을 바꾸면 종료일이 10·20일에 맞춰 함께 움직이는가**(2026-09-11 확인 요청).
 *
 *  위젯(`AnnexFieldInput` type='actionperiod')은 훅을 쓰지 않는 순수 함수 컴포넌트라
 *  **직접 호출**해 반환된 엘리먼트 트리에서 시작일 DateInput의 onChange를 실제로 눌러 본다.
 *  (로직을 여기 베껴 적으면 제품이 아니라 사본을 검사하게 된다.)
 *
 *  실행: npx tsx scripts/_probe-actionperiod-start-sync.mts
 */
import type { ReactElement } from 'react'
// 대상 모듈은 갈아끼울 수 있다 — 변이 사본(`AP_TARGET`)을 물려 **이 검사가 빨개지는지**부터 확인한다.
// (제품 파일은 공유 작업트리라 손대지 않는다.)
const mod = await import(process.env.AP_TARGET || '../src/components/inspections/annex-fields')
const AnnexFieldInput = mod.AnnexFieldInput as typeof import('../src/components/inspections/annex-fields').AnnexFieldInput

let pass = 0, fail = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  OK  ${name}`) }
  else { fail++; console.log(`  XX  ${name}\n        got  ${g}\n        want ${w}`) }
}

const DEF = { key: 'totalPeriod', label: '총 이행기간 (수동 보정)', type: 'actionperiod' as const, fullRow: true }
const LBL = { start: `${DEF.label} 시작일`, end: `${DEF.label} 종료일`, days: `${DEF.label} 총 일수` }

/** 엘리먼트 트리 전체를 훑어 aria-label이 맞는 노드를 찾는다 */
function find(node: unknown, label: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) { const r = find(n, label); if (r) return r }
    return null
  }
  if (!node || typeof node !== 'object') return null
  const el = node as ReactElement<Record<string, unknown>>
  const props = (el.props ?? {}) as Record<string, unknown>
  if (props['aria-label'] === label) return props
  return find(props.children, label)
}

type Fire = { patch: Record<string, string> | null; changed: string | null }

/** 주어진 상태로 위젯을 그리고, 지정한 칸에 값을 넣었을 때 무엇이 나가는지 관찰한다 */
function fire(state: { value: string; daysValue?: string; baseDate?: string }, which: 'start' | 'end' | 'days', next: string): Fire {
  const out: Fire = { patch: null, changed: null }
  const tree = AnnexFieldInput({
    def: DEF,
    value: state.value,
    daysValue: state.daysValue ?? '',
    baseDate: state.baseDate ?? '2026-08-05',
    onChange: v => { out.changed = v },
    onPatch: p => { out.patch = p as Record<string, string> },
  })
  const props = find(tree, LBL[which])
  if (!props) throw new Error(`위젯에서 ${which} 칸을 못 찾았다 — 선택자가 낡았다`)
  const onChange = props.onChange as (e: { target: { value: string } }) => void
  onChange({ target: { value: next } })
  return out
}

/** 조작 없이 칸의 props만 본다(잠금 여부 확인용) */
function probeProps(state: { value: string; daysValue?: string }, which: 'start' | 'end' | 'days'): Record<string, unknown> {
  const tree = AnnexFieldInput({
    def: DEF, value: state.value, daysValue: state.daysValue ?? '', baseDate: '2026-08-05',
    onChange: () => {}, onPatch: () => {},
  })
  const props = find(tree, LBL[which])
  if (!props) throw new Error(`위젯에서 ${which} 칸을 못 찾았다`)
  return props
}

/** 실제로 저장될 기간 문자열 — patch가 있으면 그것, 없으면 onChange 값 */
const periodOf = (f: Fire) => f.patch ? f.patch.totalPeriod : f.changed
const daysOf = (f: Fire) => f.patch ? f.patch.totalDays : '(변경 없음)'

console.log('\n[A] 10일이 걸려 있을 때 시작일 변경')
{
  const f = fire({ value: '2026-08-05 ~ 2026-08-15' }, 'start', '2026-08-07')
  eq('종료일이 +10일로 따라온다', periodOf(f), '2026-08-07 ~ 2026-08-17')
  eq('총 일수 10 유지', daysOf(f), '10')
}
{
  const f = fire({ value: '2026-08-05 ~ 2026-08-15' }, 'start', '2026-08-25')
  eq('달을 넘겨도 +10일', periodOf(f), '2026-08-25 ~ 2026-09-04')
}

console.log('\n[B] 20일이 걸려 있을 때 시작일 변경')
{
  const f = fire({ value: '2026-08-05 ~ 2026-08-25' }, 'start', '2026-09-01')
  eq('종료일이 +20일로 따라온다', periodOf(f), '2026-09-01 ~ 2026-09-21')
  eq('총 일수 20 유지', daysOf(f), '20')
}
{
  const f = fire({ value: '2028-02-10 ~ 2028-03-01' }, 'start', '2028-02-20')
  eq('윤년 2월도 달력일로', periodOf(f), '2028-02-20 ~ 2028-03-11')
}

console.log('\n[C] 기간이 아직 비어 있고 총 일수만 저장돼 있을 때')
{
  const f = fire({ value: '', daysValue: '20' }, 'start', '2026-08-05')
  eq('저장된 20일을 폴백으로 종료일 생성', periodOf(f), '2026-08-05 ~ 2026-08-25')
}
{
  // 2026-09-11 사용자 지시 — 총일수를 고르기 전에 시작일부터 적으면 **기본 10일**
  const f = fire({ value: '', daysValue: '' }, 'start', '2026-08-05')
  eq('총 일수를 안 골랐으면 기본 10일로 종료일 생성', periodOf(f), '2026-08-05 ~ 2026-08-15')
  eq('총 일수도 10으로 함께 저장', daysOf(f), '10')
}
{
  const f = fire({ value: '~ ', daysValue: '' }, 'start', '2026-08-05')
  eq('종료일만 공백인 기간에서도 기본 10일', periodOf(f), '2026-08-05 ~ 2026-08-15')
}

console.log('\n[D] 「직접 입력」(10·20 어느 쪽도 아닌 기간) — 기본 10일이 여기까지 번지면 안 된다')
{
  // 🚨 시작일은 **기본 10일과 답이 갈리는 날**로 고른다. 08-07이면 08-07+10 = 08-17이라
  //    기존 종료일과 우연히 같아져, 기본값이 여기까지 번져도 기간 단언이 초록으로 통과한다
  //    (2026-09-11 변이 실험에서 실제로 그렇게 뚫렸다). 08-09면 기본값 적용 시 08-19로 갈린다.
  const f = fire({ value: '2026-08-05 ~ 2026-08-17' }, 'start', '2026-08-09')
  eq('손으로 정한 종료일을 덮지 않는다', periodOf(f), '2026-08-09 ~ 2026-08-17')
  eq('총 일수도 안 건드린다', daysOf(f), '(변경 없음)')
}
{
  const f = fire({ value: '2026-08-05 ~ 2026-08-17' }, 'end', '2026-08-19')
  eq('종료일 수기 수정은 그대로 받는다', periodOf(f), '2026-08-05 ~ 2026-08-19')
}

console.log('\n[H] 시작·종료 두 칸이 **수기 입력 가능**한가 (잠겨 있지 않다)')
{
  for (const which of ['start', 'end'] as const) {
    const props = probeProps({ value: '2026-08-05 ~ 2026-08-15', daysValue: '10' }, which)
    eq(`${which} 칸 disabled 아님`, props.disabled ?? false, false)
    eq(`${which} 칸 readOnly 아님`, props.readOnly ?? false, false)
  }
}

console.log('\n[E] 시작일을 지우면')
{
  const f = fire({ value: '2026-08-05 ~ 2026-08-15' }, 'start', '')
  eq('종료일은 남는다(패치 아님)', periodOf(f), '~ 2026-08-15')
}

console.log('\n[F] 반대 진입로 — 총 일수 select로 10↔20 전환')
{
  const f = fire({ value: '2026-08-05 ~ 2026-08-15' }, 'days', '20')
  eq('시작일 기준 +20일로 다시 계산', periodOf(f), '2026-08-05 ~ 2026-08-25')
  eq('총 일수 20', daysOf(f), '20')
}
{
  const f = fire({ value: '2026-08-05 ~ 2026-08-25' }, 'days', '10')
  eq('20 → 10 되돌리기', periodOf(f), '2026-08-05 ~ 2026-08-15')
}

console.log('\n[G] 종료일을 손으로 고치면 총 일수가 따라온다(역방향)')
{
  const f = fire({ value: '2026-08-05 ~ 2026-08-15' }, 'end', '2026-08-25')
  eq('총 일수 20으로 재계산', daysOf(f), '20')
}

console.log(`\n결과: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
