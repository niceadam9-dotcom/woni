import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { FirePlanGenerateRequestClient } from '@/components/fire-plans/generate-request-client'
import { getFirePlanGenStatusAction } from '@/app/(dashboard)/fire-plans/generate/actions'
import { AnnualIssueWizard } from '@/components/reports/annual-issue-wizard'
import { ackLawRevisionAction } from '@/app/(dashboard)/reports/actions'

export const dynamic = 'force-dynamic'

/** 배치 발행 (소방계획서_8 H-6c·D-8) — 보고서 센터 해체로 이전된 전사 배치 기능.
 *  연차 일괄 발행(전 고객 소방계획서 연초 갱신) + 소방계획서 일괄 생성(고객 다중 선택).
 *  고객별 문서 조회·별지 생성은 고객관리 > 소방계획서 트리(별지 서식)가 단일 허브.
 *  서식 개정 감지 배너(law_form_baselines)도 여기로 이전 — 생성 서식과 같은 화면. */

type Baseline = { key: string; form_name: string; announce_date: string; seed_date: string | null }
const fmtYmd = (d: string) => (d?.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d)

export default async function BatchIssuePage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const [status, blRes] = await Promise.all([
    getFirePlanGenStatusAction(),
    createAdminClient().from('law_form_baselines').select('key, form_name, announce_date, seed_date'),
  ])
  const revisedList = (((blRes.data ?? []) as Baseline[]))
    .filter(b => !!b.seed_date && b.announce_date > b.seed_date)
  const canAck = ['admin', 'manager'].includes(profile.role)

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">배치 발행</h1>
        <p className="text-xs text-[#514b81] mt-1">
          연차 일괄 발행·소방계획서 일괄 생성 — 고객별 문서 조회·별지 작성은 고객관리 &gt; 소방계획서 트리에서 합니다
        </p>
      </div>

      {/* 서식 개정 감지 배너 (구 보고서 센터 §10-R3 이전) — 재심기 후 [반영 완료]로 해제 */}
      {revisedList.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" /> 법제처 서식 개정이 감지됐습니다 — 새 서식 수신 후 재심기(개발 PC)가 필요합니다
          </p>
          {revisedList.map(b => (
            <div key={b.key} className="flex items-center gap-2 text-[11px] text-amber-700">
              <span>{b.form_name}: 심어진 서식 {fmtYmd(b.seed_date!)} → 최신 공포 {fmtYmd(b.announce_date)}</span>
              {canAck && (
                <form action={ackLawRevisionAction}>
                  <input type="hidden" name="key" value={b.key} />
                  <button type="submit" title="재심기(placeholder 재실행)를 마친 뒤에만 눌러주세요"
                    className="h-5 px-2 rounded border border-amber-300 text-[10px] text-amber-800 hover:bg-amber-100">재심기 반영 완료</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {/* P-1 연차 일괄 발행 마법사 (S5) */}
      <AnnualIssueWizard defaultYear={new Date().getFullYear() + 1} />

      {/* 소방계획서 일괄 생성 — 고객 다중 선택·프리셋·큐 현황 */}
      <div>
        <h2 className="text-sm font-semibold text-[#090c1d] mb-2">소방계획서 일괄 생성</h2>
        <FirePlanGenerateRequestClient initialStatus={status} />
      </div>
    </div>
  )
}
