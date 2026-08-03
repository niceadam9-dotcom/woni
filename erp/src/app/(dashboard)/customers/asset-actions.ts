'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { ASSET_BUCKET, ASSET_MAX_SIZE, listCustomerAssets, type AssetSlot, type CustomerAsset } from '@/lib/customer-assets'

/** 지도·사진 화면 등록 액션 (소방계획서_7 §5 — H-10·H-11, S3)
 *  슬롯 3종: cover(표지 건물 사진 1장)·map_location(위치도/약도 1장)·evac(피난안내도·평면도 복수).
 *  리사이즈·EXIF 보정은 클라이언트에서 선처리(customer-assets-client) — 서버는 검증·저장만.
 *  활동 로그 없음 — 문서 재료 업로드는 과기록 방지. */

const IMG_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}
const UUID_RE = /^[0-9a-f-]{36}$/

/** 슬롯별 자산 목록 + 서명 URL(300초) */
export async function listCustomerAssetsAction(customerId: string): Promise<{ assets?: CustomerAsset[]; error?: string }> {
  await requirePermission('customer_manage')
  if (!UUID_RE.test(customerId)) return { error: '잘못된 고객 ID입니다.' }
  return { assets: await listCustomerAssets(customerId) }
}

/** 업로드·교체 — cover/map_location은 고정 파일명(기존 삭제 후 교체), evac은 evac_<ts> 추가형 */
export async function uploadCustomerAssetAction(
  customerId: string, slot: AssetSlot, formData: FormData,
): Promise<{ asset?: CustomerAsset; error?: string }> {
  await requirePermission('customer_manage')
  if (!UUID_RE.test(customerId)) return { error: '잘못된 고객 ID입니다.' }
  if (slot !== 'cover' && slot !== 'map_location' && slot !== 'evac') return { error: '지원하지 않는 슬롯입니다.' }
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: '파일을 선택해주세요.' }
  if (file.size > ASSET_MAX_SIZE) return { error: '이미지는 10MB 이하여야 합니다.' }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!IMG_MIME[ext]) return { error: 'JPG/PNG/WebP 이미지만 업로드할 수 있습니다.' }

  const admin = createAdminClient()
  const prefix = `${customerId}/assets`
  // 1장 슬롯 = 교체 — 확장자가 다른 기존 파일이 남지 않도록 삭제 후 업로드 (upsert는 동일 이름만 덮어씀)
  if (slot !== 'evac') {
    const { data: objects } = await admin.storage.from(ASSET_BUCKET).list(prefix, { limit: 100 })
    const stale = (objects ?? []).map(o => o.name)
      .filter(n => n.toLowerCase().startsWith(`${slot}.`))
      .map(n => `${prefix}/${n}`)
    if (stale.length > 0) await admin.storage.from(ASSET_BUCKET).remove(stale)
  }
  const name = slot === 'evac' ? `evac_${Date.now()}.${ext}` : `${slot}.${ext}`
  const path = `${prefix}/${name}`
  const { error: upErr } = await admin.storage.from(ASSET_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: IMG_MIME[ext], upsert: true })
  if (upErr) return { error: `업로드 실패: ${upErr.message}` }
  const { data: signed } = await admin.storage.from(ASSET_BUCKET).createSignedUrl(path, 300)
  if (!signed?.signedUrl) return { error: '업로드는 됐지만 미리보기 URL 생성에 실패했습니다 — 새로고침해주세요.' }
  return { asset: { slot, name, path, url: signed.signedUrl } }
}

/** 삭제 — 해당 고객 assets 하위 경로만 허용 */
export async function deleteCustomerAssetAction(customerId: string, path: string): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  if (!UUID_RE.test(customerId)) return { error: '잘못된 고객 ID입니다.' }
  if (!path.startsWith(`${customerId}/assets/`) || path.includes('..')) return { error: '잘못된 경로입니다.' }
  const admin = createAdminClient()
  const { error } = await admin.storage.from(ASSET_BUCKET).remove([path])
  if (error) return { error: `삭제 실패: ${error.message}` }
  return {}
}
