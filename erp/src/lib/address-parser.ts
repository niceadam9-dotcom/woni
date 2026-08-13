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

/** 시/도 약칭 → 정식 명칭. 주소 문자열은 '경기 양평군'·'서울 중구'처럼 약칭이 흔하다 */
const SIDO_ALIASES: Record<string, string> = {
  '서울': '서울특별시', '부산': '부산광역시', '대구': '대구광역시', '인천': '인천광역시',
  '광주': '광주광역시', '대전': '대전광역시', '울산': '울산광역시', '세종': '세종특별자치시',
  '경기': '경기도', '강원': '강원특별자치도', '충북': '충청북도', '충남': '충청남도',
  '전북': '전북특별자치도', '전남': '전라남도', '경북': '경상북도', '경남': '경상남도',
  '제주': '제주특별자치도',
}

/**
 * 주소에서 행정구역 4단계를 분해한다 (소방계획서_11 C-2 — 관할 소방서 매핑 조회용).
 *
 * `extractRegionFromAddress`가 시/군·읍면·리만 뽑는 것과 달리 **시/도와 자치구를 따로** 준다.
 * 소방서는 시·군 단위이지만 특별시·광역시와 대도시(성남·수원 등)는 **자치구 단위로 갈리므로**
 * 구를 잃으면 매핑이 불가능하다(독립검증 2026-08-07: 서울 주소가 전부 공란이 되던 원인).
 *
 * 예) '서울특별시 영등포구 여의대로 24' → { sido:'서울특별시', sigun:'', gu:'영등포구', emd:'' }
 * 예) '경기 성남시 분당구 판교로 255'   → { sido:'경기도', sigun:'성남시', gu:'분당구', emd:'' }
 * 예) '경기 양평군 양평읍 경강로 2047'  → { sido:'경기도', sigun:'양평군', gu:'', emd:'양평읍' }
 */
export function extractRegionDetail(address: string): {
  sido: string; sigun: string; gu: string; emd: string
} {
  const empty = { sido: '', sigun: '', gu: '', emd: '' }
  if (!address) return empty
  const tokens = address.trim().split(/\s+/)
  let sido = ''
  let sigun = ''
  let gu = ''
  let emd = ''
  for (const t of tokens) {
    if (/^\d/.test(t)) break                       // 번지·건물번호부터는 행정구역이 아니다
    if (!sido) {
      if (SIDO_ALIASES[t]) { sido = SIDO_ALIASES[t]; continue }
      if (/(특별시|광역시|특별자치시|특별자치도)$/.test(t) || (/도$/.test(t) && t.length <= 4)) {
        sido = t
        continue
      }
    }
    if (!sigun && /[시군]$/.test(t) && t.length >= 2) { sigun = t; continue }
    if (!gu && /구$/.test(t) && t.length >= 2) { gu = t; continue }
    if (!emd && /[읍면동]$/.test(t) && t.length >= 2) { emd = t; continue }
  }
  return { sido, sigun, gu, emd }
}

/**
 * 주소 중복 판정용 정규화 키 — "행정구역 + 도로명 + 건물번호"까지만 남기고 뒤를 버린다.
 *
 * 등록 화면은 주소 검색 뒤 동/호수를 덧붙이도록 안내하므로(`주소 검색 후 동/호수 등 추가 입력`),
 * 같은 건물이라도 저장된 문자열이 갈린다. 완전일치만 보면 이 경우를 전부 놓치므로
 * **건물번호 뒤(동·호수·건물명)와 괄호 보충설명을 떼고**, 시/도 약칭을 정식 명칭으로 통일한 뒤 비교한다.
 *
 * 건물번호 = 도로명주소·지번주소 공통으로 행정구역 뒤 **첫 순수숫자 토큰**(하이픈 허용).
 * `256번길`·`72번길`처럼 숫자가 섞인 도로명 토큰은 순수숫자가 아니라 통과되어 도로명에 남는다.
 *
 * 예) '경기 양평군 중복검증로 77 101동 202호' → '경기도양평군중복검증로77'
 * 예) '경기도 양평군 중복검증로 77(양평빌딩)'  → '경기도양평군중복검증로77'
 * 예) '경기 성남시 분당구 판교로 256번길 12'   → '경기도성남시분당구판교로256번길12'
 *
 * 건물번호가 없는 주소는 잘라낼 기준이 없으므로 공백만 제거해 그대로 키로 쓴다(= 사실상 완전일치).
 */
export function addressDupKey(address: string): string {
  if (!address) return ''
  const cleaned = address.replace(/\([^)]*\)/g, ' ').trim()
  if (!cleaned) return ''
  const tokens = cleaned.split(/\s+/).map(t => SIDO_ALIASES[t] ?? t)
  const bldNoIdx = tokens.findIndex(t => /^\d+(-\d+)?$/.test(t))
  const kept = bldNoIdx >= 0 ? tokens.slice(0, bldNoIdx + 1) : tokens
  return kept.join('').replace(/\s+/g, '')
}

/** 두 주소가 같은 건물을 가리키는지 — 정규화 키 비교. 빈 주소는 항상 false */
export function isSameAddress(a: string, b: string): boolean {
  const ka = addressDupKey(a)
  return !!ka && ka === addressDupKey(b)
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
