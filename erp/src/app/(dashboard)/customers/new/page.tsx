import { redirect } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CustomerNewClient } from '@/components/customers/customer-new-client'
import { getCompanyProfile } from '@/lib/company-profile'
import { listBuildingPurposes } from '@/lib/building-purposes'

export default async function CustomersNewPage({
  searchParams,
}: {
  searchParams: Promise<{ anchor?: string; from?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  /* 점검달력에서 날짜를 짚어 들어온 경우 (2026-09-22 사용자 요청 — 등록이 달력 위 모달에서
     이 페이지로 옮겨 왔다). 짚은 날짜가 **점검일자**로 프리필되고, 마치면 `from`으로 돌아간다.
     ⚠ 형식 검증만 한다 — 날짜 꼴이 아니면 프리필 없이 평소의 빈 폼이다(지어내지 않는다). */
  const initialAnchorDate = /^\d{4}-\d{2}-\d{2}$/.test(params.anchor ?? '') ? params.anchor! : ''
  /* 🚨 복귀 주소는 **내부 경로만** 받는다. 검증 없이 `router.push`에 넘기면 `//evil.com`이
     프로토콜 상대 URL로 해석돼 외부로 튕긴다(오픈 리다이렉트). `/`로 시작하되 `//`·`/\`는
     아닐 것 — 이 두 조건이 그 문을 닫는다. 걸러지면 종전 동선(고객 상세)으로 간다. */
  const from = params.from ?? ''
  const returnHref = /^\/(?![/\\])/.test(from) ? from : ''

  const admin = createAdminClient()
  const [{ data: employeesRaw }, company, purposes] = await Promise.all([
    admin
      .from('profiles')
      .select('id, name, position')
      .eq('is_active', true)
      .eq('is_system', false)
      .order('name'),
    getCompanyProfile(),
    listBuildingPurposes(),
  ])

  const employees = (employeesRaw ?? []) as Array<{ id: string; name: string; position: string | null }>
  // 폼의 region_si는 시/군/구 단위(예: 양평군) — company_profile.default_region_myeon이 해당 값
  const defaultRegionSi = company?.default_region_myeon ?? ''

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserPlus className="size-6 text-brand" />
        <div>
          <h1 className="text-xl font-bold text-ink">고객 등록</h1>
          <p className="text-sm text-ink-sub mt-0.5">
            {initialAnchorDate
              /* 달력에서 왔다는 사실을 화면이 말한다 — 안 말하면 프리필된 점검일자가 어디서
                 왔는지 알 수 없고, 등록 후 달력으로 튕기는 것도 예고 없는 이동이 된다. */
              ? <>점검일자 <b>{initialAnchorDate}</b>로 시작합니다 — 아래 폼에서 바꿀 수 있습니다{returnHref ? ' · 등록하면 점검달력으로 돌아갑니다' : ''}</>
              : '새 고객과 관계인 정보를 등록합니다'}
          </p>
        </div>
      </div>
      <CustomerNewClient
        employees={employees}
        defaultRegionSi={defaultRegionSi}
        purposes={purposes}
        initialAnchorDate={initialAnchorDate}
        returnHref={returnHref}
      />
    </div>
  )
}
