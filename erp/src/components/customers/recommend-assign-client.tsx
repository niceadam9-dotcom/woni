'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserCheck } from 'lucide-react'
import { patchCustomerFieldAction } from '@/app/(dashboard)/customers/actions'

/** §6-E: 지역 기반 담당 추천 원클릭 배정 — 같은 지역(시군구+읍면) 고객들의 최빈 담당을 제안 */
export function RecommendAssignClient({ customerId, employeeId, employeeName, regionLabel }: {
  customerId: string
  employeeId: string
  employeeName: string
  regionLabel: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function assign() {
    startTransition(async () => {
      const res = await patchCustomerFieldAction(customerId, 'assigned_employee_id', employeeId)
      if (res.error) { alert(res.error); return }
      router.refresh()
    })
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#514b81]">
      이 지역({regionLabel}) 담당: <span className="font-medium text-[#090c1d]">{employeeName}</span>
      <button onClick={assign} disabled={isPending}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium disabled:opacity-50">
        {isPending ? <Loader2 className="size-3 animate-spin" /> : <UserCheck className="size-3" />}
        원클릭 배정
      </button>
    </span>
  )
}
