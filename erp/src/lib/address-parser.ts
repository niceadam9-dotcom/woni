/**
 * 한국 주소 문자열에서 시/군/구, 읍/면/동, 리 추출
 *
 * 예) "경기도 양평군 양평읍 양평리 500"
 *   → { region_si: "양평군", region_myeon: "양평읍", region_ri: "양평리" }
 *
 * 예) "경기도 양평군 양평읍 어딘가로 123 (도로명 주소)"
 *   → { region_si: "양평군", region_myeon: "양평읍", region_ri: "" }
 */
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
