/**
 * 신규등록 순서 — 기본정보 → 건물·시설 → 관계인 → 소방계획서 (2026-09-15 사용자 확정)
 *
 * 등록이 끝나면 곧장 소방계획서 탭으로 떨어지고 있었다(`?tab=plan`). 가운데 두 탭을 건너뛰니
 * 건물 용도도 관계인도 비어 있는 채로 계획서를 쓰게 된다. 이 모듈이 **다음에 갈 곳**을 정한다.
 *
 * ## 🚨 이 모듈의 존재 이유는 「두 벌 금지」다
 * 같은 판정을 탭 ⚠ 배지도 하고 이동 규칙도 한다. 두 곳에 각각 적으면 **「⚠인데 직행시킨다」**가
 * 생기고, 그때 사용자는 화면과 동작 중 어느 쪽을 믿어야 할지 알 수 없다.
 * → `customers/[id]/page.tsx`의 `tabDefs`가 이 함수들을 그대로 부른다. 술어를 거기 인라인으로
 *   되돌리면 이 계약이 깨진다(검사가 그 배선을 단언한다).
 *
 * ## 차단이 아니라 순서다 (사용자 확정)
 * 실측(스테이징 2026-09-15): 활성 고객 305명 중 **건물·관계인 완비는 10명(3.3%)**.
 * 미완 295명의 원인은 거의 전부 **「용도」 한 칸**(277명 · 연면적은 293/312행이 이미 있다).
 * 그러니 상시 차단을 걸면 **96.7%가 소방계획서에서 잠긴다** — 못 할 일이다.
 * 그래서 이 순서는 **등록 직후 온보딩 흐름에서만** 길을 안내하고, 탭을 직접 누르는 것은 막지 않는다.
 *
 * ⭐ 96.7%는 **과거 데이터의 부채**이지 지금 등록 흐름의 모습이 아니다 — 최근 등록 20명은
 *   건물 미완이 10/20이다(용도 있는 16행이 최근에 몰려 있다). 새 고객의 절반은 실제로 직행한다.
 *
 * ## 「기본정보」는 게이트가 아니다 (사용자 확정)
 * 등록 폼이 주소·고객명·점검유형·점검일자·사용승인일·대표 관계인을 **이미 필수로 강제**하므로
 * 등록을 마친 고객은 정의상 통과 상태다. 남은 ⚠ 34명은 「담당 미배정」이 대부분인데 그건
 * **영업권(양평군) 밖**이라 담당자를 정할 수 없는 고객이다 — 게이트로 쓰면 영영 못 넘어간다.
 */

/** 순서를 타는 탭 — 「기본정보」는 위 이유로 여기 없다. 배열 순서가 곧 진행 순서다. */
export const ONBOARDING_ORDER = ['buildings', 'contacts', 'plan'] as const
export type OnboardingTab = (typeof ONBOARDING_ORDER)[number]

type BuildingLike = { is_active?: boolean | null; purpose?: string | null; total_area?: number | null }
type ContactLike = { role?: string | null }

/** 건물·시설이 채워졌는가 — 활성 동이 있고, 그중 **용도와 연면적을 둘 다 가진 동**이 하나라도 있다.
 *
 *  ⚠ 「하나라도」인 이유: 다동 고객은 부속동(창고·기계실)의 용도를 끝내 안 적는 일이 흔하다.
 *    전 동을 요구하면 정상적인 다동 고객이 영원히 미완으로 남는다.
 *  ⚠ 「용도」를 조건에 넣는 이유는 그 값이 소방계획서 1.1의 용도이자 1.2(구역)·1.5(피난)·
 *    1.11(훈련) 프리셋 추천의 입력이기 때문이다. 비면 그 셋이 추천을 못 한다. */
export function buildingsDone(buildings: readonly BuildingLike[]): boolean {
  const active = buildings.filter(b => b.is_active)
  return active.length > 0 && active.some(b => !!b.purpose && b.total_area != null)
}

/** 관계인이 채워졌는가 — **대표**가 지목돼 있는가.
 *
 *  등록 폼이 대표 이름을 필수로 받으므로(`customer-new-client.tsx` requiredChecks) 새 고객은
 *  거의 늘 참이다. 실측 미완 22명은 전부 그 필수가 생기기 전의 옛 데이터다. */
export function contactsDone(contacts: readonly ContactLike[]): boolean {
  return contacts.some(c => c.role === '대표')
}

export type OnboardingState = { buildings: boolean; contacts: boolean }

/** 다음에 열 탭 — **첫 미완**. 둘 다 채워졌으면 종전대로 소방계획서로 간다(사용자 요청 그대로).
 *
 *  🚨 「미완인 탭이 없으면 plan」이 아니라 **순서대로 훑어 첫 미완**이다. 건물이 비고 관계인이
 *    찼을 때 관계인으로 보내면 사용자는 이미 끝난 칸을 다시 보게 된다. */
export function nextOnboardingTab(s: OnboardingState): OnboardingTab {
  if (!s.buildings) return 'buildings'
  if (!s.contacts) return 'contacts'
  return 'plan'
}

/** 온보딩이 끝났는가 — 앞 단계가 전부 차서 더 보낼 곳이 없다. */
export function onboardingComplete(s: OnboardingState): boolean {
  return nextOnboardingTab(s) === 'plan'
}

export type OnboardingStep = {
  key: 'info' | OnboardingTab
  /** 화면 라벨 — 탭 라벨과 **글자까지 같아야** 사용자가 띠와 탭을 같은 것으로 읽는다 */
  label: string
  done: boolean
  /** 지금 있어야 할 자리 (첫 미완) */
  current: boolean
  /** 게이트가 아닌 단계(기본정보) — 늘 ✓로 두되 「다음」의 목적지가 되지 않는다 */
  gate: boolean
}

/** 진행 띠에 그릴 네 단계. 「기본정보」는 등록을 마친 시점에 이미 통과라 항상 done이다. */
export function onboardingSteps(s: OnboardingState): OnboardingStep[] {
  const next = nextOnboardingTab(s)
  return [
    { key: 'info', label: '기본정보', done: true, current: false, gate: false },
    { key: 'buildings', label: '건물·시설', done: s.buildings, current: next === 'buildings', gate: true },
    { key: 'contacts', label: '관계인', done: s.contacts, current: next === 'contacts', gate: true },
    { key: 'plan', label: '소방계획서', done: onboardingComplete(s), current: next === 'plan', gate: true },
  ]
}

/** 지금 칸에서 무엇이 비었는지 — 띠에 그대로 인쇄한다.
 *
 *  ⚠ 「입력하세요」가 아니라 **무엇이** 빈지를 말한다. 실측상 미완의 94%가 「용도」 한 칸인데
 *    "건물 정보를 입력하세요"라고만 하면 이미 연면적을 채운 사용자는 뭘 더 하라는지 모른다. */
export function onboardingHint(tab: OnboardingTab, buildings: readonly BuildingLike[]): string {
  if (tab === 'contacts') return '대표 관계인을 지목하면 다음으로 넘어갑니다.'
  if (tab === 'plan') return '앞 단계가 모두 채워졌습니다 — 소방계획서를 작성하세요.'
  const active = buildings.filter(b => b.is_active)
  if (active.length === 0) return '건물을 한 동 이상 등록하세요.'
  const missing = [
    !active.some(b => !!b.purpose) && '용도',
    !active.some(b => b.total_area != null) && '연면적',
  ].filter(Boolean) as string[]
  return missing.length
    ? `건물의 ${missing.join('·')}을(를) 입력하면 다음으로 넘어갑니다.`
    : '한 동에 용도와 연면적이 함께 있어야 합니다.'
}
