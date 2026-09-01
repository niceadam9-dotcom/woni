'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { inspectionCheckboxes } from '@/lib/inspection-round'
import { updateInspectionInitialAction } from '@/app/(dashboard)/inspections/actions'

/** 법정 구분 3분기 — 별지 9호·4호 머리와 **같은 표기**를 화면에서도 보고 고칠 수 있게 한다.
 *
 *  왜 화면에 두는가: 종전에는 이 값을 인쇄물을 뽑아 봐야만 알 수 있었다. 그래서 별지 9호가
 *  세 칸 모두 빈칸으로 나가던 결함(F-3)을 아무도 못 봤다. 여기 보이는 것과 서식에 찍히는 것은
 *  `inspectionCheckboxes` 한 함수가 정한다 — 두 곳이 갈라질 수 없다.
 *
 *  최초점검만 사람이 고칠 수 있다. 작동/종합 자체는 계획 항목의 차수·고객 유형에서 파생되므로
 *  여기서 바꿀 값이 아니다(바꾸려면 계획을 고쳐야 한다). */
export function InspectionLegalTypeClient({ inspectionId, inspectionType, planType, isInitial, canManage }: {
  inspectionId: string
  inspectionType: string | null
  planType: string | null
  isInitial: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [init, setInit] = useState(isInitial)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const ck = inspectionCheckboxes(inspectionType, init, planType)
  const box = (on: boolean) => (on ? '[√]' : '[  ]')
  // 작동점검이면 최초점검 칸 자체가 성립하지 않는다 — 토글을 숨긴다(서버도 거절한다)
  const canToggleInitial = canManage && !ck.ckOp

  function toggle() {
    const next = !init
    setMsg(''); setErr('')
    setInit(next)                                   // 낙관적 반영 — 실패하면 되돌린다
    startTransition(async () => {
      const res = await updateInspectionInitialAction(inspectionId, next)
      if (res.error) { setInit(!next); setErr(res.error); return }
      setMsg(res.sourceRecorded
        ? '저장했습니다. 이후 자동판정이 이 값을 덮지 않습니다.'
        : '저장했습니다. ⚠ 판정 출처는 기록되지 않았습니다(마이그레이션 155 미적용) — 재계산이 덮을 수 있습니다.')
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="inspection-legal-type">
      <p className="text-xs text-ink-meta font-mono whitespace-pre">
        {`${box(ck.ckOp)} 작동점검,  종합점검(${box(ck.ckInitial)}최초점검,  ${box(ck.ckCompEtc)}그 밖의 종합점검)`}
      </p>
      {canToggleInitial && (
        <button
          type="button" onClick={toggle} disabled={isPending}
          data-testid="toggle-initial"
          className="h-6 px-2 rounded-md border border-brand-line text-[11px] text-ink-sub hover:bg-paper disabled:opacity-50 inline-flex items-center gap-1"
        >
          {isPending && <Loader2 className="size-3 animate-spin" />}
          {init ? '최초점검 해제' : '최초점검으로 지정'}
        </button>
      )}
      {msg && <span className="text-[11px] text-green-600">{msg}</span>}
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </div>
  )
}
