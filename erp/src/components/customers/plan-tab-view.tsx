'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { FileOutput, Printer, Download, Loader2, History, BookOpen, Users, DoorOpen, Save } from 'lucide-react'
import {
  generateFirePlanPdfNowAction, requestFirePlanHwpFromTabAction, saveFirePlanRevisionAction,
} from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { downloadFirePlanDataSheetAction } from '@/app/(dashboard)/customers/fire-plan-actions'
import { recommendPresetType } from '@/lib/fire-plan-presets'
import { DateInput } from '@/components/ui/date-input'

/** 소방계획서 탭 골격 (4-1, 소방계획서_4.md §1·§2)
 *  구조: 생성 바(항상 고정) + 서브탭(장 단위) + 서식 탭(1장 내부).
 *  4-1 활성 범위: [개정이력·보관] + [1장 > 1.1]. 2·3장과 1.2~1.15는 예약(후속 단계). */

export type RevisionRow = { year: number; revision: number; date: string; note: string | null; uploader: string | null }

const CHAPTERS = [
  { key: 'archive', label: '개정이력·보관', icon: History },
  { key: 'ch1', label: '1장 소방안전관리계획', icon: BookOpen },
  { key: 'ch2', label: '2장 자위소방대', icon: Users, disabled: true },
  { key: 'ch3', label: '3장 피난계획', icon: DoorOpen, disabled: true },
] as const

/** 1장 서식 탭 — 4-1은 1.1만 활성 (소방계획서_4.md §3 순서) */
const CH1_FORMS = [
  { key: '1.1', label: '1.1 일반현황', active: true },
  { key: '1.2', label: '1.2 세부현황' },
  { key: '1.3', label: '1.3 위치·소방차진입' },
  { key: '1.4', label: '1.4 소방시설' },
  { key: '1.5', label: '1.5 피난·방화' },
  { key: '1.6', label: '1.6 기타시설' },
  { key: '1.7', label: '1.7 선임현황' },
  { key: '1.10', label: '1.10 자체점검' },
  { key: '1.11', label: '1.11 훈련·교육' },
]

export function PlanTabView({
  customerId, canManage, purpose, readiness, revisionInitial, revisionRows, initialSection, archive, form11,
}: {
  customerId: string
  canManage: boolean
  purpose: string | null
  readiness: { done: number; total: number; missing: string[] }
  revisionInitial: { revisionDate: string; revisionNote: string }
  revisionRows: RevisionRow[]
  initialSection?: string
  archive: ReactNode
  form11: ReactNode
}) {
  const router = useRouter()
  const [chapter, setChapter] = useState<string>(
    CHAPTERS.some(c => c.key === initialSection && !('disabled' in c && c.disabled)) ? initialSection! : 'archive')
  const [year, setYear] = useState(new Date().getFullYear())
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState('')
  const [rev, setRev] = useState(revisionInitial)
  const [revDirty, setRevDirty] = useState(false)
  const [isRevPending, startRevTransition] = useTransition()

  function generateHwp() {
    setMsg('')
    startTransition(async () => {
      const res = await requestFirePlanHwpFromTabAction(customerId, year, recommendPresetType(purpose))
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ HWP 생성 요청됨 (${year}년) — 워커가 처리하면 보관함에 등록됩니다`)
    })
  }

  function generatePdf() {
    setMsg('')
    startTransition(async () => {
      const res = await generateFirePlanPdfNowAction(customerId)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ PDF 생성 완료 — 보관함에 등록됐습니다')
      router.refresh()
    })
  }

  function downloadDataSheet() {
    startTransition(async () => {
      const res = await downloadFirePlanDataSheetAction(customerId)
      if (res.error || !res.base64) { setMsg(`❌ ${res.error ?? '데이터 시트 생성 실패'}`); return }
      const bytes = Uint8Array.from(atob(res.base64), c => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = res.fileName ?? '계획서데이터시트.pdf'
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  function saveRevision() {
    startRevTransition(async () => {
      const res = await saveFirePlanRevisionAction(customerId, rev)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setRevDirty(false)
      setMsg('✅ 개정이력 입력 저장됨 — 다음 생성 시 개정이력 표에 반영됩니다')
    })
  }

  const pct = readiness.total > 0 ? Math.round((readiness.done / readiness.total) * 100) : 0

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      {/* 생성 바 — 모든 서브탭 상단 고정 (소방계획서_4.md §2) */}
      <div className="flex items-center gap-3 flex-wrap pb-4 border-b border-[#e0ddf5] mb-4">
        <div className="flex items-center gap-2 min-w-40">
          <span className="text-sm font-semibold text-[#090c1d]">소방계획서</span>
          <div className="h-1.5 w-20 rounded-full bg-[#eceafd] overflow-hidden">
            <div className="h-full rounded-full bg-[#7b68ee]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-[#514b81]">{readiness.done}/{readiness.total}</span>
        </div>
        {readiness.missing.length > 0 && (
          <span className="text-[11px] text-amber-600 truncate max-w-56" title={readiness.missing.join(', ')}>
            누락: {readiness.missing.slice(0, 3).join(' · ')}{readiness.missing.length > 3 ? ` 외 ${readiness.missing.length - 3}` : ''}
          </span>
        )}
        {canManage && (
          <div className="flex items-center gap-1.5 ml-auto">
            <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value || '0', 10))}
              className="h-8 w-20 rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]" />
            <button onClick={generateHwp} disabled={isPending}
              title="한글 원본 생성 — 워커(한글 SDK) 큐로 요청, 완료 시 보관함 등록"
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50">
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <FileOutput className="size-3.5" />} HWP 생성
            </button>
            <button onClick={generatePdf} disabled={isPending}
              title="표준양식 PDF 즉시 생성 — 저장된 양식 데이터(없으면 자동 기본값)로 생성"
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
              <Printer className="size-3.5" /> PDF 생성
            </button>
            <button onClick={downloadDataSheet} disabled={isPending}
              title="한글 수동 편집용 데이터 요약 1장"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
              <Download className="size-3.5" /> 데이터 시트
            </button>
          </div>
        )}
      </div>
      {msg && <p className="text-xs text-[#514b81] mb-3">{msg}</p>}

      {/* 서브탭 (장 단위) */}
      <div className="flex items-center gap-1 flex-wrap mb-4">
        {CHAPTERS.map(c => {
          const disabled = 'disabled' in c && c.disabled
          const Icon = c.icon
          return (
            <button key={c.key}
              onClick={() => !disabled && setChapter(c.key)}
              disabled={disabled}
              title={disabled ? '후속 단계에서 제공됩니다 (소방계획서_4.md 4-4·4-5)' : undefined}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
                chapter === c.key
                  ? 'bg-[#7b68ee] text-white'
                  : disabled
                    ? 'text-[#b0acd6] cursor-not-allowed'
                    : 'text-[#514b81] hover:bg-[#f5f4ff]'
              }`}>
              <Icon className="size-3.5" /> {c.label}
              {disabled && <span className="text-[9px]">준비 중</span>}
            </button>
          )
        })}
      </div>

      {/* ── 개정이력·보관 ── */}
      {chapter === 'archive' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
            <p className="text-xs font-semibold text-[#514b81] mb-2">개정이력</p>
            {revisionRows.length > 0 ? (
              <table className="w-full text-xs mb-3">
                <thead>
                  <tr className="border-b border-[#e0ddf5] text-left text-[11px] text-[#514b81]">
                    <th className="pb-1 pr-3 font-medium w-12">순번</th>
                    <th className="pb-1 pr-3 font-medium w-24">일자</th>
                    <th className="pb-1 pr-3 font-medium">주요 개정내용</th>
                    <th className="pb-1 font-medium w-20">작성자</th>
                  </tr>
                </thead>
                <tbody>
                  {revisionRows.map((r, i) => (
                    <tr key={`${r.year}-${r.revision}-${i}`} className="border-b border-[#f3f1fb] last:border-0">
                      <td className="py-1.5 pr-3 text-[#514b81]">{i + 1}</td>
                      <td className="py-1.5 pr-3 text-[#090c1d]">{r.date.slice(0, 10)}</td>
                      <td className="py-1.5 pr-3 text-[#090c1d]">{r.note ?? `${r.year}년 소방계획서${r.revision > 1 ? ` (개정${r.revision})` : ' 작성'}`}</td>
                      <td className="py-1.5 text-[#514b81]">{r.uploader ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[11px] text-[#b0acd6] mb-3">생성 이력이 없습니다 — 첫 생성 시 1행이 기록됩니다</p>
            )}
            {canManage && (
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <label className="text-[11px] font-medium text-[#514b81] block mb-1">이번 작성일 <span className="text-[#b0acd6] font-normal">(비우면 생성일)</span></label>
                  <DateInput value={rev.revisionDate}
                    onChange={e => { setRev(p => ({ ...p, revisionDate: e.target.value })); setRevDirty(true) }}
                    className="h-8 text-xs" />
                </div>
                <div className="flex-1 min-w-52">
                  <label className="text-[11px] font-medium text-[#514b81] block mb-1">주요 개정내용</label>
                  <input value={rev.revisionNote}
                    onChange={e => { setRev(p => ({ ...p, revisionNote: e.target.value })); setRevDirty(true) }}
                    placeholder={`${year}년 소방계획서 작성`}
                    className="h-8 w-full rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]" />
                </div>
                <button onClick={saveRevision} disabled={!revDirty || isRevPending}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
                  {isRevPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 저장
                </button>
              </div>
            )}
            <p className="text-[10px] text-[#b0acd6] mt-2">생성(HWP·PDF) 시 위 목록 + 이번 작성일·개정내용이 문서의 개정이력 표에 병합됩니다.</p>
          </div>
          {archive}
        </div>
      )}

      {/* ── 1장 소방안전관리계획 ── */}
      {chapter === 'ch1' && (
        <div>
          <div className="flex items-center gap-1 flex-wrap mb-3">
            {CH1_FORMS.map(f => (
              <span key={f.key}
                title={f.active ? undefined : '후속 단계에서 제공됩니다 (소방계획서_4.md 4-2~4-4)'}
                className={`inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-medium ${
                  f.active ? 'bg-[#f5f4ff] text-[#7b68ee] border border-[#d0ccf5]' : 'text-[#b0acd6] border border-[#eceafd]'
                }`}>
                {f.label}{!f.active && <span className="ml-1 text-[9px]">예정</span>}
              </span>
            ))}
          </div>
          {form11}
        </div>
      )}
    </div>
  )
}
