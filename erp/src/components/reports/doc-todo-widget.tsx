'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ClipboardList, Clock3, FileUp, Upload, ArrowRight, CheckSquare } from 'lucide-react'
import { uploadTimelineFileAction } from '@/app/(dashboard)/inspections/timeline-actions'
import type { DueReport9Row, MissingCertRow } from '@/lib/doc-status'

/** 대시보드 '문서 할 일' 위젯 (소방계획서_5 R0-9·4-0-10) —
 *  "오늘 내가 처리할 게 있나?"에 답하는 모니터링 1층. 기한 임박 별지 9호 + 배치확인서 누락.
 *  행 안에 [업로드]/타임라인 링크 내장(4-0-13-(2)) — 여기서 바로 처리, 판정은 lib/doc-status 1곳 공유. */

const cardShadow = 'shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]'

export function DocTodoWidget({ dueSoon, missingCerts: initialMissing }: {
  dueSoon: DueReport9Row[]
  missingCerts: MissingCertRow[]
}) {
  const [missingCerts, setMissingCerts] = useState(initialMissing)
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const targetRef = useRef<MissingCertRow | null>(null)

  const total = dueSoon.length + missingCerts.length

  function pick(row: MissingCertRow) {
    targetRef.current = row
    fileRef.current?.click()
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const target = targetRef.current
    e.target.value = ''
    if (!file || !target) return
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const res = await uploadTimelineFileAction(target.inspectionId, 'cert', fd)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ ${target.customerName} 배치확인서 업로드됨`)
      setMissingCerts(prev => prev.filter(r => r.inspectionId !== target.inspectionId))
    })
  }

  return (
    <div className={`bg-white rounded-xl border border-[#c8c4d0] ${cardShadow}`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">문서 할 일</h2>
          {total > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">{total}건</span>
          )}
        </div>
        <Link href="/reports" className="text-xs text-[#7b68ee] hover:underline flex items-center gap-1">
          보고서 센터 <ArrowRight className="size-3" />
        </Link>
      </div>

      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden" onChange={onPicked} />

      {total === 0 ? (
        <div className="px-5 py-8 flex flex-col items-center gap-2">
          <div className="size-12 rounded-full bg-green-50 flex items-center justify-center">
            <CheckSquare className="size-6 text-green-500" />
          </div>
          <p className="text-sm font-medium text-green-700">처리할 문서가 없습니다</p>
          <p className="text-xs text-[#514b81]">제출 기한·배치확인서 모두 정상입니다</p>
        </div>
      ) : (
        <div className="divide-y divide-[#f8f9fa]">
          {msg && <p className={`px-5 py-1.5 text-[11px] ${msg.startsWith('✅') ? 'text-green-600' : 'text-red-600'}`}>{msg}</p>}
          {/* 제출 기한 임박 별지 9호 (D-7 이내·초과) */}
          {dueSoon.map(r => (
            <div key={`due-${r.inspectionId}`} className="flex items-center gap-2 px-5 py-3 text-xs flex-wrap">
              <Clock3 className="size-3.5 text-red-500 shrink-0" />
              <span className="font-medium text-[#090c1d]">{r.customerName}</span>
              <span className="text-[#514b81]">{r.year}년 {r.sequenceNum}차 · 별지 9호 제출</span>
              <span className={`font-semibold ${r.dday < 0 ? 'text-red-600' : 'text-amber-700'}`}>
                {r.dday < 0 ? `기한 초과 ${-r.dday}일` : `D-${r.dday}`}
              </span>
              <Link href={`/inspections/${r.inspectionId}`} className="ml-auto text-[11px] text-[#7b68ee] hover:underline shrink-0">
                타임라인에서 →
              </Link>
            </div>
          ))}
          {/* 배치확인서 누락 — 행 안에서 바로 업로드 */}
          {missingCerts.map(r => (
            <div key={`cert-${r.inspectionId}`} className="flex items-center gap-2 px-5 py-3 text-xs flex-wrap">
              <FileUp className="size-3.5 text-amber-600 shrink-0" />
              <span className="font-medium text-[#090c1d]">{r.customerName}</span>
              <span className="text-[#514b81]">{r.year}년 {r.sequenceNum}차 · 배치확인서 미업로드</span>
              {r.daysSince !== null && <span className="text-amber-700">완료 후 {r.daysSince}일 경과</span>}
              <button onClick={() => pick(r)} disabled={isPending}
                className="ml-auto inline-flex items-center gap-1 h-6 px-2 rounded border border-amber-300 text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-50 shrink-0">
                <Upload className="size-3" /> 업로드
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
