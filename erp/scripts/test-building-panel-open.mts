/** 건물 패널이 열린 채로 시작하는가 — 조회 경로 고정 (2026-09-10 사용자 신고)
 *
 *  🚨 등재 이유: **이 축을 단언하는 검사가 하나도 없었다.** `53a39b8`이 폼을 접었을 때
 *  (「규현빌라」 2중 등록 사고 대응 — 옳은 변경이었다) 전 스위트가 초록이었는데, 그 폼이
 *  건축허가일·주차장의 **유일한 조회 창구**라는 사실은 아무도 모르고 있었다. 사고는 막고
 *  조회는 잃었고, 그걸 사용자가 신고할 때까지 몰랐다.
 *
 *  판정 축:
 *   A. 우선순위 5가지가 규칙대로 갈린다
 *   B. **1동이면 열린다** — 이번에 되살린 조회 경로
 *   C. **권한 없어도 열린다** — 여기에 `canManage`를 걸면 읽기 전용 사용자만 영영 못 본다
 *   D. 2동 이상은 안 연다 — 시스템이 대신 고르지 않는다
 *   E. 화면과 같은 배열을 센다(비활성 동도 행이면 센다)
 *
 *  실행: npx tsx scripts/test-building-panel-open.mts */
import { initialBuildingPanelTarget as target } from '../src/lib/building-panel-open'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}`) } }

const B = (...ids: string[]) => ids.map(id => ({ id }))

console.log('── A. 우선순위 ──')
ok(target({ initialNew: true, buildings: B('a', 'b'), canManage: true }) === 'new',
  '① initialNew는 최우선 — 건물이 여러 개여도 등록 폼')
ok(target({ initialOpenId: 'b', buildings: B('a', 'b'), canManage: true }) === 'b',
  '② URL이 지목한 동을 연다')
ok(target({ initialOpenId: 'zzz', buildings: B('a', 'b'), canManage: true }) === null,
  '② (음성) 실재하지 않는 id는 무시 — 없는 동의 폼을 열지 않는다')
ok(target({ buildings: [], canManage: true }) === 'new',
  '③ 건물 0개 + 권한 → 등록 폼(그때는 등록 말고 할 일이 없다)')
ok(target({ buildings: [], canManage: false }) === null,
  '③ (음성) 건물 0개인데 권한 없으면 등록 폼을 열지 않는다')

console.log('── B. 1동이면 열린다 (이번에 되살린 조회 경로) ──')
ok(target({ buildings: B('only'), canManage: true }) === 'only',
  '🎯 1동 → 그 동의 상세가 펼쳐진다 (건축허가일·주차장이 여기 있다)')
ok(target({ buildings: B('only'), canManage: true }) !== 'new',
  '🚨 (음성) 1동일 때 여는 것은 `new`가 아니다 — 빈 등록 폼이면 중복 등록 사고가 되살아난다')

console.log('── C. 조회는 권한과 무관하다 ──')
ok(target({ buildings: B('only'), canManage: false }) === 'only',
  '🎯 권한 없어도 1동은 열린다 — 폼 입력칸은 각자 disabled라 보기만 한다')
ok(target({ initialOpenId: 'b', buildings: B('a', 'b'), canManage: false }) === 'b',
  '권한 없어도 URL이 지목한 동은 열린다')

console.log('── D. 2동 이상은 시스템이 고르지 않는다 ──')
for (const n of [2, 3, 7]) {
  const ids = Array.from({ length: n }, (_, i) => `b${i}`)
  ok(target({ buildings: B(...ids), canManage: true }) === null, `${n}동 → 닫힌 채 시작(사용자가 행을 고른다)`)
}

console.log('── E. 화면과 같은 배열을 센다 ──')
// 표는 비활성 동도 행으로 그린다 — 여기서 활성만 세면 「1동인데 안 열린다」가 된다
ok(target({ buildings: B('inactive-only'), canManage: true }) === 'inactive-only',
  '비활성 1동도 행이 하나면 열린다(표가 그리는 것과 같은 분모)')

console.log('── F. 대조군 — 되돌리면 잡히는가 ──')
// 종전 규칙(canManage && length===0 ? 'new' : null)을 그대로 재현해 **다른 답**이 나오는지 본다.
// 같은 답이면 이 검사는 아무것도 지키지 못한다.
const old = (o: { buildings: ReadonlyArray<{ id: string }>; canManage: boolean }) =>
  (o.canManage && o.buildings.length === 0 ? 'new' : null)
const one = { buildings: B('only'), canManage: true }
ok(old(one) !== target(one), `🎯 1동에서 구·신 규칙이 갈린다 (구=${old(one)} / 신=${target(one)})`)
const two = { buildings: B('a', 'b'), canManage: true }
ok(old(two) === target(two), '(대조군) 2동에서는 구·신이 같다 — 바꾼 것은 1동 가지뿐이다')

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
