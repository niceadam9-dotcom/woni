/** 달력 고지 → 채우러 가기 → 자동 재발행 — 순수 + 배선 단언 (2026-09-22)
 *  실행: npx tsx scripts/test-calendar-workbook-notice.mts   — **서버·DB 불필요**
 *
 *  분류(`test-workbook-notice`)는 「무엇이 채울 수 있는가」를 묻는다. 여기서는 그 분류가
 *  **실제로 사용자를 그 자리로 보내는가**를 묻는다.
 *
 *  🚨 급소 넷:
 *    ① **쪽지는 이동 「앞」에서 써야 한다.** `router.push` 뒤에 두면 실행되지 않는다
 *       (`plan-annex-round-card.tsx:121`이 같은 자리에서 물린 적이 있다).
 *    ② **목적지 주소를 여기 베껴 적으면 안 된다** — 점검 쪽은 `stepInputLink`가 정본이다.
 *       두 벌이 되면 한쪽만 고쳐져 「채우러 갔는데 그 칸이 없는」 화면이 된다.
 *    ③ **복귀 경로(from=)가 붙어야** 돌아올 수 있다. 안 붙으면 왕복이 안 닫힌다.
 *    ④ **달력에 `window.confirm` 발행 가드를 이식하면 안 된다** — 이 패널이 명시적으로 금지한
 *       방향이다(「착륙 화면이라 현장 흐름을 끊지 않고, 대신 고지로 알린다」).
 */
import { readFileSync } from 'node:fs'
import { parseWorkbookNotice, workbookFixHref, splitNoticeParts } from '../src/lib/workbook-notice.ts'
import { stepInputLink } from '../src/lib/inspection-step-links.ts'
import { codeOnly } from './_code-only.mts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const IDS = { inspectionId: 'INSP', customerId: 'CUST' }
const href = (t: Parameters<typeof workbookFixHref>[0]) => workbookFixHref(t, IDS, stepInputLink)

console.log('— ② 목적지 주소 — 점검 쪽은 stepInputLink가 정본이다')
ok('★ 점검표 = stepInputLink(1)과 **같은 주소**', href('sheet') === stepInputLink('INSP', 1)?.href, href('sheet'))
ok('★ 불량 = stepInputLink(5)와 같은 주소', href('defects') === stepInputLink('INSP', 5)?.href, href('defects'))
ok('★ 참여자 = stepInputLink(2)와 같은 주소 (②「참여 인력」 슬롯)', href('crew') === stepInputLink('INSP', 2)?.href, href('crew'))
ok('★ 점검기간·별지 = stepInputLink(4) (기한·기간이 ④에 모여 있다)',
  href('period') === stepInputLink('INSP', 4)?.href && href('annex') === stepInputLink('INSP', 4)?.href, href('period'))
ok('설비 대장 = 공통 탭 1.4', href('facilities') === '/customers/CUST?tab=facilities&form=1.4', href('facilities'))
ok('보고서 탭 = 전년도 업무 실시사항', href('reports') === '/customers/CUST?tab=reports&form=duty', href('reports'))
ok('지도·사진 = 서식 1.3 안', href('assets') === '/customers/CUST?tab=plan&form=1.3', href('assets'))
ok('관계인·건물·기본정보·소방계획서 탭', href('contacts') === '/customers/CUST?tab=contacts'
  && href('buildings') === '/customers/CUST?tab=buildings'
  && href('info') === '/customers/CUST?tab=info'
  && href('plan') === '/customers/CUST?tab=plan')
ok('모든 목적지가 주소를 낸다(빈 문자열 없음)', () => {
  const all = ['sheet', 'facilities', 'defects', 'period', 'annex', 'crew', 'info',
    'contacts', 'buildings', 'reports', 'plan', 'assets', 'org'] as const
  return all.every(t => (href(t) ?? '').length > 3)
})

console.log('\n— 실제 고지 한 줄이 칩까지 이어지는가')
{
  const raw = '점검표 미입력 5종 → 기본 ○ 인쇄: 옥내소화전설비 | 보조 점검인력 9명 중 8번째부터 미표기(허브 7행) | 회사 팩스 미등록 — 레터헤드에서 생략 (본사 정보에서 입력)'
  const parts = parseWorkbookNotice(raw)
  ok('세 조각으로 쪼개진다', parts.length === 3, String(parts.length))
  ok('★ 채울 수 있는 것에만 목적지가 붙는다',
    parts[0].target === 'sheet' && parts[1].target === undefined && parts[2].target === 'org')
  ok('★ 상한 조각은 cap이라 칩이 안 생긴다', parts[1].kind === 'cap')
  ok('★ 회사 축은 scope=org로 갈린다 (31/31에 뜨므로 낮춰 그린다)', parts[2].scope === 'org')
}

console.log('\n— ★ 네 덩이가 **섞이지 않는가** (동작으로 단언 — 모양만 보면 못 잡는다)')
{
  const raw = [
    '점검표 미입력 5종 → 기본 ○ 인쇄: 옥내소화전설비',           // fixable · inspection
    '보조 점검인력 9명 중 8번째부터 미표기(허브 7행)',             // cap
    '회사 팩스 미등록 — 레터헤드에서 생략 (본사 정보에서 입력)',    // fixable · org
    '여기 없는 새로운 고지 문구입니다',                            // unknown
    '문서번호 자동 제안(승 진 2609-1) — [입력]에서 수정·확정 가능',  // info — 어느 덩이에도 안 든다
  ].join(' | ')
  const g = splitNoticeParts(parseWorkbookNotice(raw))
  ok('fixable 1개 — 회사 축은 빠진다', g.fixable.length === 1 && g.fixable[0].target === 'sheet',
    JSON.stringify(g.fixable.map(p => p.target)))
  ok('★ caps 1개 — 상한은 칩 덩이에 안 든다', g.caps.length === 1 && g.caps[0].kind === 'cap',
    JSON.stringify(g.caps.map(p => p.kind)))
  ok('org 1개 — 따로 접어 둘 것', g.org.length === 1 && g.org[0].scope === 'org')
  ok('rest 1개 — 모르는 조각은 글자로만', g.rest.length === 1 && g.rest[0].kind === 'unknown')
  ok('★ info(안내)는 **어느 덩이에도 안 든다**',
    [...g.fixable, ...g.caps, ...g.org, ...g.rest].every(p => p.kind !== 'info'))
}

/* ─────────────────────────────────────────────────────────────────────────────
   🚨 2026-09-22 **계약 교대 — 달력은 보고서 고지를 그리지 않는다.**

   사용자 지시: 「보고서엑셀 클릭시 『채우면 다음 발행에 반영됩니다』 내용 모두 없애 달라」.
   실측이 그 판단을 뒷받침한다 — 자체점검 31건 **전건**에 고지가 떴다. 예외가 아니라 상시라,
   400px 사이드바에서 버튼 한 번에 칩 묶음·상한 목록·회사 접이줄·복귀 띠가 화면을 덮었다.

   종전 단언 여덟(①쪽지·③from·②workbookFixHref·복귀 띠…)은 **지우지 않고 음성으로 갈아끼운다.**
   그 배선이 되살아나면 사용자가 뺀 화면이 조용히 돌아오는 것이므로 여기서 멈춰 서야 한다.
   ⚠ 위쪽 **분류 축(순수 함수)은 그대로 둔다** — 소방계획서 칩이 `splitNoticeParts`를 계속
     쓰고(`doc-notice-list.tsx`), 보고서 쪽 분류표도 라우트 문구 변화를 잡는 값이 있다.
   ───────────────────────────────────────────────────────────────────────────── */
console.log('\n— ①③ 달력 배선: 보고서 고지는 **그리지 않는다**')
{
  const client = codeOnly(readFileSync(new URL('../src/components/inspections/inspection-calendar-client.tsx', import.meta.url), 'utf8'))
  const list = codeOnly(readFileSync(new URL('../src/components/ui/doc-notice-list.tsx', import.meta.url), 'utf8'))
  const btn = codeOnly(readFileSync(new URL('../src/components/inspections/workbook-xlsx-button.tsx', import.meta.url), 'utf8'))

  ok('버튼이 고지를 바깥으로 넘길 수 있다(onNotice — 다른 화면이 쓴다)',
    /onNotice\?:\s*\(raw: string\) => void/.test(btn))
  /* 🚨 급소 — **버튼이 자기 고지를 대신 그리면 안 된다.** `owns = !onNotice && !onError`이므로
     달력처럼 `onError`만 넘기면 owns=false가 되어 양쪽 다 안 그린다. 이 식이 무너지면
     고지를 뺀 자리에 버튼 자신의 토스트가 그대로 되살아난다(겉보기엔 아무것도 안 바꾼 듯 초록). */
  ok('★ owns 판정이 onError만으로도 꺼진다 (버튼이 대신 그리지 않는다)',
    /const owns = !onNotice && !onError/.test(btn) && /owns \? selfNotice/.test(btn))

  /* 달력 쪽 보고서 줄 **안쪽**을 본다 — 파일 전체에 `DocNoticeList`를 물으면 바로 아래
     소방계획서 줄(남겨 둔 축)에 걸려 영영 빨강이다. 축을 갈라 묻는다. */
  const wbBlock = (() => {
    const i = client.indexOf('data-testid="daypanel-workbook"')
    if (i < 0) return ''
    const j = client.indexOf('data-testid="daypanel-fireplan"', i)
    return client.slice(i, j > 0 ? j : i + 2_000)
  })()
  ok('보고서 줄이 여전히 있다 (버튼 자체를 없앤 게 아니다)',
    wbBlock.length > 0 && /<WorkbookXlsxButton/.test(wbBlock))
  ok('★ 그 줄이 고지 목록을 그리지 않는다', !/DocNoticeList/.test(wbBlock), wbBlock.slice(0, 400))
  ok('★ 달력이 보고서 고지를 받지도 않는다 (onNotice 미전달 = owns도 꺼짐)',
    !/onNotice=\{raw => setWbNotice/.test(client) && !/parseWorkbookNotice/.test(client))
  ok('★ 「채우러 가기」 목적지 조립이 달력에서 사라졌다',
    !/workbookFixHref/.test(client))
  ok('★ 「입력 마치고 돌아왔다」 복귀 띠·쪽지가 사라졌다',
    !/daypanel-workbook-resume/.test(client)
    && !/writePendingDoc|takePendingDoc|resumedDoc/.test(client))
  /* ⚠ **오류는 남는다.** 고지는 「받았는데 빈칸이 있다」지만 오류는 「못 받았다」다.
     같이 걷어 내면 다운로드 실패가 조용해진다 — 고지 제거의 가장 그럴듯한 과잉이다. */
  ok('★ 오류 표시는 남아 있다 (고지와 오류는 다른 축이다)',
    /onError=\{setWbError\}/.test(client) && /\{wbError &&/.test(client))
  ok('회차가 바뀌면 이전 회차의 것을 버린다', /setWbError\(''\); setFpNotice\(\[\]\); setFpError\(''\)/.test(client))

  ok('★ ④ 달력에 window.confirm 발행 가드를 이식하지 않았다', !/window\.confirm/.test(client))

  console.log('\n— 목록 컴포넌트는 살아 있다 (소방계획서 칩이 쓴다)')
  ok('목록이 onNavigate를 **이동 전에** 부른다 (Link onClick)',
    /onClick=\{\(\) => onNavigate\?\.\(p\)\}/.test(list))
  ok('두 덩이를 **나눠** 그린다(자리)', /doc-notice-caps/.test(list) && /채울 수 없습니다/.test(list))
  ok('★ 분리 규칙이 순수 함수에 있다 (JSX 안 filter면 모양만 보는 단언이 못 잡는다)',
    /splitNoticeParts\(parts\)/.test(list) && !/parts\.filter\(/.test(list))
  ok('★ 달력의 소방계획서 고지는 **그대로 남았다** (보고서 축만 뺐다)',
    /data-testid="daypanel-fireplan"/.test(client) && /parts=\{fpNotice\}/.test(client))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
