/** 공휴일 원천 (소방계획서_25 S-2·S-4) — 2층 구조.
 *
 *  **B(주 경로)** 공공데이터포털 한국천문연구원 특일 정보 API — 대체공휴일·임시공휴일·선거일이
 *    이미 확정돼 내려온다. 판정 로직이 필요 없다.
 *  **A(폴백)** date-holidays + `holiday-rules.ts`의 제3조 산출 — API 장애·미설정 시에만 쓴다.
 *    임시공휴일·선거일은 **원리상 못 잡는다**(제2조 제10의2·11호). 그 범주는 수동 등록(C)이 담당한다.
 *
 *  폴백은 **반드시 note로 표면화**한다 — 조용한 폴백은 "왜 값이 달라졌는지"를 숨긴다
 *  (선례: `api/cron/law-revision-check/route.ts`의 ocNote).
 *
 *  2026-08-18 실측: 특일 정보 API 응답이 A안의 과다 4건·누락 6건을 전부 정확히 맞힌다.
 *  A안을 남기는 것은 정확도 때문이 아니라 **외부 장애 시에도 시스템이 서게 하기 위해서**다.
 */
import {
  clauseOf, computeSubstitutes, flatten, isActiveHoliday, mergeByDate,
  type BaseHoliday,
} from './holiday-rules'

export type HolidaySource = 'api' | 'library' | 'manual'
export type ResolvedHoliday = { date: string; name: string }

export type ProviderResult =
  | { ok: true; source: 'api' | 'library'; holidays: ResolvedHoliday[] }
  /** 키 미설정·활용신청 미승인(403) 등 — '못 쓰는 상태'다. 폴백 신호이며 장애가 아니다 */
  | { ok: false; unavailable: true; reason: string }
  /** 실제 장애(네트워크·응답 이상) — 폴백하되 note에 남긴다 */
  | { ok: false; unavailable?: false; error: string }

/* ══════════════ B — 공공데이터포털 특일 정보 ══════════════ */

const OPEN_API_URL =
  'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'

/** data.go.kr 계정 인증키. 건축물대장과 **같은 키**를 쓴다(계정 단위 발급).
 *  의미가 넓어졌으므로 DATA_GO_KR_API_KEY를 우선 보되, 기존 키로도 그대로 동작하게 둔다. */
function dataGoKrKey(): string | undefined {
  return process.env.DATA_GO_KR_API_KEY || process.env.BUILDING_LEDGER_API_KEY
}

type SpcdeItem = { locdate?: number | string; dateName?: string; isHoliday?: string }

/** 'YYYYMMDD'(숫자 또는 문자) → 'YYYY-MM-DD'. 형식이 아니면 null */
function locdateToISO(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{8}$/.test(s)) return null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

export async function fetchHolidaysFromOpenApi(year: number): Promise<ProviderResult> {
  const key = dataGoKrKey()
  if (!key) return { ok: false, unavailable: true, reason: 'DATA_GO_KR_API_KEY(또는 BUILDING_LEDGER_API_KEY) 미설정' }

  const url = new URL(OPEN_API_URL)
  url.searchParams.set('serviceKey', key)   // Decoding 키를 넣는다 — searchParams가 인코딩한다
  url.searchParams.set('solYear', String(year))
  url.searchParams.set('numOfRows', '100')  // 연 최대 30건 내외 — 100이면 한 페이지에 다 온다
  url.searchParams.set('_type', 'json')

  try {
    const res = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
    // 403 = 해당 서비스 활용신청 미승인. 키 자체는 유효할 수 있으므로 '장애'가 아니라 '못 쓰는 상태'로 본다
    if (res.status === 401 || res.status === 403) {
      return { ok: false, unavailable: true, reason: `특일 정보 API 접근 거부(HTTP ${res.status}) — 활용신청 승인 여부 확인 필요` }
    }
    if (!res.ok) return { ok: false, error: `특일 정보 API 오류 (HTTP ${res.status})` }

    const json = await res.json() as {
      response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: unknown } } }
    }
    const code = json.response?.header?.resultCode
    if (code !== '00') {
      return { ok: false, error: `특일 정보 API: ${json.response?.header?.resultMsg ?? `resultCode=${code}`}` }
    }

    // items.item은 0건이면 빈 문자열, 1건이면 객체, 여러 건이면 배열로 온다(공공데이터포털 공통)
    const raw = json.response?.body?.items?.item
    const list = (Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []) as SpcdeItem[]

    const rows: Array<{ date: string; name: string }> = []
    for (const it of list) {
      if (String(it.isHoliday ?? '').trim().toUpperCase() !== 'Y') continue   // 기념일·절기 제외
      const date = locdateToISO(it.locdate)
      const name = String(it.dateName ?? '').trim()
      if (!date || !name) continue
      rows.push({ date, name })
    }
    if (rows.length === 0) return { ok: false, error: `특일 정보 API가 ${year}년 공휴일을 0건 반환` }

    // 같은 날 2행(2025-05-05 어린이날/부처님오신날)을 '·'로 합친다. 대체공휴일은 API가 이미 준다
    return { ok: true, source: 'api', holidays: flatten(mergeByDate(rows)) }
  } catch (e) {
    return { ok: false, error: `특일 정보 API 호출 실패: ${(e as Error).message.slice(0, 120)}` }
  }
}

/* ══════════════ A — date-holidays + 제3조 산출 (폴백) ══════════════ */

/** date-holidays가 주는 한 항목 */
export type LibRawHoliday = { date: string; name: string; type: string; start: string; end: string; rule?: string }

const DAY = 24 * 60 * 60 * 1000
const KST = 9 * 60 * 60 * 1000

/** raw 주입형 **순수** 함수 — 라이브러리 없이 fixture로 회귀 검증할 수 있다.
 *  ① 연휴(P3D)는 start~end를 날짜별로 펼친다
 *  ② 설날 라이브러리 버그 보정: rule이 당일(1/1)부터 3일이지만 한국법은 전날(12/30)부터 3일
 *  ③ 노동절 주입 — 라이브러리가 제공하지 않는다(2026-05-01 시행, 대통령령 제36290호)
 *  ④ 그 해에 유효하지 않은 공휴일 제외(제헌절 2008~2025 등)
 *  ⑤ 같은 날 겹침은 **버리지 않고 합친다** — 제3조①3호 판정의 전제 */
export function normalizeLibraryHolidays(raw: LibRawHoliday[], year: number): BaseHoliday[] {
  const rows: Array<{ date: string; name: string }> = []

  for (const h of raw) {
    if (h.type !== 'public') continue
    let startMs = new Date(h.start).getTime() + KST
    let endMs = new Date(h.end).getTime() + KST
    if (h.rule?.includes('01-0-01') && h.rule?.includes('P3D')) { startMs -= DAY; endMs -= DAY }

    for (let cur = startMs; cur < endMs; cur += DAY) {
      const d = new Date(cur)
      const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
      rows.push({ date: iso, name: h.name })
    }
  }

  rows.push({ date: `${year}-05-01`, name: '노동절' })   // ③ — ④의 연도 게이트가 걸러 준다

  const active = rows.filter(r => isActiveHoliday(r.name, year))
  return mergeByDate(active.map(r => ({ ...r, clause: clauseOf(r.name) })))
}

export async function fetchHolidaysFromLibrary(year: number): Promise<ProviderResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Holidays = require('date-holidays')
    const hd = new Holidays('KR')
    hd.setLanguages('ko')
    const raw = hd.getHolidays(year) as LibRawHoliday[]

    const base = normalizeLibraryHolidays(raw, year)
    const merged = mergeByDate([
      ...base.flatMap(b => b.names.map(n => ({ date: b.date, name: n }))),
      ...computeSubstitutes(base).flatMap(b => b.names.map(n => ({ date: b.date, name: n }))),
    ])
    return { ok: true, source: 'library', holidays: flatten(merged) }
  } catch (e) {
    return { ok: false, error: `공휴일 라이브러리 오류: ${(e as Error).message.slice(0, 120)}` }
  }
}

/* ══════════════ 오케스트레이터 ══════════════ */

/** 실패한 ProviderResult에서 사람이 읽을 사유를 꺼낸다 — 미설정(unavailable)과 장애(error)를 한 줄로 */
function failReason(r: Extract<ProviderResult, { ok: false }>): string {
  return 'reason' in r ? r.reason : r.error
}

/** B를 먼저 쓰고, 못 쓰면 A로 내려간다. **폴백 사유는 note로 반드시 남긴다.** */
export async function resolveHolidays(year: number): Promise<{
  holidays: ResolvedHoliday[]; source: 'api' | 'library'; note?: string
}> {
  const api = await fetchHolidaysFromOpenApi(year)
  if (api.ok) return { holidays: api.holidays, source: 'api' }

  const reason = failReason(api)
  const lib = await fetchHolidaysFromLibrary(year)
  if (lib.ok) {
    return {
      holidays: lib.holidays,
      source: 'library',
      note: `특일 정보 API를 쓰지 못해 라이브러리로 대체했습니다 — ${reason}. `
        + '임시공휴일·선거일은 이 경로로 채워지지 않으니 공휴일 관리에서 수동 등록해주세요.',
    }
  }
  // 둘 다 실패 — 빈 결과를 돌려주면 동기화가 기존 공휴일을 전부 지운다. 던져서 멈춘다
  throw new Error(`공휴일을 가져오지 못했습니다 — API: ${reason} / 라이브러리: ${failReason(lib)}`)
}

/** 종전 시그니처 유지 — 기존 호출부가 그대로 동작한다 */
export async function getKoreanHolidays(year: number): Promise<Array<{ date: string; name: string }>> {
  const { holidays } = await resolveHolidays(year)
  return holidays
}
