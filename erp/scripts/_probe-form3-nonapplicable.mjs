// 별지 9호 3쪽 = 별지 4호 1쪽 — 미해당 표기 프로브 (2026-08-20 사용자 확정)
//   ① 소화기구·피난기구 하위 항목: 미해당은 [/] (서식에 하위별 점검결과 칸이 없어 체크박스로 보인다)
//   ② 부모 항목의 체크박스는 종전대로 √ 또는 빈칸 — 부모의 해당없음은 자기 점검결과 칸이 말한다
//   ③ '기타' 3항목(방화문·비상구·방염): 무응답도 ／로 채운다(종전 공란)
// 서버·DB 불필요. 실행: npx tsx scripts/_probe-form3-nonapplicable.mjs
const { facilityResultSection } = await import('../src/lib/doc-templates/report9.ts')
const { FIRE_SUB_ITEMS, EVAC_FORM3_GROUPS } = await import('../src/lib/facility-codes.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}
/** 라벨 바로 앞의 체크박스 표기를 뽑는다 — '[√]' | '[/]' | '[ ]' */
function boxOf(html, label) {
  const i = html.indexOf(label)
  if (i < 0) return `(라벨 없음: ${label})`
  const before = html.slice(Math.max(0, i - 40), i)
  const m = [...before.matchAll(/\[(?:√|\/|&nbsp;&nbsp;)\]/g)].pop()
  return (m?.[0] ?? '(없음)').replace('&nbsp;&nbsp;', ' ')
}
/** 라벨이 든 행의 점검결과(mk) 칸 내용 */
function markOf(html, label) {
  const i = html.indexOf(label)
  if (i < 0) return '(라벨 없음)'
  const after = html.slice(i)
  const m = after.match(/<td class="center mk">([^<]*)<\/td>/)
  return (m?.[1] ?? '').replace(/&nbsp;/g, ' ').trim()
}

console.log('\n── ① 소화기구 하위 5종 ──')
{
  // 앞 3종만 대장에 설치(√), 캐비닛형·가스분말고체는 미설치
  const html = facilityResultSection({
    facilityChecks: ['소화기구 및 자동소화장치'],
    resultMarks: { '소화기구 및 자동소화장치': 'X' },
    ledgerCodes: [FIRE_SUB_ITEMS[0], FIRE_SUB_ITEMS[1], FIRE_SUB_ITEMS[2]],
  })
  check('설치한 하위 항목은 [√]', boxOf(html, '소화기구(소화기, 자확, 간이)') === '[√]', boxOf(html, '소화기구(소화기, 자확, 간이)'))
  check('설치한 하위 항목은 [√] — 주거용', boxOf(html, '주거용주방자동소화장치') === '[√]', boxOf(html, '주거용주방자동소화장치'))
  check('미해당 하위 항목은 [/] — 캐비닛형', boxOf(html, '캐비닛형자동소화장치') === '[/]', boxOf(html, '캐비닛형자동소화장치'))
  check('미해당 하위 항목은 [/] — 가스ㆍ분말ㆍ고체', boxOf(html, '가스ㆍ분말ㆍ고체자동소화장치') === '[/]', boxOf(html, '가스ㆍ분말ㆍ고체자동소화장치'))
  check('부모(소화기구 및 자동소화장치)는 종전대로 [√]', boxOf(html, '소화기구 및 자동소화장치') === '[√]', boxOf(html, '소화기구 및 자동소화장치'))
  check('부모의 점검결과 칸은 그대로 ×', markOf(html, '소화기구 및 자동소화장치') === '×', markOf(html, '소화기구 및 자동소화장치'))
  // 서식 원문에서 하위 6줄의 점검결과는 부모와 공유하는 한 칸이다(hwpx: 소화기구 colAddr 2/rowAddr 4
  // rowSpan 1). 그 행 하나를 떼어 mk 칸이 정확히 1개인지 본다 — 산수로 세면 헤더·바깥 표에 속는다.
  {
    const row = [...html.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map(m => m[0])
      .find(r => r.includes('캐비닛형자동소화장치'))
    const mk = (row?.match(/<td class="center mk">/g) ?? []).length
    check('하위 6줄이 든 행의 점검결과 칸은 정확히 1개 (서식 원문과 동일 — 부모와 한 칸)',
      mk === 1 && !!row?.includes('소화기구 및 자동소화장치'), `그 행의 mk 칸 ${mk}개`)
  }
}
{
  const html = facilityResultSection({ facilityChecks: [], resultMarks: {}, ledgerCodes: [] })
  check('부모 미설치면 부모는 빈 체크박스, 하위는 전부 [/]',
    boxOf(html, '소화기구 및 자동소화장치') === '[ ]'
    && FIRE_SUB_ITEMS.slice(1).every((_, i) => true)
    && boxOf(html, '캐비닛형자동소화장치') === '[/]' && boxOf(html, '주거용주방자동소화장치') === '[/]',
    `부모 ${boxOf(html, '소화기구 및 자동소화장치')} / 캐비닛 ${boxOf(html, '캐비닛형자동소화장치')}`)
}

console.log('\n── ② 피난기구 하위 3그룹 ──')
{
  // 1그룹(공기안전매트ㆍ피난사다리 …)만 보유
  const html = facilityResultSection({
    facilityChecks: ['피난기구'],
    resultMarks: { '피난기구': 'O' },
    specs: { s36_evac: { evac_equipment: { types: [EVAC_FORM3_GROUPS[0][0]] } } },
  })
  check('보유 그룹은 [√] — 공기안전매트ㆍ피난사다리', boxOf(html, '공기안전매트ㆍ피난사다리') === '[√]', boxOf(html, '공기안전매트ㆍ피난사다리'))
  check('미보유 그룹은 [/] — 다수인피난장비', boxOf(html, '다수인피난장비') === '[/]', boxOf(html, '다수인피난장비'))
  check('미보유 그룹은 [/] — 승강식피난기', boxOf(html, '승강식피난기') === '[/]', boxOf(html, '승강식피난기'))
  check('부모(피난기구)는 [√] + 점검결과 ○', boxOf(html, '피난기구') === '[√]' && markOf(html, '피난기구') === '○',
    `${boxOf(html, '피난기구')} / ${markOf(html, '피난기구')}`)
  check('체크박스 없는 이어짐 줄은 건드리지 않는다',
    html.includes('(간이)완강기ㆍ미끄럼대ㆍ구조대') && html.includes('하향식피난구용내림식사다리'))
}

console.log('\n── ③ 기타 3항목 — 무응답도 ／ ──')
{
  const html = facilityResultSection({ facilityChecks: [], resultMarks: {} })   // etcMarks 자체가 없음
  for (const label of ['방화문, 자동방화셔터', '비상구, 피난통로', '방  염']) {
    check(`무응답 → ／ (${label})`, markOf(html, label) === '/', `실제: "${markOf(html, label)}"`)
    check(`무응답 → 체크박스는 빈칸 (${label})`, boxOf(html, label) === '[ ]', boxOf(html, label))
  }
}
{
  const html = facilityResultSection({
    facilityChecks: [], resultMarks: {},
    etcMarks: { door: 'O', exit: 'X', flame: 'N' },
  })
  check('응답이 있으면 그 값이 이긴다 — 방화문 ○ + [√]',
    markOf(html, '방화문, 자동방화셔터') === '○' && boxOf(html, '방화문, 자동방화셔터') === '[√]',
    `${markOf(html, '방화문, 자동방화셔터')} / ${boxOf(html, '방화문, 자동방화셔터')}`)
  check('불량은 × + [√]', markOf(html, '비상구, 피난통로') === '×' && boxOf(html, '비상구, 피난통로') === '[√]')
  check('해당없음 응답은 ／ + 빈 체크박스', markOf(html, '방  염') === '/' && boxOf(html, '방  염') === '[ ]')
}

console.log('\n── ④ 회귀 — 나머지 항목 표기는 그대로 ──')
{
  const html = facilityResultSection({
    facilityChecks: ['옥내소화전설비'],
    resultMarks: { '옥내소화전설비': 'X', '스프링클러설비': 'N' },
  })
  check('설치+불량 → [√] ×', boxOf(html, '옥내소화전설비') === '[√]' && markOf(html, '옥내소화전설비') === '×')
  check('미설치 일반 항목은 [/]가 아니라 빈 체크박스 — 자기 점검결과 칸이 ／를 말한다',
    boxOf(html, '스프링클러설비') === '[ ]' && markOf(html, '스프링클러설비') === '/',
    `${boxOf(html, '스프링클러설비')} / ${markOf(html, '스프링클러설비')}`)
}

console.log(`\n결과: ${pass} pass / ${fail} fail\n`)
process.exit(fail ? 1 : 0)
