import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { LeaveForm } from '@/components/leaves/leave-form'

export default async function NewLeavePage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const year = new Date().getFullYear()

  const { data: balRaw } = await admin
    .from('leave_balances')
    .select('total_days, used_days')
    .eq('employee_id', profile.id)
    .eq('year', year)
    .single()

  const bal = balRaw as { total_days: number; used_days: number } | null
  const totalDays = bal?.total_days ?? 15
  const usedDays = bal?.used_days ?? 0
  const remaining = totalDays - usedDays

  // FIX-13: 미리보기 일수 계산용 공휴일 (올해·내년 — 연말 걸친 신청 대비)
  const { data: holsRaw } = await admin
    .from('holidays')
    .select('date')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year + 1}-12-31`)
  const holidays = ((holsRaw ?? []) as { date: string }[]).map(h => h.date)

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link
          href="/leaves"
          className="inline-flex items-center justify-center size-9 rounded-lg border border-[#c8c4d0] text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">휴가 신청</h1>
          <p className="text-sm text-[#514b81] mt-0.5">휴가 신청서를 작성해주세요</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] p-6">
        <LeaveForm remaining={remaining} totalDays={totalDays} holidays={holidays} />
      </div>
    </div>
  )
}
