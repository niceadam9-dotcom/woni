import { redirect } from 'next/navigation'
import { Tag } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BuildingPurposesManager } from '@/components/admin/building-purposes-manager'

export default async function BuildingPurposesPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  const admin = createAdminClient()
  const [{ data: purposesRaw }, { data: buildingsRaw }] = await Promise.all([
    admin.from('building_purposes').select('id, name, sort_order').order('sort_order').order('name'),
    admin.from('buildings').select('purpose'),
  ])

  const purposes = (purposesRaw ?? []) as Array<{ id: string; name: string; sort_order: number }>
  // 용도별 사용 건물 수 (삭제 시 참고용 — 삭제해도 기존 건물의 용도 텍스트는 유지됨)
  const usage = new Map<string, number>()
  for (const b of (buildingsRaw ?? []) as Array<{ purpose: string | null }>) {
    if (b.purpose) usage.set(b.purpose, (usage.get(b.purpose) ?? 0) + 1)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Tag className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">건물 용도 관리</h1>
          <p className="text-sm text-[#514b81] mt-0.5">
            건물 등록·수정 화면의 용도 선택 목록을 관리합니다 — 삭제해도 기존 건물에 입력된 용도는 유지됩니다
          </p>
        </div>
      </div>

      <BuildingPurposesManager
        purposes={purposes.map(p => ({ ...p, count: usage.get(p.name) ?? 0 }))}
      />
    </div>
  )
}
