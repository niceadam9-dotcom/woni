'use client'

import { ChevronDown, ChevronRight, Eye, PlayCircle } from 'lucide-react'
import type { CustomerRound } from '@/app/(dashboard)/reports/docs-actions'
import type { ComposeAnnexNo } from '@/components/inspections/annex-compose-panel'
import { InspectionDocRows } from '@/components/reports/customer-docs'
import { PlanAnnexSheetTree, PlanAnnexSheetHeader } from '@/components/customers/plan-annex-sheet-tree'
import { inspectionNatureBadge } from '@/lib/inspection-nature'
import { openAnnexPdf } from '@/lib/annex-filename'
import type { InspectionType, PlanType } from '@/types'
import type { PreviewDoc } from '@/components/customers/plan-annex-full-preview'

/** 회차 카드 1건 (소방계획서_8 H-2 → 소방계획서_20 S3에서 분리).
 *  본문은 작업 순서 2블록: ① 점검표 입력 → ② 별지 생성·확인.
 *  ⚠ 블록 제목에 '점검표 입력' 문자열을 쓰지 말 것 —
 *     test-annex-interaction.mts가 그 문자열 개수로 회차 펼침 상태를 판정한다(PlanAnnexSheetHeader가 유일 출처). */

const todayStr = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const blockTitleCls = 'text-[11px] font-semibold text-[#514b81] pt-1 pb-0.5'
const chipCls = 'text-[11px] text-[#7b68ee] border border-[#d0ccf5] rounded-lg px-2 py-0.5 hover:bg-[#f5f4ff] shrink-0 cursor-pointer'

/** 회차 묶음 인쇄(소방계획서_18 S1) 가능 여부 — 병합 대상은 PDF뿐이라 HWP·HTML만 있으면 열지 않는다.
 *  bundle 라우트의 TYPE_ORDER와 같은 축. */
function hasBundlePdf(d: NonNullable<CustomerRound['docs']>): boolean {
  return [d.report9, d.report4, d.report10, d.report11, d.exterior].some(g => !!g?.pdf)
}

export function statePill(r: CustomerRound): { label: string; cls: string } {
  if (r.state === 'planned') {
    const d = r.plannedDate ? Math.round((new Date(r.plannedDate).getTime() - new Date(todayStr()).getTime()) / 86400000) : null
    if (d === null) return { label: '예정', cls: 'bg-blue-50 text-blue-600' }
    if (d < 0) return { label: `예정 지연 ${-d}일 ⚠`, cls: 'bg-red-50 text-red-600' }
    return { label: `예정 D-${d}`, cls: 'bg-blue-50 text-blue-600' }
  }
  if (r.state === 'completed') return { label: '완료', cls: 'bg-green-50 text-green-700' }
  if (r.state === 'overdue') return { label: '기한초과', cls: 'bg-red-50 text-red-600' }
  return { label: '진행중', cls: 'bg-[#f5f4ff] text-[#7b68ee]' }
}

export function PlanAnnexRoundCard({
  r, isOpen, inspectionType, customerName, canRegister, isPending, isStarting,
  onToggle, onFullPreview, onPreviewSingle, onOpenFile, onGenerate, onUpload, onCompose, onSheetSaved, onStart, feedback,
}: {
  r: CustomerRound
  isOpen: boolean
  inspectionType: string
  customerName: string
  canRegister: boolean
  isPending: boolean
  isStarting: boolean
  onToggle: () => void
  onFullPreview: () => void
  onPreviewSingle: (type: PreviewDoc['type']) => void
  onOpenFile: (path: string | null | undefined, saveName?: string) => void
  onGenerate: (inspectionId: string, kind: 'report4' | 'report9' | 'report10' | 'report11' | 'exterior', rowKey: string) => void
  onUpload: (inspectionId: string, slot: 'cert' | 'contract', file: File, rowKey: string) => void
  onCompose: (inspectionId: string, annexNo: ComposeAnnexNo) => void
  onSheetSaved: (responded: number) => void
  onStart: () => void
  feedback: (key: string) => React.ReactNode
}) {
  const nb = inspectionNatureBadge(inspectionType as InspectionType, r.planType as PlanType | null)
  const pill = statePill(r)
  const done = r.state === 'completed'
  const label = `${r.year}년 ${r.sequenceNum}차`

  return (
    <div className={`rounded-xl border ${isOpen ? 'border-[#d0ccf5]' : 'border-[#e8e6f5]'} ${done ? 'bg-[#fafafa]' : 'bg-white'}`}>
      {/* 회차 헤더 — S3: 펼침만으로 미리보기를 렌더하지 않는다([보기]·[전체 미리보기]에서 로드) */}
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
        {isOpen ? <ChevronDown className="size-3.5 text-[#b0acd6] shrink-0" /> : <ChevronRight className="size-3.5 text-[#b0acd6] shrink-0" />}
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${nb.className}`}>{nb.label}</span>
        <span className="text-xs font-semibold text-[#090c1d]">{label}</span>
        {r.plannedDate && <span className="text-[11px] text-[#b0acd6]">{r.plannedDate.slice(5, 10)}</span>}
        {r.docs && isOpen && (
          <span role="button" tabIndex={0}
            onClick={e => { e.stopPropagation(); onFullPreview() }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onFullPreview() } }}
            className={chipCls}>
            🔍 전체 미리보기
          </span>
        )}
        {/* S1-4: 병합할 PDF가 하나도 없으면 열지 않는다 — 열어봐야 라우트 404다 */}
        {r.docs && isOpen && hasBundlePdf(r.docs) && (
          <span role="button" tabIndex={0}
            title="이 회차의 생성된 별지 PDF를 한 번에 인쇄 — 종이 보관용 (소방계획서_18 S1)"
            onClick={e => { e.stopPropagation(); window.open(`/inspections/${r.docs!.inspectionId}/print-bundle`, '_blank') }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); window.open(`/inspections/${r.docs!.inspectionId}/print-bundle`, '_blank') } }}
            className={chipCls}>
            🖨 전체 인쇄
          </span>
        )}
        <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${pill.cls}`}>{pill.label}</span>
        {r.docs && (
          <span className="text-[10px] text-[#b0acd6] shrink-0">
            ④{r.docs.report4 ? '✓' : '·'} ⑨{r.docs.report9 ? '✓' : '·'}
            {r.docs.defects.total > 0 && <> ⑩{r.docs.report10 ? '✓' : '·'} ⑪{r.docs.report11 ? '✓' : '·'}</>}
            {' '}불량 {r.docs.defects.total}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="px-4 pb-3">
          {r.docs ? (
            <>
              <p className={blockTitleCls}>① 점검표 <span className="font-normal text-[#b0acd6]">— 현장 결과를 설비별로 입력</span></p>
              {/* 📝 점검표 노드 (D-11 → 소방계획서_16 S4) — 머리줄 + 설비별 인라인 입력 */}
              <PlanAnnexSheetHeader inspectionId={r.docs.inspectionId}
                responded={r.docs.sheetResponses} defects={r.docs.defects.total} />
              <PlanAnnexSheetTree inspectionId={r.docs.inspectionId} canRegister={canRegister}
                onSaved={onSheetSaved} />

              <p className={`${blockTitleCls} mt-3`}>② 별지 생성·확인 <span className="font-normal text-[#b0acd6]">— 입력한 데이터로 자동 생성</span></p>
              {/* ④ 별지 4호 행 — [자동] 점검표+설비 대장에서 생성 (D-18: 입력 없음) */}
              <div className="flex items-center gap-2 py-1.5 text-xs border-b border-[#f3f1fc] flex-wrap">
                <span className="font-medium text-[#090c1d] w-44 pl-5">별지 4호 점검표</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">자동</span>
                {r.docs.report4 ? (
                  <span className="text-[#514b81]">✓ {(r.docs.report4.at ?? '').slice(5, 10)}</span>
                ) : (
                  <span className="text-amber-600">미생성 — 점검표·설비 대장(1.4)에서 자동</span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <button onClick={() => onPreviewSingle('report4')}
                    title="이 문서만 크게 보기 — 생성 전에도 확인 가능"
                    className="inline-flex items-center gap-1 h-6 px-2 rounded border border-[#d0ccf5] text-[11px] text-[#514b81] hover:bg-[#f5f4ff]">
                    <Eye className="size-3" /> 보기
                  </button>
                  {r.docs.report4?.pdf && (
                    <button onClick={() => openAnnexPdf(r.docs!.inspectionId, r.docs!.report4!.pdf!.path)} disabled={isPending}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded border border-red-200 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50">PDF</button>
                  )}
                  <button onClick={() => onGenerate(r.docs!.inspectionId, 'report4', `${r.docs!.inspectionId}:r4`)} disabled={isPending}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
                    {r.docs.report4 ? '재생성' : '생성'}
                  </button>
                </span>
                {feedback(`${r.docs.inspectionId}:r4`)}
              </div>
              {/* 문서 행 — 보고서 센터 InspectionDocRows 재사용 (9호·배치확인서·계약서·사진·10·11호) */}
              <InspectionDocRows
                i={r.docs} customerName={customerName}
                isPending={isPending} open={onOpenFile} generate={onGenerate} upload={onUpload} feedback={feedback}
                onCompose={onCompose}
                onPreview={(_id, type) => onPreviewSingle(type)} />
            </>
          ) : (
            /* 미시작(계획) 회차 (H-3) */
            <div className="flex items-center gap-2 py-2 text-xs">
              <span className="text-[#514b81]">아직 점검 미시작 — 시작하면 점검표·별지 작성이 열립니다</span>
              <button onClick={onStart} disabled={isStarting}
                className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium disabled:opacity-50">
                <PlayCircle className="size-3.5" /> 이 회차 시작
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
