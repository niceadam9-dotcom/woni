/** 대표동 규칙 — 「어느 동이 문서에 인쇄되는가」와 「지우면 누가 승계하는가」 (2026-09-11)
 *
 *  🚨 등재 이유: 이 모듈에 **검사가 하나도 없었다.** 별지 9호 2쪽·소방계획서 1.1·갑지 개요가
 *  전부 여기서 고른 한 동을 인쇄하는데, 규칙이 바뀌어도 잡아 줄 그물이 없었다.
 *
 *  판정 축:
 *   A. 정렬·선택 — is_primary 우선, 그다음 created_at, 마지막 id 티브레이커
 *   B. 무회귀 — 표식이 없으면 **종전 규칙(최고참)과 같은 답**이어야 한다(160 백필의 설계 목표)
 *   C. 승계(resolvePrimaryRepair) — 사용자 요청 "2동이 삭제되면 1동이 대표동이 되어 별지 반영"
 *   D. 과잉 수리 금지 — 고칠 필요가 없을 때 needsRepair가 거짓이어야 한다(무변경이 정답)
 *
 *  실행: npx tsx scripts/test-primary-building.mts */
import { readFileSync } from 'node:fs'
import {
  sortBuildingsForPrint, primaryBuilding, otherBuildings, resolvePrimaryRepair, FORM9_MAX_BUILDINGS,
} from '../src/lib/primary-building'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}  ${d}`) } }

type B = { id: string; is_active?: boolean | null; is_primary?: boolean | null; created_at?: string | null }
const b = (id: string, created: string, opts: Partial<B> = {}): B =>
  ({ id, created_at: created, is_active: true, ...opts })

console.log('── A. 정렬·선택 ──')
const three = [b('c', '2026-03-01'), b('a', '2026-01-01'), b('b', '2026-02-01')]
ok(primaryBuilding(three)?.id === 'a', '표식이 없으면 created_at 최고참이 대표')
ok(sortBuildingsForPrint(three).map(x => x.id).join('') === 'abc', '인쇄 순서는 created_at 오름차순')
ok(otherBuildings(three).map(x => x.id).join('') === 'bc', '나머지 동은 대표를 뺀 순서 그대로')
ok(primaryBuilding([b('c', '2026-03-01', { is_primary: true }), b('a', '2026-01-01')])?.id === 'c',
  '🎯 is_primary가 created_at을 이긴다(사용자가 [대표로]로 바꾼 것이 존중된다)')
ok(primaryBuilding([]) === null, '건물이 없으면 null')
ok(primaryBuilding([b('x', '2026-01-01', { is_active: false })]) === null, '비활성만 있으면 대표가 없다')
// 같은 created_at에서 순서가 흔들리면 실행할 때마다 다른 동이 인쇄된다
ok(primaryBuilding([b('z', '2026-01-01'), b('y', '2026-01-01')])?.id === 'y',
  'created_at 동률은 id로 갈라 흔들리지 않는다')
ok(FORM9_MAX_BUILDINGS === 4, '서식이 담는 동 수는 4(대표 1 + 블록 3)')

console.log('\n── B. 무회귀 — 160 백필의 설계 목표 ──')
// 백필 규칙(활성 중 created_at 최고참)과 이 함수가 **같은 답**이어야 적용 순간 문서가 안 바뀐다
const legacy = (rows: B[]) => rows.filter(r => r.is_active !== false)
  .slice().sort((x, y) => (x.created_at ?? '') < (y.created_at ?? '') ? -1 : 1)[0]?.id ?? null
for (const set of [three, [b('p', '2025-12-31'), b('q', '2026-05-05', { is_active: false })]]) {
  ok(primaryBuilding(set)?.id === legacy(set), `🎯 표식 없을 때 종전 규칙과 같은 답 (${legacy(set)})`)
}

console.log('\n── C. 승계 — "2동이 삭제되면 1동이 대표가 된다" ──')
// 대표(1동)를 비활성화한 직후의 행 상태: is_active=false, is_primary=false (deleteBuildingAction이 함께 내린다)
const afterDeletePrimary = [
  b('dong1', '2026-01-01', { is_active: false, is_primary: false }),
  b('dong2', '2026-02-01', { is_primary: false }),
]
const r1 = resolvePrimaryRepair(afterDeletePrimary)
ok(r1.targetId === 'dong2' && r1.needsRepair, '🎯 대표를 지우면 남은 동이 대표가 된다', JSON.stringify(r1))
// 비대표를 지운 경우 — 대표는 그대로, 고칠 것이 없다
const afterDeleteOther = [
  b('dong1', '2026-01-01', { is_primary: true }),
  b('dong2', '2026-02-01', { is_active: false, is_primary: false }),
]
const r2 = resolvePrimaryRepair(afterDeleteOther)
ok(r2.targetId === 'dong1' && !r2.needsRepair, '🚨 비대표를 지우면 대표가 안 바뀐다(무변경이 정답)', JSON.stringify(r2))
// 표식이 둘 — 낡은 데이터(수리 전 비활성화된 행을 되살린 경우)
const two = resolvePrimaryRepair([b('a', '2026-01-01', { is_primary: true }), b('b', '2026-02-01', { is_primary: true })])
ok(two.needsRepair && two.targetId === 'a', '🚨 대표가 둘이면 하나로 수렴한다(23505 예방)', JSON.stringify(two))
// 표식이 0 — 160 미적용 DB에서 올라온 데이터
const none = resolvePrimaryRepair([b('a', '2026-01-01'), b('b', '2026-02-01')])
ok(none.needsRepair && none.targetId === 'a', '표식이 없으면 최고참을 세운다', JSON.stringify(none))
// 마지막 동까지 지운 경우 — 세울 대상이 없다
const empty = resolvePrimaryRepair([b('a', '2026-01-01', { is_active: false, is_primary: false })])
ok(empty.targetId === null && !empty.needsRepair, '활성 동이 없으면 세우지 않는다', JSON.stringify(empty))

console.log('\n── D. 과잉 수리 금지 ──')
// 🚨 여기가 핵심 음성 축이다. 늘 needsRepair=true를 내면 저장할 때마다 DB를 두 번 쓰고,
//    사용자가 [대표로]로 고른 동이 조용히 되돌아갈 수 있다.
const settled = [b('a', '2026-01-01'), b('b', '2026-02-01', { is_primary: true })]
const r3 = resolvePrimaryRepair(settled)
ok(!r3.needsRepair && r3.targetId === 'b',
  '🎯 표식이 정확히 하나면 손대지 않는다 — 사용자가 고른 대표가 되돌아가지 않는다', JSON.stringify(r3))
ok(resolvePrimaryRepair([b('solo', '2026-01-01', { is_primary: true })]).needsRepair === false,
  '1동이 이미 대표면 무변경')
// 비활성 행의 표식은 셈에서 뺀다(부분 유니크 인덱스가 WHERE is_active인 것과 같은 축)
const ghost = resolvePrimaryRepair([
  b('old', '2026-01-01', { is_active: false, is_primary: true }),
  b('live', '2026-02-01', { is_primary: true }),
])
ok(!ghost.needsRepair && ghost.targetId === 'live',
  '🚨 비활성 행의 낡은 표식은 「둘」로 세지 않는다(인덱스와 같은 분모)', JSON.stringify(ghost))

console.log('\n── E. 배선 — 규칙이 있어도 아무도 안 부르면 소용없다 ──')
// 🚨 순수 함수가 옳은 것과 **액션이 그걸 부르는 것**은 다른 축이다. 종전에 "포장했는가만 묻고
//   요청이 나가는가를 안 물어" 놓친 결함이 있었다. 여기서는 소스를 읽어 호출부를 센다.
const actionsSrc = readFileSync(new URL('../src/app/(dashboard)/buildings/actions.ts', import.meta.url), 'utf8')
const bodyOf = (name: string) => {
  const i = actionsSrc.indexOf(`export async function ${name}(`)
  if (i < 0) return ''
  const j = actionsSrc.indexOf('\nexport ', i + 10)
  return actionsSrc.slice(i, j < 0 ? undefined : j)
}
const del = bodyOf('deleteBuildingAction')
ok(del.length > 0, 'deleteBuildingAction을 찾았다')
ok(/is_primary:\s*false/.test(del),
  '🎯 비활성화할 때 is_primary도 함께 내린다(켜 둔 채 두면 재활성화에서 23505)')
ok(/repairPrimary\(/.test(del), '🎯 비활성화 뒤 승계를 부른다')
ok(/repairPrimary\(/.test(bodyOf('updateBuildingAction')),
  '🚨 재활성화 경로도 승계를 부른다(수리 이전에 지워진 낡은 행 치유)')
ok(/resolvePrimaryRepair\(/.test(actionsSrc),
  '승계 판단은 순수 함수에 맡긴다(규칙을 액션 안에 다시 적지 않는다)')
// 유니크 인덱스 규약 — 먼저 전부 내리고 하나만 올린다
ok(actionsSrc.indexOf('is_primary: false') < actionsSrc.lastIndexOf('is_primary: true'),
  '내리고 나서 올린다(순서를 바꾸면 잠깐 둘이 되어 인덱스가 거부한다)')

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
