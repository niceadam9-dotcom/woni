/** 한글 초성 검색 유틸 (소방계획서_5 R0-5, 4-0-13-(1)) — ㅅㄹㅅ → 서림사.
 *  검색 입력 공용: 보고서 센터 검색·Ctrl+K 팔레트 등. 클라이언트/서버 공용 순수 함수. */

const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const

/** 문자열의 초성 시퀀스 (한글 음절만 변환, 나머지는 그대로) */
export function choseongOf(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    if (code >= 0xac00 && code <= 0xd7a3) out += CHOSEONG[Math.floor((code - 0xac00) / 588)]
    else out += ch
  }
  return out
}

/** 부분 일치 — 일반 substring(대소문자 무시) 또는 전체 초성 질의(ㄱ-ㅎ만) 시 초성 매칭 */
export function hangulMatch(text: string, query: string): boolean {
  const q = query.replace(/\s/g, '')
  if (!q) return false
  const t = text.replace(/\s/g, '')
  if (t.toLowerCase().includes(q.toLowerCase())) return true
  if (/^[ㄱ-ㅎ]+$/.test(q)) return choseongOf(t).includes(q)
  return false
}
