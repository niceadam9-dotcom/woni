'use client'

import { useState, useTransition } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import {
  getSectionCopyCandidatesAction, copySectionFromCustomerAction, type SectionCopyCandidate,
} from '@/app/(dashboard)/customers/fire-plan-form-actions'

/** §11-6: 다른 고객 섹션 복사 버튼 — 같은 용도 고객 우선 후보 목록 → 선택 시 저장 후 onApplied로 화면 반영 */
export function SectionCopyButton({ customerId, sectionKey, sectionLabel, onApplied }: {
  customerId: string
  sectionKey: 'evacFire' | 'etcFacility' | 'training'
  sectionLabel: string
  onApplied: (value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<SectionCopyCandidate[] | null>(null)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function load() {
    setMsg('')
    if (open) { setOpen(false); return }
    setOpen(true)
    startTransition(async () => {
      const res = await getSectionCopyCandidatesAction(customerId, sectionKey)
      if (res.error) { setMsg(res.error); setCandidates([]); return }
      setCandidates(res.candidates)
    })
  }

  function copyFrom(sourceId: string) {
    startTransition(async () => {
      const res = await copySectionFromCustomerAction(customerId, sourceId, sectionKey)
      if (res.error) { setMsg(res.error); return }
      setOpen(false)
      onApplied(res.value)
    })
  }

  return (
    <div className="relative inline-block">
      <button onClick={load} disabled={isPending} type="button"
        title={`다른 고객의 ${sectionLabel} 입력을 복사해 채웁니다 (같은 용도 우선)`}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] border border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
        {isPending ? <Loader2 className="size-3 animate-spin" /> : <Copy className="size-3" />} 다른 고객에서 복사
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 w-64 rounded-lg border border-[#d0ccf5] bg-white shadow-lg p-1.5">
          {candidates === null ? (
            <p className="text-[11px] text-[#b0acd6] px-2 py-1.5">불러오는 중…</p>
          ) : candidates.length === 0 ? (
            <p className="text-[11px] text-[#b0acd6] px-2 py-1.5">{msg || `${sectionLabel} 입력이 있는 다른 고객이 없습니다.`}</p>
          ) : (
            <>
              <p className="text-[10px] text-[#b0acd6] px-2 pb-1">복사하면 현재 입력을 덮어쓰고 즉시 저장됩니다.</p>
              {candidates.map(c => (
                <button key={c.id} onClick={() => copyFrom(c.id)} disabled={isPending} type="button"
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-[#f5f4ff] text-xs text-[#090c1d] flex items-center gap-1.5 disabled:opacity-50">
                  <span className="truncate">{c.name}</span>
                  {c.purpose && <span className="text-[10px] text-[#b0acd6] shrink-0">{c.purpose}</span>}
                  {c.updatedAt && <span className="ml-auto text-[10px] text-[#b0acd6] shrink-0">{c.updatedAt.slice(0, 10)}</span>}
                </button>
              ))}
              {msg && <p className="text-[11px] text-red-600 px-2 py-1">{msg}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
