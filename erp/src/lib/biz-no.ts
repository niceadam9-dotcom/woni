/** 사업자등록번호·세금계산서 이메일 검증 — 서버 액션과 화면이 **같은 함수**를 쓴다(B2, 2026-10-02).
 *  종전엔 체크섬이 `billing-client.tsx`('use client') 안에만 있어 서버가 부를 수 없었고, 그래서 저장이 검증 없이 통과했다
 *  (실측: 활성 고객 309/4명 중 사업자번호 입력 0 — 입력이 시작되면 이 관문이 첫 품질 장치다). */

/** 숫자만 10자리 — 홈택스 엑셀은 하이픈 없는 10자리를 받는다 */
export function bizNoDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '')
}

/** 000-00-00000 */
export function formatBizNoDash(v: string | null | undefined): string {
  const d = bizNoDigits(v).slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
}

/** 국세청 10자리 체크섬. 10자리가 아니면 null(아직 판정 불가) */
export function isValidBizNo(v: string | null | undefined): boolean | null {
  const d = bizNoDigits(v)
  if (d.length !== 10) return null
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i]
  sum += Math.floor((Number(d[8]) * 5) / 10)
  return (10 - (sum % 10)) % 10 === Number(d[9])
}

/** 세금계산서 수신 이메일 — 형식만 본다(실제 수신 여부는 모른다) */
export function isValidTaxEmail(v: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v ?? '').trim())
}

/** 홈택스 발급 가능 판정 — 공급받는자 사업자번호(체크섬 통과)와 수신 이메일이 둘 다 있어야 한다 */
export function billingProfileReady(p: { business_no?: string | null; tax_email?: string | null } | null | undefined): boolean {
  return !!p && isValidBizNo(p.business_no) === true && isValidTaxEmail(p.tax_email)
}
