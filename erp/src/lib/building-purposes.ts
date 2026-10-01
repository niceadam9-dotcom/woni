import 'server-only'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUILDING_PURPOSES_TAG } from '@/lib/cache-tags'

/** 건물 용도 선택지 (049 building_purposes) — 관리자 > 건물 용도 관리에서 CRUD.
 *  입력 화면은 datalist로 제안만 한다: 건축물대장 자동 조회가 목록에 없는 용도를 넣는
 *  경우가 있어 <select>로 강제하면 값이 잘린다(기존 buildings.purpose는 자유 TEXT).
 *
 *  요청 간 캐시(3단계, 2026-10-01): 전역 표인데 고객 상세가 매 방문 읽었다. 관리자 액션이
 *  `updateTag(BUILDING_PURPOSES_TAG)`로 즉시 무효화하고, 60초 TTL이 백스톱이다(cache-tags.ts). */
const listBuildingPurposesCached = unstable_cache(
  async (): Promise<string[]> => {
    const admin = createAdminClient()
    const { data } = await admin
      .from('building_purposes')
      .select('name')
      .order('sort_order')
      .order('name')
    return ((data ?? []) as Array<{ name: string }>).map(p => p.name)
  },
  ['building-purposes'],
  { tags: [BUILDING_PURPOSES_TAG], revalidate: 60 },
)

export async function listBuildingPurposes(): Promise<string[]> {
  return listBuildingPurposesCached()
}
