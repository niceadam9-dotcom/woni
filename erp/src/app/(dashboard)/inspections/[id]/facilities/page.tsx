import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadFacilityFormData } from '@/lib/facility-form-data'
import { facilitiesForSheet } from '@/lib/sheet-facility-map'
import { ALL_STANDARD_CODES } from '@/lib/facility-codes'
import { PlanForm14 } from '@/components/customers/plan-form14'

/** 점검 귀속 소방시설(1.4) 화면 (소방계획서_40 S3) — 점검표 입력 중 설치 누락을 발견했을 때
 *  고객 상세 → 소방계획서 탭 → 1.4까지 돌아가지 않고 **1클릭으로 대장을 고치고 돌아오는** 자리다.
 *
 *  새 입력 로직은 없다 — 1.4 정본 컴포넌트(PlanForm14)와 저장 액션(saveFacilitiesAction)을
 *  그대로 서빙한다(저장·로드 규칙 단일성). 회차는 URL의 점검 건으로 결정적이라 자체 페치도 없다.
 *
 *  딥링크 계약 — 값이 이상하면 조용히 무시한다(링크가 썩어도 페이지는 열려야 한다):
 *    ?sheet=스프링클러설비   점검표에서 보던 **시트명** → 관련 설비 행 스크롤·강조.
 *                          해석은 facilitiesForSheet 한 곳(생성부에서 매핑하면 규칙이 두 벌이 된다).
 *    ?fac=코드,코드         설비 코드 직접 지정(미커버 경고 진입) — 42종 어휘 밖 값은 버린다.
 *                          sheet보다 우선한다.
 *    ?from=/inspections/…  뒤로가기 복귀 경로 — 내부 경로만(sheet/page.tsx와 같은 규칙).
 *                          없으면 이 점검의 점검표 입력 화면으로.
 *
 *  권한은 1.4와 같은 축(customers/[id]/page.tsx의 PlanForm14 마운트와 동일 값) — 점검 건
 *  편집권(담당자 축)과 무관하게 비담당 직원도 설비 대장은 정정할 수 있다(대장은 고객 자산). */
export default async function InspectionFacilitiesPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ sheet?: string; fac?: string; from?: string }>
}) {
  const { id } = await params
  const sp = (await searchParams) ?? {}

  const profile = await getProfile()
  if (!profile) redirect('/login')
  const canManage = can(profile.role as UserRole, 'customer_manage')
  const canRegister = can(profile.role as UserRole, 'inspection_register')

  const admin = createAdminClient()
  const { data: inspRaw } = await admin.from('inspections')
    .select('id, year, sequence_num, customer_id, customers:customer_id (customer_name)')
    .eq('id', id).maybeSingle()
  if (!inspRaw) notFound()
  const insp = inspRaw as unknown as {
    id: string; year: number; sequence_num: number; customer_id: string
    customers: { customer_name: string } | null
  }

  const { facilityBuildings, specsByBuilding } = await loadFacilityFormData(admin, insp.customer_id)

  const fromRaw = sp.from?.trim() ?? ''
  const backHref = fromRaw.startsWith('/') && !fromRaw.startsWith('//') ? fromRaw : `/inspections/${id}/sheet`

  // 관련 설비 포커스(S5-1b) — fac(코드 직접 지정)이 sheet(시트명 해석)보다 우선.
  // 시트명이 매핑에 없거나 어휘 밖 코드면 빈 배열 = 포커스 생략(조용히 무시)
  const sheetName = sp.sheet?.trim() ?? ''
  const facCodes = (sp.fac ?? '').split(',').map(s => s.trim()).filter(c => ALL_STANDARD_CODES.includes(c))
  const focusCodes = facCodes.length > 0 ? facCodes
    : sheetName ? facilitiesForSheet(sheetName, ALL_STANDARD_CODES) : []

  // 배지 → 점검표 → 뒤로가기가 이 화면(포커스·복귀 경로 포함)으로 돌아오도록 자기 URL을 만든다
  const qs = new URLSearchParams()
  if (facCodes.length > 0) qs.set('fac', facCodes.join(','))
  else if (sheetName) qs.set('sheet', sheetName)
  if (backHref !== `/inspections/${id}/sheet`) qs.set('from', backHref)
  const qsStr = qs.toString()
  const selfUrl = `/inspections/${id}/facilities${qsStr ? `?${qsStr}` : ''}`

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={backHref} data-testid="facilities-back"
          className="inline-flex items-center gap-1 text-form-sm text-ink-sub hover:text-brand">
          <ChevronLeft className="size-4" /> 점검표로
        </Link>
        <h1 className="text-form-base font-semibold text-ink">
          {insp.customers?.customer_name ?? '—'} · {insp.year}년 {insp.sequence_num}차
        </h1>
        <span className="text-form-xs text-ink-meta">
          설치 체크를 저장하면 점검표의 설치 설비·필수 입력 대상이 함께 갱신됩니다
        </span>
      </div>
      <PlanForm14
        customerId={insp.customer_id}
        buildings={facilityBuildings}
        canManage={canManage}
        canRegister={canRegister}
        specsByBuilding={specsByBuilding}
        inspectionCtx={{ id: insp.id, label: `${insp.year}년 ${insp.sequence_num}차` }}
        linkFrom={selfUrl}
        focusCodes={focusCodes}
      />
    </div>
  )
}
