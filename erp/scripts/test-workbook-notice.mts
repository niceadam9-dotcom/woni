/** 결과보고서 고지 분류 — 순수 단언 (2026-09-22)
 *  실행: npx tsx scripts/test-workbook-notice.mts   — **서버·DB 불필요**
 *
 *  ## 무엇이 걸려 있나
 *  고지를 「채우러 가기」 입구로 바꾸려면(R5) 먼저 **채울 수 있는 것과 없는 것을 갈라야** 한다.
 *  안 가르고 내보내면 사용자가 **못 고치는 것**(서식 행수 상한)을 고치러 헤맨다.
 *
 *  🚨 급소 넷:
 *    ① **상한을 fixable로 분류하면 안 된다** — 「(허브 7행)」·「(엑셀 4행 상한)」은 양식의 한계다.
 *    ② **안내를 누락으로 분류하면 안 된다** — 「문서번호 자동 제안」은 멀쩡한 값이다(실측 30/31).
 *    ③ **모르는 문장에 목적지를 지어내면 안 된다** — `fire-plan-notice.ts`의 「3.5층창고」 사고.
 *    ④ **라우트가 새 고지를 추가했는데 표가 모르면 빨개져야 한다** — 표는 썩는다.
 *
 *  표본은 스테이징 자체점검 **31건 전수**에서 받은 실물이다
 *  (`_probe-workbook-notice-samples.mts` → `_fixtures/workbook-notice-samples.json`).
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseWorkbookNotice, fixableParts, capParts, WORKBOOK_NOTICE_RULES } from '../src/lib/workbook-notice.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const one = (s: string) => parseWorkbookNotice(s)[0]

console.log('— ① 서식 상한은 **채울 수 없다**')
for (const t of [
  '보조 점검인력 9명 중 8번째부터 미표기(허브 7행)',
  '이행완료 사항 2건 접힘 — 「외 N건 (별첨 참조)」(엑셀 4행 상한)',
  '불량 세부 소화기구 3건 미표기(엑셀 1행 상한)',
  '3-1 동별 수량 2개 동 미표기(현1 8행 상한)',
  '불량사진 4건 미표기(시트 상한 20건)',
  '목차 미표기: 옥내소화전설비',
  '점검표 서식 미동봉(자산 없음): 방화문 및 방화셔터, 비상구 및 피난통로',
]) ok(`cap — ${t.slice(0, 34)}…`, one(t)?.kind === 'cap', JSON.stringify(one(t)))

console.log('\n— ② 안내는 누락이 아니다 (실측 30/31에 뜬다)')
for (const t of [
  '문서번호 자동 제안(승 진 2609-1) — [입력]에서 수정·확정 가능',
  '점검표 항목 252건 중 191건 반영 · 시트 미동봉 27건 · 자산 좌표 없음 34건',
  '미설치 항목 3건(화재조기진압용스프링클러설비·화재알림설비·할론소화설비) — 같은 시트의 설치 설비 응답이 번지지 않도록 ／로 인쇄됨',
]) ok(`info — ${t.slice(0, 30)}…`, one(t)?.kind === 'info', JSON.stringify(one(t)))
ok('★ 안내에는 목적지가 없다(채우러 보내지 않는다)',
  ['문서번호 자동 제안(승 진 2609-1) — [입력]에서 수정·확정 가능',
   '점검표 항목 15건 중 15건 반영'].every(t => one(t)?.target === undefined))

console.log('\n— 채울 수 있는 것 — 목적지가 옳은가')
const CASES: Array<[string, string]> = [
  ['점검표 미입력 5종 → 기본 ○ 인쇄: 소화기구 및 자동소화장치·옥내소화전설비', 'sheet'],
  ['설치 설비 중 점검표 무응답 5건 — 3쪽 결과칸 공란', 'sheet'],
  ['점검표 항목 미입력 300건(설치 설비 · 종합 필수 ● 163건 포함) — 부속 점검표 결과칸 빈칸', 'sheet'],
  ['점검표 응답', 'sheet'],
  ['대장 미체크인데 점검표 응답 있음 2건(소화수조 및 저수조) — 3쪽에 ／로 인쇄됨, 실제 설치·점검한 설비라면 1.4 대장에 체크하세요', 'facilities'],
  ['설비 대장 미등록 시트 할로겐화합물 및 불활성기체소화설비 — 점검표 응답이 있어 부속 점검표·목차에 포함됨', 'facilities'],
  ['주소', 'info'],
  ['사용승인일', 'info'],
  ['송달 동의', 'info'],
  ['건축허가일', 'buildings'],
  ['소방안전관리등급(대상물 급수) 미입력 — 2쪽 체크 공란', 'info'],
  ['관할 소방서 없음 — 고객 정보(1.3) 또는 [입력]에서 지정', 'info'],
  ['소방안전관리자 미지정 — 2쪽 성명·전화 공란', 'contacts'],
  ['소방안전관리자 전화번호 없음 — 지정한 관계인에 번호가 비어 2쪽 공란', 'contacts'],
  ['소방안전관리자 최근 교육이수일 미입력 — 2쪽 공란', 'contacts'],
  ['관계인 성명 없음 — 관계인 탭 [소방안전관리] 지정 또는 [입력]에서 기재', 'contacts'],
  ['전년도(2025) 완료된 자체점검 이력 없음 — 2쪽 자체점검 칸 공란(보고서 탭 「전년도 업무 실시사항」에서 실시·미실시 확정 가능)', 'reports'],
  ['전년도(2025) 소방안전교육 실적 없음 — 2쪽 교육훈련 칸 공란(서식 1.11.4 기록부 입력 또는 보고서 탭 「전년도 업무 실시사항」 확정)', 'reports'],
  ['소방계획서 서식 입력 없음(고객 > 소방계획서 탭) — 2쪽 작성·보관 칸 공란', 'plan'],
  ['점검기간', 'period'],
  ['주된 점검인력', 'crew'],
  ['표지 건물 사진 미등록 — 자리표시로 인쇄 (고객 상세 [지도·사진] cover 슬롯)', 'assets'],
  ['회사 팩스 미등록 — 레터헤드에서 생략 (본사 정보에서 입력)', 'org'],
  ['대리인 생년월일 미입력 — 공란 인쇄 (관리자 > 직원 관리 또는 [입력]에서 기재)', 'org'],
]
for (const [text, want] of CASES) {
  const p = one(text)
  ok(`${want.padEnd(10)} ← ${text.slice(0, 28)}…`, p?.kind === 'fixable' && p.target === want, JSON.stringify(p))
}

console.log('\n— ③ 모르는 문장에 목적지를 지어내지 않는다')
{
  const p = one('여기 없는 새로운 고지 문구입니다')
  ok('unknown으로 남는다', p?.kind === 'unknown', JSON.stringify(p))
  ok('★ 목적지가 없다', p?.target === undefined)
  ok('★ 글자는 그대로 보존된다', p?.text === '여기 없는 새로운 고지 문구입니다')
}
ok('빈 문자열 → 빈 배열', parseWorkbookNotice('').length === 0 && parseWorkbookNotice('   ').length === 0)
ok('절단 꼬리는 따로 분류된다', one('…외 273자 생략')?.kind === 'truncated')

console.log('\n— ④ 실측 표본 전수 — 분류표가 실제 고지를 덮는가')
{
  const raw = readFileSync(new URL('./_fixtures/workbook-notice-samples.json', import.meta.url), 'utf8')
  const fx = JSON.parse(raw) as { samples: Array<{ inspection: string; customer: string; notice: string }> }
  ok('표본이 있다', fx.samples.length > 0, `${fx.samples.length}건`)

  const unknown = new Map<string, string>()
  let total = 0
  for (const s of fx.samples) {
    for (const p of parseWorkbookNotice(s.notice)) {
      total++
      if (p.kind === 'unknown') unknown.set(p.text.replace(/\d+/g, 'N').replace(/:.*$/, ': …'), p.text)
    }
  }
  ok(`★ 실측 조각 ${total}개 중 분류 못 한 모양 0종`, unknown.size === 0,
    [...unknown.values()].slice(0, 3).map(t => t.slice(0, 80)).join(' || '))

  // 두 덩이가 **둘 다** 표본에 있어야 화면 분리가 뜻을 갖는다
  const anyFixable = fx.samples.some(s => fixableParts(parseWorkbookNotice(s.notice)).length > 0)
  const anyCap = fx.samples.some(s => capParts(parseWorkbookNotice(s.notice)).length > 0)
  ok('전제 — 채울 수 있는 조각이 표본에 있다', anyFixable)
  ok('전제 — 채울 수 없는(상한) 조각도 표본에 있다', anyCap)

  /* ★ 두 덩이가 **섞이지 않는가** — 이게 화면 분리의 알맹이다.
     첫 판엔 이 단언이 없어 변이 M7(fixableParts가 상한까지 셈)이 그대로 살아남았다. */
  const mixed = fx.samples.flatMap(s => {
    const parts = parseWorkbookNotice(s.notice)
    return fixableParts(parts).filter(p => p.kind !== 'fixable')
      .concat(capParts(parts).filter(p => p.kind !== 'cap'))
  })
  ok('★ fixableParts는 fixable만, capParts는 cap만 돌려준다', mixed.length === 0,
    mixed.slice(0, 3).map(p => `${p.kind}:${p.text.slice(0, 40)}`).join(' || '))

  /* ★ 규칙이 **서로 배타적인가** — 한 문장이 둘에 걸리면 `find`가 줄 순서라는 우연으로 결정한다.
     나중에 넓은 패턴을 끼워 넣는 순간 기존 규칙이 조용히 가려진다.
     (변이 M4 「규칙 순서 뒤집기」가 살아남아 알게 됐다 — 배타적이라 순서가 안 중요했고,
      그건 **지켜야 할 성질**이지 우연으로 둘 것이 아니다) */
  const shadowed: string[] = []
  for (const s of fx.samples) {
    for (const frag of s.notice.split(' | ').map(t => t.trim()).filter(Boolean)) {
      const n = WORKBOOK_NOTICE_RULES.filter(r => r.test.test(frag)).length
      if (n > 1) shadowed.push(`${n}개 규칙: ${frag.slice(0, 60)}`)
    }
  }
  ok('★ 실측 전수 — 두 규칙에 걸리는 문장 0건 (겹치면 줄 순서가 결과를 정한다)',
    shadowed.length === 0, shadowed.slice(0, 3).join(' || '))
}

console.log('\n— ⑤ 표가 썩지 않게 — 라우트의 고정 문구를 표가 아는가')
{
  const route = readFileSync(
    new URL('../src/app/(dashboard)/inspections/[id]/workbook/route.ts', import.meta.url), 'utf8')
  /* ⚠ 라우트의 문구를 **분류표에 직접 물어볼 수는 없다** — 리터럴이 `점검표 미입력` 같은
     템플릿 **앞토막**이라 완성 문장 규칙과 애초에 안 맞는다(첫 두 판이 그렇게 헛돌았다).
     대신 **블록이 바뀌면 빨개지는 도화선**을 둔다: 고지를 새로 추가하거나 문구를 고치면
     여기서 멈춰 서고, 그때 표본을 다시 받아(`_probe-workbook-notice-samples.mts`)
     분류표를 갱신한 뒤 이 지문을 새로 박는다. 표가 조용히 썩는 것을 막는 유일한 방법이다.
     (`feedback_probe_baseline_pin` — 기준을 「지금 화면」으로 잡으면 무엇을 해도 통과한다) */
  const start = route.indexOf("'X-Workbook-Missing'")
  const end = route.indexOf('const full = parts.join', start)
  ok('고지 조립 블록을 찾았다', start > 0 && end > start, `start=${start} end=${end}`)
  const block = route.slice(start, end)
  // 주석·공백은 뜻을 안 바꾸므로 뺀다 — 주석만 고쳤다고 빨개지면 도화선이 소음이 된다
  const norm = block
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ').trim()
  const digest = createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 16)
  const PINNED = '38b576c0b6ec22f6'
  ok('★ 라우트 고지 블록이 그대로다 (바뀌었으면 표본을 다시 받아 분류표를 갱신하라)',
    digest === PINNED, `지금 ${digest} · 박아 둔 값 ${PINNED} · 조각 수 ${norm.length}자`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
