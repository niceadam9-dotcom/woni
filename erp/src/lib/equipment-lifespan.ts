/** 설비 대장 — 품목 규칙·만료 판정 (순수 모듈, 서버·클라이언트·테스트 공용) (통합계획 C3, 2026-10-02)
 *
 *  근거(비교진단 「설비 자산 대장 해결방안」 절 표):
 *   · 분말소화기  법정 내용연수 10년(소방시설법 17조·시행령 19조) — 성능확인 합격 시 연장(extension_until)
 *   · 자동확산소화기·완강기  권장 10년 / 소방호스·연기감지기  권장 15년(소방청 노후 소방용품 관리대책 2026-07-01)
 *   · 가스계 저장용기·펌프·기타 소화기  연수 판정 없음(용기는 재검사·약제량 측정으로, 펌프는 명판으로)
 *  ⚠ 성능확인 연장 연수(2022 개정 3년/1년)는 조문 원문 미대조 — 상수로 박지 않고 사람이 extension_until을 적는다. */

export type EquipmentCategory = 'powder' | 'other_ext' | 'auto_diffuse' | 'descender' | 'hose' | 'smoke_detector' | 'gas_cylinder' | 'pump'
export type LifespanRule = 'legal10' | 'rec10' | 'rec15' | 'none'

export const CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  powder: '분말소화기', other_ext: '기타 소화기', auto_diffuse: '자동확산소화기', descender: '완강기',
  hose: '소방호스', smoke_detector: '연기감지기', gas_cylinder: '가스계 저장용기', pump: '펌프',
}
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as EquipmentCategory[]

/** 품목 → 기본 연수 규칙(행마다 바꿀 수 있다) */
export const DEFAULT_RULE: Record<EquipmentCategory, LifespanRule> = {
  powder: 'legal10', other_ext: 'none', auto_diffuse: 'rec10', descender: 'rec10',
  hose: 'rec15', smoke_detector: 'rec15', gas_cylinder: 'none', pump: 'none',
}
export const RULE_YEARS: Record<LifespanRule, number | null> = { legal10: 10, rec10: 10, rec15: 15, none: null }
export const RULE_LABEL: Record<LifespanRule, string> = { legal10: '법정 10년', rec10: '권장 10년', rec15: '권장 15년', none: '연수 없음' }

/** 'YYYY-MM' 또는 'YYYY-MM-DD' → 그 달 1일 'YYYY-MM-01'. 형식이 아니면 null */
export function normalizeYm(v: string | null | undefined): string | null {
  const m = /^(\d{4})[-./]?(\d{1,2})(?:[-./]\d{1,2})?$/.exec((v ?? '').trim())
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2])
  if (y < 1980 || y > 2100 || mo < 1 || mo > 12) return null
  return `${y}-${String(mo).padStart(2, '0')}-01`
}

/** 만료일(YYYY-MM-DD) — 연장값이 있으면 그것, 없으면 제조연월 + 연수(그 달 1일 기준). 판정 불가면 null */
export function expiryOf(a: { manufactured_on: string | null; lifespan_rule: LifespanRule; extension_until?: string | null }): string | null {
  if (a.extension_until) return a.extension_until.slice(0, 10)
  const years = RULE_YEARS[a.lifespan_rule]
  if (!years || !a.manufactured_on) return null
  const [y, m] = a.manufactured_on.slice(0, 10).split('-').map(Number)
  return `${y + years}-${String(m).padStart(2, '0')}-01`
}

export type ExpiryState = 'expired' | 'soon' | 'ok' | 'unknown' | 'none'

/** 상태 — 법정·권장 규칙 없음은 'none', 제조연월 미입력은 'unknown', 오늘 이후 soonDays 안이면 'soon' */
export function expiryState(a: { manufactured_on: string | null; lifespan_rule: LifespanRule; extension_until?: string | null }, todayISO: string, soonDays = 365): ExpiryState {
  if (a.lifespan_rule === 'none' && !a.extension_until) return 'none'
  const exp = expiryOf(a)
  if (!exp) return 'unknown'
  if (exp <= todayISO) return 'expired'
  const t = new Date(`${todayISO}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + soonDays)
  return exp <= t.toISOString().slice(0, 10) ? 'soon' : 'ok'
}

/** 묶음 행 집계 — 수량 가중(행 수가 아니라 대수) */
export function tallyAssets<T extends { qty: number; manufactured_on: string | null; lifespan_rule: LifespanRule; extension_until?: string | null; status?: string }>(rows: ReadonlyArray<T>, todayISO: string) {
  let total = 0, expired = 0, soon = 0, extended = 0, unknown = 0
  for (const r of rows) {
    if (r.status && r.status !== 'in_use') continue
    total += r.qty
    const s = expiryState(r, todayISO)
    if (s === 'expired') expired += r.qty
    else if (s === 'soon') soon += r.qty
    else if (s === 'unknown') unknown += r.qty
    if (r.extension_until) extended += r.qty
  }
  return { total, expired, soon, extended, unknown }
}

/** 불량 내역 자동 문장 — 「내용연수 경과 분말소화기 6대: 3층 4대(2015-03), 지하1층 2대(2014-11)」 */
export function expiredSentence<T extends { qty: number; category: EquipmentCategory; location: string | null; manufactured_on: string | null; lifespan_rule: LifespanRule; extension_until?: string | null; status?: string }>(rows: ReadonlyArray<T>, category: EquipmentCategory, todayISO: string): string | null {
  const hit = rows.filter(r => r.category === category && (!r.status || r.status === 'in_use') && expiryState(r, todayISO) === 'expired')
  if (!hit.length) return null
  const n = hit.reduce((s, r) => s + r.qty, 0)
  const parts = hit.map(r => `${r.location?.trim() || '위치 미기재'} ${r.qty}대${r.manufactured_on ? `(${r.manufactured_on.slice(0, 7)})` : ''}`)
  const label = RULE_YEARS[hit[0].lifespan_rule] ? '내용연수 경과' : '연장 만료'
  return `${label} ${CATEGORY_LABEL[category]} ${n}대: ${parts.join(', ')}`
}

/** 공사 하자보수 기간(소방시설공사업법 시행령 6조) — 대장 품목이 속한 설비 분류로(C3 2단계).
 *  2년: 피난기구(완강기) / 3년: 옥내소화전(호스)·자동화재탐지(연기감지기)·물분무등(가스계)·펌프(소화설비).
 *  소화기구(분말·기타·자동확산 소화기)는 시공 대상 설비가 아니라 null — 사람이 만료일을 직접 적을 수는 있다. */
export const WARRANTY_YEARS: Record<EquipmentCategory, number | null> = {
  powder: null, other_ext: null, auto_diffuse: null, descender: 2,
  hose: 3, smoke_detector: 3, gas_cylinder: 3, pump: 3,
}

/** 완공일 + 품목 하자보수 연수 → 만료일(전날이 아니라 같은 날짜, 단순 연 가산). 연수 없는 품목·형식 오류는 null */
export function warrantyUntilOf(category: EquipmentCategory, completedOn: string | null | undefined): string | null {
  const y = WARRANTY_YEARS[category]
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(completedOn ?? '')
  if (!y || !m) return null
  return `${Number(m[1]) + y}-${m[2]}-${m[3] === '29' && m[2] === '02' ? '28' : m[3]}`
}
