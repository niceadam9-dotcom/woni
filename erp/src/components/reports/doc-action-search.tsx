'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Search, FileText, FileType2, Upload, Loader2, FolderOpen } from 'lucide-react'
import {
  searchDocCommandsAction, getDocUrlAction, type DocCommand,
} from '@/app/(dashboard)/reports/docs-actions'
import { uploadTimelineFileAction } from '@/app/(dashboard)/inspections/timeline-actions'
import { openAnnexHwp, openAnnexPdf } from '@/lib/annex-filename'

/** 행동 자동완성 검색 (소방계획서_5 R0-3·4-0-13-(1)) — 검색 결과가 곧 실행 버튼.
 *  고객 2자/초성(R0-5) 입력 → 문서·행동 후보 드롭다운에서 즉시 실행(PDF 보기·HWP 받기·업로드·생성).
 *  보고서 센터 검색창(⓪)과 Ctrl+K 팔레트(R0-4)가 같은 컴포넌트를 재사용. */

export function DocActionSearch({ onOpenDocs, autoFocus, placeholder }: {
  onOpenDocs: (customerId: string, customerName: string) => void
  autoFocus?: boolean
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; type: string }>>([])
  const [commands, setCommands] = useState<DocCommand[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<DocCommand | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // 250ms 디바운스 검색
  useEffect(() => {
    if (q.trim().length < 1) { setCustomers([]); setCommands([]); setOpen(false); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await searchDocCommandsAction(q)
        setCustomers(res.customers)
        setCommands(res.commands)
        setOpen(true)
      } finally { setLoading(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function openFile(path: string | undefined, saveName?: string) {
    if (!path) return
    startTransition(async () => {
      const res = await getDocUrlAction(path, saveName)
      if (res.error || !res.url) { setMsg(`❌ ${res.error ?? '다운로드 실패'}`); return }
      window.open(res.url, '_blank')
    })
  }

  function pickUpload(c: DocCommand) {
    uploadTargetRef.current = c
    fileRef.current?.click()
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const target = uploadTargetRef.current
    e.target.value = ''
    if (!file || !target || target.kind !== 'upload-cert') return
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const res = await uploadTimelineFileAction(target.inspectionId, 'cert', fd)
      setMsg(res.error ? `❌ ${res.error}` : `✅ ${target.customerName} 배치확인서 업로드됨`)
    })
  }

  // '소방계획서 생성 요청' 명령 폐지(2026-09-02 보관함 폐지) — 계획서는 파일로 만들지 않고
  // 고객 소방계획서 탭 [조회·개정이력]에서 즉석 조회·인쇄한다

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-faint" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setMsg('') }}
          onFocus={() => { if (customers.length > 0 || commands.length > 0) setOpen(true) }}
          autoFocus={autoFocus}
          placeholder={placeholder ?? '고객명을 검색하세요 — 문서 확인·생성이 여기서 시작됩니다 (초성 ㅅㄹㅅ 가능)'}
          className="h-10 w-full rounded-xl border border-brand-line bg-surface pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {(loading || isPending) && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-ink-faint" />}
      </div>
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden" onChange={onFilePicked} />
      {msg && <p className={`text-[11px] mt-1 ${msg.startsWith('✅') ? 'text-green-600' : 'text-red-600'}`}>{msg}</p>}

      {open && (customers.length > 0 || commands.length > 0) && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-brand-line bg-surface shadow-lg py-1 max-h-80 overflow-y-auto">
          {/* 행동 후보 — 최상위 매칭 고객의 문서·행동 (즉시 실행) */}
          {commands.map((c, idx) => (
            <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-paper">
              {c.kind === 'open-docs' && (
                <button onClick={() => { setOpen(false); onOpenDocs(c.customerId, c.customerName) }}
                  className="flex items-center gap-1.5 text-ink font-medium hover:text-brand flex-1 text-left">
                  <FolderOpen className="size-3.5 text-brand" /> {c.label}
                </button>
              )}
              {c.kind === 'open-file' && (<>
                <span className="text-ink flex-1 truncate">{c.label}</span>
                {c.pdfPath && (
                  <button onClick={() => (c.inspectionId ? openAnnexPdf(c.inspectionId, c.pdfPath!) : openFile(c.pdfPath))} disabled={isPending} title="바로 보기·인쇄"
                    className="inline-flex items-center gap-1 h-6 px-2 rounded border border-red-200 text-[11px] text-red-600 hover:bg-red-50">
                    <FileType2 className="size-3" /> PDF 보기
                  </button>
                )}
                {c.hwpPath && (
                  <button onClick={() => (c.inspectionId ? openAnnexHwp(c.inspectionId, c.hwpPath!) : openFile(c.hwpPath))} disabled={isPending} title="한글 편집용 원본 내려받기"
                    className="inline-flex items-center gap-1 h-6 px-2 rounded border border-blue-200 text-[11px] text-blue-600 hover:bg-blue-50">
                    <FileText className="size-3" /> HWP 받기
                  </button>
                )}
              </>)}
              {c.kind === 'upload-cert' && (<>
                <span className="text-amber-600 flex-1 truncate">{c.label}</span>
                <button onClick={() => pickUpload(c)} disabled={isPending}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded border border-brand-line text-[11px] text-brand hover:bg-brand-tint">
                  <Upload className="size-3" /> 업로드
                </button>
              </>)}
            </div>
          ))}
          {/* 그 외 매칭 고객 — 문서 현황 열기 */}
          {customers.slice(1).length > 0 && <div className="border-t border-brand-line-soft my-1" />}
          {customers.slice(1).map(c => (
            <button key={c.id} onClick={() => { setOpen(false); onOpenDocs(c.id, c.name) }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-paper">
              <FolderOpen className="size-3.5 text-ink-faint" />
              <span className="text-ink">{c.name}</span>
              <span className="text-ink-faint">· {c.type} · 문서 현황 열기</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
