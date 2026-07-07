import { redirect } from 'next/navigation'
import { Users2, MapPin } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { RegionalAssignClient } from '@/components/customers/regional-assign-client'
import type { UserRole } from '@/types'

export default async function RegionalAssignPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const role = profile.role as UserRole
  if (role === 'employee') redirect('/customers')

  const admin = createAdminClient()

  type CustomerRow = {
    id: string
    customer_code: string
    customer_name: string
    address: string | null
    region_si: string | null
    region_myeon: string | null
    region_ri: string | null
    assigned_employee_id: string | null
  }

  type EmployeeRow = { id: string; name: string; position: string | null; is_active: boolean }

  // region 컬럼 존재 여부 확인 (018_region 마이그레이션 적용 여부)
  const { error: regionColErr } = await admin.from('customers').select('region_si').limit(1)
  const hasRegionCols = !regionColErr

  const [customersRes, employeesRes] = await Promise.all([
    hasRegionCols
      ? admin
          .from('customers')
          .select('id, customer_code, customer_name, address, region_si, region_myeon, region_ri, assigned_employee_id')
          .eq('is_active', true)
          .not('region_si', 'is', null)
          .order('region_si')
          .order('region_myeon')
          .order('customer_name')
      : Promise.resolve({ data: [] }),
    // 퇴사자(비활성)도 '현재 담당자'로 조회되어야 하므로 전체 로드 (후임 배정 드롭다운은 클라이언트에서 활성만 필터)
    admin
      .from('profiles')
      .select('id, name, position, is_active')
      .order('name'),
  ])

  const customers = (customersRes.data ?? []) as CustomerRow[]
  const employees = (employeesRes.data ?? []) as EmployeeRow[]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users2 className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">담당자 배정 · 재배정</h1>
          <p className="text-sm text-[#514b81] mt-0.5">
            지역별 일괄 배정 또는 담당자별 조회로 담당 직원을 배정·교체·인수인계합니다
          </p>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#c8c4d0] py-20 text-center space-y-3">
          <MapPin className="size-10 mx-auto text-[#b0acd6]" />
          {!hasRegionCols ? (
            <>
              <p className="text-sm text-[#514b81]">지역 컬럼이 DB에 아직 적용되지 않았습니다</p>
              <p className="text-xs text-[#b0acd6]">Supabase SQL Editor에서 <code className="bg-gray-100 px-1 rounded">018_region.sql</code> 마이그레이션을 실행해주세요</p>
            </>
          ) : (
            <>
              <p className="text-sm text-[#514b81]">지역 정보(시/군/구)가 등록된 고객이 없습니다</p>
              <p className="text-xs text-[#b0acd6]">고객 등록 또는 편집 시 주소 검색을 통해 지역 정보를 입력하면 이 화면에서 일괄 배정이 가능합니다</p>
            </>
          )}
        </div>
      ) : (
        <RegionalAssignClient customers={customers} employees={employees} />
      )}
    </div>
  )
}
