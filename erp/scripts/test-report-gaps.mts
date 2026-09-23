/** 보고서 준비도 — 탭 뱃지·탭 상단 목록·달력 한 줄 (2026-09-23 사용자 요청)
 *  실행: npx tsx scripts/test-report-gaps.mts   — **서버·DB 불필요**
 *
 *  사용자: 「기본정보~보고서 탭을 입력하도록 유도해야 한다 — 보고서 엑셀을 채우려면」.
 *  종전엔 빈칸을 **엑셀을 받은 뒤에야** 알았다(고지는 다운로드 헤더에서만 만들어졌다).
 *
 *  🚨 급소:
 *    ① **규칙이 두 벌이 되면 안 된다** — 탭 뱃지가 엑셀과 다른 판정을 쓰면 「탭은 다 찼다는데 엑셀은
 *       비었다」. 라우트가 엑셀과 **같은 조립 함수 셋**을 부르고, 분류는 **같은 표**를 거치는지 묻는다.
 *    ② **회차·본사 축을 탭에 세면 안 된다** — 「점검표 미입력」을 기본정보 탭에 세면 그 탭을 아무리
 *       채워도 안 준다(사용자가 못 고치는 빨강). 본사 팩스는 31/31이라 전 탭을 영영 빨갛게 한다.
 *    ③ **목적지가 칸 없는 탭이면 안 된다** — 송달 동의·급수는 공통 1.1에 있다(종전 표는 기본정보).
 *    ④ **판정 불가를 0으로 그리면 안 된다** — 회차가 없거나 조회가 실패하면 「다 찼다」가 아니다.
 *    ⑤ 표에 새 고객 축 목적지가 생겼는데 탭 매핑이 모르면 **빨개져야** 한다(표는 썩는다).
 */
import { readFileSync } from 'node:fs'
import { codeOnly } from './_code-only.mts'
import { safeReturnHref } from '../src/lib/safe-return.ts'
import {
  groupReportGaps, nextGapTab, gapShortText, reportTabOfTarget, reportInputTarget, REPORT_INPUT_TABS,
  WORKBOOK_NOTICE_RULES, parseWorkbookNotice, workbookFixHref,
} from '../src/lib/workbook-notice.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const read = (p: string) => codeOnly(readFileSync(new URL(p, import.meta.url), 'utf8'))

console.log('— ① 탭 묶기 — 고객 축만, 목적지대로')
{
  const g = groupReportGaps([
    '주소', '사용승인일', '관할 소방서 없음 — 고객 정보(1.3) 또는 [입력]에서 지정',
    '송달 동의', '소방안전관리등급(대상물 급수) 미입력 — 2쪽 체크 공란',
    '건축허가일',
    '소방안전관리자 최근 교육이수일 미입력 — 2쪽 공란',
    '설비 대장 미등록 시트 옥외소화전설비 — 점검표 응답이 있어 부속 점검표·목차에 포함됨',
    '전년도(2025) 소방훈련 실적 없음 — 2쪽 교육훈련 칸 공란(서식 1.11.4 기록부 입력 또는 보고서 탭 「전년도 업무 실시사항」 확정)',
  ])
  ok('기본정보 = 주소·사용승인일·관할 소방서 (3)', g.info.map(x => x.short).join('|') === '주소|사용승인일|관할 소방서 없음', JSON.stringify(g.info))
  ok('건물·시설 = 건축허가일', g.buildings.length === 1 && g.buildings[0].short === '건축허가일')
  ok('관계인 = 교육이수일', g.contacts.length === 1 && g.contacts[0].short === '소방안전관리자 최근 교육이수일 미입력')
  ok('★ 공통 = 송달 동의·급수(1.1) + 설비 대장(1.4)', g.facilities.length === 3
    && g.facilities.filter(x => x.target === 'common11').length === 2
    && g.facilities.filter(x => x.target === 'facilities').length === 1, JSON.stringify(g.facilities))
  ok('보고서 = 전년도 훈련', g.reports.length === 1 && g.reports[0].target === 'reports')
}

console.log('\n— ② 회차·본사·안내·상한은 탭에 세지 않는다')
{
  const g = groupReportGaps([
    '점검표 미입력 5종 → 기본 ○ 인쇄: 소화기구', '점검기간', '주된 점검인력', '불량사진 2장 누락',
    '회사 팩스 미등록 — 레터헤드에서 생략 (본사 정보에서 입력)',
    '대리인 생년월일 미입력 — 공란 인쇄 (관리자 > 직원 관리 또는 [입력]에서 기재)',
    '문서번호 자동 제안(승 진 2609-1) — [입력]에서 수정·확정 가능',
    '보조 점검인력 9명 중 8번째부터 미표기(허브 7행)',
    '여기 없는 새로운 고지 문구입니다',
    // 소방계획서·지도사진은 **자기 탭 뱃지(n/12)**가 맡는다 — 보고서 다섯 탭에 세지 않는다
    '소방계획서 서식 입력 없음(고객 > 소방계획서 탭) — 2쪽 작성·보관 칸 공란',
    '표지 건물 사진 미등록 — 자리표시로 인쇄 (고객 상세 [지도·사진] cover 슬롯)',
  ])
  const n = REPORT_INPUT_TABS.reduce((s, k) => s + g[k].length, 0)
  ok('★ 다섯 탭 합계 0', n === 0, JSON.stringify(g))
}

console.log('\n— ③ 한 칸은 한 번만 (공문·위임장·9호가 같은 빈칸을 각자 알린다)')
{
  const g = groupReportGaps(['주소', '주소', '관계인 성명 없음 — A', '관계인 성명 없음 — B'])
  ok('주소 1개', g.info.length === 1)
  ok('관계인 성명 1개(꼬리가 달라도 같은 칸)', g.contacts.length === 1)
}

console.log('\n— ④ 목적지 교정 — 칸이 있는 탭으로')
{
  const t = (s: string) => parseWorkbookNotice(s)[0]?.target
  ok('★ 송달 동의 → 공통 1.1', t('송달 동의') === 'common11')
  ok('★ 급수 → 공통 1.1', t('소방안전관리등급(대상물 급수) 미입력 — 2쪽 체크 공란') === 'common11')
  ok('공통 1.1 주소', workbookFixHref('common11', { inspectionId: 'I', customerId: 'C' }, () => null) === '/customers/C?tab=facilities&form=1.1')
  ok('관할 소방서는 기본정보 그대로(기본정보 폼에 칸이 있다)', t('관할 소방서 없음 — x') === 'info')
}

console.log('\n— ⑤ 표가 새 고객 축 목적지를 만들면 탭 매핑이 알아야 한다')
{
  // 탭 뱃지에서 **일부러** 뺀 목적지 — 늘리려면 여기와 TAB_OF_TARGET을 함께 고친다
  const EXCLUDED = new Set(['plan', 'assets'])
  const unknown = WORKBOOK_NOTICE_RULES
    .filter(r => r.kind === 'fixable' && r.scope === 'customer' && r.target && !EXCLUDED.has(r.target))
    .filter(r => reportTabOfTarget(r.target) === null)
  ok('★ 고객 축 목적지 전부가 탭을 갖는다', unknown.length === 0, unknown.map(r => r.target).join(','))
  ok('회차 축 목적지는 탭이 없다', ['sheet', 'defects', 'period', 'crew', 'annex', 'org'].every(t => reportTabOfTarget(t as never) === null))
}

console.log('\n— ⑥ 다음 빈 탭 — 뒤에서 먼저, 없으면 앞으로 되감기')
{
  const e = { info: [], buildings: [], contacts: [], facilities: [], reports: [] } as Record<string, unknown[]>
  const by = (o: Partial<Record<string, number>>) => Object.fromEntries(Object.keys(e).map(k => [k, Array(o[k] ?? 0).fill(0)])) as never
  ok('기본정보에서 → 공통', nextGapTab(by({ info: 1, facilities: 2 }), 'info') === 'facilities')
  ok('★ 보고서에서 → 앞으로 되감아 기본정보', nextGapTab(by({ info: 1, reports: 1 }), 'reports') === 'info')
  ok('★ 자기 탭만 남았으면 null(자기를 가리키지 않는다)', nextGapTab(by({ contacts: 2 }), 'contacts') === null)
  ok('다 찼으면 null', nextGapTab(by({}), 'info') === null)
  ok('다섯 탭 밖(소방계획서)에서 → 첫 빈 탭', nextGapTab(by({ buildings: 1 }), 'plan') === 'buildings')
  // 달력 [입력하기] 목적지 — 첫 빈 탭(2026-09-23 image-14: 칩 묶음 대신 버튼 하나)
  const g1 = groupReportGaps(['관계인 생년월일 미입력 — x', '송달 동의'])
  ok('★ [입력하기] = 첫 빈 탭(관계인)', JSON.stringify(reportInputTarget(g1)) === '{"tab":"contacts","form":null}', JSON.stringify(reportInputTarget(g1)))
  ok('★ 공통이 첫 빈 탭이면 1.1/1.4를 가른다', reportInputTarget(groupReportGaps(['송달 동의'])).form === '1.1'
    && reportInputTarget(groupReportGaps(['설비 대장 미등록 시트 X — y'])).form === '1.4')
  ok('보고서 탭이면 전년도 업무 칸', reportInputTarget(groupReportGaps(['전년도(2025) 소방훈련 실적 없음 — x'])).form === 'duty')
  ok('★ 판정 불가(null)·다 찬 경우는 기본정보', reportInputTarget(null).tab === 'info' && reportInputTarget(groupReportGaps([])).tab === 'info')
  ok('짧은 글씨 = 「 — 」 앞', gapShortText('관할 소방서 없음 — 고객 정보') === '관할 소방서 없음' && gapShortText('주소') === '주소')
}

console.log('\n— ⑦ 표본 31건 전수 — 아무 고지도 탭 묶기에서 터지지 않는다')
{
  const fx = JSON.parse(readFileSync(new URL('./_fixtures/workbook-notice-samples.json', import.meta.url), 'utf8')) as { samples: Array<{ notice: string }> }
  let withGaps = 0
  const bad: string[] = []
  for (const s of fx.samples) {
    const g = groupReportGaps(s.notice.split(' | '))
    const all = REPORT_INPUT_TABS.flatMap(k => g[k])
    if (all.length) withGaps++
    for (const x of all) if (/본사|직원 관리|점검표 미입력|점검기간/.test(x.text)) bad.push(x.text)
  }
  ok('표본 31건', fx.samples.length === 31)
  ok('★ 본사·회차 문구가 탭에 새지 않는다', bad.length === 0, bad.slice(0, 3).join(' / '))
  ok('표본 대부분에 탭 빈칸이 있다(실측 — 기능이 할 일이 있다)', withGaps >= 25, `${withGaps}/31`)
}

console.log('\n— ⑧ 배선 — 규칙 두 벌 금지·판정 불가는 안 그린다·복귀 주소')
{
  const route = read('../src/app/(dashboard)/customers/[id]/report-gaps/route.ts')
  const wbRoute = read('../src/app/(dashboard)/inspections/[id]/workbook/route.ts')
  const page = read('../src/app/(dashboard)/customers/[id]/page.tsx')
  const comp = read('../src/components/customers/report-gaps.tsx')
  const cal = read('../src/components/inspections/inspection-calendar-client.tsx')
  const three = ['assembleOfficial(', 'assembleDelegation(', 'assembleReport9(']
  ok('★ 라우트가 엑셀 라우트와 같은 조립 함수 셋을 부른다', three.every(f => route.includes(f) && wbRoute.includes(f)))
  ok('★ 라우트가 같은 분류표를 거친다(groupReportGaps)', /groupReportGaps\(\[\.\.\.official\.missing, \.\.\.delegation\.missing, \.\.\.r9\.missing\]\)/.test(route))
  ok('★ 라우트가 회차를 [보고서] 탭과 같은 판정으로 고른다', /currentRoundOf\(/.test(route) && /downloadableInspectionId\(/.test(route))
  ok('★ 현재 회차에 엑셀이 없으면 최근 받을 수 있는 회차로 센다(예정만 된 회차에 막히지 않게)',
    /downloadableInspectionId\(cur\) \? cur : \(rounds\.find\(r => downloadableInspectionId\(r\)\) \?\? null\)/.test(route))
  ok('★ 남의 회차 id를 받지 않는다(customer_id 대조)', /\.eq\('id', inspectionId\)\.eq\('customer_id', customerId\)/.test(route))
  ok('★ 회차가 없으면 byTab: null(0이 아니다)', /byTab: null/.test(route))
  ok('★ 실패 응답이면 목록·뱃지를 안 그린다(0으로 그리지 않는다)', /if \(!j\) \{ setState\(s => \(\{ \.\.\.s, loaded: true \}\)\); return \}/.test(comp)
    && /if \(!g\?\.byTab\) return null/.test(comp))
  ok('다섯 탭에 빈칸 수', REPORT_INPUT_TABS.every(k => page.includes(`extra: <ReportGapCount tabKey="${k}" />`)))
  ok('다섯 탭 맨 위에 목록', REPORT_INPUT_TABS.every(k => page.includes(`<ReportGapsStrip tabKey="${k}" />`)))
  ok('소방계획서 탭에는 안 단다(자기 뱃지 n/12가 있다)', !page.includes('tabKey="plan"'))
  ok('★ 고객 ←가 복귀 주소를 따른다', /href=\{returnHref \|\| '\/customers'\}/.test(page) && /const returnHref = safeReturnHref\(fromParam\)/.test(page))
  // 2026-09-23 image-14 — 칩 묶음(ReportGapsLine) → 제목줄 「빈칸 N」 + [입력하기](첫 빈 탭)
  ok('★ 달력 [입력하기]가 첫 빈 탭 + 달력 복귀 주소로 간다', /reportInputTarget\(reportGaps\?\.byTab \?\? null\)/.test(cal)
    && /data-testid="daypanel-report-input"/.test(cal)
    && /\?tab=\$\{reportTo\.tab\}.*from=\$\{encodeURIComponent\(calendarBackHref\)\}/.test(cal))
  ok('★ 달력이 빈칸 칩 묶음을 되살리지 않았다(수만)', !/daypanel-report-gap-/.test(cal))
  ok('★ 달력이 고지 목록을 되살리지 않았다(R9 계약 유지)', !/parseWorkbookNotice|workbookFixHref|DocNoticeList[^]*daypanel-workbook/.test(cal.slice(cal.indexOf('data-testid="daypanel-workbook"'), cal.indexOf('data-testid="daypanel-fireplan"'))))
  ok('복귀 주소 검증 — 내부 경로만', safeReturnHref('/inspections/calendar?insp=1') !== '' && safeReturnHref('//x.com') === '' && safeReturnHref('report9') === '')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
