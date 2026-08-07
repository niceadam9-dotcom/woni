/**
 * 한국 주소 문자열에서 시/군/구, 읍/면/동, 리 추출
 *
 * 예) "경기도 양평군 양평읍 양평리 500"
 *   → { region_si: "양평군", region_myeon: "양평읍", region_ri: "양평리" }
 *
 * 예) "경기도 양평군 양평읍 어딘가로 123 (도로명 주소)"
 *   → { region_si: "양평군", region_myeon: "양평읍", region_ri: "" }
 */
export type RoadTier = 'daero' | 'ro' | 'gil'

/**
 * 도로명주소에서 도로명·위계 추출 (소방계획서_11.md §8-3 — 서식 1.3 주변 현황 자동 초안)
 *
 * 도로명주소는 `<도로명>(대로|로|길) <건물번호>` 구조라, **건물번호가 뒤따르는 것**을 필수 조건으로 두어
 * "경기도"·"양평읍 도로" 같은 오탐을 억제한다. 지번주소에는 도로명이 없으므로 null.
 *
 * 자동차 도로(간선) 판정:
 *   - 대로·로 = 차량 통행 도로 → mainRoad = 자기 자신
 *   - ○○대로123번길 = 이면도로지만 **모도로가 이름에 인코딩**돼 있음 → mainRoad = '○○대로'
 *   - ○○길 = 이면도로, 모도로 불명 → mainRoad = null (경로 조회 L3 필요, §9)
 *
 * 예) "경기 양평군 양평읍 마유산로 123-4"   → { road:'마유산로', tier:'ro',  mainRoad:'마유산로' }
 * 예) "서울 중구 중앙대로123번길 45"        → { road:'중앙대로123번길', tier:'gil', mainRoad:'중앙대로' }
 */
export function extractRoadName(address: string): {
  road: string
  tier: RoadTier
  mainRoad: string | null
  bldNo: string
} | null {
  if (!address) return null
  // 문자 클래스에 숫자를 포함시켜 greedy 매칭이 '중앙대로123번길'을 통째로 집도록 한다(부속 도로명 보존).
  // 부속 도로명은 붙여쓴 형태(`중앙대로123번길`)와 **띄어쓴 형태(`중문관광로 72번길`)가 모두 실제로 쓰인다** —
  // 후자를 놓치면 `중문관광로` + 건물번호 `72`로 읽혀 **이면도로를 간선도로로 단정**한다(BLK-4, 독립검증 2026-08-07).
  // 그래서 도로명 뒤에 `<숫자><번?><가?>길`이 이어지면 그것까지 도로명으로 흡수한다.
  const m = address.trim().match(
    /([가-힣A-Za-z0-9]+(?:대로|로|길)(?:\s*\d+(?:번)?[가-힣]?길)?)\s*(\d+(?:-\d+)?)(?![\d-])/)
  if (!m) return null
  const road = m[1].replace(/\s+/g, ' ')
  const tier: RoadTier = road.endsWith('길') ? 'gil' : road.endsWith('대로') ? 'daero' : 'ro'
  // 모도로 역산 — 기초번호식(`중앙대로123번길`)과 일련번호식(`사직로8길`), `5가길` 변형까지 흡수한다.
  const branch = tier === 'gil' ? road.match(/^(.+?(?:대로|로))\s*\d+(?:번)?[가-힣]?길$/) : null
  const mainRoad = tier === 'gil' ? (branch ? branch[1].trim() : null) : road
  return { road, tier, mainRoad, bldNo: m[2] }
}

export function extractRegionFromAddress(address: string): {
  region_si: string
  region_myeon: string
  region_ri: string
} {
  const empty = { region_si: '', region_myeon: '', region_ri: '' }
  if (!address) return empty

  const tokens = address.trim().split(/\s+/)
  let i = 0

  // 1) 시/도 건너뜀 (도·특별시·광역시·특별자치시·특별자치도)
  if (i < tokens.length) {
    const t = tokens[i]
    if (/도$/.test(t) || /특별시$/.test(t) || /광역시$/.test(t) || /특별자치/.test(t)) {
      i++
    }
  }

  // 2) 시/군/구
  let region_si = ''
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.length >= 2 && /[시군구]$/.test(t)) {
      region_si = t
      i++
      break
    }
    i++
  }
  if (!region_si) return empty

  // 3) 읍/면/동
  let region_myeon = ''
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^\d/.test(t)) break
    if (t.length >= 2 && /[읍면동]$/.test(t)) {
      region_myeon = t
      i++
      break
    }
    i++
  }

  // 4) 리 (지번 주소에만 존재, 도로명 주소에는 없음)
  let region_ri = ''
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^\d/.test(t)) break
    if (t.length >= 2 && /리$/.test(t)) {
      region_ri = t
      break
    }
    i++
  }

  return { region_si, region_myeon, region_ri }
}
