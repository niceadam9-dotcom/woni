// 별지 9호 3쪽 = 별지 4호 1쪽 — 미해당 표기 프로브 (2026-08-20 사용자 지시로 ①② 정정)
//   ① '/'는 **점검결과 칸의 어휘**다(양호○·불량×·해당없음/). 체크박스에는 절대 넣지 않는다 —
//      한때 하위 항목 미해당을 [/]로 찍었으나 서식 원문에서도 하위 줄은 부모와 똑같은 [ ] 칸이다
//      (_form/_별지4호_현행판_추출.txt:23-37). 미해당이든 미설치든 체크박스는 빈칸이다.
//   ② 하위 줄에 자기 점검결과 칸이 없는 것은 사실이나(부모와 한 칸 공유), 체크박스를 결과칸
//      대용으로 쓰지 않는다. 해당없음은 부모의 점검결과 칸 '/'가 말한다.
//   ③ '기타' 3항목(방화문·비상구·방염): 무응답도 ／로 채운다(종전 공란) — 이건 점검결과 칸이라 유지
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
  check('미해당 하위 항목은 빈 체크박스 — 캐비닛형', boxOf(html, '캐비닛형자동소화장치') === '[ ]', boxOf(html, '캐비닛형자동소화장치'))
  check('미해당 하위 항목은 빈 체크박스 — 가스ㆍ분말ㆍ고체', boxOf(html, '가스ㆍ분말ㆍ고체자동소화장치') === '[ ]', boxOf(html, '가스ㆍ분말ㆍ고체자동소화장치'))
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
  // 종전 이 단언은 `FIRE_SUB_ITEMS.slice(1).every(() => true)`라는 항진식을 끼고 있어 5종 중 2종만
  // 실제로 봤다 — 하위 5줄 라벨을 전부 훑는다.
  const SUB_LABELS = ['소화기구(소화기, 자확, 간이)', '주거용주방자동소화장치', '상업용주방자동소화장치',
    '캐비닛형자동소화장치', '가스ㆍ분말ㆍ고체자동소화장치']
  check('부모 미설치면 부모도 하위 5종도 전부 빈 체크박스',
    boxOf(html, '소화기구 및 자동소화장치') === '[ ]' && SUB_LABELS.every(l => boxOf(html, l) === '[ ]'),
    `부모 ${boxOf(html, '소화기구 및 자동소화장치')} / 하위 ${SUB_LABELS.map(l => boxOf(html, l)).join(' ')}`)
}
{
  // 부모의 해당없음이 어디서 말해지는지 — 이 함수는 순수 렌더러라 '/'는 resultMarks에서 온다
  // (미설치라고 자동으로 ／가 되지 않는다. 채우는 쪽은 조립 단계다).
  const html = facilityResultSection({
    facilityChecks: [], resultMarks: { '소화기구 및 자동소화장치': 'N' }, ledgerCodes: [],
  })
  check('부모 해당없음 = 빈 체크박스 + 점검결과 /',
    boxOf(html, '소화기구 및 자동소화장치') === '[ ]' && markOf(html, '소화기구 및 자동소화장치') === '/',
    `${boxOf(html, '소화기구 및 자동소화장치')} / "${markOf(html, '소화기구 및 자동소화장치')}"`)
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
  check('미보유 그룹은 빈 체크박스 — 다수인피난장비', boxOf(html, '다수인피난장비') === '[ ]', boxOf(html, '다수인피난장비'))
  check('미보유 그룹은 빈 체크박스 — 승강식피난기', boxOf(html, '승강식피난기') === '[ ]', boxOf(html, '승강식피난기'))
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

console.log('\n── ⑤ 불변식 — 체크박스에 [/]는 어디에도 없다 ──')
{
  // 하위 항목만 고쳐 놓고 다른 자리에 같은 표기가 다시 생기는 것을 막는다.
  // 설치/미설치·응답 유무를 섞은 여러 조합에서 전수로 훑는다.
  const cases = {
    '전부 비었을 때': { facilityChecks: [], resultMarks: {}, ledgerCodes: [] },
    '일부 설치 + 불량': {
      facilityChecks: ['소화기구 및 자동소화장치', '피난기구'],
      resultMarks: { '소화기구 및 자동소화장치': 'X', '피난기구': 'N' },
      ledgerCodes: [FIRE_SUB_ITEMS[0]],
      specs: { s36_evac: { evac_equipment: { types: [EVAC_FORM3_GROUPS[0][0]] } } },
    },
    '기타 응답 있음': { facilityChecks: [], resultMarks: {}, etcMarks: { door: 'O', exit: 'X', flame: 'N' } },
  }
  for (const [name, d] of Object.entries(cases)) {
    const html = facilityResultSection(d)
    const hits = [...html.matchAll(/\[\/\]/g)].length
    check(`${name} — [/] 0건`, hits === 0, `${hits}건 발견`)
  }
  // ／(U+FF0F)를 체크박스에 넣는 변종도 함께 막는다
  const anyFull = Object.values(cases).some(d => /\[[／/]\]/.test(facilityResultSection(d)))
  check('전각 ／를 넣은 변종도 없다', !anyFull)
}

console.log(`\n결과: ${pass} pass / ${fail} fail\n`)
process.exit(fail ? 1 : 0)
