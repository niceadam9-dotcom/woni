/** 엑셀 고지 → 클릭 칩 검사 — `src/lib/fire-plan-notice.ts` + 자동 생성 표.
 *
 *  🚨 가장 중요한 단언은 [2]다. 고지가 말하는 번호는 **시트 번호**라 화면 노드 키와 다르다.
 *    `1.15`의 뒤를 자르면 `1.1`이 나오는데, `1.1`은 **실재하는 엉뚱한 노드**다(일반현황).
 *    접두 잘라내기로 짜면 사용자를 조용히 딴 화면으로 보낸다 — 그건 고장보다 나쁘다.
 *
 *  [1]은 생성물이 대장과 어긋나지 않았는지(드리프트)를 **생성기와 같은 함수**로 되묻는다.
 *  검사가 자기 사본을 만들면 둘이 같이 틀려도 초록이다.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-fire-plan-notice.mts
 */
import { parseFirePlanNotice, clickableCount } from '../src/lib/fire-plan-notice.ts'
import { SHEET_NO_TO_FORM } from '../src/lib/fire-plan-notice-map.ts'
import { deriveNoToForm } from './build-fire-plan-notice-map.mts'
import { PLAN_TREE_FORM_KEYS, FIRE_PLAN_FORM_KEYS, tabOfForm } from '../src/lib/fire-plan-sections.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

console.log('\n[1] 생성물이 대장과 같은가 (드리프트 차단)')
{
  const truth = deriveNoToForm()
  check('표가 비어 있지 않다(공허 통과 방지)', Object.keys(SHEET_NO_TO_FORM).length > 20,
    `${Object.keys(SHEET_NO_TO_FORM).length}개`)
  check('생성물 개수 = 대장 파생 개수', Object.keys(SHEET_NO_TO_FORM).length === truth.size,
    `${Object.keys(SHEET_NO_TO_FORM).length} vs ${truth.size}`)
  const wrong = [...truth].filter(([no, form]) => SHEET_NO_TO_FORM[no] !== form)
  check('모든 번호가 대장과 같은 노드를 가리킨다', wrong.length === 0,
    wrong.slice(0, 3).map(([n, f]) => `${n}→${f}≠${SHEET_NO_TO_FORM[n]}`).join(' '))
  const unknown = Object.values(SHEET_NO_TO_FORM).filter(f => !FIRE_PLAN_FORM_KEYS.includes(f))
  check('가리키는 노드가 전부 대장에 있는 키다', unknown.length === 0, unknown.join(' '))
}

console.log('\n[2] 🚨 접두 잘라내기로는 못 푸는 자리')
{
  // 라우트 route.ts가 실제로 내보내는 문구 그대로다(자유 서술이라 표본이 곧 계약이다)
  const p = parseFirePlanNotice('피해 복구(1.15) 화재발생개요 — 화재 2건은 미표기(단일 사건 서식, 최신 1건만)')
  check('1.15는 1.1이 아니라 1.12 노드로 간다', p[0]?.form === '1.12', `got=${p[0]?.form}`)
  const q = parseFirePlanNotice('공사·정비 「대상 설비」 3건 미표기(양식에 해당 열 없음) | 개정이력 2건 미표기(양식 연번 11행)')
  check('번호 없는 조각은 칩이 아니라 글자로 남는다', q.length === 2 && !q[0].form && !q[1].form,
    q.map(x => x.form ?? '-').join(','))

  // 🚨 **표에 없는 번호는 지어내지 않는다.** 이 단언이 없으면 「표를 보되 없으면 접두를 잘라
  //   추측한다」는 구현이 그대로 통과한다(변이 N1이 실제로 살아남아서 잡았다).
  //   현실적인 위험이다 — 고지에는 **사용자가 입력한 장소명이 그대로 실린다**
  //   (`화재취약장소 … : 보일러실 3.5층창고`). 접두 구현은 그 「3.5」를 서식 번호로 읽고
  //   엉뚱한 화면으로 보낸다. 조용한 오안내는 고장보다 나쁘다.
  const r = parseFirePlanNotice('화재취약장소 2곳 미표기(양식 고정 3개소 밖): 3.5층창고 9.99별관')
  check('🚨 표에 없는 번호(사용자 장소명)로 칩을 만들지 않는다', !r[0]?.form, `got=${r[0]?.form}`)
  check('🚨 그래도 문장은 글자로 그대로 남는다', r[0]?.text.includes('3.5층창고'))

  // ⚠ 방어가 **세 겹**이라 표본 하나로는 하나밖에 못 잰다(변이 N1·N2가 둘 다 생존해서 드러났다).
  //   위 표본은 `: ` 절단만 건드린다 — 나머지 둘을 각각 겨누는 표본을 따로 둔다.
  //
  // (a) 한글 가드 — 사용자 입력이 **문장 가운데** 박히는 고지가 실재한다:
  //     route.ts의 `피난약자 방법 ${...join('·')} 미표기(양식 4종 밖)`는 콜론이 없다.
  const mid = parseFirePlanNotice('피난약자 방법 3.5층이동·업기 미표기(양식 4종 밖)')
  check('🚨 문장 가운데 사용자 값(3.5층이동)도 번호로 읽지 않는다', !mid[0]?.form, `got=${mid[0]?.form}`)

  // (b) 표에만 묻는다 — 모르는 번호는 **지어내지 않는다**. 콜론도 없고 뒤에 한글도 없어
  //     앞의 두 방어가 통과시키는 자리다. 여기서 칩이 생기면 없는 화면으로 보내는 것이다.
  const unknown = parseFirePlanNotice('개정이력 2건 미표기(양식 연번 9.99)')
  check('🚨 표에 없는 번호는 칩이 되지 않는다(지어내지 않는다)', !unknown[0]?.form, `got=${unknown[0]?.form}`)

  // ⭐ 콜론 **뒤**가 사용자 값이 아니라 진짜 시트 좌표인 고지가 있다 — 그건 링크가 **되어야** 한다.
  //   (종전에 두었던 「콜론 뒤는 안 본다」 절단을 걷어낸 이유. 그 절단은 이 옳은 링크까지 막았다.)
  const heal = parseFirePlanNotice('서식 좌표 자가치유: 1.4!AR13')
  check('⭐ 자가치유 좌표는 그 서식으로 가는 칩이 된다', heal[0]?.form === '1.4', `got=${heal[0]?.form}`)
}

console.log('\n[3] 라우트 실제 문구 표본 — 갈 곳이 있는 것은 간다')
{
  const SAMPLES: Array<[string, string]> = [
    ['선임현황(1.7.1) 2명 미표기(양식 16행)', '1.7'],
    ['피난유도팀(2.10) 피난경로 1건 미표기(양식 세 줄)', 'ch2'],
    ['초기소화팀(2.9) 화재취약장소 2건 미표기(양식 3행)', 'ch2'],
    ['위험물 4건 미표기(양식 3행 — 1.6.1·2.12 공통)', '1.6'],
  ]
  for (const [text, want] of SAMPLES) {
    const got = parseFirePlanNotice(text)[0]
    check(`「${text.slice(0, 18)}…」 → ${want}`, got?.form === want, `got=${got?.form}`)
  }
}

console.log('\n[4] 조각 나누기 — 라우트의 구분자와 같은 자를 쓴다')
{
  const raw = '서식 좌표 자가치유: A | 구역별 세부현황 3개 구역 미표기(양식 고정 행 상한) | 선임현황(1.7.1) 2명 미표기'
  const p = parseFirePlanNotice(raw)
  check('3조각으로 쪼갠다', p.length === 3, String(p.length))
  check('원문이 보존된다(잘라 먹지 않는다)', p.every(x => raw.includes(x.text)))
  check('갈 곳 있는 조각만 칩이 된다', clickableCount(p) === 1, String(clickableCount(p)))
  check('빈 고지는 빈 배열', parseFirePlanNotice('').length === 0)
  check('공백뿐인 고지도 빈 배열', parseFirePlanNotice('   ').length === 0)
}

console.log('\n[5] 목적지가 실제로 열리는 자리인가')
{
  // 이사 노드(1.1·1.4)는 소방계획서 트리에 **없다** — 화면은 그 탭으로 보내야 한다.
  // 표가 그런 키를 내보낼 수 있으므로(1.10.3→1.4), 호출부가 분기해야 한다는 사실을 못박는다.
  const moved = Object.values(SHEET_NO_TO_FORM).filter(f => tabOfForm(f))
  check('이사 노드로 가는 번호가 실재한다(호출부 분기가 필요하다)', moved.length > 0, `${moved.length}건`)
  const inTree = Object.values(SHEET_NO_TO_FORM).filter(f => PLAN_TREE_FORM_KEYS.includes(f))
  check('나머지는 소방계획서 트리 노드다', inTree.length > 0, `${inTree.length}건`)
  check('트리에도 없고 이사도 아닌 키는 없다',
    Object.values(SHEET_NO_TO_FORM).every(f => tabOfForm(f) || PLAN_TREE_FORM_KEYS.includes(f)))
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
