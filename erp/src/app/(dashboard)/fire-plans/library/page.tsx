import { redirect } from 'next/navigation'
import { BookMarked } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { PlanTextLibraryPage } from '@/components/customers/plan-text-library-page'

/** 계획서 공통문구 — 전역 라이브러리 관리 (소방계획서_21 R1-1)
 *
 *  고객 종속 화면에 두지 않는 이유: plan_text_library는 customer_id가 없는 전역 테이블이라
 *  고객 화면에 두면 같은 데이터가 모든 고객 화면에 중복 노출되고, 거기서 누른 삭제가
 *  전사 삭제라는 사실이 맥락과 어긋난다.
 *
 *  데이터 로드는 클라이언트가 listPlanTextLibraryAction으로 한다 — 저장·기본지정 후 재조회가 잦아
 *  SSR prop으로 내려주면 매번 라우트 갱신을 태워야 한다. 페이지는 게이트만 담당한다. */

export default async function PlanTextLibraryRoute({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  // 서식 팝오버에서 이미 전 직원이 등록·삭제·기본지정을 한다 — 관리 화면은 가시성만 추가한다(D1-2)
  if (!can(profile.role, 'customer_manage')) redirect('/dashboard')

  const { section } = await searchParams

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BookMarked className="size-6 text-brand" />
        <div>
          <h1 className="text-xl font-bold text-ink">계획서 공통문구</h1>
          <p className="mt-0.5 text-sm text-ink-sub">
            모든 고객이 함께 쓰는 서술 8섹션을 한 장에서 관리합니다 — ⭐ 기본문구는 신규 고객에 자동 주입됩니다
          </p>
        </div>
      </div>
      <PlanTextLibraryPage initialSection={section} />
    </div>
  )
}
