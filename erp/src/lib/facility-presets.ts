/** 용도별 소방시설 기본 세트 (탭개편 설계 §6-E 건물·시설-2)
 *  코드는 facilities-client CATALOG의 명칭과 일치해야 한다.
 *  ⚠ 초안 매핑 — 실제 표준 조합은 사용자 확인 후 조정 (설계 §8 note). 적용은 '추가 체크'만 하며 기존 체크를 해제하지 않는다. */

const COMMON = ['소화기구', '자동화재탐지설비', '유도등·유도표지']

const SETS: Array<{ match: RegExp; label: string; items: string[] }> = [
  { match: /아파트|공동주택/, label: '공동주택형',
    items: [...COMMON, '옥내소화전', '스프링클러', '피난기구', '비상조명등', '비상방송설비'] },
  { match: /숙박|병원|의료|요양/, label: '숙박·의료형',
    items: [...COMMON, '옥내소화전', '스프링클러', '피난기구', '인명구조기구', '비상조명등', '비상방송설비', '자동화재속보설비'] },
  { match: /공장|창고/, label: '공장·창고형',
    items: [...COMMON, '옥내소화전', '옥외소화전', '비상경보설비'] },
  { match: /판매|근린|업무|교육/, label: '상가·업무형',
    items: [...COMMON, '옥내소화전', '비상조명등'] },
]

export function suggestFacilitySet(purpose: string | null): { label: string; items: string[] } | null {
  if (!purpose) return null
  const hit = SETS.find(s => s.match.test(purpose))
  if (hit) return { label: hit.label, items: hit.items }
  return { label: '기본형', items: COMMON }
}

/** §12-A(T12): 시설별 상세 '종류' 프리셋 — 칩 편집기용.
 *  저장 형식은 기존 detail 문자열("분말 12, CO2 2") 그대로 직렬화 — 목록에 없는 종류는 직접 입력 허용. */
export const DETAIL_TYPE_PRESETS: Record<string, string[]> = {
  '소화기구': ['분말', 'CO2', '강화액', '자동확산'],
  '옥내소화전': ['수량'],
  '옥외소화전': ['수량'],
  '스프링클러': ['헤드'],
  '간이스프링클러': ['헤드'],
  '자동화재탐지설비': ['감지기', '발신기', '수신기'],
  '유도등·유도표지': ['피난구', '통로', '객석', '유도표지'],
  '비상조명등': ['수량'],
  '피난기구': ['완강기', '구조대', '피난사다리'],
  '비상콘센트설비': ['수량'],
}

export type DetailChip = { kind: string; qty: number }

/** detail 문자열 → 칩 배열. "이름 숫자, 이름 숫자" 패턴이 아니면 null (자유 텍스트 폴백) */
export function parseDetailChips(s: string): DetailChip[] | null {
  const t = (s ?? '').trim()
  if (!t) return []
  const chips: DetailChip[] = []
  for (const part of t.split(',').map(p => p.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s+(\d+)$/)
    if (!m) return null
    chips.push({ kind: m[1], qty: parseInt(m[2], 10) })
  }
  return chips
}

export function serializeDetailChips(chips: DetailChip[]): string {
  return chips.map(c => `${c.kind} ${c.qty}`).join(', ')
}
