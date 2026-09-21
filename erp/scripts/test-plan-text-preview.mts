/** 라이브러리 목록 미리보기가 **대표 칸**을 띄우는가 — 순수 단언 (2026-09-21)
 *  실행: npx tsx scripts/test-plan-text-preview.mts   — **서버·DB 불필요**, 결정적이고 빠르다
 *
 *  무엇을 지키나 — 이 결함은 "틀려도 화면상으로는 멀쩡해 보이는" 종류다. 목록에 문장이 하나
 *  떠 있으니 비어 보이지도, 깨져 보이지도 않는다. 다만 **엉뚱한 칸**이라 이름만으로 항목을
 *  구분 못 하는 문제를 보완하라던 미리보기가 제 일을 안 한다(§4-1).
 *    · brigadeTeams   — 지휘통제 대신 **응급구조**가 떴다
 *    · constructionLog — 공사·정비 내용 대신 **비고**가 떴다
 *
 *  🚨 이 검사의 급소 — **본문을 「선언 순서」로 만들면 결함 코드로도 초록이 뜬다**(공허 통과).
 *     결함은 객체의 키 순서가 선언 순서와 **다를 때만** 드러나기 때문이다. Postgres jsonb는
 *     키를 「길이 → 바이트순」으로 재정렬해 돌려주므로, 여기서도 **그 순서로 만들어** 재현한다.
 *     그리고 한 걸음 더 — 미리보기는 애초에 **키 순서와 무관**해야 한다. 순열을 돌려 고정한다.
 *
 *  ⚠ jsonb 순서 모델(길이→바이트순)은 지어낸 것이 아니라 **운영/스테이징 실측을 붙박아** 둔다
 *     (아래 OBSERVED). 모델이 틀리면 재현이 헛돌고 검사가 결함을 통과시킨다.
 */
import { PLAN_TEXT_SECTIONS, planTextPreview } from '../src/lib/plan-text-sections.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Postgres jsonb가 객체 키를 돌려주는 순서 — 길이 오름차순, 같으면 바이트순 */
const jsonbOrder = (keys: string[]): string[] =>
  [...keys].sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0))

/** 키 순서를 지정해 객체를 만든다 — JS 객체는 문자열 키의 **삽입 순서**를 보존하므로
 *  이렇게 만든 객체가 곧 "DB가 돌려준 모양"이다 */
const objIn = (order: string[], val: (k: string) => string): Record<string, string> =>
  Object.fromEntries(order.map(k => [k, val(k)]))

/** 편집기 스펙이 선언한 대표 칸 순서 — 제품과 **같은 원천**(editor)에서 읽는다 */
function declaredKeys(sectionKey: string): string[] {
  const ed = PLAN_TEXT_SECTIONS[sectionKey]?.editor ?? []
  const rec = ed.find(f => f.kind === 'record')
  if (rec && rec.kind === 'record') return rec.entries.map(e => e.key)
  const row = ed.find(f => f.kind === 'rows' && !f.key)
  if (row && row.kind === 'rows') return row.cols.map(c => c.key)
  return []
}

/** 행 섹션은 body가 행 배열, 레코드 섹션은 body가 객체 */
const isRowSection = (sectionKey: string) =>
  (PLAN_TEXT_SECTIONS[sectionKey]?.editor ?? []).some(f => f.kind === 'rows' && !f.key)

/** DB에 실제로 들어 있는 **모든** 키(비서술 열 포함) — 결함은 비서술 열이 앞으로 밀릴 때 커진다 */
const ALL_KEYS: Record<string, string[]> = {
  brigadeTeams: ['command', 'contact', 'extinguish', 'evacuate', 'rescue', 'protect', 'initial'],
  fireworkLog: ['date', 'place', 'work', 'supervisor', 'measure'],
  constructionLog: ['date', 'facility', 'content', 'company', 'note'],
  promoLog: ['date', 'method', 'content', 'target'],
  recoveryLog: ['date', 'damage', 'recovery', 'cost'],
}

/** 🚨 스테이징 실측(2026-09-21 `_probe-plan-text-preview.mts`) — jsonb 순서 모델의 정답지.
 *  모델을 코드로만 두면 내가 틀리게 적어도 검사끼리 사이좋게 통과한다. 실제 DB가 돌려준
 *  순서를 그대로 박아 **모델이 현실과 같은지**를 먼저 묻는다. */
const OBSERVED: Record<string, string[]> = {
  brigadeTeams: ['rescue', 'command', 'contact', 'initial', 'protect', 'evacuate', 'extinguish'],
  constructionLog: ['date', 'note', 'company', 'content', 'facility'],
  fireworkLog: ['date', 'work', 'place', 'measure', 'supervisor'],
  promoLog: ['date', 'method', 'target', 'content'],
  recoveryLog: ['cost', 'date', 'damage', 'recovery'],
}

console.log('— jsonb 순서 모델이 실제 DB와 같은가 (이게 틀리면 아래 재현이 전부 헛돈다)')
for (const [sk, observed] of Object.entries(OBSERVED)) {
  ok(`${sk}: 길이→바이트순 모델 = 스테이징 실측 순서`,
    jsonbOrder(ALL_KEYS[sk]).join(',') === observed.join(','),
    `모델 ${jsonbOrder(ALL_KEYS[sk]).join(',')} vs 실측 ${observed.join(',')}`)
}

console.log('\n— 대표 칸: 미리보기는 **선언 순서의 첫 서술 칸**을 띄운다 (jsonb 순서로 만든 본문에서)')
const SECTIONS = Object.keys(ALL_KEYS)
for (const sk of SECTIONS) {
  const declared = declaredKeys(sk)
  ok(`${sk}: 선언 축이 editor 스펙에서 나온다`, declared.length > 0, `declared=${declared.join(',')}`)
  if (declared.length === 0) continue

  // 서술 칸에만 값을 넣는다 — 비서술 열(일자·장소·담당)은 pickRows가 ''로 정규화한 그 모양
  const val = (k: string) => (declared.includes(k) ? `[${k}]본문` : '')
  const row = objIn(OBSERVED[sk], val)
  const body = isRowSection(sk) ? [row] : row

  ok(`${sk}: 대표 = ${declared[0]} (jsonb가 앞으로 민 칸이 아니다)`,
    planTextPreview(sk, body) === `[${declared[0]}]본문`,
    `preview=${planTextPreview(sk, body)}`)
}

console.log('\n— ★ 키 순서에 **의존하지 않는다**: 어떤 순열로 줘도 같은 값 (결함의 뿌리를 막는다)')
for (const sk of SECTIONS) {
  const declared = declaredKeys(sk)
  const val = (k: string) => (declared.includes(k) ? `[${k}]본문` : '')
  const mk = (order: string[]) => {
    const r = objIn(order, val)
    return planTextPreview(sk, isRowSection(sk) ? [r] : r)
  }
  const orders = [
    ALL_KEYS[sk],                      // 선언(삽입) 순서
    OBSERVED[sk],                      // jsonb 실측 순서
    [...ALL_KEYS[sk]].reverse(),       // 역순
    [...ALL_KEYS[sk]].sort(),          // 사전순
  ]
  const got = orders.map(mk)
  ok(`${sk}: 4개 순열이 모두 같은 미리보기`,
    new Set(got).size === 1 && got[0] === `[${declared[0]}]본문`, got.join(' | '))
}

console.log('\n— 회귀 고정: 실제로 틀리게 떴던 두 건 (스테이징 「기본 문구」 실데이터)')
{
  // brigadeTeams — 화면엔 지휘통제가 떠야 하는데 응급구조가 떴다
  const teams = objIn(OBSERVED.brigadeTeams, k => ({
    command: '자위소방대장을 보좌하여 각 팀의 활동을 총괄 지휘한다.',
    rescue: '부상자를 안전구역으로 옮겨 응급처치하고 구급대 도착 시 인계한다.',
  } as Record<string, string>)[k] ?? `${k} 임무`)
  const p = planTextPreview('brigadeTeams', teams)
  ok('★ brigadeTeams: 지휘통제(command)가 뜬다', p.startsWith('자위소방대장을 보좌하여'), p)
  ok('★ brigadeTeams: 응급구조(rescue)가 아니다', !p.startsWith('부상자를'), p)

  // constructionLog — 공사·정비 내용이 떠야 하는데 비고가 떴다
  const cons = [objIn(OBSERVED.constructionLog, k => ({
    content: '소화기 교체·충약',
    note: '내용연수 10년 경과분 교체, 지시압력계 정상범위 확인',
    date: '', facility: '', company: '',
  } as Record<string, string>)[k] ?? '')]
  const q = planTextPreview('constructionLog', cons)
  ok('★ constructionLog: 공사·정비 내용(content)이 뜬다', q === '소화기 교체·충약', q)
  ok('★ constructionLog: 비고(note)가 아니다', !q.startsWith('내용연수'), q)
}

console.log('\n— 존속: 대표 칸을 명시해 둔 3섹션은 그대로다 (선언 첫 칸이 대표가 아닌 섹션들)')
{
  // 3.4는 editor 첫 칸이 falseAlarm이지만 대표는 procedure다 — 이 구별이 살아 있어야 한다
  ok('evacPlan: 대표는 procedure(편집기 첫 칸 falseAlarm이 아니다)',
    planTextPreview('evacPlan', { falseAlarm: '비화재보 본문', procedure: '절차 본문', evacMethod: '대피 본문' }) === '절차 본문')
  // 1.11은 첫 칸이 분류자(scenarioType)다 — 대표는 scenario
  ok('training: 대표는 scenario(분류자 scenarioType이 아니다)',
    planTextPreview('training', { scenarioType: '아파트', scenario: '시나리오 본문', details: [] }) === '시나리오 본문')
  ok('vulnerableMethods: 대표는 method', planTextPreview('vulnerableMethods', { method: '부축 이동' }) === '부축 이동')
}

console.log('\n— 경계')
{
  ok('행이 없으면 빈 문자열', planTextPreview('constructionLog', []) === '')
  ok('서술 칸이 전부 비면 빈 문자열',
    planTextPreview('constructionLog', [objIn(OBSERVED.constructionLog, () => '')]) === '')
  ok('40자를 넘으면 … 로 자른다', () => {
    const long = '가'.repeat(60)
    const r = [objIn(OBSERVED.constructionLog, k => (k === 'content' ? long : ''))]
    const p = planTextPreview('constructionLog', r)
    return p.length === 41 && p.endsWith('…')
  })
  // 선언 축이 없는 섹션(알 수 없는 키)에서도 죽지 않는다 — 종전 동작(객체 순서)으로 떨어진다
  ok('모르는 섹션도 예외 없이 값을 돌려준다',
    planTextPreview('unknownSection', [{ a: '', b: '값' }]) === '값')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
