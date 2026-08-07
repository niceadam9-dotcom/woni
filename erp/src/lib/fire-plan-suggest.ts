/** 소방계획서 추천값 (탭개편 설계 §6-D-1) — 급수 법정 판정·운영시간 프리셋·수신기위치 후보.
 *
 *  급수 규칙 근거: 화재의 예방 및 안전관리에 관한 법률 시행령 별표 4 (소방안전관리대상물 등급).
 *  - 특급: ①50층 이상(지하 제외)·높이 200m 이상 아파트 ②30층 이상(지하 포함)·높이 120m 이상(아파트 제외)
 *          ③연면적 10만㎡ 이상(아파트 제외)
 *  - 1급: ①30층 이상·높이 120m 이상 아파트 ②연면적 1만5천㎡ 이상(아파트·연립 제외) ③11층 이상(아파트 제외)
 *  - 2급: 옥내소화전·스프링클러·물분무등 소화설비(호스릴 제외) 설치 대상 등
 *  - 3급: 간이스프링클러·자동화재탐지설비 설치 대상
 *  ⚠ 어디까지나 '제안'이며 확정은 사용자 — 가연성가스 시설·지하구·문화재 등 특수 조건은 판정하지 않는다 (설계 §9). */

import type { RoadTier } from '@/lib/address-parser'

/** 서식 1.3 주변 현황 초안 (소방계획서_11.md §8-4 — D-2 '자동차 도로 기반')
 *
 *  자동으로 단정할 수 있는 것은 **접도 도로명뿐**이다. 차로수·인접 건물은 현장 정보이고,
 *  도로 제원(폭·차로수)을 주는 공개 API가 연동돼 있지 않다. 그래서 문장을 완성하지 않고
 *  `__`·`____` 빈칸을 남긴 **뼈대**만 만든다 — 사람이 채워 저장한다(자동 저장 금지).
 *
 *  주변 현황은 소방차 진입 가부·연소 확대 판단 근거라(fire-plan-template.ts 서식 1.3),
 *  기준이 되는 도로는 **자동차가 진입하는 도로**다. 이면도로(길)면 그 사실을 명시한다. */
export function buildSurroundingsDraft(i: {
  road: string | null
  mainRoad: string | null
  tier: RoadTier | null
  bearing?: string          // 방위 — 자동 판정 불가(건물 폴리곤 필요)라 사용자가 칩으로 지정
}): string {
  const b = i.bearing ? `${i.bearing}측` : '[방위]측'
  const tail = '동측 ____, 서측 ____, 남측 ____ 인접.'
  if (!i.road) return `${b} ____에 접함(왕복 __차로). ${tail}`
  if (i.tier === 'gil') {
    // 이면도로 — 자동차 진입은 모도로에서 분기. 모도로가 이름에 없으면(○○길) 빈칸으로 남긴다.
    const from = i.mainRoad ? `${i.mainRoad}에서` : '____에서'
    return `${b} ${i.road}(이면도로, 왕복 __차로)에 접함. 소방차는 ${from} 분기 진입. ${tail}`
  }
  return `${b} ${i.road}에 접함(왕복 __차로). ${tail}`
}

export type GradeSuggestInput = {
  purpose: string | null      // 건물 용도 (아파트/공동주택 판별)
  totalArea: number | null    // 연면적(㎡)
  floorsAbove: number | null
  floorsBelow: number | null
  height: number | null       // m (건축물대장)
  facilityCodes: string[]     // 설치된 소방시설 명칭 (fire_facilities.facility_code)
}

const isApt = (p: string | null) => !!p && /아파트|공동주택/.test(p)

export function suggestGrade(i: GradeSuggestInput): { grade: string; reason: string } | null {
  const apt = isApt(i.purpose)
  const fa = i.floorsAbove ?? 0
  const fb = i.floorsBelow ?? 0
  const h = i.height ?? 0
  const area = i.totalArea ?? 0

  if (apt && (fa >= 50 || h >= 200)) return { grade: '특급', reason: '아파트 50층 이상 또는 높이 200m 이상 (별표4 특급)' }
  if (!apt && (fa + fb >= 30 || h >= 120)) return { grade: '특급', reason: '30층 이상(지하 포함) 또는 높이 120m 이상 (별표4 특급)' }
  if (!apt && area >= 100_000) return { grade: '특급', reason: '연면적 10만㎡ 이상 (별표4 특급)' }

  if (apt && (fa >= 30 || h >= 120)) return { grade: '1급', reason: '아파트 30층 이상 또는 높이 120m 이상 (별표4 1급)' }
  if (!apt && area >= 15_000) return { grade: '1급', reason: '연면적 1만5천㎡ 이상 (별표4 1급)' }
  if (!apt && fa >= 11) return { grade: '1급', reason: '11층 이상 (별표4 1급)' }

  // 2급 — 옥내소화전·스프링클러(간이 제외)·물분무등 소화설비 설치
  const grade2 = i.facilityCodes.find(c =>
    /옥내소화전/.test(c) ||
    (/스프링클러/.test(c) && !/간이/.test(c)) ||
    /물분무|미분무|포소화|이산화탄소|할론|할로겐|분말소화|강화액|고체에어로졸/.test(c))
  if (grade2) return { grade: '2급', reason: `${grade2} 설치 대상 (별표4 2급)` }

  // 3급 — 간이스프링클러·자동화재탐지설비 설치
  const grade3 = i.facilityCodes.find(c => /간이스프링클러|자동화재탐지/.test(c))
  if (grade3) return { grade: '3급', reason: `${grade3} 설치 대상 (별표4 3급)` }

  return null
}

/** 운영시간 프리셋 — 건물 용도 기반 추정 (설계 §6-D-1) */
export function suggestOpHours(purpose: string | null): { weekday: string; holiday: string; reason: string } | null {
  if (!purpose) return null
  if (/아파트|공동주택|주택|숙박|병원|요양|기숙사/.test(purpose))
    return { weekday: '24시간', holiday: '24시간', reason: `용도(${purpose}) — 상시 운영 추정` }
  return { weekday: '09~18시', holiday: '미운영', reason: `용도(${purpose}) — 주간 운영 추정` }
}

/** 수신기위치 자주 쓰는 후보 (datalist) */
export const RECEIVER_LOCATION_PRESETS = ['1층 관리실', '1층 경비실', '1층 사무실', '지하1층 방재실', '1층 방재실']
