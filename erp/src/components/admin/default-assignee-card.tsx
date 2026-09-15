'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserCheck } from 'lucide-react'
import { setDefaultAssigneeAction, applyDefaultAssigneeAction } from '@/app/(dashboard)/customers/actions'

/** 기본 담당자 설정 — 직원 관리 상단 카드 (2026-09-15 사용자 확정)
 *
 *  「일반관리」 고객이 담당 미선택으로 저장될 때 채울 직원을 고른다.
 *
 *  ⚠ **설정 저장과 일괄 적용을 가른다.** 드롭다운을 바꾸는 순간 수십 명의 데이터가 함께
 *    바뀌면, 사람을 잘못 고른 순간 되돌릴 방법이 마땅찮다. 저장은 설정만 바꾸고,
 *    과거 데이터는 **버튼을 눌러야** 바뀐다 — 그 전에 대상 수를 문구로 먼저 보여준다.
 *  ⚠ 대상 수(`targetCount`)는 서버가 `defaultAssigneeTargets`로 센 값이다. 화면이 제 나름대로
 *    세면 "2명"이라 말하고 3명을 바꾸는 일이 생긴다.
 */
export function DefaultAssigneeCard({ current, employees, targetCount }: {
  current: string | null
  employees: Array<{ id: string; name: string; position: string | null }>
  /** 지금 설정으로 일괄 적용하면 바뀌는 고객 수 — 설정이 비었으면 0 */
  targetCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  function save(v: string) {
    setMsg(null)
    startTransition(async () => {
      const r = await setDefaultAssigneeAction(v || null)
      if (r.error) { setMsg({ text: r.error, ok: false }); return }
      setMsg({ text: v ? '저장됨' : '해제됨 — 자동 채움을 하지 않습니다', ok: true })
      router.refresh()
    })
  }

  function apply() {
    setMsg(null)
    if (!window.confirm(`「일반」 유형 미배정 ${targetCount}명을 기본 담당자로 채웁니다.\n이미 담당이 있는 고객은 건드리지 않습니다. 진행할까요?`)) return
    startTransition(async () => {
      const r = await applyDefaultAssigneeAction()
      if (r.error) { setMsg({ text: r.error, ok: false }); return }
      setMsg({ text: `${r.applied ?? 0}명에게 적용했습니다 — 화면에 「(기본)」으로 표시됩니다`, ok: true })
      router.refresh()
    })
  }

  return (
    <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4">
      <div className="flex items-center gap-2">
        <UserCheck className="size-4 text-brand" />
        <p className="text-sm font-semibold text-ink">기본 담당자</p>
      </div>
      <p className="mt-1 text-xs text-ink-sub">
        <strong>「일반」 유형</strong> 고객을 담당 없이 저장하면 이 직원으로 채워집니다 —
        「<strong>(기본)</strong>」으로 표시되고 <strong>배정 알림은 보내지 않습니다</strong>.
        작동·종합 유형은 종전대로 미배정으로 남습니다.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <select
          value={current ?? ''}
          onChange={e => save(e.target.value)}
          disabled={isPending}
          data-testid="default-assignee-select"
          className="h-9 rounded-lg border border-brand-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-brand min-w-[170px]"
        >
          <option value="">사용 안 함 (미배정 유지)</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.name}{e.position ? ` (${e.position})` : ''}</option>
          ))}
        </select>
        {isPending && <Loader2 className="size-4 animate-spin text-brand" />}
        {/* 적용 버튼은 **설정과 별개**다 — 저장만으로는 과거 데이터가 바뀌지 않는다 */}
        <button
          type="button" onClick={apply} disabled={isPending || !current || targetCount === 0}
          data-testid="default-assignee-apply"
          className="h-9 rounded-lg border border-brand-line bg-surface px-3 text-sm text-brand hover:bg-brand-tint disabled:opacity-40 disabled:cursor-not-allowed"
        >
          미배정 {targetCount}명에 적용
        </button>
        <span className="text-xs text-ink-meta">
          {!current ? '기본 담당자를 고르면 적용할 수 있습니다'
            : targetCount === 0 ? '채울 「일반」 유형 미배정 고객이 없습니다'
              : '이미 담당이 있는 고객은 건드리지 않습니다'}
        </span>
      </div>
      {msg && (
        <p className={`mt-1.5 text-xs ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>
          {msg.ok ? '✅' : '❌'} {msg.text}
        </p>
      )}
    </div>
  )
}
