/** 별지 보고일 ← 소방서 제출 기록 정렬 (2026-09-20 사용자 요구)
 *
 *  발단: 별지 11호 미리보기가 ⑥ 소방서 제출 기록(09-15) 대신 **생성일(오늘)**을 인쇄했다 —
 *  「2026-09-20 날짜를 소방서 제출일로 맞추고 싶다. 10호 동일」. 종전 규칙(수기 > 오늘)에는
 *  제출 기록 가지가 없었고, 주석 두 곳(inspection-workbench·report9-assemble select)은
 *  「④ 제출일 가지가 있다」고 **거짓으로** 약속하고 있었다.
 *
 *  규칙(단일 원천 `annexReportDateISO`): 수기 reportDate > 소방서 제출 기록 > 오늘(KST)
 *  축: 9호·10호 = ④ `report9_submitted_at`(한 봉투) · 11호 = ⑥ `report11_submitted_at`
 *  위임장은 별지 9호 보고일 축을 따른다(2026-08-20 사용자 확정 — 같은 봉투).
 *
 *  🎯 가장 중요한 단언은 [B]의 **축 분리**다 — 「제출 기록을 쓴다」만 물으면
 *  10호에 ⑥을(또는 11호에 ④를) 물려도 초록이 된다. 어느 문서가 어느 기록을 쓰는지를 묻는다.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-annex-report-date.mts
 *  변이: node scripts/_mutate-annex-report-date.mjs */
import { readFileSync } from 'node:fs'
import { annexReportDateISO, todayKstISO } from '../src/lib/report9-assemble'
import { codeOnly } from './_code-only.mts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}`) } }
const src = (p: string) => codeOnly(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

console.log('── A. 단위 — annexReportDateISO 서열 (수기 > 제출 기록 > 오늘) ──')
{
  ok(annexReportDateISO({ reportDate: '2026-09-01' }, '2026-09-15') === '2026-09-01',
    '[A1] 수기값이 최우선 — 「문서에 인쇄할 제출일」을 기록이 덮지 않는다')
  ok(annexReportDateISO({}, '2026-09-15') === '2026-09-15',
    '[A2] 수기 없으면 제출 기록 — 제출한 날이 인쇄된다')
  ok(annexReportDateISO({ reportDate: '' }, '2026-09-15') === '2026-09-15',
    '[A2b] 빈 문자열 수기도 미입력이다')
  ok(annexReportDateISO({}, null) === todayKstISO(),
    '[A3] 둘 다 없으면 오늘(KST) — 종전 계약 유지(하위 호환)')
  ok(annexReportDateISO({}) === todayKstISO(),
    '[A3b] 인자 없이 부르는 옛 호출부와 동등 — 서명 확장이 기존 호출을 깨지 않는다')
  ok(annexReportDateISO({}, '2026/09/15') === todayKstISO() && annexReportDateISO({}, '   ') === todayKstISO(),
    '[A4] 형식이 어긋난 제출 기록은 인쇄하지 않는다 — 조용히 3순위로')
  ok(annexReportDateISO({ reportDate: '9월 중' }, '2026-09-15') === '2026-09-15',
    '[A5] 날짜꼴이 아닌 수기는 무효 — 다음 단(제출 기록)으로 내려간다')
}

console.log('\n── B. 배선 — 다섯 표면이 같은 규칙·바른 축을 쓰는가 ──')
const ACTIONS = src('src/app/(dashboard)/inspections/report9-actions.ts')
const ASSEMBLE = src('src/lib/report9-assemble.ts')
const ROUTE = src('src/app/(dashboard)/inspections/[id]/workbook/route.ts')
const COVER = src('src/lib/annex-cover-official.ts')
const SPEC = src('src/app/(dashboard)/customers/facility-spec-actions.ts')
{
  console.log('  · PDF 10·11호 (report9-actions assembleAnnex1011)')
  ok(/from\('inspections'\)\.select\('report9_submitted_at, report11_submitted_at'\)/.test(ACTIONS),
    '[B1] 조립이 제출 기록 두 컬럼을 실어 온다 — select에서 빠지면 조용히 오늘로 떨어진다')
  ok(/submittedISO = kind === 'report10' \? inspSub\?\.report9_submitted_at : inspSub\?\.report11_submitted_at/.test(ACTIONS),
    '[B2] 🎯 축이 문서를 따라간다 — 10호=④(9호와 한 봉투) · 11호=⑥')
  ok(ACTIONS.includes('data.reportDate = kdate(annexReportDateISO(fields, submittedISO))'),
    '[B3] 인쇄되는 보고일이 그 축을 실제로 탄다')
  ok(!ACTIONS.includes('data.reportDate = kdate(annexReportDateISO(fields))'),
    '[B3n] (음성) 제출 기록 없이 부르는 옛 형태가 남아 있지 않다')

  console.log('  · PDF 9호 (report9-assemble)')
  ok(ASSEMBLE.includes('kdate(annexReportDateISO(annexFields, insp.report9_submitted_at))'),
    '[B4] 9호 보고일 오버레이가 ④ 가지를 **실제로** 탄다 — select 주석의 약속이 이제 참이다')

  console.log('  · 갑지 엑셀 (workbook route)')
  ok(/report9_submitted_at, report11_submitted_at'\)/.test(ROUTE.replace(/\s+/g, ' ')) || /report9_submitted_at, report11_submitted_at/.test(ROUTE),
    '[B5a] 라우트 점검 조회에 두 컬럼이 있다')
  ok(ROUTE.includes('annexReportDateISO(done11Fields, row.report11_submitted_at)'),
    '[B5b] 완료보고서!G25(11호 보고일)는 ⑥ 기록을 탄다')
  ok(ROUTE.includes('annexReportDateISO(plan10Fields, row.report9_submitted_at)'),
    '[B5c] 법정 기본 기산일(10호 보고일)은 ④ 기록을 탄다')
  ok(!ROUTE.includes('annexReportDateISO(done11Fields, row.report9_submitted_at)')
    && !ROUTE.includes('annexReportDateISO(plan10Fields, row.report11_submitted_at)'),
    '[B6] 🎯 (음성) 축이 섞이지 않았다 — 11호에 ④를, 10호에 ⑥을 물리면 두 문서가 갈라진다')

  console.log('  · 위임장 (annex-cover-official) — 9호와 같은 봉투')
  ok(COVER.includes('annexReportDateISO(r9f, insp.report9_submitted_at)'),
    '[B7] 위임 일자가 9호 보고일과 **같은 함수·같은 축**을 탄다 — 사슬을 손으로 다시 적지 않았다')
  ok(/loadInspection|report9_submitted_at/.test(COVER) && /assigned_employee_id, report9_submitted_at/.test(COVER),
    '[B7b] loadInspection select에 ④ 컬럼이 실려 있다')
}

console.log('\n── C. 화면 — 작성 패널·작업대가 인쇄물과 같은 날을 본다 ──')
{
  ok(/annexNo === 'report11' \? r\?\.report11_submitted_at : r\?\.report9_submitted_at/.test(SPEC),
    '[C1] 자동값 액션이 제출 기록을 보고일 자동값으로 내준다 — 축은 11호=⑥, 나머지=④')
  ok(SPEC.includes('return { defaults: sub ? { reportDate: sub } : {} }'),
    '[C2] 기록이 없으면 자동값을 지어내지 않는다(빈 defaults) — placeholder는 실제 인쇄값만')
  const WB = src('src/components/inspections/inspection-workbench.tsx')
  const PANEL = src('src/components/inspections/annex-compose-panel.tsx')
  const CHAIN = "(fields.reportDate ?? '').trim() || (auto.reportDate ?? '').trim() || todayKst()"
  ok(WB.includes(CHAIN), '[C3] 작업대 기산일 사슬 = 수기 > ④ 제출 기록(auto) > 오늘 — 인쇄 규칙과 동일')
  ok(PANEL.includes(CHAIN), '[C4] 작성 패널 기산일도 같은 사슬 — 화면 둘이 서로 갈라지지 않는다')
  // 힌트가 낡은 채 남으면 다음 사람이 「오늘로 나간다」로 읽고 이 배선을 되돌린다
  const FIELDS = readFileSync(new URL('../src/components/inspections/annex-fields.tsx', import.meta.url), 'utf8')
  ok(/④ 소방서 제출 기록, 그것도 없으면 생성일\(오늘\)로 출력/.test(FIELDS),
    '[C5] 9호 힌트가 새 폴백을 말한다')
  ok(/미입력 시 ④ 소방서 제출 기록\(그것도 없으면 오늘\)으로 출력/.test(FIELDS),
    '[C6] 10호 힌트가 새 폴백을 말한다')
  ok(/미입력 시 ⑥ 소방서 제출 기록\(그것도 없으면 오늘\)으로 출력/.test(FIELDS),
    '[C7] 11호 힌트가 새 폴백을 말한다 — ⑥ 축')
  ok(/미입력 시 점검 시작일로 출력/.test(FIELDS),
    '[C8] (대조군) 외관점검표 힌트는 점검 시작일 축 그대로 — 이 차수가 남의 축을 건드리지 않았다')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
