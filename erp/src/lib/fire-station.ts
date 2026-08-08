import type { SupabaseClient } from '@supabase/supabase-js'
import { extractRegionDetail } from '@/lib/address-parser'

/** 관할 소방서 자동 지정 (소방계획서_11.md D-3·§13-C)
 *
 *  종전 설계는 `region`(읍면동) 하나를 전국 단일 키로 쓰다가 오매핑을 냈고(독립검증 2026-08-07),
 *  자치구 단위로 갈리는 지역(서울 25개구, 성남 분당 vs 수정·중원)을 아예 표현하지 못했다.
 *  116 마이그레이션으로 (시/도, 시/군, 지역) 복합키 + `region_type`(emd/gu/sigun)이 생겼고,
 *  조회도 **좁은 범위 → 넓은 범위** 순으로 내려간다.
 *
 *    1) gu       — (시/군, 자치구)      예: 성남시 + 분당구
 *    2) gu_sido  — (시/도, 자치구)      예: 서울특별시 + 영등포구   ← 특별시·광역시
 *    3) emd      — (시/군, 읍면동)      예: 양평군 + 양평(읍)
 *    4) sigun    — (시/군) 전역 대표행
 *    5) estimate — 시/군명 + '소방서' 규칙 조합 (매핑이 없는 지역의 최후 폴백)
 *
 *  `estimate`만 추정이므로 화면에서 '확인 필요' 배지를 띄운다(C-1). 1~4는 실제 매핑이다.
 */
export type FireStationSource = 'gu' | 'gu_sido' | 'emd' | 'sigun' | 'estimate'

export type FireStationResult = { station: string; source: FireStationSource }

/** Daum 우편번호 위젯의 sigungu는 `"성남시 분당구"` 형태다 — 시/군과 구를 분리해 둘 다 쓴다 */
function splitSigungu(raw: string): { sigun: string; gu: string } {
  const tokens = (raw || '').trim().split(/\s+/)
  return {
    sigun: tokens.find(t => /[시군]$/.test(t)) ?? '',
    gu: tokens.find(t => /구$/.test(t)) ?? '',
  }
}

export async function resolveFireStation(
  admin: SupabaseClient,
  input: { regionMyeon?: string | null; regionSi?: string | null; address?: string | null },
): Promise<FireStationResult | null> {
  const fromAddr = input.address ? extractRegionDetail(input.address) : null
  const fromInput = splitSigungu(input.regionSi ?? '')
  const sido = fromAddr?.sido ?? ''
  const sigun = fromInput.sigun || fromAddr?.sigun || ''
  const gu = fromInput.gu || fromAddr?.gu || ''
  const emd = (input.regionMyeon || fromAddr?.emd || '').trim().replace(/(읍|면|동)$/, '')

  const lookup = async (regionSi: string, region: string): Promise<string | null> => {
    if (!regionSi || !region) return null
    const { data } = await admin.from('region_fire_stations')
      .select('fire_station').eq('region_si', regionSi).eq('region', region).limit(1).maybeSingle()
    return (data as { fire_station: string } | null)?.fire_station ?? null
  }

  // 1) 시/군 + 자치구 — 성남시 분당구처럼 한 시에 소방서가 여럿인 경우
  const byGu = await lookup(sigun, gu)
  if (byGu) return { station: byGu, source: 'gu' }

  // 2) 시/도 + 자치구 — 특별시·광역시는 시/군 토큰이 없다(서울 영등포구)
  const byGuSido = await lookup(sido, gu)
  if (byGuSido) return { station: byGuSido, source: 'gu_sido' }

  // 3) 시/군 + 읍면동
  const byEmd = await lookup(sigun, emd)
  if (byEmd) return { station: byEmd, source: 'emd' }

  // 4) 시/군 전역 대표행
  if (sigun) {
    const { data } = await admin.from('region_fire_stations')
      .select('fire_station').eq('region_si', sigun).eq('region_type', 'sigun').limit(1).maybeSingle()
    const s = (data as { fire_station: string } | null)?.fire_station
    if (s) return { station: s, source: 'sigun' }
  }

  // 5) 추정 — '양평군' → '양평소방서'. 매핑이 없는 지역의 최후 폴백이라 배지로 확인을 요구한다.
  //    ⚠ 자치구만 있는 주소(서울 등)는 여기서도 값을 못 만든다 — 매핑 확충이 유일한 해법.
  if (sigun) return { station: `${sigun.replace(/[시군]$/, '')}소방서`, source: 'estimate' }
  return null
}

/** 1.3 관할 소방서 드롭다운 후보 — 관할은 행정구역 기준이므로 좌표 근접이 아니라 매핑 테이블에서 뽑는다.
 *  [같은 시/군 소방서] → [같은 시/군 119안전센터·지역대 "본서 (센터)" — 고객 읍면동 일치 우선] →
 *  [같은 시/도 나머지 소방서] 순. 특별시·광역시는 시/군 토큰이 없어 시/도 전체(구 단위 매핑)가 곧 근접 범위다.
 *  센터는 fire_station_centers(117)에 시드된 시/군만 나온다 — 전국 수록이 아니다. */
export async function listFireStationCandidates(
  admin: SupabaseClient,
  input: { regionSi?: string | null; regionMyeon?: string | null; address?: string | null },
): Promise<string[]> {
  const fromAddr = input.address ? extractRegionDetail(input.address) : null
  const fromInput = splitSigungu(input.regionSi ?? '')
  const sido = fromAddr?.sido ?? ''
  const sigun = fromInput.sigun || fromAddr?.sigun || ''
  if (!sido && !sigun) return []
  const emd = (input.regionMyeon || fromAddr?.emd || '').trim().replace(/(읍|면|동)$/, '')

  const conds = [
    sido && `region_sido.eq.${sido}`,
    sido && `region_si.eq.${sido}`,      // 특별시·광역시는 region_si에 시/도명이 들어있다 (116)
    sigun && `region_si.eq.${sigun}`,
  ].filter(Boolean) as string[]
  const nearKey = sigun || sido           // 센터는 근접 범위(같은 시/군)만 노출
  const [stRes, ctRes] = await Promise.all([
    admin.from('region_fire_stations').select('fire_station, region_si').or(conds.join(',')),
    admin.from('fire_station_centers').select('center, station, emds').eq('region_si', nearKey),
  ])
  const rows = (stRes.data ?? []) as Array<{ fire_station: string; region_si: string }>
  const centers = (ctRes.data ?? []) as Array<{ center: string; station: string; emds: string[] | null }>

  const near = new Set<string>()
  const wide = new Set<string>()
  for (const r of rows) {
    const isNear = sigun ? r.region_si === sigun : r.region_si === sido
    ;(isNear ? near : wide).add(r.fire_station)
  }
  const ko = (a: string, b: string) => a.localeCompare(b, 'ko')
  // 고객 읍면동 관할 센터(emds 일치, 폴백: 센터명이 지명으로 시작)를 맨 앞에
  // 센터명 폴백은 2자 이상만 — 남면/서면/내면의 한 글자 스템('서')이 '서석119안전센터'를 오매칭한다
  const isMine = (c: { center: string; emds: string[] | null }) =>
    !!emd && ((c.emds ?? []).includes(emd) || (emd.length >= 2 && c.center.startsWith(emd)))
  const centerLabels = [...centers]
    .sort((a, b) => (isMine(b) ? 1 : 0) - (isMine(a) ? 1 : 0) || ko(a.center, b.center))
    .map(c => `${c.station} (${c.center})`)
  return [...[...near].sort(ko), ...centerLabels, ...[...wide].filter(st => !near.has(st)).sort(ko)]
}
