/** 사업자번호·전화번호 표시 정규화 — 입력·저장·표시 어디서든 같은 규칙 (본사정보·거래처·관계인 공통).
 *  판별 불가한 값(자릿수 불일치·내선 표기 등)은 훼손하지 않고 원문을 그대로 돌려준다. */

/** 사업자등록번호 — 10자리면 000-00-00000, 아니면 원문 유지 */
export function formatBizNo(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (/[^\d\s.\-]/.test(s)) return s
  const d = s.replace(/\D/g, '')
  if (d.length !== 10) return s
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
}

/** 사업자등록번호 입력 중 자동 하이픈 — 자릿수 미달 상태도 진행형으로 표기 */
export function formatBizNoKR(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10)
  if (d.length < 4) return d
  if (d.length < 6) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
}

/** 전화·팩스·휴대전화 — 02 지역·전국 대표번호(15xx/16xx/18xx)·10/11자리 공통 하이픈.
 *  '~8'(연번)·'(교환)' 같은 부가 표기가 섞인 값은 재구성하면 정보가 유실되므로 원문 유지 */
export function formatTel(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (/[^\d\s.\-]/.test(s)) return s
  const d = s.replace(/\D/g, '')
  if (d.length === 8 && /^1[568]/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`
  if (d.startsWith('02')) {
    if (d.length === 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`
    return s
  }
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
  return s
}
