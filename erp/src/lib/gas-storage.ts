/** 가스계 「※ 약제저장량 점검리스트」 — 손실률 판정 (순수, 통합계획 C3 1단계, 2026-10-02)
 *  서식(별지 4호 CO2-4·할3 시트): 설치위치 / 용기 No. / 실내온도(℃) / 약제높이(cm) / 충전량(kg) / 손실량(kg) / 점검결과 / 비고
 *  판정: 「약제량 손실 5% 초과 시 불량」(서식 문구). 손실량 = 기준 충전량 − 측정 충전량. */

export const GAS_ITEM_CODES = new Set(['9-B-001', '11-B-001'])  // CO2 / 할론 「소화약제 저장량 적정 여부」
export const LOSS_LIMIT = 0.05

export type GasMeasure = {
  assetId: string
  cylNo: number
  location: string | null
  tempC: number | null
  heightCm: number | null
  chargeKg: number | null      // 측정 충전량
  nominalKg: number | null     // 기준(정격) 충전량
}

export function lossOf(m: Pick<GasMeasure, 'chargeKg' | 'nominalKg'>): { lossKg: number | null; rate: number | null; result: '양호' | '불량' | null } {
  if (m.chargeKg == null || m.nominalKg == null || !(m.nominalKg > 0)) return { lossKg: null, rate: null, result: null }
  const lossKg = Math.round((m.nominalKg - m.chargeKg) * 100) / 100
  const rate = lossKg / m.nominalKg
  return { lossKg, rate, result: rate > LOSS_LIMIT ? '불량' : '양호' }
}

/** 숫자 칸 — 빈칸·문자는 null(0으로 바꾸지 않는다: 「안 잼」과 「0」이 다르다) */
export function numOrNull(v: unknown): number | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
