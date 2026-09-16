/**
 * 서식 1.1 「시설현황」 상자 규칙 — `lib/facility-status.ts` (2026-09-16 신설)
 *
 * 왜 생겼나: 승강기·주차장·계단 상자를 켜는 규칙이 **JSX와 조립기에 흩어져** 있었다.
 * 화면은 칩으로, 엑셀은 `!!txt(...)`로, PDF는 `ck(!!ef?.stairs?.[k])`로 — 같은 질문에 답이 셋이었고
 * **그 축을 단언하는 검사가 하나도 없었다**. 그 사이에 실제 결함이 인쇄되고 있었다
 * (2026-09-16 스테이징 실측: 송학떡집 `옥외계단:'0'`이 서식 1.1 `AJ16`에 ■로 찍힘).
 *
 * 이 검사의 무게 중심은 **음성**이다. 「켜지는가」보다 「켜지면 안 될 때 안 켜지는가」가
 * 이 모듈이 존재하는 이유다 — 양성만 물으면 `() => true`도 통과한다.
 *
 * 실행: npx tsx scripts/test-facility-status.mts
 */
import {
  countOf, checkFromCount,
  STAIR_KINDS, STAIR_LABEL, STAIR_COLUMN, stairChecks, stairsSumForAnnex9, stairCountsFromLegacyMap,
  ELEVATOR_KINDS, ELEVATOR_LABEL, ELEVATOR_COLUMN, elevatorChecks,
} from '../src/lib/facility-status.ts'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const J = (v: unknown) => JSON.stringify(v)

console.log('\n[1] countOf — 숫자를 읽는다 / 못 읽으면 null')
check('정수 컬럼값', countOf(3) === 3)
check('문자열 숫자(1.5 탭 JSON)', countOf('2') === 2)
check('단위가 붙어도 읽는다', countOf('1개소') === 1 && countOf('2 대') === 2)
check('0은 0이다(널이 아니다)', countOf('0') === 0, J(countOf('0')))
/* 🚨 아래 넷이 이 함수의 존재 이유다 — 「모른다」와 「0」을 섞으면 위 체크 규칙이 무너진다 */
check('null → null', countOf(null) === null)
check('undefined → null', countOf(undefined) === null)
check('빈 문자열 → null', countOf('') === null && countOf('   ') === null)
check('숫자가 없는 글 → null', countOf('있음') === null, J(countOf('있음')))
check('NaN → null', countOf(Number.NaN) === null)

console.log('\n[2] checkFromCount — 1 이상일 때만 켠다')
check('1이면 켠다', checkFromCount(1) === true)
check('문자열 1도 켠다', checkFromCount('1') === true)
/* 🚨 이 한 줄이 송학떡집 결함이다. 종전 판정 `!!txt('0')`은 **true**였다 */
check("★ '0'은 켜지 않는다(종전 !!txt는 켰다)", checkFromCount('0') === false, J(checkFromCount('0')))
check('숫자 0도 켜지 않는다', checkFromCount(0) === false)
check('음수는 켜지 않는다', checkFromCount(-1) === false, J(checkFromCount(-1)))
check('null·빈칸은 켜지 않는다', !checkFromCount(null) && !checkFromCount('') && !checkFromCount(undefined))
check('숫자로 못 읽으면 켜지 않는다(모르면 안 켠다)', checkFromCount('있음') === false)

console.log('\n[3] 계단 4종 — 사전이 서식과 1:1인가')
check('종류가 넷이다', STAIR_KINDS.length === 4, STAIR_KINDS.join(','))
check('이름이 1.5 탭 열쇠말과 같은 자구', STAIR_KINDS.every(k => ['특별피난계단', '직통계단', '피난계단', '옥외계단'].includes(STAIR_LABEL[k])))
check('컬럼 이름이 넷 다 다르다', new Set(STAIR_KINDS.map(k => STAIR_COLUMN[k])).size === 4)
check('컬럼 이름이 마이그 165와 같다', STAIR_KINDS.every(k => /^stair_(direct|escape|special|outdoor)_count$/.test(STAIR_COLUMN[k])))

console.log('\n[4] stairChecks — 종류별로 독립인가')
{
  const c = stairChecks({ direct: 1 })
  check('직통만 켠 값은 직통만 켠다', c.direct && !c.escape && !c.special && !c.outdoor, J(c))
  const all = stairChecks({ direct: 1, escape: 2, special: 1, outdoor: 3 })
  check('넷 다 켤 수 있다', all.direct && all.escape && all.special && all.outdoor)
  const none = stairChecks({})
  check('빈 값이면 넷 다 꺼진다(음성)', !none.direct && !none.escape && !none.special && !none.outdoor, J(none))
  /* 송학떡집 실측 재현 — 특별피난은 켜지고 옥외('0')는 꺼져야 한다 */
  const shp = stairChecks({ special: '1', outdoor: '0' })
  check('★ 송학떡집: 특별피난 ■ · 옥외 □', shp.special === true && shp.outdoor === false, J(shp))
}

console.log('\n[5] stairsSumForAnnex9 — 별지 9호 한 행의 합계')
check('직통+피난', stairsSumForAnnex9({ direct: 1, escape: 1 }) === 2)
check('직통만', stairsSumForAnnex9({ direct: 3 }) === 3)
check('피난만', stairsSumForAnnex9({ escape: 2 }) === 2)
/* 🚨 특별피난·옥외를 더하면 한 계단이 두 번 세어진다(별지 9호는 특별피난을 다른 칸에 따로 인쇄한다) */
check('★ 특별피난은 안 더한다', stairsSumForAnnex9({ direct: 1, special: 5 }) === 1, J(stairsSumForAnnex9({ direct: 1, special: 5 })))
check('★ 옥외는 안 더한다(별지 9호에 칸이 없다)', stairsSumForAnnex9({ direct: 1, outdoor: 9 }) === 1)
check('아무것도 없으면 null', stairsSumForAnnex9({}) === null, J(stairsSumForAnnex9({})))
check('특별·옥외만 있으면 null(합계 칸은 비운다)', stairsSumForAnnex9({ special: 1, outdoor: 1 }) === null)
check("★ 합이 0이면 null (‘0개소인데 ☑’ 재발 금지)", stairsSumForAnnex9({ direct: '0', escape: '0' }) === null, J(stairsSumForAnnex9({ direct: '0', escape: '0' })))
check('음수는 0으로 깎아 더한다', stairsSumForAnnex9({ direct: 2, escape: -5 }) === 2)
/* 별그리다 실측 재현 — 넷 다 1이면 합계는 2여야 한다(직통1+피난1) */
check('★ 별그리다: 넷 다 1 → 합계 2', stairsSumForAnnex9({ direct: '1', escape: '1', special: '1', outdoor: '1' }) === 2)

console.log('\n[6] stairCountsFromLegacyMap — 1.5 탭 JSON 이관 사전')
{
  const m = stairCountsFromLegacyMap({ '직통계단': '1', '피난계단': '2', '특별피난계단': '3', '옥외계단': '4' })
  check('네 종류를 모두 옮긴다', countOf(m.direct) === 1 && countOf(m.escape) === 2 && countOf(m.special) === 3 && countOf(m.outdoor) === 4, J(m))
  check('빈 지도·null도 견딘다', J(stairCountsFromLegacyMap(null)) === J(stairCountsFromLegacyMap({})))
  const partial = stairCountsFromLegacyMap({ '직통계단': '1' })
  check('없는 종류는 켜지지 않는다(음성)', stairChecks(partial).escape === false && stairChecks(partial).direct === true)
  /* 🚨 오타·다른 이름은 조용히 흡수하지 않는다 — 흡수하면 「1.5에 적었는데 안 나온다」가 된다 */
  const typo = stairCountsFromLegacyMap({ '직통 계단': '1' })
  check('★ 열쇠말이 다르면 안 읽는다(조용한 흡수 금지)', stairChecks(typo).direct === false, J(typo))
}

console.log('\n[7] 승강기 3종 — 계단과 같은 술어를 쓰는가')
check('종류가 셋이다', ELEVATOR_KINDS.length === 3, ELEVATOR_KINDS.join(','))
check('라벨이 서식 자구', ELEVATOR_KINDS.every(k => ['승용', '비상용', '피난용'].includes(ELEVATOR_LABEL[k])))
check('컬럼이 buildings 실재 이름', ELEVATOR_COLUMN.passenger === 'elevator_count'
  && ELEVATOR_COLUMN.emergency === 'emergency_elevator_count' && ELEVATOR_COLUMN.evac === 'evac_elevator_count')
{
  const e = elevatorChecks({ passenger: 2 })
  check('승용만 켠 값은 승용만 켠다', e.passenger && !e.emergency && !e.evac, J(e))
  const z = elevatorChecks({ passenger: 0, emergency: null, evac: '' })
  check('0·null·빈칸은 셋 다 꺼진다(음성)', !z.passenger && !z.emergency && !z.evac, J(z))
}
/* ⚠ 두 축이 같은 술어를 쓴다는 것 자체를 못박는다 — 한쪽만 고치면 다시 갈라진다 */
check('★ 계단과 승강기가 같은 술어다', stairChecks({ direct: '0' }).direct === elevatorChecks({ passenger: '0' }).passenger
  && stairChecks({ direct: '2' }).direct === elevatorChecks({ passenger: '2' }).passenger)

/* ── [8] 배선 축 ──────────────────────────────────────────────────────────────
 *  규칙이 옳고 위 단언이 전부 초록이어도, **화면·조립기가 이 함수를 안 부르면 사용자에겐 없는 것**이다.
 *  특히 계단은 종전에 입력구가 **셋**이었고 그중 둘이 같은 컬럼을 덮고 있었다 — 한쪽만 고치면
 *  다른 쪽이 되돌린다. 그 「되돌리는 쪽」이 죽었는지를 음성으로 못박는다.
 *  ⚠ 주석을 걷고 잰다 — 위 설명 문구가 패턴에 걸려 거짓 초록/빨강이 되지 않게. */
console.log('\n[8] 배선 — 입력구가 하나인가')
{
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  const panel = code(read('../src/components/customers/building-inline-panel.tsx'))
  check('건물 폼이 합계를 직접 받지 않는다(파생이다)', !/setField\('stairs_count'/.test(panel))
  check('건물 폼이 합계를 stairsSumForAnnex9로 계산해 보낸다',
    /stairs_count: stairsSumForAnnex9\(\{/.test(panel))
  check('건물 폼이 계단 4종을 모두 보낸다',
    STAIR_KINDS.every(k => new RegExp(`${STAIR_COLUMN[k]}: int\\(form\\.${STAIR_COLUMN[k]}\\) \\?\\? null`).test(panel)))
  /* 🚨 **비우기 축.** 이 저장 액션은 `undefined`를 「안 건드림」으로 읽는다(`ledgerFields`).
   *   그래서 빈 칸을 `undefined`로 보내면 계단을 다 지워도 **옛 값이 DB에 그대로 남고**
   *   별지 9호가 유령 개소를 계속 인쇄한다. 채우는 것만 물으면 이 결함은 영영 초록이다.
   *   (실제로 처음 구현에서 합계를 `?? undefined`로 접어 놨다가 여기서 걸렸다.) */
  check('★ 합계를 null로 보낸다 — 비우기가 되는가', !/stairs_count: stairsSumForAnnex9\([\s\S]{0,120}?\}\) \?\? undefined/.test(panel))
  check('★ 계단 4종도 null로 보낸다 — 비우기가 되는가',
    !STAIR_KINDS.some(k => new RegExp(`${STAIR_COLUMN[k]}: int\\(form\\.${STAIR_COLUMN[k]}\\),`).test(panel)))
  const act = code(read('../src/app/(dashboard)/buildings/actions.ts'))
  check('저장 액션이 계단 4종을 null로 지울 수 있다',
    STAIR_KINDS.every(k => new RegExp(`out\\.${STAIR_COLUMN[k]} = b\\.${STAIR_COLUMN[k]} \\?\\? null`).test(act)))
  check('저장 액션 타입이 null을 받는다(number만이면 비우기가 막힌다)',
    STAIR_KINDS.every(k => new RegExp(`${STAIR_COLUMN[k]}\\?: number \\| null`).test(act))
    && /stairs_count\?: number \| null/.test(act))
  check('주석 제거 후에도 건물 폼 소스가 살아 있다(공허 통과 방지)', panel.includes('FacilityStatusGrid'), `${panel.length}자`)

  /* 🚨 이 한 줄이 「같은 컬럼을 덮는 두 번째 화면」을 막는다. 2026-09-16 이전엔 소방계획서 정보
   *   패널이 `stairs_count`를 손값으로 써서, 건물 탭에서 종류별로 적어도 이쪽 저장이 되돌렸다. */
  const infoAct = code(read('../src/app/(dashboard)/customers/fire-plan-info-actions.ts'))
  check('★ 소방계획서 정보 저장이 합계를 덮지 않는다(두 벌 금지)', !/stairs_count:/.test(infoAct))
  check('같은 파일의 형제 컬럼은 그대로 쓴다(과잉 제거 아님)',
    /ramp_count: toInt\(input\.rampCount\)/.test(infoAct) && /evac_elevator_count: toInt\(/.test(infoAct))

  const infoUi = code(read('../src/components/customers/fire-plan-info-panel.tsx'))
  check('★ 소방계획서 정보 화면에 계단 입력칸이 없다', !/set\('stairsCount'/.test(infoUi))
  check('대신 값을 읽기 전용으로 비춘다', /data-testid="fp-stairs-readonly"/.test(infoUi))

  const f15 = code(read('../src/components/customers/plan-form15.tsx'))
  check('★ 1.5 탭이 계단을 더 이상 입력받지 않는다', !/patch\(\{ stairs:/.test(f15))
  check('1.5 탭이 용도만 보고 계단을 지어내지 않는다(프리셋 제거)', !/stairs: \{ '직통계단'/.test(f15))
  check('1.5 탭이 형제 프리셋은 그대로 둔다(과잉 제거 아님)', /compartment: 'floor'/.test(f15))

  /* 두 인쇄 표면이 **같은 술어**를 부르는가 — 사본이 생기면 언젠가 갈라진다 */
  const xlsx = code(read('../src/lib/fire-plan-xlsx-values.ts'))
  const pdf = code(read('../src/lib/fire-plan-template.ts'))
  check('엑셀이 stairChecks를 부른다', /stairChecks\(d\.stairCounts \?\? \{\}\)/.test(xlsx))
  check('PDF가 stairChecks를 부른다', /stairChecks\(d\.stairCounts \?\? \{\}\)/.test(pdf))
  check('★ 엑셀이 옛 원천(1.5 탭 JSON)을 안 본다', !/evacFire\?\.stairs/.test(xlsx), 'forms.evacFire.stairs')
  check('★ PDF가 옛 원천을 안 본다', !/ef\?\.stairs/.test(pdf))

  const gen = code(read('../src/lib/fire-plan-generate.ts'))
  check('조립기가 계단을 한 번만 해석해 넘긴다', /stairCounts: \(\(\) => \{/.test(gen))
  check('조립기가 이관 전 고객을 폴백으로 건진다', /stairCountsFromLegacyMap\(sections\.evacFire\?\.stairs\)/.test(gen))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} facility-status: ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
