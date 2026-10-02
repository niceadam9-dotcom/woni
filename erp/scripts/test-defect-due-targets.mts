/** 불량 이행기한 알림 **대상 묶기** 순수 함수 단언 (2026-10-02, 불량 → 매출 1단계의 부수 결함 수리)
 *  실행: npx tsx scripts/test-defect-due-targets.mts   — 서버·DB 불필요
 *
 *  지키는 것: 크론 `defect-action-notify`가 **회차의 실질 기한**(별지 10호 총 이행기간 종료일 → 없으면 action_end 최댓값)으로
 *  대상을 고른다. 종전 `action_end = 기한` 행 조회는 2026-09-11 이후 회차(action_end 미기록)를 전부 놓쳤다.
 *  대시보드(`repairEndISO`)와 같은 함수를 쓰므로, 여기서 틀리면 화면과 크론이 다른 기한을 말한다. */
import { groupDefectsByRepairEnd, pickDueOn, type DueDefect } from '../src/lib/defect-due-targets.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const D = (id: string, insp: string, end: string | null = null): DueDefect => ({ id, inspection_id: insp, defect_name: `불량${id}`, action_end: end })

console.log('— 총 이행기간이 있는 회차(2026-09-11 이후 형태: action_end 전부 null)')
{
  const g = groupDefectsByRepairEnd([D('a', 'I1'), D('b', 'I1')], new Map([['I1', '2026-10-01 ~ 2026-10-20']]))
  ok('회차가 묶인다', g.size === 1)
  ok('기한 = 총 이행기간 종료일', g.get('I1')?.end === '2026-10-20', `got ${g.get('I1')?.end}`)
  ok('불량 2건이 한 묶음', g.get('I1')?.list.length === 2)
  ok('pickDueOn이 그 날짜에 회차를 돌려준다', pickDueOn(g, '2026-10-20').size === 1)
  ok('다른 날짜에는 비어 있다', pickDueOn(g, '2026-10-19').size === 0)
}

console.log('— 총 이행기간이 없는 회차(종전 형태: action_end 폴백)')
{
  const g = groupDefectsByRepairEnd([D('a', 'I2', '2026-10-05'), D('b', 'I2', '2026-10-09'), D('c', 'I2', null)], new Map())
  ok('기한 = action_end 최댓값', g.get('I2')?.end === '2026-10-09', `got ${g.get('I2')?.end}`)
  ok('action_end 없는 불량도 같은 묶음에 든다(알림 문구의 미완료 목록)', g.get('I2')?.list.length === 3)
}

console.log('— 총 이행기간이 action_end보다 우선한다(사람이 소방서에 낸 값이 정본)')
{
  const g = groupDefectsByRepairEnd([D('a', 'I3', '2026-10-30')], new Map([['I3', '2026-10-01 ~ 2026-10-15']]))
  ok('총 이행기간 종료일이 이긴다', g.get('I3')?.end === '2026-10-15', `got ${g.get('I3')?.end}`)
}

console.log('— 기한을 구할 수 없는 회차는 묶음에서 빠진다(없는 기한을 지어내지 않는다)')
{
  const g = groupDefectsByRepairEnd([D('a', 'I4'), D('b', 'I4')], new Map([['I4', '']]))
  ok('총 이행기간도 action_end도 없으면 제외', !g.has('I4'))
  const g2 = groupDefectsByRepairEnd([D('a', 'I5')], new Map())
  ok('periodOf에 회차가 없어도 예외 없이 제외', !g2.has('I5'))
}

console.log('— 회차가 섞여 들어와도 회차별로 갈린다')
{
  const g = groupDefectsByRepairEnd(
    [D('a', 'X', '2026-11-01'), D('b', 'Y'), D('c', 'X', '2026-11-03'), D('d', 'Y')],
    new Map([['Y', '2026-11-01 ~ 2026-11-01']]))
  ok('두 회차', g.size === 2)
  ok('X는 action_end 최댓값 11-03', g.get('X')?.end === '2026-11-03')
  ok('Y는 총 이행기간 11-01', g.get('Y')?.end === '2026-11-01')
  const due = pickDueOn(g, '2026-11-01')
  ok('11-01에는 Y만', due.size === 1 && due.has('Y'))
  ok('Y 묶음의 불량은 b·d', (due.get('Y') ?? []).map(d => d.id).sort().join() === 'b,d')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
