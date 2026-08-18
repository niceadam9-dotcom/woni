import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/** 불량 전/후 사진 URL 발급 (2026-08-18).
 *
 *  ⚠ 왜 필요했나: 업로드가 `getPublicUrl()`로 만든 주소를 DB에 저장했는데 `inspection-defects`
 *  버킷은 **비공개**다. 그 주소는 `{"error":"Bucket not found"}` 400을 돌려주므로 불량사진이
 *  화면 어디에서도 뜨지 않았다(목록 썸네일·작업대·타임라인 ⑤·전후 갤러리 전부). 파일 자체는
 *  멀쩡해서 서명 URL로 받으면 200이다 — 죽은 것은 저장된 주소뿐이었다.
 *
 *  버킷을 공개로 돌리지 않는 이유: 고객 건물 내부 사진이라 주소만 알면 누구나 열람하게 된다.
 *  다른 버킷 5개도 전부 비공개다.
 *
 *  DB에는 **경로만** 저장한다(신규 업로드). 보정 스크립트가 기존 행의 공개 URL도 경로로 바꾼다.
 *  그래도 extractStoragePath는 두 형태를 모두 받는다 — 코드 배포와 보정 실행 사이의 시차,
 *  그리고 보정에서 누락된 행이 조용히 깨지는 것을 막기 위한 안전망이다. */

const BUCKET = 'inspection-defects'
/** 서명 수명 — 고객 지도·사진과 같은 1시간. 페이지를 열어 두고 작업하는 시간을 덮는다 */
const TTL_SECONDS = 3600

/** 저장값 → 버킷 내 경로. 구형식(공개 URL)이면 경로만 떼어낸다. 알 수 없으면 null */
export function extractStoragePath(stored: string | null | undefined): string | null {
  if (!stored) return null
  const v = stored.trim()
  if (!v) return null
  if (!v.startsWith('http')) return v.replace(/^\/+/, '')
  // .../object/public/inspection-defects/{path} · .../object/sign/inspection-defects/{path}?token=...
  const m = v.match(new RegExp(`/${BUCKET}/(.+)$`))
  if (!m) return null
  return m[1].split('?')[0]
}

/** 여러 경로를 한 번에 서명 — 사진 하나마다 왕복하면 불량 20건에 40번이 된다.
 *  실패한 항목은 결과에서 빠진다(그 슬롯은 '사진 없음'으로 그려진다 — 화면을 깨지 않는다). */
export async function signDefectPhotoMap(
  admin: SupabaseClient,
  stored: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const paths = [...new Set(stored.map(extractStoragePath).filter((p): p is string => !!p))]
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(paths, TTL_SECONDS)
  if (error || !data) return out
  for (const row of data) {
    // createSignedUrls는 요청 경로를 그대로 돌려준다(항목별 error 가능)
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl)
  }
  return out
}

/** 저장값 → 서명 URL (맵 조회용 헬퍼). 못 찾으면 null이라 호출부는 '사진 없음'으로 처리 */
export function signedOf(map: Map<string, string>, stored: string | null | undefined): string | null {
  const p = extractStoragePath(stored)
  return p ? map.get(p) ?? null : null
}

/** 불량 행 배열의 photo_url·after_photo_url을 서명 URL로 바꿔 돌려준다(원본 배열 불변) */
export async function withSignedDefectPhotos<T extends { photo_url?: string | null; after_photo_url?: string | null }>(
  admin: SupabaseClient,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows
  const map = await signDefectPhotoMap(admin, rows.flatMap(r => [r.photo_url, r.after_photo_url]))
  return rows.map(r => ({
    ...r,
    ...(r.photo_url !== undefined ? { photo_url: signedOf(map, r.photo_url) } : {}),
    ...(r.after_photo_url !== undefined ? { after_photo_url: signedOf(map, r.after_photo_url) } : {}),
  }))
}
