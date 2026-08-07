/** NCP Directions 5 (자동차 길찾기) — 소방계획서_11.md §9 D-4′
 *
 *  용도: 관할 소방서 → 대상 건물의 실제 주행 경로를 받아 서식 1.3의 네 칸을 채운다.
 *    ① 거리(km)  ② 도착예상(분)  ③ 진입경로 서술 초안  ④ 진입 경로도 이미지(경로선 렌더)
 *
 *  인증 헤더는 Geocoding·Static Map과 동일(NCP_MAPS_CLIENT_ID / NCP_MAPS_CLIENT_SECRET)이지만
 *  **Directions 5는 콘솔에서 별도 활성화가 필요한 상품**이다. 미활성 상태에서는 401/403이 오므로
 *  건축물대장·지도 자동생성과 같은 `unavailable` 패턴으로 조용히 떨어뜨린다(기능 차단이 아니라 수기 입력 유지).
 *
 *  ⚠ 좌표 순서는 `경도,위도`다. 지오코딩 응답의 x=경도·y=위도와 같은 규약이며,
 *     뒤집으면 에러 없이 엉뚱한 경로가 나오므로 아래 isKoreanLngLat 가드로 막는다.
 */

const DIRECTIONS_URL = 'https://maps.apigw.ntruss.com/map-direction/v1/driving'

export type LngLat = [number, number]

export type FireRoute = {
  distanceM: number
  durationMs: number
  path: LngLat[]
  /** 주행 구간 도로명 — 마지막 구간이 건물에 실제로 접근하는 도로다 */
  sections: Array<{ name: string; distanceM: number }>
  guides: Array<{ instructions: string; distanceM: number }>
}

/** 한반도 범위 가드 — 위경도가 뒤집혔거나 지오코딩이 이상한 값을 준 경우를 잡는다 */
export function isKoreanLngLat(p: LngLat): boolean {
  const [lng, lat] = p
  return Number.isFinite(lng) && Number.isFinite(lat)
    && lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39
}

export function hasMapsCredentials(): boolean {
  return !!process.env.NCP_MAPS_CLIENT_ID && !!process.env.NCP_MAPS_CLIENT_SECRET
}

export function mapsHeaders(): Record<string, string> {
  return {
    'x-ncp-apigw-api-key-id': process.env.NCP_MAPS_CLIENT_ID ?? '',
    'x-ncp-apigw-api-key': process.env.NCP_MAPS_CLIENT_SECRET ?? '',
  }
}

/** 주소 → 좌표 (Geocoding v2). 실패는 null — 호출부가 안내 문구를 정한다 */
export async function geocodeToLngLat(address: string): Promise<LngLat | null> {
  if (!address.trim() || !hasMapsCredentials()) return null
  try {
    const url = new URL('https://maps.apigw.ntruss.com/map-geocode/v2/geocode')
    url.searchParams.set('query', address)
    const res = await fetch(url.toString(), { headers: mapsHeaders(), cache: 'no-store' })
    if (!res.ok) return null
    const geo = await res.json() as { addresses?: Array<{ x: string; y: string }> }
    const a = geo.addresses?.[0]
    if (!a) return null
    const p: LngLat = [Number(a.x), Number(a.y)]
    return isKoreanLngLat(p) ? p : null
  } catch { return null }
}

/** 자동차 경로 조회. option=trafast(실시간 빠른길) */
export async function fetchDrivingRoute(
  start: LngLat,
  goal: LngLat,
): Promise<{ route?: FireRoute; unavailable?: boolean; error?: string }> {
  if (!hasMapsCredentials()) return { unavailable: true }
  if (!isKoreanLngLat(start)) return { error: '출발지(관할 소방서) 좌표가 올바르지 않습니다.' }
  if (!isKoreanLngLat(goal)) return { error: '도착지(대상 건물) 좌표가 올바르지 않습니다.' }

  try {
    const url = new URL(DIRECTIONS_URL)
    url.searchParams.set('start', `${start[0]},${start[1]}`)
    url.searchParams.set('goal', `${goal[0]},${goal[1]}`)
    url.searchParams.set('option', 'trafast')
    const res = await fetch(url.toString(), { headers: mapsHeaders(), cache: 'no-store' })
    // 401/403 = 콘솔에서 Directions 5 미활성(또는 권한 없음) — 키 자체는 유효하므로 unavailable로 본다
    if (res.status === 401 || res.status === 403) return { unavailable: true }
    if (!res.ok) return { error: `경로 조회에 실패했습니다 (HTTP ${res.status})` }

    const body = await res.json() as {
      code?: number; message?: string
      route?: Record<string, Array<{
        summary?: { distance?: number; duration?: number }
        path?: number[][]
        section?: Array<{ name?: string; distance?: number }>
        guide?: Array<{ instructions?: string; distance?: number }>
      }>>
    }
    // code 0이 성공. 그 외(1=출발지 오류, 2=도착지 오류 등)는 message를 그대로 노출한다
    if (body.code !== 0) return { error: body.message || '경로를 찾지 못했습니다.' }

    const leg = body.route?.trafast?.[0] ?? Object.values(body.route ?? {})[0]?.[0]
    if (!leg?.summary) return { error: '경로 응답이 비어 있습니다.' }

    const path = (leg.path ?? [])
      .filter(p => Array.isArray(p) && p.length >= 2)
      .map(p => [p[0], p[1]] as LngLat)

    return {
      route: {
        distanceM: leg.summary.distance ?? 0,
        durationMs: leg.summary.duration ?? 0,
        path,
        sections: (leg.section ?? [])
          .map(s => ({ name: (s.name ?? '').trim(), distanceM: s.distance ?? 0 }))
          .filter(s => s.name !== ''),
        guides: (leg.guide ?? [])
          .map(g => ({ instructions: (g.instructions ?? '').trim(), distanceM: g.distance ?? 0 }))
          .filter(g => g.instructions !== ''),
      },
    }
  } catch {
    return { error: '경로 API 호출에 실패했습니다 — 잠시 후 다시 시도해주세요.' }
  }
}

/** 받침 유무로 목적격 조사 선택 — '갈월길를' 같은 문장이 서식에 그대로 인쇄되는 걸 막는다 */
function objectParticle(word: string): '을' | '를' {
  const last = word.trim().at(-1) ?? ''
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return '를'   // 한글 음절이 아니면(숫자·영문 등) 기본값
  return (code - 0xac00) % 28 === 0 ? '를' : '을'
}

/** 진입경로 서술 초안 (B-2) — 마지막 구간 도로명 + 종료 직전 안내 문장으로 조립.
 *  전체 안내를 다 붙이면 소방계획서 서식에 맞지 않는 장문이 되므로 **끝부분 3개**만 쓴다. */
export function buildRouteDesc(route: FireRoute, stationName: string): string {
  const roads = [...new Set(route.sections.map(s => s.name))]
  const lastRoads = roads.slice(-2).join(' → ') || '주요 도로'
  const tailGuides = route.guides.slice(-3).map(g => g.instructions)
  const head = `${stationName}에서 출발, ${lastRoads}${objectParticle(lastRoads)} 경유해 진입.`
  return tailGuides.length > 0 ? `${head} (${tailGuides.join(' / ')})` : head
}

/** 건물에 실제로 접근하는 도로 = 마지막 구간 도로명 (§8 L3 '자동차 도로') */
export function mainApproachRoad(route: FireRoute): string | null {
  for (let i = route.sections.length - 1; i >= 0; i -= 1) {
    if (route.sections[i].name) return route.sections[i].name
  }
  return null
}
