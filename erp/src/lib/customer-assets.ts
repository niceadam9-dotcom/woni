import { createAdminClient } from '@/lib/supabase/admin'

/** 지도·사진 자산 공용 로직 (소방계획서_7 §5·§5-1 — H-10·H-11)
 *  저장 규약: fire-plans/{customerId}/assets/ 하위
 *   - cover.<ext>        표지 건물 사진 (1장 — 기존 워커 --photo CLI 대체)
 *   - map_location.<ext> 위치도(약도) (1장)
 *   - evac_<ts>.<ext>    피난안내도·평면도 (층별 복수, 추가형)
 *  문서 생성 시 템플릿에 삽입되는 재료 — 미등록이어도 생성은 막지 않음(자리표시 렌더). */

export const ASSET_BUCKET = 'fire-plans'
export const ASSET_MAX_SIZE = 10 * 1024 * 1024   // 10MB

export type AssetSlot = 'cover' | 'map_location' | 'evac'
export type CustomerAsset = { slot: AssetSlot; name: string; path: string; url: string }

/** 파일명 → 슬롯 판별 (규약 밖 파일은 무시) */
function slotOf(name: string): AssetSlot | null {
  if (/^cover\.(jpg|jpeg|png|webp)$/i.test(name)) return 'cover'
  if (/^map_location\.(jpg|jpeg|png|webp)$/i.test(name)) return 'map_location'
  if (/^evac_\d+\.(jpg|jpeg|png|webp)$/i.test(name)) return 'evac'
  return null
}

/** 서명 URL 유효기간 — 슬롯 UI는 서식 1.3을 열 때 비로소 <img>를 요청하므로,
 *  페이지 진입 시점에 발급한 URL이 300초면 5분 뒤 여는 순간 만료돼 깨진 이미지가 보였다.
 *  클라이언트가 마운트마다 재조회하지만(권한 없는 조회자는 재조회 불가) 여유를 둔다. */
export const ASSET_URL_TTL = 3600

/** 고객 자산 목록 + 서명 URL — 페이지 초기 조회와 액션이 공용 */
export async function listCustomerAssets(customerId: string): Promise<CustomerAsset[]> {
  const admin = createAdminClient()
  const prefix = `${customerId}/assets`
  const { data: objects } = await admin.storage.from(ASSET_BUCKET)
    .list(prefix, { limit: 100, sortBy: { column: 'name', order: 'asc' } })
  const rows = (objects ?? [])
    .map(o => ({ name: o.name, slot: slotOf(o.name) }))
    .filter((r): r is { name: string; slot: AssetSlot } => r.slot !== null)
  if (rows.length === 0) return []
  const paths = rows.map(r => `${prefix}/${r.name}`)
  const { data: signed } = await admin.storage.from(ASSET_BUCKET).createSignedUrls(paths, ASSET_URL_TTL)
  return rows
    .map((r, i) => ({ slot: r.slot, name: r.name, path: paths[i], url: signed?.[i]?.signedUrl ?? '' }))
    .filter(a => a.url !== '')
}
