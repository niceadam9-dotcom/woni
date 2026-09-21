'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarRange, Loader2 } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { updateInspectionMultidayAction } from '@/app/(dashboard)/inspections/actions'
import {
  daysFromRange, endFromDays, inspectionPeriodError, MAX_INSPECTION_DAYS,
} from '@/lib/inspection-period'

/** 다일 점검(2~5일) 설정 (P32-9) — 종료일 지정 시 6단계 기산점이 종료일로 재계산됨
 *
 *  🚨 2026-09-21 — **종료일과 일수가 서로를 모르고 있었다.** 두 state가 독립이라 종료일을 넣어도
 *    일수가 그대로였고, 사용자는 종료일만 고치고 저장했다. 결과: 다일 점검 **3건 중 3건 전부**
 *    기간은 3·4·8일인데 저장된 일수는 `1`(스테이징 실측 100%). 그 일수는 **별지 9호에 인쇄된다** —
 *    한 종이에서 기간과 일수가 서로를 부정했다.
 *  → 두 칸을 **양방향으로 묶는다**. 산식은 `lib/inspection-period` 한 곳이고 서버 액션도 같은
 *    함수를 쓴다('use server'는 공개 엔드포인트라 화면 검사만 두면 그대로 뚫린다). */
export function InspectionMultidayClient({ inspectionId, startDate, endDate, days, canManage }: {
  inspectionId: string; startDate: string; endDate: string | null; days: number; canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [end, setEnd] = useState(endDate ?? '')
  const [d, setD] = useState(String(days || 1))
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  /** 종료일을 고치면 **일수가 따라온다**. 계산이 안 되는 값(미완성 날짜·역전)이면 일수를 건드리지
   *  않는다 — 타이핑 도중의 중간 상태로 멀쩡한 값을 덮지 않기 위해서다. */
  function onEndChange(v: string) {
    setEnd(v); setMsg(''); setErr('')
    const n = daysFromRange(startDate, v || null)
    if (n !== null) setD(String(n))
  }

  /** 일수를 고치면 **종료일이 따라온다**. 1일이면 종료일을 비운다(079의 「NULL이면 당일」 표기).
   *  ⚠ 상한에서 자른다 — 서버는 범위 밖 값을 종전에 **조용히 1로** 떨어뜨렸다(7 → 5가 아니라 1). */
  function onDaysChange(raw: string) {
    const digits = raw.replace(/\D/g, '')
    setMsg(''); setErr('')
    if (digits === '') { setD(''); return }
    const n = Math.min(parseInt(digits, 10) || 1, MAX_INSPECTION_DAYS)
    setD(String(n))
    setEnd(endFromDays(startDate, n))
  }

  /** 저장 전 판정 — 서버와 **같은 함수**. 여기서 미리 말해 주면 왕복 없이 고칠 수 있다. */
  const localErr = inspectionPeriodError(startDate, end || null)

  function save() {
    setMsg(''); setErr('')
    if (localErr) { setErr(localErr); return }
    startTransition(async () => {
      const res = await updateInspectionMultidayAction(inspectionId, { endDate: end || null, days: parseInt(d, 10) || 1 })
      if (res.error) { setErr(res.error); return }
      // 마이그레이션 128 이후 완료된 단계의 마감일도 함께 재계산된다(마감일은 완료 여부와 무관)
      setMsg('저장했습니다. 종료일 기준으로 단계 마감일이 재계산됩니다.')
      router.refresh()
    })
  }

  return (
    <div className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-4">
      <div className="flex items-center gap-2 mb-2">
        <CalendarRange className="size-4 text-brand" />
        <h3 className="text-sm font-semibold text-ink">점검 기간 <span className="text-xs font-normal text-ink-meta">다일 점검 시 종료일</span></h3>
        <span className="ml-auto text-xs text-ink-sub">시작 {startDate}{end ? ` ~ 종료 ${end}` : ''}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-ink-sub">종료일</span>
        <DateInput value={end} onChange={e => onEndChange(e.target.value)} disabled={!canManage}
          data-testid="multiday-end" className="text-sm h-8" />
        <span className="text-xs text-ink-sub ml-2">일수</span>
        <input value={d} onChange={e => onDaysChange(e.target.value)} disabled={!canManage}
          data-testid="multiday-days" inputMode="numeric" aria-label="점검 일수"
          className="h-8 w-14 rounded-lg border border-brand-line px-2 text-sm outline-none focus:border-brand" />
        <span className="text-xs text-ink-meta">일</span>
        {canManage && (
          <button onClick={save} disabled={isPending || !!localErr} data-testid="multiday-save"
            className="h-8 px-3 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1">
            {isPending && <Loader2 className="size-3.5 animate-spin" />} 저장
          </button>
        )}
      </div>
      {/* 🚨 저장을 누르기 **전에** 말한다 — 종전엔 5일을 넘겨도 화면이 아무 말 없이 받아 놓고
          서버가 일수를 조용히 1로 떨어뜨렸다. 막는 이유를 칸 옆에서 읽을 수 있어야 고친다. */}
      {localErr && <p className="text-form-xs text-red-600 mt-1.5" data-testid="multiday-warn">{localErr}</p>}
      {msg && <p className="text-form-xs text-green-600 mt-1.5">{msg}</p>}
      {err && !localErr && <p className="text-form-xs text-red-600 mt-1.5">{err}</p>}
    </div>
  )
}
