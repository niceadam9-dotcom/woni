import type { SupabaseClient } from '@supabase/supabase-js'
import { extractRegionFromAddress } from '@/lib/address-parser'

/** 관할 소방서 자동 지정 (소방계획서_11.md D-3 — 2026-08-07 사용자 지시:
 *  "주소가 저장되면 자동으로 관할 소방서가 지정되게 하고 비어 있지 않도록")
 *
 *  종전에는 주소 원클릭 입력(quickAddressApplyAction)에서 읍/면 정확 매핑 1회만 시도했고,
 *  region_fire_stations(065)에 없는 지역이면 그냥 공란으로 남았다. 서식 1.3·별지 서식이 모두
 *  관할 소방서를 인쇄하므로 공란은 그대로 문서 공란이 된다.
 *
 *  4단계로 내려가며 반드시 값을 만든다. 마지막 단계는 **추정**이므로 source로 구분해
 *  화면에서 '확인 필요'를 표시할 수 있게 한다(추정을 조용히 확정하지 않는다).
 *    1) region  — 읍/면/동 접미사 제거 + 시/군 일치 (가장 정확)
 *    2) region  — 시/군 없이 지역명만 일치 (시/군 표기 흔들림 흡수)
 *    3) sigungu — 같은 시/군의 다른 읍/면 행에서 소방서명 차용 (관내 단일 소방서 전제)
 *    4) estimate— 시/군명 + '소방서' 규칙 조합 (065 시드가 따르는 실제 명명 규칙)
 */
export type FireStationSource = 'region' | 'region_only' | 'sigungu' | 'estimate'

export async function resolveFireStation(
  admin: SupabaseClient,
  input: { regionMyeon?: string | null; regionSi?: string | null; address?: string | null },
): Promise<{ station: string; source: FireStationSource } | null> {
  // 지역값이 안 넘어오면 주소 문자열에서 뽑는다(수기 주소 입력 경로 대응)
  const fromAddr = input.address ? extractRegionFromAddress(input.address) : null
  const regionMyeon = (input.regionMyeon || fromAddr?.region_myeon || '').trim()
  const regionSi = (input.regionSi || fromAddr?.region_si || '').trim()
  const regionKey = regionMyeon.replace(/(읍|면|동)$/, '')

  if (regionKey && regionSi) {
    const { data } = await admin.from('region_fire_stations')
      .select('fire_station').eq('region_si', regionSi).eq('region', regionKey).maybeSingle()
    const s = (data as { fire_station: string } | null)?.fire_station
    if (s) return { station: s, source: 'region' }
  }
  if (regionKey) {
    const { data } = await admin.from('region_fire_stations')
      .select('fire_station').eq('region', regionKey).limit(1).maybeSingle()
    const s = (data as { fire_station: string } | null)?.fire_station
    if (s) return { station: s, source: 'region_only' }
  }
  if (regionSi) {
    const { data } = await admin.from('region_fire_stations')
      .select('fire_station').eq('region_si', regionSi).limit(1).maybeSingle()
    const s = (data as { fire_station: string } | null)?.fire_station
    if (s) return { station: s, source: 'sigungu' }
    // 4) 추정 — '양평군' → '양평소방서'. 구(區)는 소방서 관할이 구 단위가 아닌 경우가 많아 제외한다.
    if (/[시군]$/.test(regionSi)) {
      return { station: `${regionSi.replace(/[시군]$/, '')}소방서`, source: 'estimate' }
    }
  }
  return null
}
