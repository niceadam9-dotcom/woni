'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { FileText, Loader2, RefreshCw, Download, CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  requestReport9Action, getReport9StatusAction, downloadReport9Action,
  type Report9Job, type Report9File,
} from '@/app/(dashboard)/inspections/report9-actions'

/** 실시결과 보고서(별지 9호) 준비·생성 섹션 — §9-6⑦ 준비 체크리스트 + 생성 버튼 + 생성물 목록.
 *  값 수정은 각 입력처(고객 탭·참여자·점검표)에서 — 이 화면은 상태 표시와 생성만. */

export type Report9CheckRow = { label: string; ok: boolean; detail: string; href?: string; hrefLabel?: string }

export function InspectionReport9Client({
  inspectionId, canManage, checks, initialJob, initialFiles,
}: {
  inspectionId: string
  canManage: boolean
  checks: Report9CheckRow[]
  initialJob: Report9Job | null
  initialFiles: Report9File[]
}) {
  const [job, setJob] = useState(initialJob)
  const [files, setFiles] = useState(initialFiles)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const busy = job?.status === 'pending' || job?.status === 'processing'

  // 생성 진행 중이면 8초 간격 상태 폴링
  useEffect(() => {
    if (!busy) return
    const t = setInterval(async () => {
      const res = await getReport9StatusAction(inspectionId)
      if (!res.error) { setJob(res.job); setFiles(res.files) }
    }, 8000)
    return () => clearInterval(t)
  }, [busy, inspectionId])

  function generate() {
    setMsg('')
    startTransition(async () => {
      const res = await requestReport9Action(inspectionId)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      const st = await getReport9StatusAction(inspectionId)
      if (!st.error) { setJob(st.job); setFiles(st.files) }
      setMsg('✅ 생성 요청됨 — 워커가 처리하면 아래 목록에 등록됩니다.')
    })
  }

  function download(path: string) {
    startTransition(async () => {
      const res = await downloadReport9Action(inspectionId, path)
      if (res.error || !res.url) { setMsg(`❌ ${res.error ?? '다운로드 실패'}`); return }
      window.open(res.url, '_blank')
    })
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">실시결과 보고서 (별지 9호)</h2>
        <span className="text-[11px] text-[#b0acd6]">1~3쪽 자동 병합 · 4~8쪽 빈 서식 포함</span>
      </div>

      {/* 준비 체크리스트 — 각 행은 읽기 전용 상태 + 입력처 딥링크 (§9-6⑦) */}
      <div className="space-y-1.5 mb-3">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-2 text-xs">
            {c.ok
              ? <CheckCircle2 className="size-3.5 text-green-600 shrink-0" />
              : <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />}
            <span className="text-[#090c1d] font-medium w-28">{c.label}</span>
            <span className={c.ok ? 'text-[#514b81]' : 'text-amber-600'}>{c.detail}</span>
            {c.href && !c.ok && (
              <Link href={c.href} className="text-[#7b68ee] hover:underline ml-auto">{c.hrefLabel ?? '입력 →'}</Link>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={generate} disabled={isPending || busy}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50">
            {busy || isPending ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
            {busy ? '생성 중 — 워커 처리 대기' : '보고서 생성 (HWP+PDF)'}
          </button>
          {checks.some(c => !c.ok) && (
            <span className="text-[11px] text-amber-600">미비 항목은 빈 칸으로 출력됩니다 (fail-soft)</span>
          )}
        </div>
      )}
      {msg && <p className="text-xs text-[#514b81] mt-2">{msg}</p>}
      {job?.status === 'failed' && (
        <p className="text-xs text-red-600 mt-2">❌ 생성 실패: {job.error ?? '알 수 없는 오류'}</p>
      )}
      {job?.status === 'done' && job.missing && job.missing.length > 0 && (
        <p className="text-[11px] text-amber-600 mt-2">누락: {job.missing.join(' · ')}</p>
      )}

      {/* 생성물 목록 */}
      {files.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#e0ddf5] space-y-1">
          {files.map(f => (
            <div key={f.path} className="flex items-center gap-2 text-xs">
              <span className="text-[#090c1d] truncate">{f.name}</span>
              {f.createdAt && <span className="text-[11px] text-[#b0acd6]">{f.createdAt.slice(0, 16).replace('T', ' ')}</span>}
              <button onClick={() => download(f.path)} disabled={isPending}
                className="ml-auto inline-flex items-center gap-1 h-6 px-2 rounded border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
                <Download className="size-3" /> 받기
              </button>
            </div>
          ))}
        </div>
      )}
      {busy && (
        <p className="text-[11px] text-[#b0acd6] mt-2 inline-flex items-center gap-1">
          <RefreshCw className="size-3 animate-spin" /> 자동 새로고침 중 — 개발 PC 워커가 처리합니다
        </p>
      )}
    </div>
  )
}
