'use client'

import { useState, useTransition } from 'react'
import { FileSpreadsheet, Download } from 'lucide-react'
import { getGeneratedReportUrlAction } from '@/app/(dashboard)/inspections/report-generate-actions'

export type GenReportRow = { id: string; report_kind: string; file_name: string; generated_at: string; by_name: string | null }

/** 소방시설등점검표(엑셀) — **생성 폐지, 과거 이력 조회만** (소방계획서_21 R5-6 / 소방계획서_7 D-9)
 *
 *  엑셀 생성은 별지 4호 PDF로 대체됐다. 폐지 전 R5-7 대조로 유실이 없음을 확인했다 —
 *  엑셀에만 있던 점검항목 12건은 마이그레이션 132·133으로 별지 4호 원천에 편입했고,
 *  펌프성능시험 실측치는 131로 자리를 만들어 별지 4호 표에 실린다.
 *
 *  ⚠ 과거에 생성된 파일은 남긴다. 폐지 대상은 **생성**이지 이미 만들어 둔 기록에 대한 접근이 아니다.
 *     이 화면이 없으면 실고객의 기존 xlsx에 닿을 길이 사라진다. */
export function ReportGenerateClient({ history }: {
  inspectionId?: string; history: GenReportRow[]; canManage?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function redownload(id: string) {
    startTransition(async () => {
      const res = await getGeneratedReportUrlAction(id)
      if (res.error || !res.url) { setError(res.error ?? '다운로드 실패'); return }
      window.open(res.url, '_blank')
    })
  }

  // 이력이 없으면 화면에서 통째로 뺀다 — 폐지된 기능의 빈 카드를 남길 이유가 없다
  if (history.length === 0) return null

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <FileSpreadsheet className="size-4 text-ink-faint" />
        <h2 className="text-sm font-semibold text-ink-sub">소방시설등점검표 (엑셀) — 과거 생성물</h2>
        <span className="text-[10px] text-ink-meta">엑셀 생성은 폐지됐습니다 — 별지 4호 PDF로 대체</span>
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      <div className="space-y-1">
        {history.map(h => (
          <div key={h.id} className="flex items-center gap-2 border-b border-paper py-1.5 text-xs last:border-0">
            <span className="text-ink">{h.file_name}</span>
            <span className="text-ink-meta">{h.generated_at.slice(0, 16).replace('T', ' ')}{h.by_name ? ` · ${h.by_name}` : ''}</span>
            <button onClick={() => redownload(h.id)} disabled={isPending}
              className="ml-auto inline-flex h-6 items-center gap-1 rounded border border-brand-line px-2 text-brand hover:bg-brand-tint disabled:opacity-50">
              <Download className="size-3" /> 다운로드
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
