/** 별지 10호 「이행조치 계획사항」 7행 구조 프로브 (2026-09-07, image-77 축)
 *  판정 축: ①7 구분이 서식 순서대로 전부 인쇄 ②fold 문구(이상없음/해당없음/결과참조)가 그 칸에 실린다
 *  ③그룹별 일자·총일수가 **각자의 기간**으로 찍힌다(총 기간 복제 아님) ④빈 구분은 자리표만
 *  ⑤총합 행(이행조치 필요기간) 존치 ⑥planRows 미공급이면 종전 렌더 그대로(하위 호환)
 *  실행: npx tsx scripts/_probe-r10-plan-rows.mts */
import { renderReport10, type Annex1011Data, type AnnexPlanRow } from '../src/lib/doc-templates/report1011'
import { DEFECT_GROUPS, foldDefectGroups, DEFECT_FOLD_TEXT } from '../src/lib/doc-templates/report9'
import { actionPlanPeriod } from '../src/lib/report9-assemble'

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

console.log('── D. 하위 호환(planRows 미공급) ──')
const legacy = renderReport10({ ...base, rows: [{ content: '유도등 교체', period: '2026년 8월 1일 ~ 2026년 8월 5일' }] })
// ⚠ 'grp-label'만 세면 항진명제다 — CSS 블록에 늘 들어 있다. **본문 클래스 속성**으로 판정한다
ok(legacy.includes('유도등 교체') && !legacy.includes('class="grp-label"'), '구 호출부는 종전 불량별 행 렌더')
ok(html.includes('class="grp-label"'), '(대조군) 신 렌더에는 본문 구분 라벨이 있다')

console.log('── E. 계획 요약(③ 고유값)은 7행 위 한 줄 ──')
const withSummary = renderReport10({ ...base, planRows, rows: [{ content: '전관 유도등 정비', period: '', isSummary: true }] })
ok(withSummary.includes('계획 요약') && withSummary.includes('전관 유도등 정비'), '요약 줄 인쇄')
ok(withSummary.indexOf('전관 유도등 정비') < withSummary.indexOf('>소화설비</td>'), '요약은 7행보다 위')

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
