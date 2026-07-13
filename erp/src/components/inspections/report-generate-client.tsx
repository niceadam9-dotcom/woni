'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileSpreadsheet, Download, AlertTriangle, Loader2 } from 'lucide-react'
import { generateOperationalReportAction, getGeneratedReportUrlAction } from '@/app/(dashboard)/inspections/report-generate-actions'

export type GenReportRow = { id: string; report_kind: string; file_name: string; generated_at: string; by_name: string | null }

/** 보고서 생성 (P32-5) — 개요 주입 엑셀 생성·다운로드. 엑셀을 열면 수식으로 전 시트 자동완성. */
export function ReportGenerateClient({ inspectionId, history, canManage }: {
  inspectionId: string; history: GenReportRow[]; canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [missing, setMissing] = useState<string[] | null>(null)
  const [error, setError] = useState('')

  function generate() {
    setError(''); setMissing(null)
    startTransition(async () => {
      const res = await generateOperationalReportAction(inspectionId)
      if (res.error) { setError(res.error); if (res.missing?.length) setMissing(res.missing); return }
      if (res.missing?.length) setMissing(res.missing)
      if (res.url) window.open(res.url, '_blank')
      router.refresh()
    })
  }
  function redownload(id: string) {
    startTransition(async () => {
      const res = await getGeneratedReportUrlAction(id)
      if (res.error || !res.url) { setError(res.error ?? '다운로드 실패'); return }
      window.open(res.url, '_blank')
    })
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-3">
        <FileSpreadsheet className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">작동점검 보고서</h2>
        {canManage && (
          <button onClick={generate} disabled={isPending}
            className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <FileSpreadsheet className="size-3.5" />} 보고서 생성
          </button>
        )}
      </div>

      <p className="text-[11px] text-[#b0acd6] mb-2">엑셀을 열면 개요 데이터로 갑지·정보·위임장·계약서가 자동 완성됩니다. (PDF 자동인쇄는 도입 예정)</p>

      {missing && missing.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs font-semibold text-amber-700 flex items-center gap-1 mb-1"><AlertTriangle className="size-3.5" /> 누락 항목 {missing.length}건 (빈칸으로 생성됨)</p>
          <ul className="text-[11px] text-amber-700 space-y-0.5 list-disc pl-4">
            {missing.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {history.length === 0 ? (
        <p className="text-xs text-[#b0acd6] py-2 text-center">생성 이력이 없습니다</p>
      ) : (
        <div className="space-y-1">
          {history.map(h => (
            <div key={h.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-[#f8f9fa] last:border-0">
              <span className="text-[#090c1d]">{h.file_name}</span>
              <span className="text-[#b0acd6]">{h.generated_at.slice(0, 16).replace('T', ' ')}{h.by_name ? ` · ${h.by_name}` : ''}</span>
              <button onClick={() => redownload(h.id)} disabled={isPending}
                className="ml-auto inline-flex items-center gap-1 h-6 px-2 rounded border border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
                <Download className="size-3" /> 다운로드
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
