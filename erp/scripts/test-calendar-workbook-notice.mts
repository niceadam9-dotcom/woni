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

console.log('\n— ①③④ 배선')
{
  const client = codeOnly(readFileSync(new URL('../src/components/inspections/inspection-calendar-client.tsx', import.meta.url), 'utf8'))
  const list = codeOnly(readFileSync(new URL('../src/components/ui/doc-notice-list.tsx', import.meta.url), 'utf8'))
  const btn = codeOnly(readFileSync(new URL('../src/components/inspections/workbook-xlsx-button.tsx', import.meta.url), 'utf8'))

  ok('버튼이 고지를 바깥으로 넘길 수 있다(onNotice)', /onNotice\?:\s*\(raw: string\) => void/.test(btn))
  ok('★ 안 넘기면 종전대로 자기가 그린다 (기존 호출부 무변경)',
    /const owns = !onNotice && !onError/.test(btn) && /owns \? selfNotice/.test(btn))
  ok('달력이 고지를 받아 분류한다', /onNotice=\{raw => setWbNotice\(parseWorkbookNotice\(raw\)\)\}/.test(client))

  ok('★ ① 쪽지를 **Link의 onClick**(이동 앞)에서 쓴다', /onNavigate=\{\(\) => writePendingDoc\(/.test(client))
  ok('★ ① 목록이 onNavigate를 **이동 전에** 부른다 (Link onClick)',
    /onClick=\{\(\) => onNavigate\?\.\(p\)\}/.test(list))
  ok('음성 — 쪽지를 router.push 뒤에서 쓰지 않는다', !/router\.push\([\s\S]{0,120}?writePendingDoc/.test(client))

  /* ⚠ `from=…calendarBackHref`는 이 파일 **여러 곳**에 있다(단계 [입력]·나머지 채우기).
     앵커 없이 찾으면 칩에서 떼어내도 다른 곳에 걸려 초록이다(변이 M3가 그렇게 뚫었다).
     `hrefOf` 블록 **안쪽**을 물어야 한다 — 같은 부류를 이번 작업에서 네 번째 밟았다. */
  ok('★ ③ 칩 주소에 복귀 경로가 붙는다', () => {
    const i = client.indexOf('hrefOf={p => {')
    if (i < 0) return false
    const block = client.slice(i, client.indexOf('onNavigate=', i))
    return /from=\$\{encodeURIComponent\(calendarBackHref\)\}/.test(block)
  }, '(hrefOf 블록 안에 from=이 없다)')
  ok('★ ② 주소를 베껴 적지 않고 workbookFixHref를 쓴다',
    /workbookFixHref\(\s*p\.target/.test(client) && !/tab=facilities&form=1\.4/.test(client))

  ok('돌아오면 쪽지를 소비해 [지금 받기]를 띄운다',
    /takePendingDoc\(id, Date\.now\(\)\)\) setResumedDoc\(true\)/.test(client)
    && /daypanel-workbook-resume/.test(client))
  ok('★ 쪽지 소비는 회차 수명당 한 번', /if \(resumeRef\.current === id\) return/.test(client))
  ok('회차가 바뀌면 이전 고지를 버린다 (남의 빈칸을 이 회차 것으로 읽지 않는다)',
    /setWbNotice\(\[\]\); setWbError\(''\); setResumedDoc\(false\)/.test(client))

  ok('★ ④ 달력에 window.confirm 발행 가드를 이식하지 않았다', !/window\.confirm/.test(client))
  ok('두 덩이를 **나눠** 그린다(자리)', /doc-notice-caps/.test(list) && /채울 수 없습니다/.test(list))
  ok('★ 분리 규칙이 순수 함수에 있다 (JSX 안 filter면 모양만 보는 단언이 못 잡는다)',
    /splitNoticeParts\(parts\)/.test(list) && !/parts\.filter\(/.test(list))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
