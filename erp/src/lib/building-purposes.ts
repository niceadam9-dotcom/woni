import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/** 건물 용도 선택지 (049 building_purposes) — 관리자 > 건물 용도 관리에서 CRUD.
 *  입력 화면은 datalist로 제안만 한다: 건축물대장 자동 조회가 목록에 없는 용도를 넣는
 *  경우가 있어 <select>로 강제하면 값이 잘린다(기존 buildings.purpose는 자유 TEXT). */
export async function listBuildingPurposes(): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('building_purposes')
    .select('name')
    .order('sort_order')
    .order('name')
  return ((data ?? []) as Array<{ name: string }>).map(p => p.name)
}
