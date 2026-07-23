'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ClipboardCopy, Check, X, ExternalLink, AlertTriangle, Loader2 } from 'lucide-react'
import { getPlacementInfoAction, type PlacementField } from '@/app/(dashboard)/inspections/timeline-actions'

/** ⑥ 배치신고 도우미 (소방계획서_5 R7) — [신고 정보 복사] + 복사 전 미리보기 팝오버.
 *  빈 값 앰버·입력처 딥링크 + '✓ 복사됨' 피드백 + 협회 링크 병치 (복사→이동 한 흐름). */
export function PlacementReportHelper({ inspectionId }: { inspectionId: string }) {
  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState<PlacementField[] | null>(null)
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')
  const [pending, startTransition] = useTransition()

  function openPreview() {
    setErr(''); setCopied(false); setOpen(true)
    if (fields) return
    startTransition(async () => {
      const res = await getPlacementInfoAction(inspectionId)
      if (res.error || !res.fields) { setErr(res.error ?? '정보를 불러오지 못했습니다.'); return }
      setFields(res.fields); setText(res.text ?? '')
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { setErr('클립보드 복사에 실패했습니다.') }
  }

  return (
    <span className="relative inline-block">
      <button onClick={openPreview} disabled={pending}
        className="inline-flex items-center gap-1 h-6 px-2 rounded border border-[#d0ccf5] text-[10px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
        {pending ? <Loader2 className="size-3 animate-spin" /> : <ClipboardCopy className="size-3" />} 신고 정보 복사
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-xl border border-[#d0ccf5] bg-white shadow-lg p-3 text-left">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#090c1d]">협회 배치신고 정보</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700"><X className="size-3.5" /></button>
          </div>
          {err && <p className="text-[11px] text-red-600 mb-1.5">{err}</p>}
          {!fields ? (
            <p className="text-[11px] text-[#b0acd6] py-3 text-center">불러오는 중…</p>
          ) : (
            <>
              <div className="space-y-1 mb-2">
                {fields.map(f => (
                  <div key={f.label} className="flex items-start gap-1.5 text-[11px]">
                    <span className="text-[#b0acd6] w-14 shrink-0">{f.label}</span>
                    {f.missing ? (
                      <span className="flex items-center gap-1 text-amber-600 flex-1">
                        <AlertTriangle className="size-3 shrink-0" /> 미입력
                        {f.href && <Link href={f.href} className="text-[#7b68ee] hover:underline">→ {f.hrefLabel ?? '입력'}</Link>}
                      </span>
                    ) : (
                      <span className="text-[#090c1d] flex-1 whitespace-pre-wrap break-words">{f.value}</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={copy}
                  className={`inline-flex items-center gap-1 h-7 px-2.5 rounded text-[11px] font-medium ${copied ? 'bg-green-500 text-white' : 'bg-[#7b68ee] hover:bg-[#6647f0] text-white'}`}>
                  {copied ? <><Check className="size-3" /> 복사됨</> : <><ClipboardCopy className="size-3" /> 복사</>}
                </button>
                <a href="https://www.kfma.kr" target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 h-7 px-2 rounded border border-[#d0ccf5] text-[11px] text-[#514b81] hover:text-[#7b68ee] hover:border-[#7b68ee]">
                  협회 신고 <ExternalLink className="size-3" />
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  )
}
