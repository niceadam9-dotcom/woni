/** 신규등록 순서 검사 (2026-09-15) — 기본정보 → 건물·시설 → 관계인 → 소방계획서.
 *
 *  이 축이 겨누는 사고는 둘이다:
 *   ① **건너뛰기** — 종전 `?tab=plan` 직행이 건물·관계인을 통째로 지나쳤다(원래 결함).
 *   ② **붙잡기** — 다 채운 사용자를 순서에 가두는 것. 사용자 요청이 "모두 채워지면 소방계획서로
 *      가도 됩니다"였으므로 ②는 ①만큼 분명한 실패다. 그래서 음성 단언을 함께 건다.
 *
 *  의존 0 — DB도 서버도 필요 없다. 실행: npx tsx scripts/test-onboarding-order.mts
 */
import {
  buildingsDone, contactsDone, nextOnboardingTab, onboardingComplete,
  onboardingSteps, onboardingHint, ONBOARDING_ORDER,
} from '../src/lib/onboarding-steps.ts'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { codeOnly, strippedStats } from './_code-only.mts'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${m}${d ? ' — ' + d : ''}`) }
  else { fail++; console.log(`  ❌ ${m}${d ? ' — ' + d : ''}`) }
}
const B = (o: Partial<{ is_active: boolean; purpose: string | null; total_area: number | null }>) =>
  ({ is_active: true, purpose: '제2종근린생활시설', total_area: 300, ...o })
const REP = [{ role: '대표' }]

console.log('── 1) 순서 — 첫 미완으로 간다')
{
  ok(nextOnboardingTab({ buildings: false, contacts: false }) === 'buildings',
    '🎯 둘 다 비면 건물·시설부터')
  ok(nextOnboardingTab({ buildings: false, contacts: true }) === 'buildings',
    '🎯 건물이 비면 관계인이 찼어도 건물부터(순서를 건너뛰지 않는다)')
  ok(nextOnboardingTab({ buildings: true, contacts: false }) === 'contacts',
    '🎯 건물이 찼으면 관계인으로 — 이미 끝난 칸을 다시 보여주지 않는다')
  ok(ONBOARDING_ORDER.join('>') === 'buildings>contacts>plan',
    '순서 배열이 곧 진행 순서다', ONBOARDING_ORDER.join(' → '))
  /* 🚨 「기본정보」는 게이트가 아니다(사용자 확정) — 등록 폼이 이미 필수로 강제했고, 남은 ⚠는
     영업권 밖 고객의 담당 미배정이라 게이트로 쓰면 영영 못 넘어간다. */
  ok(!(ONBOARDING_ORDER as readonly string[]).includes('info'),
    '🎯 (음성) 「기본정보」는 게이트가 아니다')
}

console.log('\n── 2) 붙잡지 않는가 — 다 채우면 소방계획서 (사용자 요청의 후반부)')
{
  ok(nextOnboardingTab({ buildings: true, contacts: true }) === 'plan',
    '🎯 둘 다 채우면 소방계획서로 간다')
  ok(onboardingComplete({ buildings: true, contacts: true }) === true, '완료 판정이 참')
  ok(onboardingComplete({ buildings: true, contacts: false }) === false, '하나라도 비면 미완')
  /* 🚨 실측(스테이징 2026-09-15): 활성 305명 중 완비는 10명(3.3%)뿐이고 미완 295명의 원인은
     거의 전부 「용도」 한 칸이다. 그래서 **차단이 아니라 안내**다 — 아래 5절이 그 계약을 건다. */
}

console.log('\n── 3) 건물 완성도 — 「하나라도」이지 「전부」가 아니다')
{
  ok(buildingsDone([B({})]) === true, '용도+연면적 있는 활성 동 하나 → 참')
  ok(buildingsDone([]) === false, '🎯 활성 건물 0동 → 거짓')
  ok(buildingsDone([B({ is_active: false })]) === false, '🎯 비활성 동만 있으면 거짓(세지 않는다)')
  ok(buildingsDone([B({ purpose: null })]) === false, '🎯 용도가 비면 거짓 — 실측 미완의 94%가 이 칸')
  ok(buildingsDone([B({ purpose: '' })]) === false, '용도가 빈 문자열이어도 거짓')
  ok(buildingsDone([B({ total_area: null })]) === false, '연면적이 비면 거짓')
  ok(buildingsDone([B({ total_area: 0 })]) === true, '🎯 연면적 0은 「입력됨」이다(0과 미입력을 가른다)')
  /* 🚨 다동 고객은 부속동(창고·기계실) 용도를 끝내 안 적는다. **전 동**을 요구하면 정상적인
     다동 고객이 영원히 미완으로 남는다 — 이 단언이 그 회귀를 막는다. */
  ok(buildingsDone([B({}), B({ purpose: null, total_area: null })]) === true,
    '🎯 다동 — 한 동만 완비면 참(부속동 미입력이 전체를 막지 않는다)')
  ok(buildingsDone([B({ purpose: null }), B({ total_area: null })]) === false,
    '🎯 용도·연면적이 **서로 다른 동**에 흩어져 있으면 거짓(한 동이 둘 다 가져야 한다)')
}

console.log('\n── 4) 관계인 완성도 · 진행 띠 · 문구')
{
  ok(contactsDone(REP) === true, '대표가 있으면 참')
  ok(contactsDone([{ role: '관리자' }]) === false, '🎯 대표가 아닌 관계인만 있으면 거짓')
  ok(contactsDone([]) === false, '관계인이 없으면 거짓')

  const steps = onboardingSteps({ buildings: false, contacts: true })
  ok(steps.length === 4, '띠는 네 칸', steps.map(s => s.label).join(' › '))
  ok(steps[0].key === 'info' && steps[0].done === true,
    '🎯 기본정보는 항상 ✓(등록을 마친 시점에 이미 통과)')
  /* 🚨 한 상태만 재면 안 된다 — 변이 M11(「buildings는 늘 current」)이 **살아남았다**.
     하필 이 표본에서 buildings가 첫 미완이라 변이와 원본이 같은 값을 냈다.
     네 상태를 **전부** 돌려야 「늘 정확히 하나」가 계약이 된다. */
  const STATES = [
    { buildings: false, contacts: false }, { buildings: false, contacts: true },
    { buildings: true, contacts: false }, { buildings: true, contacts: true },
  ]
  const currents = STATES.map(st => onboardingSteps(st).filter(s => s.current).map(s => s.key))
  ok(currents.every(c => c.length === 1), '🎯 「지금」은 **네 상태 전부** 정확히 하나',
    currents.map(c => c.join('+') || '(없음)').join(' / '))
  ok(currents.map(c => c[0]).join(',') === 'buildings,buildings,contacts,plan',
    '🎯 「지금」이 상태마다 첫 미완을 정확히 따라간다', currents.map(c => c[0]).join(' · '))
  ok(steps.find(s => s.current)?.key === 'buildings', '첫 미완이 「지금」')
  ok(steps.find(s => s.key === 'contacts')?.done === true, '이미 찬 칸은 ✓로 남는다')
  /* 라벨이 탭 라벨과 글자까지 같아야 사용자가 띠와 탭을 같은 것으로 읽는다 */
  const page = readFileSync(path.join(import.meta.dirname, '..', 'src/app/(dashboard)/customers/[id]/page.tsx'), 'utf8')
  for (const [key, label] of [['buildings', '건물·시설'], ['contacts', '관계인'], ['plan', '소방계획서']] as const) {
    ok(onboardingSteps({ buildings: true, contacts: true }).find(s => s.key === key)?.label === label
      && new RegExp(`key: '${key}', label: '${label}'`).test(page),
      `🎯 「${label}」 라벨이 띠와 탭에서 같다`)
  }

  /* 🚨 「입력하세요」로 끝내면 안 된다 — 미완의 94%가 「용도」 한 칸인데, 연면적을 이미 채운
     사용자는 뭘 더 하라는지 모른다. **무엇이** 빈지를 말해야 한다. */
  ok(onboardingHint('buildings', [B({ purpose: null })]).includes('용도'),
    '🎯 용도가 비면 문구가 「용도」를 집어 말한다',
    onboardingHint('buildings', [B({ purpose: null })]))
  ok(!onboardingHint('buildings', [B({ purpose: null })]).includes('연면적'),
    '🎯 (음성) 이미 채운 연면적을 하라고 하지 않는다')
  ok(onboardingHint('buildings', []).includes('건물을'), '건물이 0동이면 등록부터 안내')
  ok(onboardingHint('contacts', []).includes('대표'), '관계인 칸은 대표 지목을 안내')
}

console.log('\n── 5) 배선 — 규칙이 한 벌인가, 그리고 차단이 아닌가')
{
  const src = (p: string) => readFileSync(path.join(import.meta.dirname, '..', 'src', p), 'utf8')
  const page = src('app/(dashboard)/customers/[id]/page.tsx')
  ok(page.length > 1000, '분모 확인: 고객 상세 소스를 읽었다')

  /* 🚨 이 검사의 심장 — 탭 ⚠ 배지와 온보딩 이동이 **같은 값**을 써야 한다. 두 벌이면
     「⚠인데 소방계획서로 직행시킨다」가 생기고, 사용자는 화면과 동작 중 뭘 믿을지 모른다.
     문자열 존재만 묻지 않고 **tabDefs가 obState를 쓰는지**를 본다. */
  ok(/const obState = \{ buildings: buildingsDone\(buildings\), contacts: contactsDone\(contacts\) \}/.test(page),
    '🎯 완성도를 한 번만 계산한다(obState)')
  ok(/key: 'buildings', label: '건물·시설', warn: !obState\.buildings/.test(page),
    '🎯 건물 탭 ⚠가 **그 값**을 쓴다(제 손으로 다시 세지 않는다)')
  ok(/key: 'contacts',[^\n]*warn: !obState\.contacts/.test(page),
    '🎯 관계인 탭 ⚠가 **그 값**을 쓴다')
  /* 옛 인라인 술어가 되살아나면 두 벌이 된다 — 부활을 음성으로 막는다 */
  ok(!/activeBlds\.some\(b => b\.purpose && b\.total_area != null\)/.test(page),
    '🎯 (음성) 옛 인라인 건물 술어가 부활하지 않았다')
  ok(!/const hasRep = /.test(page), '🎯 (음성) 옛 인라인 대표 술어가 부활하지 않았다')

  /* ① 건너뛰기 — 원래 결함. 등록 폼이 tab=plan을 붙이면 순서가 통째로 무력해진다.
     🚨 아래 두 음성 단언은 **주석에 걸려 빨갛게 떴다**(이 저장소는 결함 내력을 주석에 길게
        적는 규약이라, 내가 방금 "tab=plan을 붙이지 않는다"라고 적은 그 글자가 잡혔다).
        코드만 남기고 묻는다 — `_code-only.mts`. 계측기가 실제로 물었는지 먼저 단언한다. */
  const neuRaw = src('components/customers/customer-new-client.tsx')
  const stat = strippedStats(neuRaw)
  ok(stat.removed > 0 && stat.leftover === 0,
    '계측기 자기 검사: 주석이 실제로 걷혔다', `${stat.removed}자 제거 · 잔존 줄주석 ${stat.leftover}`)
  const neu = codeOnly(neuRaw)
  ok(/router\.push\(`\/customers\/\$\{result\.customerId\}\?created=1&onboarding=1`\)/.test(neu),
    '🎯 등록 직후 URL이 탭을 지정하지 않는다(서버가 첫 미완을 고른다)')
  ok(!/tab=plan/.test(neu), '🎯 (음성) 등록 폼이 소방계획서로 직행시키지 않는다 — 원래 결함')

  /* 온보딩일 때만 서버가 탭을 고르고, 사용자가 ?tab=을 쓰면 그쪽이 이긴다 */
  ok(/const effectiveTab = onboardingActive && !initialTab \? obNext : resolvedTab/.test(page),
    '🎯 ?tab=을 명시하면 사용자 지정이 이긴다(온보딩이 덮어쓰지 않는다)')
  ok(/initialTab=\{effectiveTab\}/.test(page), '탭 셸이 그 값을 받는다')
  ok(/const onboardingActive = onboarding === '1'/.test(page), '띠는 ?onboarding=1일 때만')

  /* ② 차단이 아니다 — 사용자 확정. 탭 버튼에 disabled가 붙으면 96.7%가 잠긴다. */
  const shell = src('components/customers/customer-tabs.tsx')
  ok(!/disabled/.test(shell),
    '🎯 (음성) 탭 셸이 탭을 잠그지 않는다 — 차단이 아니라 안내다(사용자 확정)')
  ok(/banner \?\? |banner &&/.test(shell), '탭 셸이 띠 자리를 연다')

  /* 🚨 띠가 URL만 바꾸면 화면이 안 따라온다 — 활성 탭은 셸 state가 들고 있다. goTab이라야 한다. */
  const strip = codeOnly(src('components/customers/onboarding-strip.tsx'))
  ok(/tabs\?\.goTab\(next\)/.test(strip),
    '🎯 [다음]이 셸의 goTab을 부른다(URL만 바꾸면 화면이 안 따라온다)')
  ok(!/<Link/.test(strip) && !/router\.push/.test(strip),
    '🎯 (음성) 띠가 Link·push로 탭을 옮기지 않는다')
  ok(/sp\.delete\('onboarding'\)/.test(strip) && !/sp\.set\('tab'/.test(strip),
    '🎯 [안내 닫기]는 띠만 접는다 — 보던 탭을 뺏지 않는다')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
