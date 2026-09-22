/** 달력의 소방계획서 고지 칩 — 순수 + 배선 단언 (2026-09-22)
 *  실행: npx tsx scripts/test-calendar-fireplan-notice.mts   — **서버·DB 불필요**
 *
 *  ## 실측이 이 축의 모양을 정했다 (활성 고객 12명 전건)
 *  실제 `X-FirePlan-Missing` 조각 **17종이 거의 전부 미입력 라벨 그 자체**였다
 *  (`수신기위치`·`구조`·`지붕`·`선임일`·`급수`·`화재보험`·`운영시간`·`인원`·`자위소방대`·
 *   `주소`·`건물 용도`·`층수`…). **시트 번호가 있는 조각은 한 종도 없었다.**
 *  → `parseFirePlanNotice`의 노드 매핑만으로는 칩이 **하나도** 안 생긴다.
 *    미입력 라벨 표(`FIRE_PLAN_CHIP_TARGET`)가 이 축의 본체다.
 *
 *  🚨 급소 셋:
 *    ① **모르는 라벨에 목적지를 지어내면 안 된다.** 고객 화면은 「모르면 1.1로」 폴백이 있지만
 *       그건 사람이 고른 누락 칩이다. 고지는 기계가 만든 문장이라 폴백이 곧 오배송이다.
 *    ② 표가 **한 벌**이어야 한다 — 고객 화면과 달력이 같은 것을 봐야 「주소」 칩이 갈리지 않는다.
 *    ③ 소방계획서는 **게이트가 없다**(사용자 지시: 경우에 따라 만들 수도, 안 만들 수도).
 */
import { readFileSync } from 'node:fs'
import { firePlanNoticeHref, FIRE_PLAN_CHIP_TARGET } from '../src/lib/fire-plan-chip-target.ts'
import { parseFirePlanNotice } from '../src/lib/fire-plan-notice.ts'
import { tabOfForm } from '../src/lib/fire-plan-sections.ts'
import { codeOnly } from './_code-only.mts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const hit = (text: string) => firePlanNoticeHref({ text }, 'CUST', tabOfForm)

console.log('— 실측 라벨 17종이 갈 곳을 얻는가 (이 축의 본체)')
const MEASURED: Array<[string, string | null]> = [
  ['주소', '/customers/CUST?tab=info'],
  ['사용승인일', '/customers/CUST?tab=info'],
  ['건물 용도', '/customers/CUST?tab=buildings'],
  ['층수', '/customers/CUST?tab=buildings'],
  ['수신기위치', '/customers/CUST?tab=facilities&form=1.1'],
  ['구조', '/customers/CUST?tab=facilities&form=1.1'],
  ['지붕', '/customers/CUST?tab=facilities&form=1.1'],
  ['선임일', '/customers/CUST?tab=facilities&form=1.1'],
  ['급수', '/customers/CUST?tab=facilities&form=1.1'],
  ['화재보험', '/customers/CUST?tab=facilities&form=1.1'],
  ['운영시간', '/customers/CUST?tab=facilities&form=1.1'],
  ['인원', '/customers/CUST?tab=facilities&form=1.1'],
  ['자위소방대', '/customers/CUST?tab=plan&form=ch2'],
  ['송달 동의', '/customers/CUST?tab=facilities&form=1.1'],
  // ★ 표에 없는 실측 라벨 — **목적지를 지어내지 않는다**
  ['시설현황', null],
  ['계약일', null],
]
for (const [text, want] of MEASURED) {
  const got = hit(text)?.href ?? null
  ok(`${(want ?? '(목적지 없음)').padEnd(44)} ← ${text}`, got === want, `got=${got}`)
}

console.log('\n— ① 모르는 문장에 목적지를 지어내지 않는다')
ok('★ 표에 없는 문장 → null', hit('범위: 시트 50장') === null && hit('여기 없는 새 고지') === null)
ok('★ 「모르면 1.1로」 폴백이 없다', hit('아무 말') === null)
ok('부분 일치로 걸리지 않는다(정확 일치만)', hit('주소가 비었습니다') === null, JSON.stringify(hit('주소가 비었습니다')))
ok('앞뒤 공백은 다듬는다', hit('  주소  ')?.href === '/customers/CUST?tab=info')

console.log('\n— 시트 번호가 있는 조각은 그 노드로 (지금 표본엔 없지만 규칙은 산다)')
{
  const p = parseFirePlanNotice('선임현황(1.7.1) 2명 미표기')[0]
  ok('전제 — 번호가 노드로 읽힌다', !!p.form, JSON.stringify(p))
  if (p.form) {
    const h = firePlanNoticeHref(p, 'CUST', tabOfForm)
    ok('★ 이사 노드까지 반영된 탭으로 보낸다', !!h?.href.includes(`form=${p.form}`), h?.href ?? '(없음)')
  }
}

console.log('\n— ② 표가 한 벌인가')
{
  const view = codeOnly(readFileSync(new URL('../src/components/customers/plan-tab-view.tsx', import.meta.url), 'utf8'))
  ok('★ 고객 화면이 공용 표를 들여온다',
    /import \{ FIRE_PLAN_CHIP_TARGET, FIRE_PLAN_CHIP_LABEL \} from '@\/lib\/fire-plan-chip-target'/.test(view))
  ok('★ 고객 화면에 표가 복제돼 있지 않다',
    !/'주소': 'info', '사용승인일': 'info'/.test(view))
  ok('표에 실측 라벨이 다 들어 있다',
    ['주소', '건물 용도', '수신기위치', '자위소방대'].every(k => k in FIRE_PLAN_CHIP_TARGET))
}

console.log('\n— ③ 배선 — 게이트 없음 · 복귀 경로 · 다른 축')
{
  const client = codeOnly(readFileSync(new URL('../src/components/inspections/inspection-calendar-client.tsx', import.meta.url), 'utf8'))
  ok('패널에 소방계획서 버튼이 있다', /daypanel-fireplan/.test(client) && /<FirePlanXlsxButton/.test(client))
  ok('★ ③ 게이트를 걸지 않는다 (hasResultReport로 가리지 않는다)', () => {
    const i = client.indexOf('daypanel-fireplan')
    const before = client.slice(Math.max(0, i - 400), i)
    return !/hasResultReport\s*&&/.test(before)
  }, '소방계획서에 결과보고서 게이트가 걸렸다')
  ok('★ 복귀 경로(from=)가 칩에 붙는다', () => {
    const i = client.indexOf('parts={fpNotice}')
    if (i < 0) return false
    return /from=\$\{encodeURIComponent\(calendarBackHref\)\}/.test(client.slice(i, i + 700))
  })
  ok('★ 보고서와 **다른 축** — 소방계획서엔 회차 쪽지를 쓰지 않는다', () => {
    const i = client.indexOf('parts={fpNotice}')
    return i > 0 && !/writePendingDoc/.test(client.slice(i, i + 700))
  })
  ok('회차가 바뀌면 소방계획서 고지도 버린다', /setFpNotice\(\[\]\); setFpError\(''\)/.test(client))
  ok('목적지 변환을 베껴 적지 않고 firePlanNoticeHref를 쓴다',
    /firePlanNoticeHref\(/.test(client) && !/tab=facilities&form=1\.1/.test(client))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
