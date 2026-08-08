'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { resolveFireStation } from '@/lib/fire-station'
import {
  fetchDrivingRoute, geocodeToLngLat, buildRouteDesc, mainApproachRoad,
  hasMapsCredentials, type LngLat,
} from '@/lib/ncp-directions'
import { renderRouteMapPng } from '@/lib/static-map-compose'

/** 소방차 진입 경로 (소방계획서_11.md §9 — D-4′ 채택 2026-08-07)
 *
 *  출발지 = **관할 소방서 본서**(§9-7 ① 결정, 119안전센터 아님) / 도착지 = 대상 건물.
 *  한 번 조회한 경로는 sections.routeMeta에 캐시해 재호출을 막는다(§9-4 캐시 정책) —
 *  경로도 이미지 생성은 이 캐시를 읽어 **Directions를 다시 부르지 않는다**.
 *
 *  routeMeta를 location 안이 아니라 **sections 최상위 키**로 둔 이유: 1.3 화면이 저장할 때
 *  location 객체를 통째로 덮어쓰므로, 안에 넣으면 사용자가 저장하는 순간 캐시가 날아간다.
 */

const BUCKET = 'fire-plans'
const MAX_PATH_POINTS = 300   // 경로도 렌더에 충분하고 sections JSONB를 부풀리지 않는 선

export type RouteMeta = {
  distanceM: number
  durationMs: number
  /** 요청 라벨 — 1.3 드롭다운이 고른 값 그대로("양평소방서 (용문119안전센터)"). 캐시 유효성 판정 축 (A-3).
   *  구 캐시에는 없어 optional — 없으면 stationName으로 판정한다 */
  station?: string
  /** 좌표를 실제로 사용한 소방서(본서) — 센터는 좌표 미보유라 본서로 환원된다 */
  stationName: string
  mainRoad: string | null
  routeDesc: string
  path: LngLat[]
  fetchedAt: string
}

export type FireRouteResult = {
  unavailable?: boolean
  error?: string
  meta?: Omit<RouteMeta, 'path'> & { pathPoints: number }
  cached?: boolean
  cacheFailed?: boolean   // 조회는 됐으나 캐시 저장 실패 — 다음 조회가 또 API를 부른다
  /** 119안전센터를 골랐지만 센터 좌표가 없어 본서 기준으로 계산했다 — 화면이 그대로 표기해야 한다 */
  centerFallback?: boolean
}

function downsample(path: LngLat[]): LngLat[] {
  if (path.length <= MAX_PATH_POINTS) return path
  const step = Math.ceil(path.length / MAX_PATH_POINTS)
  const out = path.filter((_, i) => i % step === 0)
  const last = path[path.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

async function loadSections(customerId: string): Promise<Record<string, unknown>> {
  const admin = createAdminClient()
  const { data } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', customerId).maybeSingle()
  return ((data as { sections?: Record<string, unknown> } | null)?.sections ?? {})
}

/** 대상 건물 좌표 — buildings에 캐시된 값 우선, 없으면 지오코딩 후 저장(§9-3) */
async function resolveBuildingCoords(customerId: string): Promise<
  { coords?: LngLat; name?: string; error?: string }
> {
  const admin = createAdminClient()
  const { data: cust } = await admin.from('customers')
    .select('customer_name, address').eq('id', customerId).maybeSingle()
  const c = cust as { customer_name: string; address: string | null } | null
  const { data: bldRaw } = await admin.from('buildings')
    .select('id, building_name, address, address_jibun, lat, lng, geocoded_at, updated_at')
    .eq('customer_id', customerId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  const b = bldRaw as {
    id: string; building_name: string | null; address: string | null
    address_jibun: string | null; lat: number | null; lng: number | null
    geocoded_at: string | null; updated_at: string | null
  } | null

  const name = b?.building_name || c?.customer_name || '대상 건물'
  // BLK-5(독립검증 2026-08-07): 종전엔 좌표가 있으면 무조건 재사용해, **주소를 고쳐도 옛 좌표**로
  // 경로가 나왔다(refresh로도 못 고침). 건물이 좌표 기록 이후에 수정됐으면 캐시를 버린다.
  const staleCoords = !!b?.geocoded_at && !!b?.updated_at && b.updated_at > b.geocoded_at
  if (b?.lat != null && b?.lng != null && !staleCoords) {
    return { coords: [Number(b.lng), Number(b.lat)], name }
  }

  // 좌표는 **건물 주소 우선** — 고객(본사) 주소가 건물과 다르면 건물 행에 엉뚱한 좌표가 박힌다(독립검증 지적)
  const address = b?.address || b?.address_jibun || c?.address
  if (!address) return { error: '고객 주소가 없습니다 — 기본정보에 주소를 먼저 입력해주세요.' }
  const coords = await geocodeToLngLat(address)
  if (!coords) return { error: `주소의 좌표를 찾지 못했습니다: ${address}` }
  if (b?.id) {
    await admin.from('buildings')
      .update({ lat: coords[1], lng: coords[0], geocoded_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', b.id)
  }
  return { coords, name }
}

/** 드롭다운 라벨 "양평소방서 (용문119안전센터)" → 본서명. 센터는 좌표를 보유하지 않아(117 스키마)
 *  본서로 환원해 경로를 낸다 — 센터 좌표 도입(A-4)은 마이그레이션 동반이라 후속 과제다. */
function stationBaseName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim()
}
function isCenterLabel(label: string): boolean {
  return stationBaseName(label) !== label.trim()
}

/** 경로 출발지가 될 관할 소방서 라벨 — 1.3에서 고른 값(preferred) 우선, 없으면 고객 정보·주소 추정 (A-1).
 *  좌표 조회 전에 라벨만 확정해 캐시 유효성을 먼저 판정한다(A-3). */
async function resolveStationLabel(
  customerId: string, preferred?: string,
): Promise<{ label?: string; error?: string }> {
  const p = (preferred ?? '').trim()
  if (p) return { label: p }

  const admin = createAdminClient()
  const { data: cust } = await admin.from('customers')
    .select('fire_station, region_si, region_myeon, address').eq('id', customerId).maybeSingle()
  const c = cust as {
    fire_station: string | null; region_si: string | null
    region_myeon: string | null; address: string | null
  } | null

  const saved = (c?.fire_station ?? '').trim()
  if (saved) return { label: saved }
  const resolved = await resolveFireStation(admin, {
    regionMyeon: c?.region_myeon, regionSi: c?.region_si, address: c?.address,
  })
  if (!resolved?.station) return { error: '관할 소방서를 알 수 없습니다 — 기본정보에서 주소를 저장해주세요.' }
  return { label: resolved.station }
}

/** 관할 소방서 좌표 — region_fire_stations(114 컬럼). 주소만 있으면 지오코딩 후 저장 */
async function resolveStationCoords(label: string): Promise<
  { coords?: LngLat; name?: string; error?: string }
> {
  const admin = createAdminClient()
  const name = stationBaseName(label)
  if (!name) return { error: '관할 소방서를 알 수 없습니다 — 기본정보에서 주소를 저장해주세요.' }

  const { data: stRaw } = await admin.from('region_fire_stations')
    .select('fire_station, station_address, station_lat, station_lng')
    .eq('fire_station', name).limit(1).maybeSingle()
  const st = stRaw as {
    station_address: string | null; station_lat: number | null; station_lng: number | null
  } | null
  if (!st) return { error: `'${name}'의 좌표가 등록돼 있지 않습니다 — 소방서 시드(scripts/seed-fire-station-coords.mjs)를 실행해주세요.` }
  if (st.station_lat != null && st.station_lng != null) {
    return { coords: [Number(st.station_lng), Number(st.station_lat)], name }
  }
  if (!st.station_address) return { error: `'${name}'의 주소가 등록돼 있지 않습니다 — 소방서 시드를 실행해주세요.` }

  const coords = await geocodeToLngLat(st.station_address)
  if (!coords) return { error: `'${name}' 주소의 좌표를 찾지 못했습니다.` }
  await admin.from('region_fire_stations')
    .update({ station_lat: coords[1], station_lng: coords[0] } as Record<string, unknown>)
    .eq('fire_station', name)
  return { coords, name }
}

/** B-1·B-2 — 경로 조회(캐시 우선). refresh=true면 강제 재조회.
 *  opts.station = 1.3에서 고른 관할 소방서(A-1) — 종전엔 고객 정보 값만 써서 1.3 선택이 무시됐다(K-1) */
export async function getFireRouteAction(
  customerId: string,
  opts?: { refresh?: boolean; station?: string },
): Promise<FireRouteResult> {
  await requirePermission('customer_manage')
  if (!hasMapsCredentials()) return { unavailable: true }

  const resolved = await resolveStationLabel(customerId, opts?.station)
  if (resolved.error || !resolved.label) return { error: resolved.error }
  const label = resolved.label

  const sections = await loadSections(customerId)
  const cached = sections.routeMeta as RouteMeta | undefined
  // A-3: 캐시는 '어느 소방서 기준인가'가 같을 때만 유효 — 소방서를 바꿔도 옛 경로가 나오던 문제(K-2).
  // 구 캐시(station 없음)는 stationName으로 판정한다.
  const cachedLabel = cached?.station ?? cached?.stationName
  if (!opts?.refresh && cached?.path?.length && cachedLabel === label) {
    const { path, ...rest } = cached
    return {
      meta: { ...rest, station: label, pathPoints: path.length },
      cached: true, centerFallback: isCenterLabel(label),
    }
  }

  const goal = await resolveBuildingCoords(customerId)
  if (goal.error || !goal.coords) return { error: goal.error }
  const start = await resolveStationCoords(label)
  if (start.error || !start.coords) return { error: start.error }

  const res = await fetchDrivingRoute(start.coords, goal.coords)
  if (res.unavailable) return { unavailable: true }
  if (res.error || !res.route) return { error: res.error }

  // 센터를 골랐어도 좌표는 본서 것이다 — 서술이 '용문119안전센터에서'라고 말하면 거짓이 되므로 본서명을 쓴다
  const originName = start.name ?? '관할 소방서'
  const meta: RouteMeta = {
    distanceM: res.route.distanceM,
    durationMs: res.route.durationMs,
    station: label,
    stationName: start.name ?? '',
    mainRoad: mainApproachRoad(res.route),
    routeDesc: buildRouteDesc(res.route, originName),
    path: downsample(res.route.path),
    fetchedAt: new Date().toISOString(),
  }

  const admin = createAdminClient()
  const profile = await requirePermission('customer_manage')
  // 캐시 저장 실패를 삼키면 화면엔 성공으로 보이면서 매 조회마다 Directions를 재호출한다(요금 전제 훼손) —
  // 독립검증 지적. 조회 결과 자체는 유효하므로 **실패해도 값은 반환**하되 안내로 표면화한다.
  const { error: cacheErr } = await admin.from('fire_plan_forms').upsert({
    customer_id: customerId,
    sections: { ...sections, routeMeta: meta },
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  } as Record<string, unknown>)

  const { path, ...rest } = meta
  return {
    meta: { ...rest, pathPoints: path.length },
    cached: false,
    cacheFailed: !!cacheErr,
    centerFallback: isCenterLabel(label),
  }
}

/** B-3 — 캐시된 경로로 경로도 PNG 생성 → plan-assets 업로드. 화면이 fa.routeImage에 반영한다 */
export async function generateRouteImageAction(
  customerId: string,
  opts?: { station?: string },
): Promise<{ path?: string; unavailable?: boolean; error?: string }> {
  await requirePermission('customer_manage')
  const sections = await loadSections(customerId)
  let meta = sections.routeMeta as RouteMeta | undefined
  // 캐시가 다른 소방서 기준이면 경로도도 그 소방서 것이 된다 — 요청 소방서와 다르면 다시 조회한다 (A-3)
  const staleStation = !!opts?.station?.trim()
    && (meta?.station ?? meta?.stationName) !== opts.station.trim()
  if (!meta?.path?.length || staleStation) {
    const fetched = await getFireRouteAction(customerId, { station: opts?.station })
    if (fetched.unavailable) return { unavailable: true }
    if (fetched.error) return { error: fetched.error }
    meta = (await loadSections(customerId)).routeMeta as RouteMeta | undefined
  }
  if (!meta?.path?.length) return { error: '경로 정보를 찾지 못했습니다.' }

  const goal = await resolveBuildingCoords(customerId)
  const km = (meta.distanceM / 1000).toFixed(1)
  const min = Math.max(1, Math.round(meta.durationMs / 60000))
  const render = await renderRouteMapPng({
    path: meta.path,
    startLabel: meta.stationName || '관할 소방서',
    goalLabel: goal.name ?? '대상 건물',
    caption: `${km}km · ${min}분 (일반 차량 기준)`,
  })
  if (render.unavailable) return { unavailable: true }
  if (render.error || !render.png) return { error: render.error }

  const admin = createAdminClient()
  const path = `${customerId}/plan-assets/route-${Date.now()}.png`
  const { error } = await admin.storage.from(BUCKET)
    .upload(path, render.png, { contentType: 'image/png', upsert: false })
  if (error) return { error: `저장 실패: ${error.message}` }
  return { path }
}
