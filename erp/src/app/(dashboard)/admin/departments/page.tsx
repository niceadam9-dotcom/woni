import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { DeptManageClient } from '@/components/admin/dept-manage-client'

export default async function AdminDepartmentsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  const admin = createAdminClient()

  const [deptsRes, profilesRes] = await Promise.all([
    admin.from('departments').select('id, name, manager_id').order('name'),
    admin.from('profiles').select('id, name, department_id').eq('is_active', true),
  ])

  type DeptRow = { id: string; name: string; manager_id: string | null }
  type ProfileRow = { id: string; name: string; department_id: string | null }

  const rawDepts = (deptsRes.data ?? []) as DeptRow[]
  const allProfiles = (profilesRes.data ?? []) as ProfileRow[]

  // 부서별 직원 수 집계
  const countMap = new Map<string, number>()
  allProfiles.forEach(p => {
    if (p.department_id) {
      countMap.set(p.department_id, (countMap.get(p.department_id) ?? 0) + 1)
    }
  })

  const depts = rawDepts.map(d => ({
    ...d,
    member_count: countMap.get(d.id) ?? 0,
  }))

  // 팀장/관리자만 부서장 후보
  const managers = allProfiles
    .filter(p => {
      const fullProfile = allProfiles.find(x => x.id === p.id)
      return fullProfile
    })
    .map(p => ({ id: p.id, name: p.name }))

  // 더 정확한 매니저 필터 — role 컬럼 포함해서 다시 fetch
  const { data: managersRaw } = await admin
    .from('profiles')
    .select('id, name')
    .in('role', ['manager', 'admin'])
    .eq('is_active', true)
    .order('name')

  const managerList = (managersRaw ?? []) as Array<{ id: string; name: string }>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Building2 className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">부서 관리</h1>
          <p className="text-sm text-[#514b81] mt-0.5">부서를 생성하고 부서장을 지정합니다</p>
        </div>
      </div>
      <DeptManageClient depts={depts} managers={managerList} />
    </div>
  )
}
