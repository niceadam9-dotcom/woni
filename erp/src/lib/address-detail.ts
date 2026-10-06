/**
 * 주소 칸 글자를 **검색어 본체**와 **덧붙인 상세(동/호수 등)**로 가른다 (2026-10-06 사용자 요청:
 * 「직접 입력한 후 주소검색하면 바로 주소입력이 되게 — 다시 입력할 필요 없이」).
 *
 * 본체 = 마지막 「○○로/○○길 + 건물번호」까지. 그 뒤가 상세다.
 *   「서울 중구 세종대로 110 3층 302호」 → 본체 「서울 중구 세종대로 110」 · 상세 「3층 302호」
 *   「양평군 지평면 지평의병로 123-4, 101동」 → 본체 「… 지평의병로 123-4」 · 상세 「101동」
 * 도로명 꼴이 없으면(지번 주소·건물명만 등) 전체를 본체로 둔다 — 지어내지 않는다.
 *
 * ⚠ 본체는 검색창에 넣을 글자다 — 「3층」이 섞이면 Daum 검색이 0건이 된다.
 * ⚠ 상세는 결과를 고른 뒤 도로명 뒤에 다시 붙인다 — 검색이 상세를 지우지 않게.
 */
export function splitAddressDetail(text: string): { base: string; detail: string } {
  const s = (text ?? '').trim()
  // 「…로 110」「…길 12-3」「…로12번길 7」 — 도로명 끝(로|길) 뒤 건물번호. 가장 마지막 것을 본체 끝으로 본다.
  const re = /[가-힣A-Za-z0-9.·]+(?:로|길)\s*\d+(?:-\d+)?(?=$|[\s,(])/g
  let end = -1
  for (let m = re.exec(s); m; m = re.exec(s)) end = m.index + m[0].length
  if (end < 0) return { base: s, detail: '' }
  const detail = s.slice(end).replace(/^[\s,]+/, '').trim()
  return { base: s.slice(0, end).trim(), detail }
}

/** 검색으로 고른 도로명 뒤에 상세를 붙인다 — 상세가 없으면 도로명 그대로 */
export function joinAddressDetail(road: string, detail: string): string {
  const d = (detail ?? '').trim()
  return d ? `${road.trim()} ${d}` : road.trim()
}
