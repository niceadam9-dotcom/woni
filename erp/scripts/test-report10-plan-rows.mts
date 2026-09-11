/** 별지 10호 「이행조치 계획사항」 7행 구조 프로브 (2026-09-07, image-77 축)
 *  판정 축: ①7 구분이 서식 순서대로 전부 인쇄 ②fold 문구(이상없음/해당없음/결과참조)가 그 칸에 실린다
 *  ③그룹별 일자·총일수가 **각자의 기간**으로 찍힌다(총 기간 복제 아님) ④빈 구분은 자리표만
 *  ⑤총합 행(이행조치 필요기간) 존치 ⑥planRows 미공급이면 종전 렌더 그대로(하위 호환)
 *  실행: npx tsx scripts/_probe-r10-plan-rows.mts */
import { readFileSync } from 'node:fs'
import { renderReport10, type Annex1011Data, type AnnexPlanRow } from '../src/lib/doc-templates/report1011'
import { DEFECT_GROUPS, foldDefectGroups, DEFECT_FOLD_TEXT } from '../src/lib/doc-templates/report9'
import { actionPlanPeriod, annexPlanRows } from '../src/lib/report9-assemble'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}`) } }

const base: Annex1011Data = {
  customerName: '서림사', purpose: '문화및집회시설', address: '경기 양평군 강상면 가레밭골길 40',
  ownerName: '홍길동2', ownerPhone: '010-1234-3432', mgrName: '홍길동2', mgrPhone: '010-1234-3432',
  rows: [], reportDate: '2026년 7월 23일', submitTo: '양평소방서장',
}

// ── 원천 모사: 8쪽 defectRows + 설치 축 + 불량별 계획 일자 ──
const defectRows = [
  { group: '소화설비', code: 'STD-01-001', content: '거주자 등이 손 쉽게 사용할 수 있는 장소에 설치', userEntered: true },
  { group: '경보설비', code: 'STD-12-003', content: '수신기 정상 여부', userEntered: false },
]
const applicableGroups = ['소화설비', '경보설비', '피난구조설비']
const defects = [
  { defect_code: 'STD-01-001', action_plan: '소화기 재배치', action_start: '2026-08-18', action_end: '2026-08-20' },
  { defect_code: 'STD-12-003', action_plan: '수신기 교체', action_start: '2026-09-01', action_end: '2026-09-02' },
]
const groupByCode = new Map(defectRows.map(r => [r.code, r.group]))
const folds = foldDefectGroups(defectRows, applicableGroups)
const planRows: AnnexPlanRow[] = DEFECT_GROUPS.map(g => {
  const f = folds.get(g)!
  const p = actionPlanPeriod(defects.filter(d => groupByCode.get(d.defect_code) === g))
  return {
    group: g,
    content: f.kind === 'rows' ? f.rows.map(r => r.content).join('\n') : DEFECT_FOLD_TEXT[f.kind],
    period: p ? `2026년 ${Number(p.startISO.slice(5, 7))}월 ${Number(p.startISO.slice(8))}일 ~ 2026년 ${Number(p.endISO.slice(5, 7))}월 ${Number(p.endISO.slice(8))}일` : '',
    days: p ? String(p.days) : '',
  }
})

console.log('── A. 7행 구조 ──')
const html = renderReport10({ ...base, planRows, totalPeriod: '2026년 8월 18일 ~ 2026년 9월 2일', totalDays: '16' })
for (const g of DEFECT_GROUPS) ok(html.includes(`>${g}</td>`), `구분 행 인쇄: ${g}`)
const order = DEFECT_GROUPS.map(g => html.indexOf(`>${g}</td>`))
ok(order.every((v, i) => i === 0 || v > order[i - 1]), '서식 원문 순서(DEFECT_GROUPS) 보존')

console.log('── B. fold 문구 ──')
ok(html.includes('거주자 등이 손 쉽게 사용할 수 있는 장소에 설치'), '사용자 입력 불량은 그 문구 그대로')
ok(html.includes('결과참조'), '자동 등록만 있는 구분 → 결과참조')
ok(html.includes('이상없음'), '설치했고 불량 없는 구분 → 이상없음')
ok(html.includes('해당없음'), '미설치 구분 → 해당없음')

console.log('── C. 그룹별 일자(총 기간 복제 금지) ──')
ok(html.includes('2026년 8월 18일 ~ 2026년 8월 20일'), '소화설비는 자기 기간')
ok(html.includes('2026년 9월 1일 ~ 2026년 9월 2일'), '경보설비는 자기 기간')
ok(html.includes('(총 3 일)') && html.includes('(총 2 일)'), '총 일수도 구분마다 다르다')
// 총 기간(8/18~9/2)이 **행 칸**에 복제되지 않았는가 — 필요기간 행에만 1회
ok((html.match(/2026년 8월 18일 ~ 2026년 9월 2일/g) ?? []).length === 1, '총 기간은 이행조치 필요기간 행에만')
ok(html.includes('이행조치 필요기간') && html.includes('(총 16일)'), '총합 행 존치')
const emptyMarks = (html.match(/\(총&nbsp;&nbsp;&nbsp;&nbsp;일\)/g) ?? []).length
ok(emptyMarks === 5, `계획 없는 5개 구분은 자리표만 (실측 ${emptyMarks})`)

console.log('── C-2. 운영 Gotenberg 육안에서 잡힌 3건(2026-09-07) ──')
// ①② 라벨과 내용은 **각자 셀**이다. 한 셀 안 inline-block 두 개로는 두 번 실패했다 —
//    min-width는 6글자 라벨에서 넘쳐 콜론을 두 열로 갈랐고, calc() 폭은 내용을 다음 줄로 내렸다.
ok(/<td class="grp-label">[^<]+<\/td>\s*<td class="grp-body">/.test(html), '구분 라벨·내용이 각자 셀')
ok(/\.grp-label\s*\{[^}]*\bwidth:\s*\d+mm/.test(html) && !/\.grp-label\s*\{[^}]*min-width/.test(html),
  '라벨 셀은 고정 폭(글자 수에 따라 늘지 않는다)')
// 콜론은 **내용 셀의 첫 글자** — 라벨 폭이 어떻든 한 열에 선다
ok((html.match(/<td class="grp-body">:\s/g) ?? []).length === DEFECT_GROUPS.length,
  `콜론이 전 행에서 내용 셀 첫 글자 (${DEFECT_GROUPS.length}행)`)
// 헤더·요약 줄이 늘어난 열 수를 따라가는가 — 안 맞으면 표가 어긋난다
ok(html.includes('<td class="rows-th row-content" colspan="2">이행조치 사항'), '헤더가 라벨+내용 2열을 덮는다')
// 총합 행도 같은 열 수를 따라야 한다 — 안 그러면 그 행만 셀이 모자라 표 오른쪽이 잘린다(실제 발생)
ok(html.includes('<td class="rows-th" colspan="2">이행조치 필요기간'), '총합 행 라벨도 2열을 덮는다')
// 전 행의 셀 수가 같은가 — 어긋나면 인쇄물에서만 드러난다
const bodyRowCells = (html.match(/<tr>\s*<td class="grp-label"[\s\S]*?<\/tr>/g) ?? [])
  .map(r => (r.match(/<td/g) ?? []).length)
ok(bodyRowCells.length === DEFECT_GROUPS.length && bodyRowCells.every(n => n === 3),
  `본문 7행은 전부 3셀 (실측 ${bodyRowCells.join(',')})`)
// 구 렌더(2열)는 colspan을 붙이면 안 된다 — 같은 totalRow를 두 표가 공유한다
ok(!renderReport10({ ...base, rows: [{ content: 'x', period: 'y' }], totalDays: '3' }).includes('rows-th" colspan'),
  '구 렌더의 총합 행에는 colspan이 붙지 않는다')
// ③ 「총 20일일」 — 총 일수는 자유 텍스트 수동 보정 칸이라 사람이 「일」을 붙이면 서식과 겹쳤다
const dup = renderReport10({ ...base, planRows, totalPeriod: '2026년 8월 1일 ~ 2026년 8월 20일', totalDays: '20일' })
ok(dup.includes('(총 20일)') && !dup.includes('20일일'), '총 일수에 「일」을 적어도 중복 인쇄 안 함')
ok(renderReport10({ ...base, planRows, totalDays: '20' }).includes('총 20일'), '「일」 없는 값은 그대로')
// 지어내지 않는다 — 끝의 '일'만 벗기고 숫자로 만들지 않는다
ok(renderReport10({ ...base, planRows, totalDays: '미정' }).includes('총 미정일'), '숫자가 아닌 값은 원문 보존')

console.log('── C-3. Q-5 — 자동 문구 행의 일자 칸(자리표 대신 —) ──')
// ⚠ 위 A~C는 planRows를 **손으로** 만든다. 그러면 `annexPlanRows`가 붙이는 `isNote`를 안 타서
//   Q-5 축이 통째로 검사 밖에 남는다(픽스처에 판정값을 박은 검사가 그 규칙을 안 타는 것과 같은 형태).
//   그래서 여기서는 **실제 조립 함수**를 부른다.
{
  const PLACEHOLDER = '(총&nbsp;&nbsp;&nbsp;&nbsp;일)'
  /* 🎯 2026-09-11 — **사항 = 「결과참조」 · 일자 = 총 이행기간**(사용자 지시). 이 자리는 네 번 바뀌었다:
   *     ① 구분마다 다른 날짜 → ② 09-09 총 기간을 7행에 복제(같은 기간 여덟 번) →
   *     ③ 09-10 일자를 통째로 「결과참조」 → ④ 09-11 **사항·일자를 맞바꿈**.
   *   ②의 「여덟 번」이 재발하지 않는 이유는 날짜가 붙는 행이 **불량 있는 구분으로 한정**되기
   *   때문이다(이 픽스처에선 2행). 7행 전체에 붙기 시작하면 ②로 되돌아간 것이니 아래 dated 개수와
   *   음성 대조가 함께 붉어져야 한다.
   *   두 날짜 축에 **일부러 다른 값**을 넣어 둔다 — 구분별 기간이 새어 나오면 잡히게.
   *     actionPeriod(총)       = 8월 5일 ~ 8월 15일 (10일)  ← 필요기간 행 + **불량 있는 7행**에 인쇄
   *     actionGroupPeriods(구) = 8월 18일 ~ 8월 20일 (3일)  ← 어디에도 인쇄되면 안 되는 값 */
  const TOTAL_TEXT = '2026년 8월 5일 ~ 2026년 8월 15일'
  const TOTAL = { startISO: '2026-08-05', endISO: '2026-08-15', days: 10 }
  const GROUP_ONLY = { startISO: '2026-08-18', endISO: '2026-08-20', days: 3 }
  const realRows = annexPlanRows({
    defectRows, applicableGroups,
    actionPeriod: TOTAL,
    actionGroupPeriods: { 소화설비: GROUP_ONLY },
  } as never)
  ok(realRows.length === DEFECT_GROUPS.length, `annexPlanRows 7행 (실측 ${realRows.length})`)
  // 자동 문구 행에는 isNote가 붙는다 — 생산자가 표시하는 축(렌더가 글자로 알아보지 않는다)
  const notes = realRows.filter(r => r.isNote)
  ok(notes.length > 0, `isNote 붙은 문구 행 ${notes.length}개(개수 하한 선단언)`,
    notes.map(r => `${r.group}:${r.content}`).join(' · '))
  // 🎯 2026-09-11 — 불량 있는 구분(rows·refer)은 **사항 칸이 「결과참조」 한 낱말**로 접힌다.
  //   종전 계약은 「isNote 없는 행에는 자동 문구가 **없다**」였다 — 정반대가 됐으므로 갈아끼운다.
  ok(realRows.filter(r => !r.isNote).every(r => r.content === DEFECT_FOLD_TEXT.refer),
    'isNote 없는 행(불량 있는 구분)은 사항 칸이 전부 「결과참조」')
  // 축이 어긋나지 않았는가 — 이상없음·해당없음은 **isNote 행의 몫**이고 그 반대는 없다
  ok(realRows.filter(r => r.isNote).every(r => r.content === DEFECT_FOLD_TEXT.ok || r.content === DEFECT_FOLD_TEXT.na),
    'isNote 행은 이상없음/해당없음뿐(축이 어긋나지 않았다)')

  const realHtml = renderReport10({ ...base, planRows: realRows, totalPeriod: '2026년 8월 5일 ~ 2026년 8월 15일', totalDays: '10' })
  const bodyOnly = realHtml.slice(realHtml.indexOf('이행조치<br>계획사항'))
  ok(!bodyOnly.includes(PLACEHOLDER), '문구 행에 빈 기간 자리표가 없다')
  /* 🚨 2026-09-11 **같은 날 두 번째 계약 교체.**
   *   아침 판: 「불량 있는 구분만 기간 · 이상없음·해당없음은 —」.
   *   확정 판: **7행 전부 기간.** 사용자가 두 안을 미리보기로 나란히 보고 택했다
   *   (「같은 기간이 여덟 번째」 경고까지 본 선택이라 중복은 **의도된 것**이다).
   *   ⚠ 지우지 않고 **반대 방향**으로 세운다 — 지우면 누가 `—`로 되돌려도 스위트가 조용하다. */
  for (const g of notes) {
    const seg = bodyOnly.slice(bodyOnly.indexOf(`>${g.group}<`))
    const cell = seg.slice(0, seg.indexOf('</tr>'))
    ok(cell.includes(TOTAL_TEXT), `🎯 ${g.group}(${g.content}) 일자 칸에도 총 이행기간(종전 「—」)`)
  }
  /* 🚨 구간을 **갈라서** 잰다. `bodyOnly`는 7행과 「이행조치 필요기간」 행을 **둘 다** 품는다 —
   *   통째로 `includes`를 걸면 필요기간 행의 날짜가 7행 단언을 초록으로 만들어, 이 검사가
   *   '날짜가 어디에 있는가'를 하나도 고정하지 못한다([[feedback_exhaustive_has_an_axis]] 형태). */
  const totalAt = bodyOnly.indexOf('이행조치 필요기간')
  ok(totalAt > 0, '필요기간 행을 찾았다(구간 분할 전제)')
  const rowsOnly = bodyOnly.slice(0, totalAt)
  const totalOnly = bodyOnly.slice(totalAt)

  // 7행 전부의 일자 칸 = **총 이행기간** (2026-09-11 사용자 확정)
  ok(realRows.length === DEFECT_GROUPS.length,
    `일자 대상 ${realRows.length}행 = 7행 전부(양성 표본 선단언)`)
  /* 🚨 **생산자 층에서도** 잰다 — 렌더만 보면 부족하다. 아침 판에서 얻은 교훈이 반대로도 유효하다:
   *   그때는 렌더가 isNote에 무조건 `—`를 찍어 **생산자에 period가 실려도 화면이 조용했고**,
   *   그래서 「7행 전체」 변이가 스위트를 통과했다. 지금은 그 가림막을 걷었으므로, 이번엔
   *   **생산자가 7행 전부에 실었는가**를 직접 물어 렌더 한쪽만 고치는 회귀를 막는다. */
  ok(realRows.every(r => r.period !== ''),
    '🎯 (생산자) 7행 전부에 period가 실린다 — 불량 없는 구분도 포함')
  ok(realRows.every(r => r.days === ''),
    '(생산자) days는 전부 비어 있다 — 총 일수는 「필요기간」이 단독으로 싣는다')
  for (const g of realRows) {
    const seg = rowsOnly.slice(rowsOnly.indexOf(`>${g.group}<`))
    const cell = seg.slice(0, seg.indexOf('</tr>'))
    ok(cell.includes(TOTAL_TEXT), `${g.group} 일자 칸 = 총 이행기간`)
    // 총 일수는 「이행조치 필요기간」이 단독으로 싣는다 — days가 비면 꼬리를 안 붙인다
    ok(!cell.includes('row-days'), `${g.group} 일자 칸에 (총 N 일) 꼬리가 없다`)
  }
  /* 🚨 음성 대조 ① — **불량 내용 원문이 10호 7행에 새면 안 된다**. 「결과참조」로 접는 것이
   *   2026-09-11 변경의 핵심이고, 되돌리면 여기가 붉어진다.
   *   ⚠ 원문 자체는 8쪽·갑지 현5가 **계속 싣는다**(그래야 「결과참조」가 가리킬 곳이 있다) —
   *     그 축은 test-defect-fold·test-applicable-surfaces가 본다. 여기서 재는 건 10호뿐이다. */
  ok(!rowsOnly.includes('거주자 등이 손 쉽게'),
    '(음성) 불량 내용 원문은 10호 7행에 안 나온다')
  // 🚨 음성 대조 ①-b — 총 **일수**는 7행에 안 붙는다(필요기간 행이 단독)
  ok(!rowsOnly.includes('(총 10 일)') && !rowsOnly.includes('row-days'),
    '(음성) 총 일수 꼬리는 7행에 없다')
  // 🚨 음성 대조 ② — 그보다 앞선 규칙(설비 구분별 기간)도 어디에도 안 나온다
  ok(!bodyOnly.includes('2026년 8월 18일') && !bodyOnly.includes('(총 3 일)'),
    '(음성) 설비 구분별 기간은 어디에도 안 나온다')
  // 양성 — 날짜는 「이행조치 필요기간」 한 줄이 **단독으로** 싣는다
  ok(totalOnly.includes('2026년 8월 5일 ~ 2026년 8월 15일') && totalOnly.includes('(총 10일)'),
    '총 이행기간은 필요기간 행에 그대로')
  // 7행이 **전부 같은 한 값** — 그룹별 기간으로 되돌아가거나 일부만 실으면 여기가 붉어진다
  const periods = new Set(realRows.map(r => `${r.period}|${r.days}`))
  ok(periods.size === 1 && [...periods][0] === `${TOTAL_TEXT}|`,
    `7행 전부가 총 이행기간 한 값 (실측 ${[...periods].join(' / ')})`)
}

console.log('── D. 하위 호환(planRows 미공급) ──')
const legacy = renderReport10({ ...base, rows: [{ content: '유도등 교체', period: '2026년 8월 1일 ~ 2026년 8월 5일' }] })
// ⚠ 'grp-label'만 세면 항진명제다 — CSS 블록에 늘 들어 있다. **본문 클래스 속성**으로 판정한다
ok(legacy.includes('유도등 교체') && !legacy.includes('class="grp-label"'), '구 호출부는 종전 불량별 행 렌더')
ok(html.includes('class="grp-label"'), '(대조군) 신 렌더에는 본문 구분 라벨이 있다')

console.log('── E. 계획 요약(③ 고유값)은 7행 위 한 줄 ──')
const withSummary = renderReport10({ ...base, planRows, rows: [{ content: '전관 유도등 정비', period: '', isSummary: true }] })
ok(withSummary.includes('계획 요약') && withSummary.includes('전관 유도등 정비'), '요약 줄 인쇄')
ok(withSummary.indexOf('전관 유도등 정비') < withSummary.indexOf('>소화설비</td>'), '요약은 7행보다 위')

console.log('── F. 액션 덧칠 배선(소스 축) ──')
/* 🚨 일자 칸을 쓰는 곳은 **둘**이다: 조립본 `annexPlanRows`와 액션의 덧칠(수기 보정만 있고
 *   자동 산출이 없는 회차용). **덧칠이 나중에 이기므로** 한쪽만 고치면 다른 쪽이 되돌린다 —
 *   위 A~E는 조립본만 보기 때문에 그때도 전부 초록이다(이 세션이 실제로 밟을 뻔한 자리).
 *   `report9-actions.ts`는 'use server'라 import할 수 없어 **소스를 읽어** 배선을 단언한다
 *   (test-annex-total-period가 라우트·액션에 쓰는 것과 같은 방식).
 * ⚠ 파일 전체에서 문자열을 세지 않는다 — **덧칠 블록 안**으로 좁힌다. 파일 어딘가에 남아 있는
 *   `DEFECT_FOLD_TEXT.refer`(11호 축이 쓴다)에 매치돼 음성 단언이 헛도는 것을 막는다. */
{
  const ACTIONS = 'src/app/(dashboard)/inspections/report9-actions.ts'
  const src = readFileSync(new URL(`../${ACTIONS}`, import.meta.url), 'utf8')
  ok(src.length > 1000, `분모 확인: 액션 소스 ${src.length}자 읽음`)
  const overlay = /data\.planRows\s*=\s*data\.planRows\.map\(([\s\S]{0,400}?)\n\s*\}/.exec(src)?.[1] ?? ''
  ok(overlay.length > 0, '덧칠 블록을 찾았다(전제 — 못 찾으면 아래가 공허하다)')
  ok(/period:\s*total\b/.test(overlay), '덧칠이 일자 칸에 총 이행기간(totalPeriod)을 싣는다')
  ok(!/DEFECT_FOLD_TEXT\.refer/.test(overlay), '(음성) 덧칠이 「결과참조」로 되돌아가지 않았다')
  /* 🚨 2026-09-11 계약 교체 — 종전엔 `덧칠은 isNote 줄을 건드리지 않는다`(`r.isNote ? r : …`)였다.
   *   **7행 전부 기간**으로 확정되면서 그 제외가 사라졌다. 조립본(annexPlanRows)과 덧칠이
   *   **같은 축**이어야 한다 — 한쪽만 제외하면 자동 산출이 있는 회차와 수기 보정만 있는 회차가
   *   서로 다른 표를 인쇄한다. 음성으로 세워 제외가 되살아나면 붉어지게 한다. */
  ok(!/isNote\s*\?\s*r\s*:/.test(overlay),
    '🎯 덧칠이 isNote 줄을 제외하지 않는다(7행 전부 같은 축)')
  ok(/days:\s*''/.test(overlay), "덧칠은 days를 비운다(「(총 N 일)」 중복 인쇄 차단)")
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
