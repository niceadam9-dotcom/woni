/**
 * 건물 이름 중복 판정 축 (2026-09-09 신설)
 *
 * 왜 생겼나: 같은 고객에 「규현빌라」가 **두 번 등록**됐다. 주소 중복 경고는 다른 고객과 겹칠
 * 때만 뜨고, 같은 고객의 다른 동은 정상으로 보기 때문이다. 화면·문서는 대표동만 보여주므로
 * 나중에 등록한 동에 입력한 값이 **사라진 것처럼** 보였다.
 *
 * ⚠ 이 검사는 **차단이 아니라 확인**임을 함께 못박는다 — 한 고객이 A동·B동을 갖는 것은 정상이고,
 *   그 경우까지 막으면 제품이 쓸 수 없게 된다. 그래서 「이름이 다르면 통과」가 핵심 단언이다.
 *
 * 실행: npx tsx scripts/test-building-dup.mts
 */
import { findSameNameBuilding, normalizeBuildingName } from '../src/lib/building-dup.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

const B = (id: string, building_name: string, is_active = true) => ({ id, building_name, is_active })

console.log('\n[1] 이름 정규화 — 사람이 같다고 보는 것을 같게 본다')
check('공백을 접는다', normalizeBuildingName('규현 빌라') === normalizeBuildingName('규현빌라'))
check('앞뒤 공백도 접는다', normalizeBuildingName('  규현빌라 ') === '규현빌라')
check('대소문자를 접는다', normalizeBuildingName('AB Tower') === normalizeBuildingName('ab tower'))
check('빈 값은 빈 문자열', normalizeBuildingName(null) === '' && normalizeBuildingName('   ') === '')
check('숫자는 지우지 않는다(A동·B동 구별 의도를 뭉개지 않는다)',
  normalizeBuildingName('규현빌라2') !== normalizeBuildingName('규현빌라'))

console.log('\n[2] 중복 판정 — 실사고 재현')
const rows = [B('b1', '규현빌라'), B('b2', '햇빛상가')]
check('같은 이름이면 잡는다(실사고 그대로)', findSameNameBuilding(rows, '규현빌라')?.id === 'b1')
check('공백만 다른 이름도 잡는다', findSameNameBuilding(rows, '규현 빌라')?.id === 'b1')
check('🎯다른 이름이면 통과 — 다동을 막지 않는다', findSameNameBuilding(rows, '규현빌라 A동') === null)
check('전혀 다른 이름도 통과', findSameNameBuilding(rows, '새건물') === null)
check('빈 이름은 판정하지 않는다', findSameNameBuilding(rows, '   ') === null)

console.log('\n[3] 자기 자신 제외 — 수정 저장이 자기 이름에 걸리면 안 된다')
check('excludeId를 주면 자기는 안 걸린다', findSameNameBuilding(rows, '규현빌라', 'b1') === null)
check('다른 동은 여전히 걸린다', findSameNameBuilding([...rows, B('b3', '규현빌라')], '규현빌라', 'b3')?.id === 'b1')

console.log('\n[4] 비활성도 본다 — 목록에 남아 사용자 눈에는 「있는 건물」이다')
check('비활성 건물과 이름이 같아도 확인한다',
  findSameNameBuilding([B('b9', '규현빌라', false)], '규현빌라')?.id === 'b9')

console.log('\n[5] 음성 대조 — 빈 목록에서는 어떤 이름도 안 걸린다')
check('빈 목록', findSameNameBuilding([], '규현빌라') === null)

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail === 0 ? 0 : 1)
