import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadFacilityFormData } from '@/lib/facility-form-data'
import { facilitiesForSheet } from '@/lib/sheet-facility-map'
import { ALL_STANDARD_CODES, ETC_ITEMS } from '@/lib/facility-codes'
import { sheetScope } from '@/lib/sheet-scope'
import { getSheets } from '@/lib/sheet-catalog'
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
    // plan_type은 **기타 7종을 이 회차 것만 남기는** 데 쓴다(아래 etcCodes) — 없으면 7종이 다 뜬다
    .select('id, year, sequence_num, customer_id, plan_type, customers:customer_id (customer_name, inspection_type)')
    .eq('id', id).maybeSingle()
  if (!inspRaw) notFound()
  const insp = inspRaw as unknown as {
    id: string; year: number; sequence_num: number; customer_id: string; plan_type: string | null
    customers: { customer_name: string; inspection_type: string | null } | null
  }

  const { facilityBuildings, specsByBuilding } = await loadFacilityFormData(admin, insp.customer_id)

  /* 🚨 2026-09-21 — 「기타」 7종을 **이 회차에 해당하는 것만** 남긴다.
   *
   *  7종은 한 묶음처럼 보이지만 속한 점검이 다르다(실측):
   *    방화문·비상구·방염      → STD-31 「기타사항」  = **자체점검(v2025) 전용**
   *    위험물·화기·가스·전기   → EXT-11~14          = **외관점검(v2022) 전용**
   *  그래서 자체점검 회차에서 뒤 4종을 체크해도 **이 회차 점검표엔 그 시트가 없다** — 대상 축도
   *  안 늘고 필수 입력에도 안 잡힌다. 3분리(2026-09-20) 때 이 화면은 「무변경 대조군」으로
   *  일부러 안 건드렸는데, 2026-09-21 A로 **달력 ①이 여기로 바로 보내게 되면서** 전제가 깨졌다:
   *  「설비를 확인하세요」라고 말하는 첫 관문에 무관한 항목이 절반 넘게 섞여 있었다(사용자 지적).
   *
   *  ⚠ 목록을 손으로 적지 않는다 — **시트 카탈로그에 묻는다**(버전 × 시트명). 손으로 적으면
   *    서식이 갱신될 때 한쪽만 바뀌고, 그 갈라짐은 화면 어디에도 안 드러난다.
   *  ⚠ 카탈로그 조회가 실패하면 **거르지 않는다**(종전 동작 = 7종). 보조 기능이 본 기능을 막지 않는다. */
  const { version: etcVersion } = sheetScope(insp.plan_type, insp.customers?.inspection_type ?? null)
  const etcCodes = await getSheets()
    .then(sheets => ETC_ITEMS
      .filter(it => sheets.some(s => s.version === etcVersion && s.sheet_name === it.sheetName))
      .map(it => it.code))
    .catch(() => undefined)

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
          <ChevronLeft className="size-4" /> 뒤로
        </Link>
        <h1 className="text-form-base font-semibold text-ink">
          {insp.customers?.customer_name ?? '—'} · {insp.year}년 {insp.sequence_num}차
        </h1>
        {/* 🚨 2026-09-21 — 「설비 확인 → 점검표 입력」이 **한 세트**임을 화면이 말한다.
            종전엔 순서가 어디에도 없어서, 달력에서 ①을 누른 사용자가 무엇을 먼저 해야 하는지
            몰랐다(운주빌딩: 대장 0건인 채 33개 시트가 펼쳐졌다). */}
        <span className="inline-flex items-center gap-1.5 text-form-xs" data-testid="facilities-stepband">
          <span className="rounded-full bg-brand px-2 py-0.5 font-medium text-white">① 설비 확인</span>
          <span className="text-ink-faint">→</span>
          <span className="rounded-full border border-brand-line px-2 py-0.5 text-ink-sub">② 점검표 입력</span>
        </span>
      </div>
      <p className="text-form-xs text-ink-meta">
        설치 체크를 저장하면 점검표의 설치 설비·필수 입력 대상이 함께 갱신됩니다 ·
        설비가 하나도 없는 건물은 아래 [해당 설비 없음 — 확인만]으로 끝낼 수 있습니다
      </p>
      {/* B — **전진 버튼**. 종전엔 왼쪽 위 화살표뿐이라 「다 됐으니 이제 점검표로」가 화면에 없었다.
          뒤로가기(←)는 *취소*처럼 읽힌다 — 마쳤을 때 누를 자리는 따로 있어야 한다.
          ⚠ 저장 여부로 막지 않는다: 막으면 「설비 없음」 건물이 갇힌다. 이 버튼이 곧
            A의 「건너뛰고 점검표로」를 겸한다(막지 않는다는 규약과 한 벌).
          ⚠ E-1 — 내가 받은 복귀 경로(`backHref`)를 **점검표에 그대로 넘긴다**. 그래야 점검표의
            뒤로가기가 달력까지 닿는다(종전엔 여기서 출처가 끊겼다). */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/inspections/${id}/sheet${backHref !== `/inspections/${id}/sheet` ? `?from=${encodeURIComponent(backHref)}` : ''}`}
          data-testid="facilities-to-sheet"
          className="inline-flex h-form-7 items-center gap-1 rounded-lg bg-brand px-3 text-form-xs font-medium text-white hover:bg-brand-strong">
          점검표 입력 <ChevronRight className="size-3.5" />
        </Link>
        <span className="text-form-xs text-ink-meta">확인이 끝났으면 이어서 점검표를 입력합니다</span>
      </div>
      <PlanForm14
        customerId={insp.customer_id}
        buildings={facilityBuildings}
        canManage={canManage}
        canRegister={canRegister}
        specsByBuilding={specsByBuilding}
        inspectionCtx={{ id: insp.id, label: `${insp.year}년 ${insp.sequence_num}차` }}
        etcCodes={etcCodes}
        linkFrom={selfUrl}
        focusCodes={focusCodes}
      />
    </div>
  )
}
