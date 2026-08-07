import type { SupabaseClient } from '@supabase/supabase-js'
import { extractRegionFromAddress } from '@/lib/address-parser'

/** 관할 소방서 자동 지정 (소방계획서_11.md D-3 — 2026-08-07 사용자 지시:
 *  "주소가 저장되면 자동으로 관할 소방서가 지정되게 하고 비어 있지 않도록")
 *
 *  종전에는 주소 원클릭 입력(quickAddressApplyAction)에서 읍/면 정확 매핑 1회만 시도했고,
 *  region_fire_stations(065)에 없는 지역이면 그냥 공란으로 남았다. 서식 1.3·별지 서식이 모두
 *  관할 소방서를 인쇄하므로 공란은 그대로 문서 공란이 된다.
 *
 *  3단계로 내려가며 값을 만든다. 마지막 단계는 **추정**이므로 source로 구분해
 *  화면에서 '확인 필요'를 표시할 수 있게 한다(추정을 조용히 확정하지 않는다).
 *    1) region  — 읍/면/동 접미사 제거 + 시/군 일치 (가장 정확)
 *    2) sigungu — 같은 시/군의 다른 읍/면 행에서 소방서명 차용 (관내 단일 소방서 전제)
 *    3) estimate— 시/군명 + '소방서' 규칙 조합 (065 시드가 따르는 실제 명명 규칙)
 *
 *  ⚠ 한계(독립검증 2026-08-07): 주소에서 **시/군을 못 얻으면 null**이다(광역시 구 단위 주소 등).
 *     또 2단계는 시/군에 소방서가 여러 개면 틀릴 수 있다(성남시 수정·중원구 → 분당소방서).
 *     근본 해법은 C-2(공공데이터로 region_fire_stations 전국 확장) — 그때 3단계를 제거한다.
 */
export type FireStationSource = 'region' | 'sigungu' | 'estimate'

/** Daum 우편번호 위젯의 sigungu는 `"성남시 분당구"` 형태이고, 주소 파서는 서울을 `"영등포구"`로 뽑는다.
 *  소방서는 시·군 단위 조직이므로 **구(區)를 떼고 상위 시**를 얻어야 조회가 맞는다.
 *  BLK-3(독립검증): 이 절삭이 없어 구 소재 고객은 4단계가 전부 불발하고 공란으로 남았다.
 *    "성남시 분당구" → "성남시"  /  "영등포구" → ""(광역시 정보 없음 — 상위 폴백 불가)  */
function toSiGun(regionSi: string): string {
  const tokens = regionSi.trim().split(/\s+/)
  const siGun = tokens.find(t => /[시군]$/.test(t))
  return siGun ?? ''
}

export async function resolveFireStation(
  admin: SupabaseClient,
  input: { regionMyeon?: string | null; regionSi?: string | null; address?: string | null },
): Promise<{ station: string; source: FireStationSource } | null> {
  // 지역값이 안 넘어오면 주소 문자열에서 뽑는다(수기 주소 입력 경로 대응)
  const fromAddr = input.address ? extractRegionFromAddress(input.address) : null
  const regionMyeon = (input.regionMyeon || fromAddr?.region_myeon || '').trim()
  const rawSi = (input.regionSi || fromAddr?.region_si || '').trim()
  const regionSi = toSiGun(rawSi)
  const regionKey = regionMyeon.replace(/(읍|면|동)$/, '')

  if (regionKey && regionSi) {
    const { data } = await admin.from('region_fire_stations')
      .select('fire_station').eq('region_si', regionSi).eq('region', regionKey).maybeSingle()
    const s = (data as { fire_station: string } | null)?.fire_station
    if (s) return { station: s, source: 'region' }
  }
  // ⚠ 종전 2단계('시/군을 버리고 지역명만으로 조회')는 **삭제했다**.
  //   065의 region은 PK라 전국 단일 키이므로, 충북 옥천군 옥천읍 → '양평소방서',
  //   서울 종로구 청운동 → '양평소방서' 같은 조용한 오매핑을 만들었다(독립검증 지적).
  //   source가 'region_only'라 추정 배지 대상도 아니어서 estimate보다 위험했다.
  if (regionSi) {
    const { data } = await admin.from('region_fire_stations')
      .select('fire_station').eq('region_si', regionSi).limit(1).maybeSingle()
    const s = (data as { fire_station: string } | null)?.fire_station
    if (s) return { station: s, source: 'sigungu' }
    // 3) 추정 — '양평군' → '양평소방서'.
    return { station: `${regionSi.replace(/[시군]$/, '')}소방서`, source: 'estimate' }
  }
  return null
}
