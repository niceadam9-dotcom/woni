'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, Check, CheckCircle2, Circle, Download, ExternalLink, FileText, Loader2,
  Package, Send, Upload,
} from 'lucide-react'
import {
  requestReport9Action, getReport9StatusAction, getAnnexPreviewHtmlAction,
  type Report9Job, type Report9File,
} from '@/app/(dashboard)/inspections/report9-actions'
import { getAnnexInputsAction, saveAnnexInputsAction } from '@/app/(dashboard)/customers/facility-spec-actions'
import {
  uploadTimelineFileAction, sendOwnerReportAction, recordSubmissionAction, downloadPackageAction,
  forceCompleteStepAction, undoForceCompleteStepAction, recordOwnerReportOfflineAction,
} from '@/app/(dashboard)/inspections/timeline-actions'
import { updateInspectionMultidayAction } from '@/app/(dashboard)/inspections/actions'
import { getReportDownloadUrl } from '@/app/(dashboard)/inspections/report-actions'
import { DateInput } from '@/components/ui/date-input'
import { TIMELINE_STEP_LABELS, TIMELINE_STEP_TOOLTIPS, type TimelineStepKey } from '@/lib/doc-requirements'
import { evidenceDone, activeStepNums, stepProgress, type StepNum } from '@/lib/inspection-step-status'
import { GeneratedDocList } from '@/components/inspections/generated-doc-list'
import { PlacementReportHelper } from '@/components/inspections/placement-report-helper'
import { FIELD_DEFS, AnnexFieldInput, type ComposeAnnexNo } from '@/components/inspections/annex-fields'
import { DefectGrid, type GridDefect } from '@/components/inspections/defect-grid'
import { MessageTemplateModal } from '@/components/settings/message-template-modal'
import { STEP_REPORT_LABELS, STEP_REPORT_TYPES, type StepReportType } from '@/app/(dashboard)/inspections/report-constants'
import type { TimelineData, TimelineSlots } from '@/components/inspections/inspection-timeline-client'

/** 점검 상세 한 화면 작업대 (소방계획서_21 R6 / C2, D34-4)
 *
 *  세로 아코디언을 6단계 가로 스텝바 + 3칸(마스터·디테일·보조)으로 바꾼다.
 *  판정·D-day·단계 구성은 InspectionTimelineClient의 것을 그대로 이어받는다 — 레이아웃 교체이지 재구현이 아니다.
 *
 *  ⚠ 두 축 혼동 금지: 단계 수를 정하는 것은 plan_type(자체점검 6단계 / 월간·이벤트 ① 하나)이지
 *     관리유형(종합·작동·일반관리)이 아니다. 일반관리 자체점검도 6단계 대상이다(F-8).
 *     여기서는 상위가 계산해 넘긴 data.steps를 그대로 신뢰한다. */

type StepKey = TimelineStepKey

const STEP_NUM: Record<StepKey, number> = {
  checklist: 1, cert: 2, ownerReport: 3, submit9: 4, repair: 5, submit11: 6,
}

export function InspectionWorkbench({
  inspectionId, canManage, canComplete, today, data, initialJob, initialFiles, customerName, customerId, slots, defectRows,
}: {
  inspectionId: string
  canManage: boolean
  canComplete: boolean
  today: string
  data: TimelineData
  initialJob: Report9Job | null
  initialFiles: Report9File[]
  customerName?: string
  customerId?: string
  slots?: TimelineSlots
  /** ⑤⑥ 표 편집용 원본 행(R6-7) — ①의 불량 카드(slots.defects)와 같은 데이터, 저장 액션도 같다 */
  defectRows?: GridDefect[]
}) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [files, setFiles] = useState(initialFiles)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const [subDate9, setSubDate9] = useState(data.submit9.submittedAt ?? '')
  const [subDate11, setSubDate11] = useState(data.submit11.submittedAt ?? '')
  const [completing, setCompleting] = useState<string | null>(null)
  // 불량을 고치면 ⑤⑥ 미리보기가 따라가야 한다 — 표가 저장할 때마다 토큰을 올린다(R6-4·R6-5)
  const [defectRev, setDefectRev] = useState(0)
  // R5-8 기산 근거 인라인 수정 — 기한을 보는 자리에서 바로 고칠 수 있어야 한다
  const [anchorEdit, setAnchorEdit] = useState(false)
  const [anchorEnd, setAnchorEnd] = useState(data.period?.end ?? '')
  const [anchorMsg, setAnchorMsg] = useState('')
  // R4-2(D2): ③ 방문·유선 보고 기록 입력
  const [offlineOpen, setOfflineOpen] = useState(false)
  const [offlineDate, setOfflineDate] = useState(today)
  const [offlineMethod, setOfflineMethod] = useState('방문 설명')
  const [offlineMemo, setOfflineMemo] = useState('')
  const [dragOver, setDragOver] = useState<'cert' | 'contract' | null>(null)
  const certRef = useRef<HTMLInputElement>(null)
  const contractRef = useRef<HTMLInputElement>(null)
  const busy = job?.status === 'pending' || job?.status === 'processing'

  /* ── 판정 — 서버(syncInspectionSteps)와 **같은 함수**를 쓴다 (R4-1).
   *  여기서 규칙을 다시 쓰면 화면 ✓와 DB status가 갈라진다 — 오프라인 보고·사유 완료가
   *  DB에만 반영되던 그 괴리가 되살아난다. data.evidence가 없는 과도기에만 옛 규칙으로 폴백한다. */
  const hasDefects = data.defects.total > 0
  const isSpecial = data.steps.length > 1
  const doneByNum = data.evidence
    ? evidenceDone(data.evidence)
    : ({
      1: data.responded > 0,
      2: !!data.certFile || !!data.certArchived,
      3: !!data.delivery,
      4: !!data.submit9.submittedAt,
      5: hasDefects && data.defects.done >= data.defects.total,
      6: !!data.submit11.submittedAt,
    } as Record<StepNum, boolean>)
  const done = Object.fromEntries(
    (Object.keys(STEP_NUM) as StepKey[]).map(k => [k, doneByNum[STEP_NUM[k] as StepNum]]),
  ) as Record<StepKey, boolean>

  /** 불량 0건이면 ⑤⑥은 해당없음 — 분모에서 뺀다(R10-b·R4-8, activeStepNums가 원본) */
  /** 사유로 완료된 단계 — 철회 버튼 노출 판정 (D1) */
  const forcedNums = new Set<number>(data.evidence?.forced ?? [])
  const activeNums = activeStepNums(isSpecial, hasDefects)
  const activeSteps: StepKey[] = data.steps.filter(k => activeNums.includes(STEP_NUM[k] as StepNum))
  const prog = stepProgress(doneByNum, activeNums)
  const doneCount = prog.done
  const progressPct = prog.pct
  const nextStep = activeSteps.find(k => !done[k])

  // 진입 화면은 첫 미완료 단계 — '지금 무엇을 해야 하는지'가 곧 초기 화면이다
  const [sel, setSel] = useState<StepKey>(() => nextStep ?? data.steps[0] ?? 'checklist')

  const stepByNum = new Map(data.inspectionSteps.map(s => [s.step_num, s]))
  const stepOf = (k: StepKey) => stepByNum.get(STEP_NUM[k]) ?? null

  const ddayText = (k: StepKey) => {
    const st = stepOf(k)
    if (st?.status === 'completed') return { text: `완료 ${st.completed_at?.split('T')[0] ?? ''}`, cls: 'text-green-600' }
    // ④⑥ 기한은 법정 규칙(9호 = 점검 종료일+15일 / 11호 = 이행기간 종료)이 원천이고
    // inspection_steps.due_date는 그 사본이라 어긋날 수 있다 — 지켜야 하는 날짜를 보여준다
    const legal = k === 'submit9' ? data.submit9 : k === 'submit11' ? data.submit11 : null
    if (legal?.submittedAt) return { text: `제출 ${legal.submittedAt}`, cls: 'text-green-600' }
    const due = legal?.due ?? st?.due_date ?? null
    if (!due) return null
    const d = Math.round((new Date(due).getTime() - new Date(today).getTime()) / 86400000)
    if (d < 0) return { text: `초과 ${-d}일 ⚠`, cls: 'text-red-600 font-semibold' }
    return { text: `D-${d}`, cls: d <= 3 ? 'text-red-600 font-semibold' : d <= 7 ? 'text-amber-600 font-semibold' : 'text-[#b0acd6]' }
  }

  /* ── 서버 동작 — 타임라인과 같은 액션을 그대로 호출 ── */
  useEffect(() => {
    if (!busy) return
    const t = setInterval(async () => {
      const res = await getReport9StatusAction(inspectionId)
      if (!res.error) { setJob(res.job); setFiles(res.files) }
    }, 8000)
    return () => clearInterval(t)
  }, [busy, inspectionId])

  function generate(reportType: 'report4' | 'report9' | 'report10' | 'report11' | 'exterior') {
    setMsg('')
    startTransition(async () => {
      const res = await requestReport9Action(inspectionId, reportType)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      const st = await getReport9StatusAction(inspectionId)
      if (!st.error) { setJob(st.job); setFiles(st.files) }
      setMsg('✅ 생성 완료 — 아래 문서 목록에서 확인하세요.')
    })
  }
  function doUpload(slot: 'cert' | 'contract', file: File) {
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const res = await uploadTimelineFileAction(inspectionId, slot, fd)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ ${slot === 'cert' ? '배치확인서' : '계약서'} 업로드됨`)
      router.refresh()
    })
  }
  function uploadSlot(slot: 'cert' | 'contract', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) doUpload(slot, file)
  }
  const uploadCert = (e: React.ChangeEvent<HTMLInputElement>) => uploadSlot('cert', e)
  const uploadContract = (e: React.ChangeEvent<HTMLInputElement>) => uploadSlot('contract', e)
  /** 업로드 슬롯 = 드롭존 (R0-6, 문서 현황·타임라인과 같은 패턴) */
  const dropProps = (slot: 'cert' | 'contract') => canManage ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(slot) },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDragOver(null)
      const f = e.dataTransfer.files?.[0]
      if (f) doUpload(slot, f)
    },
  } : {}
  const dropCls = (slot: 'cert' | 'contract') =>
    dragOver === slot ? ' bg-[#f5f4ff] outline outline-1 outline-dashed outline-[#7b68ee]' : ''

  function saveAnchor() {
    setAnchorMsg('')
    startTransition(async () => {
      const res = await updateInspectionMultidayAction(inspectionId, {
        endDate: anchorEnd || null, days: data.period?.days ?? 1,
      })
      if (res.error) { setAnchorMsg(`❌ ${res.error}`); return }
      setAnchorEdit(false)
      setAnchorMsg('✅ 기산일 변경 — 마감일을 다시 계산했습니다.')
      router.refresh()
    })
  }
  function sendOwner() {
    setMsg('')
    startTransition(async () => {
      const res = await sendOwnerReportAction(inspectionId)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ 관계인 보고 발송됨 → ${res.sentTo} (발송 이력 기록)`)
      router.refresh()
    })
  }
  function submit(kind: 'report9' | 'report11', date: string) {
    if (!date) { setMsg('제출일을 입력해주세요.'); return }
    startTransition(async () => {
      const res = await recordSubmissionAction(inspectionId, kind, date)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ 제출 기록됨')
      router.refresh()
    })
  }
  function pkg(kind: 'report9' | 'report11') {
    setMsg('')
    startTransition(async () => {
      const res = await downloadPackageAction(inspectionId, kind)
      if (res.error || !res.base64) { setMsg(`❌ ${res.error ?? '패키지 생성 실패'}`); return }
      const bin = atob(res.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const a = document.createElement('a'); a.href = url; a.download = res.fileName ?? 'package.zip'; a.click()
      URL.revokeObjectURL(url)
      // 무엇이 들어갔고 무엇이 빠졌는지 — 제출 직전에 이걸 못 보면 빠진 채로 낸다
      setMsg(`✅ 패키지 다운로드 — 포함: ${(res.included ?? []).join(', ')}${(res.skipped?.length ?? 0) > 0 ? ` / 누락: ${res.skipped!.join(', ')}` : ''}`)
    })
  }
  function download(path: string) {
    startTransition(async () => {
      const res = await getReportDownloadUrl(path)
      if (res.url) window.open(res.url, '_blank')
    })
  }
  function downloadReport(reportId: string, fileName: string) {
    startTransition(async () => {
      const res = await getReportDownloadUrl(reportId)
      if (res.error || !res.url) { setMsg(`❌ ${res.error ?? '다운로드 실패'}`); return }
      const a = document.createElement('a')
      a.href = res.url; a.download = res.fileName ?? fileName; a.target = '_blank'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    })
  }
  function forceComplete(k: StepKey) {
    const st = stepOf(k)
    if (!st) return
    const reason = window.prompt(`${TIMELINE_STEP_LABELS[k]} — 증거 없이 완료하는 사유를 남겨주세요.`)?.trim()
    if (!reason) return
    setCompleting(st.id)
    startTransition(async () => {
      const res = await forceCompleteStepAction(inspectionId, st.step_num, reason)
      setCompleting(null)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ 사유와 함께 완료 처리했습니다.')
      router.refresh()
    })
  }

  /** D1: 사유 완료 철회 — 마커는 append-only라 지우지 않고 반대 마커를 남긴다 */
  function undoForce(k: StepKey) {
    const st = stepOf(k)
    if (!st) return
    const reason = window.prompt(
      `${TIMELINE_STEP_LABELS[k]} — '사유 완료'를 철회합니다.\n`
      + '철회하면 증거만으로 다시 판정하므로, 증거가 없으면 미완료로 돌아갑니다.\n\n'
      + '철회 사유(5자 이상):')?.trim()
    if (!reason) return
    setCompleting(st.id)
    startTransition(async () => {
      const res = await undoForceCompleteStepAction(inspectionId, st.step_num, reason)
      setCompleting(null)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ 사유 완료를 철회했습니다 — 증거 기준으로 다시 판정합니다.')
      router.refresh()
    })
  }

  /** R4-2(D2): ③ 방문·유선 보고 기록 */
  function saveOffline() {
    startTransition(async () => {
      const res = await recordOwnerReportOfflineAction(inspectionId, {
        date: offlineDate, method: offlineMethod, memo: offlineMemo,
      })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setOfflineOpen(false); setOfflineMemo('')
      setMsg('✅ 오프라인 보고를 기록했습니다 — ③이 근거로 완료됩니다.')
      router.refresh()
    })
  }

  const btn = 'inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50'
  const btnPri = 'inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium disabled:opacity-50'

  /* ── 3칸 구성 — 단계마다 역할이 바뀐다 (R6-2) ──
   *  ① 설비목록·점검표 / 불량 / (참여·기간)   ② 참여인력 / 업로드 / 배치요약
   *  ③ 수신정보 / 발송 / 발송이력            ④ 문서목록 / 제출 / 전제·제출일
   *  ⑤ 불량목록 / 조치 / 10호 미리보기        ⑥ 완료현황 / 11호 / 11호 미리보기 */
  const paneCls = 'min-h-0 overflow-y-auto rounded-xl border border-[#e0ddf5] bg-white'
  const paneHead = 'sticky top-0 z-10 flex items-center gap-1.5 border-b border-[#eceafd] bg-[#fafaff] px-3 py-1.5 text-[11px] font-semibold text-[#514b81]'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 lg:overflow-hidden">
      {/* 헤더 1줄 — 진행률·다음 할 일·역링크 */}
      <div className="flex items-center gap-2 flex-wrap rounded-xl border border-[#c8c4d0] bg-white px-4 py-2 shrink-0">
        <FileText className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">점검 작업대</h2>
        <span className="text-[11px] text-[#b0acd6]">
          {isSpecial ? '자체점검 보고 절차 6단계 — ⑤⑥은 불량 발생 시' : '정기·일반 — 점검표 작성·2년 보관만 (보고 의무 없음)'}
        </span>
        {isSpecial && (
          <>
            <span className="ml-auto text-[11px] font-semibold text-[#7b68ee]" title="해당없음 단계는 분모에서 제외">
              {doneCount}/{activeSteps.length} 단계 완료
            </span>
            <div className="h-1 w-24 overflow-hidden rounded-full bg-[#e0ddf5]">
              <div className={`h-full rounded-full transition-all ${progressPct === 100 ? 'bg-green-500' : 'bg-[#7b68ee]'}`}
                style={{ width: `${progressPct}%` }} />
            </div>
          </>
        )}
        {customerId && (
          <NextLink href={`/customers/${customerId}?tab=plan&form=annex`}
            className={`${isSpecial ? '' : 'ml-auto'} inline-flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline shrink-0`}>
            소방계획서 트리 <ExternalLink className="size-3" />
          </NextLink>
        )}
      </div>

      {/* 6단계 가로 스텝바 (R6-1) — 항상 보인다. 월간 건은 ① 하나(R6-11) */}
      <div className="flex items-stretch gap-1 overflow-x-auto rounded-xl border border-[#c8c4d0] bg-white p-1.5 shrink-0" data-testid="workbench-stepbar">
        {data.steps.map(k => {
          const na = !hasDefects && (k === 'repair' || k === 'submit11')
          const d = ddayText(k)
          const active = sel === k
          return (
            <button key={k} onClick={() => setSel(k)} disabled={na}
              title={TIMELINE_STEP_TOOLTIPS[k]} data-step={k}
              className={`flex min-w-[8.5rem] flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left transition-colors
                ${active ? 'bg-[#7b68ee] text-white' : na ? 'bg-[#fafafa] text-[#c8c4d0]' : 'text-[#514b81] hover:bg-[#f5f4ff]'}`}>
              {done[k] ? <CheckCircle2 className={`size-4 shrink-0 ${active ? 'text-white' : 'text-green-600'}`} />
                : na ? <Circle className="size-4 shrink-0 text-[#e0ddf5]" />
                  : <AlertTriangle className={`size-4 shrink-0 ${active ? 'text-white' : 'text-amber-500'}`} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold">{TIMELINE_STEP_LABELS[k]}</span>
                <span className={`block truncate text-[10px] ${active ? 'text-white/80' : na ? 'text-[#c8c4d0]' : d?.cls ?? 'text-[#b0acd6]'}`}>
                  {na ? '해당없음 — 불량 0건' : d?.text ?? (done[k] ? '완료' : '진행 전')}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {msg && <p className={`shrink-0 text-[11px] ${msg.startsWith('❌') ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>}

      {/* 3칸 — 데스크톱 전용. 좁은 화면은 세로 스택 폴백(R6-10, 현장은 폰이다) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]"
        data-testid="workbench-panes">
        {sel === 'checklist' && (<>
          <Pane title="점검표 입력" cls={paneCls} head={paneHead}>
            {slots?.multiday}
            {slots?.sheet}
            {/* 펌프성능시험 실측치 — 점검표 바로 아래(같은 ① 안). 별지 4호가 이 값을 읽는다 */}
            {slots?.pumpTest}
            {!isSpecial && slots?.exterior}
          </Pane>
          {/* R6-3: ①에서 점검표와 불량이 동시에 보인다 — ✕ 태깅하면 오른쪽에서 그 자리에 늘어난다 */}
          <Pane title={`불량 내역 ${data.defects.total}건`} cls={paneCls} head={paneHead}>
            {slots?.defects ?? <Empty>불량 목록을 불러올 수 없습니다.</Empty>}
          </Pane>
          <Pane title="점검 인력·생성물" cls={paneCls} head={paneHead}>
            {slots?.participants}
            {isSpecial && canManage && (
              <div className="px-3 py-2">
                <button onClick={() => generate('report4')} disabled={isPending || busy} className={btn}
                  title="소방시설등점검표(별지 4호) — 점검결과·인력 자동, 3~7쪽은 설비 대장(1.4)">
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} 별지 4호 생성
                </button>
              </div>
            )}
            <DocPane files={files} customerName={customerName} onOpen={download} />
          </Pane>
        </>)}

        {sel === 'cert' && (<>
          <Pane title="참여 인력" cls={paneCls} head={paneHead}>{slots?.participants}</Pane>
          <Pane title="배치확인서 업로드" cls={paneCls} head={paneHead}>
            <div className={`space-y-2 rounded-lg px-3 py-2${dropCls('cert')}`} {...dropProps('cert')}
              title={canManage ? '클릭 또는 파일을 이 칸에 끌어다 놓으세요' : undefined}>
              <p className={`text-xs ${done.cert ? 'text-[#514b81]' : 'text-amber-600'}`}>
                {data.certFile ? `업로드됨: ${data.certFile.name}`
                  : data.certArchived ? '종이 보관됨 — 과거본 정리로 ERP 사본은 삭제되었습니다'
                    : '협회 발급본 업로드 필요 (자체점검 대행 시 필수)'}
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {canManage && <PlacementReportHelper inspectionId={inspectionId} />}
                <a href="https://www.kfma.kr" target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-[10px] text-[#b0acd6] hover:text-[#7b68ee]">협회 <ExternalLink className="size-2.5" /></a>
                {data.certFile && <button onClick={() => download(data.certFile!.path)} className={btn}><Download className="size-3" /> 보기</button>}
                {canManage && (<>
                  <input ref={certRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden" onChange={uploadCert} />
                  <button onClick={() => certRef.current?.click()} disabled={isPending} className={btn}><Upload className="size-3" /> 업로드</button>
                </>)}
              </div>
            </div>
          </Pane>
          <Pane title="배치 요약" cls={paneCls} head={paneHead}>
            <Summary rows={[
              ['점검표 응답', `${data.responded}건`],
              ['배치확인서', data.certFile ? data.certFile.name : data.certArchived ? '종이 보관' : '없음'],
              ['불량', `${data.defects.total}건`],
            ]} />
          </Pane>
        </>)}

        {sel === 'ownerReport' && (<>
          <Pane title="수신 정보" cls={paneCls} head={paneHead}>
            <Summary rows={[
              ['고객', customerName ?? '-'],
              ['송달 동의·이메일', data.consentOk ? '보유' : '미입력 — 고객 소방계획서 탭에서 입력'],
              ['최근 발송', data.delivery ? `${data.delivery.sentTo} (${data.delivery.sentAt.slice(0, 10)})` : '없음'],
            ]} />
          </Pane>
          <Pane title="발송" cls={paneCls} head={paneHead}>
            <div className="space-y-2 px-3 py-2">
              <p className={`text-xs ${done.ownerReport ? 'text-[#514b81]' : 'text-amber-600'}`}>
                {data.delivery ? '발송 완료 — 필요 시 재발송'
                  : data.evidence?.offlineReport ? '방문·유선으로 보고함 (오프라인 기록됨)'
                  : '별지 9호 생성 후 이메일로 보고합니다'}
              </p>
              {/* R4-2(독립 검증 D2): 이메일만 근거로 삼으면 방문·유선 보고가 영원히 미완이다 */}
              {canManage && (offlineOpen ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <DateInput value={offlineDate} onChange={e => setOfflineDate(e.target.value)}
                    className="h-7 w-32 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                  <select value={offlineMethod} onChange={e => setOfflineMethod(e.target.value)}
                    className="h-7 rounded-lg border border-[#d0ccf5] px-2 text-[11px] outline-none focus:border-[#7b68ee]">
                    <option>방문 설명</option><option>유선 통보</option><option>대면 전달</option><option>기타</option>
                  </select>
                  <input value={offlineMemo} onChange={e => setOfflineMemo(e.target.value)} placeholder="메모(선택)"
                    className="h-7 w-40 rounded-lg border border-[#d0ccf5] px-2 text-[11px] outline-none focus:border-[#7b68ee]" />
                  <button onClick={saveOffline} disabled={isPending} className={btnPri}>기록</button>
                  <button onClick={() => setOfflineOpen(false)} className="text-[10px] underline text-[#b0acd6]">취소</button>
                </div>
              ) : (
                <button onClick={() => setOfflineOpen(true)} className={btn}>방문·유선 보고 기록</button>
              ))}
              <div className="flex items-center gap-1.5 flex-wrap">
                <MessageTemplateModal templateKey="owner_report" label="관계인 보고 메일"
                  sampleVars={{ 고객명: customerName ?? '', 연도: '', 차수: '', 점검일: '' }} />
                {canManage && (
                  <button onClick={sendOwner} disabled={isPending || !data.consentOk} className={btnPri}>
                    <Send className="size-3" /> {done.ownerReport ? '재발송' : '생성물 이메일 발송'}
                  </button>
                )}
              </div>
            </div>
          </Pane>
          <Pane title="생성물" cls={paneCls} head={paneHead}><DocPane files={files} customerName={customerName} onOpen={download} /></Pane>
        </>)}

        {sel === 'submit9' && (<>
          <Pane title="제출 전제" cls={paneCls} head={paneHead}>
            <div className="px-3 py-2 space-y-1">
              {data.prereqs.length === 0 && <Empty>전제 항목이 없습니다.</Empty>}
              {data.prereqs.map((p, i) => (
                <p key={i} className={`text-[11px] ${p.ok ? 'text-[#514b81]' : 'text-amber-600'}`}>
                  {p.ok ? '✓' : '⚠'} {p.label}
                </p>
              ))}
              {/* R5-8 기산 근거 — '기한이 왜 이 날짜인지'를 여기서 보고 여기서 고친다.
                  종료일이 없으면 시작일이 기산일이다(page.tsx due9 규칙과 동일) */}
              {data.period && (data.period.end || data.period.start) && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-[#f3f1fc] pt-2 text-[10px] text-[#b0acd6]">
                  <span>
                    기산: {data.period.end
                      ? <>종료일 <b className="text-[#514b81]">{data.period.end}</b></>
                      : <>시작일 <b className="text-[#514b81]">{data.period.start}</b> <span className="text-amber-600">(종료일 미지정 — 다일 점검이면 종료일을 넣어야 기한이 맞습니다)</span></>
                    } + 15일 = 기한 <b className="text-[#514b81]">{data.submit9.due ?? '—'}</b>
                  </span>
                  {canManage && !anchorEdit && (
                    <button onClick={() => { setAnchorEnd(data.period?.end ?? ''); setAnchorEdit(true) }}
                      className="underline hover:text-[#7b68ee]">종료일 고치기</button>
                  )}
                  {canManage && anchorEdit && (
                    <span className="inline-flex items-center gap-1">
                      <DateInput value={anchorEnd} onChange={e => setAnchorEnd(e.target.value)}
                        className="h-6 w-28 rounded-lg border border-[#d0ccf5] px-1.5 text-[10px]" />
                      <button onClick={saveAnchor} disabled={isPending} className={btn}>저장</button>
                      <button onClick={() => { setAnchorEdit(false); setAnchorMsg('') }} className="underline">취소</button>
                    </span>
                  )}
                  {anchorMsg && <span className={anchorMsg.startsWith('❌') ? 'text-red-600' : 'text-green-600'}>{anchorMsg}</span>}
                </div>
              )}
            </div>
          </Pane>
          <Pane title="별지 9·10호 생성·제출" cls={paneCls} head={paneHead}>
            <div className="space-y-2 px-3 py-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {canManage && (<>
                  <button onClick={() => generate('report9')} disabled={isPending || busy} className={btnPri}>
                    {busy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} 별지 9호 생성
                  </button>
                  <button onClick={() => generate('report4')} disabled={isPending || busy} className={btn}><FileText className="size-3" /> 별지 4호</button>
                  <button onClick={() => pkg('report9')} disabled={isPending} className={btn}><Package className="size-3" /> 제출 패키지</button>
                </>)}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap border-t border-[#f3f1fc] pt-2">
                <span className="text-[11px] text-[#514b81]">소방서 제출일</span>
                <DateInput value={subDate9} onChange={e => setSubDate9(e.target.value)}
                  className="h-7 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                {canManage && <button onClick={() => submit('report9', subDate9)} disabled={isPending} className={btn}>기록</button>}
                {data.submit9.due && !data.submit9.submittedAt && (
                  <span className="text-[10px] text-[#b0acd6]">기한 {data.submit9.due} (점검 종료일 +15일)</span>
                )}
              </div>
              <div className="border-t border-[#f3f1fc] pt-2">
                <DocPane files={files} customerName={customerName} onOpen={download} />
              </div>
              {/* 제출본 파일 — 생성물과 달리 '이미 낸 것'이라 따로 둔다 */}
              {data.reports.length > 0 && (
                <details className="border-t border-[#f3f1fc] pt-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-[#514b81] hover:text-[#7b68ee]">
                    제출 보고서 파일 ({data.reports.length}건)
                  </summary>
                  <div className="mt-1.5 space-y-1">
                    {data.reports.map(r => (
                      <div key={r.id} className="flex items-center gap-1.5 rounded-lg border border-[#eceafd] px-2 py-1 text-[10px]">
                        <span className="shrink-0 font-medium text-[#090c1d]">
                          {STEP_REPORT_TYPES.includes(r.report_type as StepReportType) ? STEP_REPORT_LABELS[r.report_type as StepReportType] : r.report_type}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[#514b81]">{r.file_name}</span>
                        {r.submitted_at && <span className="shrink-0 text-[#b0acd6]">{r.submitted_at.split('T')[0]}</span>}
                        <button onClick={() => downloadReport(r.id, r.file_name)} disabled={isPending}
                          className="shrink-0 text-[#7b68ee] hover:underline">다운로드</button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </Pane>
          {/* R6-6: 3단 작성 패널 대신 미리보기 위에 서식 고유값 몇 칸 */}
          <Pane title="9호 고유값·미리보기" cls={paneCls} head={paneHead}>
            <AnnexPane inspectionId={inspectionId} annexNo="report9" canEdit={canManage} />
          </Pane>
        </>)}

        {sel === 'repair' && (<>
          {/* R6-7: 불량마다 폼을 펼치지 않고 표에서 바로 고친다 */}
          <Pane title={`이행계획 ${data.defects.planned}/${data.defects.total}`} cls={paneCls} head={paneHead}>
            {defectRows
              ? <DefectGrid defects={defectRows} inspectionId={inspectionId} canEdit={canManage} mode="plan"
                  onSaved={() => { setDefectRev(v => v + 1); router.refresh() }} />
              : slots?.defects ?? <Empty>불량 목록을 불러올 수 없습니다.</Empty>}
          </Pane>
          <Pane title="10호 고유값·증빙" cls={paneCls} head={paneHead}>
            <Summary rows={[
              ['조치 계획 입력', `${data.defects.planned}/${data.defects.total}`],
              ['조치 완료', `${data.defects.done}/${data.defects.total}`],
              ['전·후 사진 쌍', `${data.defects.photoPairs}/${data.defects.total}쌍 완료`],
            ]} />
            {/* 수리 계약서 — 선택 증빙(R10-a). ⑤ 완료 조건은 불량 전건 조치이지 계약서가 아니다 */}
            <div className={`flex flex-wrap items-center gap-1.5 rounded-lg border-t border-[#f3f1fc] px-1 pt-2${dropCls('contract')}`}
              {...dropProps('contract')}
              title={canManage ? '수리 계약서 — 클릭 또는 파일을 이 칸에 끌어다 놓으세요' : undefined}>
              <span className="text-[10px] text-[#b0acd6]">
                (사진·계약서는 선택){data.contractFile ? ` · 계약서: ${data.contractFile.name}` : ''}
              </span>
              {data.contractFile && (
                <button onClick={() => download(data.contractFile!.path)} className={btn}><Download className="size-3" /> 계약서</button>
              )}
              {canManage && (<>
                <input ref={contractRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden" onChange={uploadContract} />
                <button onClick={() => contractRef.current?.click()} disabled={isPending} className={btn}
                  title="수리 계약서 (선택 증빙)"><Upload className="size-3" /> 계약서 업로드 (선택)</button>
              </>)}
            </div>
            <div className="border-t border-[#f3f1fc] pt-2">
              <AnnexFields inspectionId={inspectionId} annexNo="report10" canEdit={canManage}
                onSaved={() => setDefectRev(v => v + 1)} />
            </div>
            {canManage && (
              <div className="flex items-center gap-1.5 flex-wrap border-t border-[#f3f1fc] px-1 pt-2">
                <button onClick={() => generate('report10')} disabled={isPending || busy} className={btnPri}>
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} 10호 PDF 생성
                </button>
                <span className="text-[10px] text-[#b0acd6]">확정 시 1회 — 생성물은 문서 목록에 쌓입니다</span>
              </div>
            )}
          </Pane>
          {/* R6-4: 불량을 고치면 10호 미리보기가 갱신된다. Gotenberg 미호출(즉석 HTML) */}
          <Pane title="10호 실시간 미리보기" cls={paneCls} head={paneHead}>
            <AnnexPreview inspectionId={inspectionId} reportType="report10"
              watch={`${data.defects.planned}-${data.defects.done}-${data.defects.total}-${defectRev}`} />
          </Pane>
        </>)}

        {sel === 'submit11' && (<>
          {/* R6-7: 완료 내용·완료일·후 사진을 같은 표에서 */}
          <Pane title={`이행완료 ${data.defects.done}/${data.defects.total}`} cls={paneCls} head={paneHead}>
            {defectRows
              ? <DefectGrid defects={defectRows} inspectionId={inspectionId} canEdit={canManage} mode="complete"
                  onSaved={() => { setDefectRev(v => v + 1); router.refresh() }} />
              : slots?.defects ?? <Empty>불량 목록을 불러올 수 없습니다.</Empty>}
          </Pane>
          <Pane title="11호 고유값·제출" cls={paneCls} head={paneHead}>
            <Summary rows={[
              ['전·후 사진 쌍', `${data.defects.photoPairs}건`],
              ['9호 제출', data.submit9.submittedAt ?? '미제출'],
            ]} />
            <div className="border-t border-[#f3f1fc] pt-2">
              <AnnexFields inspectionId={inspectionId} annexNo="report11" canEdit={canManage}
                onSaved={() => setDefectRev(v => v + 1)} />
            </div>
            <div className="space-y-2 px-1 pt-2">
              <div className="flex items-center gap-1.5 flex-wrap border-t border-[#f3f1fc] pt-2">
                {canManage && (<>
                  <button onClick={() => generate('report11')} disabled={isPending || busy} className={btnPri}>
                    {busy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} 11호 PDF 생성
                  </button>
                  <button onClick={() => pkg('report11')} disabled={isPending} className={btn}><Package className="size-3" /> 제출 패키지</button>
                </>)}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap border-t border-[#f3f1fc] pt-2">
                <span className="text-[11px] text-[#514b81]">이행완료 제출일</span>
                <DateInput value={subDate11} onChange={e => setSubDate11(e.target.value)}
                  className="h-7 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                {canManage && <button onClick={() => submit('report11', subDate11)} disabled={isPending} className={btn}>기록</button>}
              </div>
              <div className="border-t border-[#f3f1fc] pt-2">
                <DocPane files={files} customerName={customerName} onOpen={download} />
              </div>
            </div>
          </Pane>
          {/* R6-5 */}
          <Pane title="11호 실시간 미리보기" cls={paneCls} head={paneHead}>
            <AnnexPreview inspectionId={inspectionId} reportType="report11"
              watch={`${data.defects.done}-${data.defects.photoPairs}-${defectRev}`} />
          </Pane>
        </>)}
      </div>

      {/* D1: 사유로 완료한 단계는 되돌릴 수 있어야 한다 — 증거로 완료된 단계엔 나오지 않는다 */}
      {isSpecial && canComplete && stepOf(sel) && forcedNums.has(stepOf(sel)!.step_num) && (
        <div className="flex items-center gap-2 shrink-0 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-1.5">
          <span className="text-[10px] text-amber-700">사유로 완료한 단계입니다 — 철회하면 증거만으로 다시 판정합니다.</span>
          <button onClick={() => undoForce(sel)} disabled={completing === stepOf(sel)!.id}
            className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-amber-200 bg-white text-[11px] text-amber-700 hover:bg-amber-50 disabled:opacity-50">
            {completing === stepOf(sel)!.id ? <Loader2 className="size-3 animate-spin" /> : null} 사유 완료 철회
          </button>
        </div>
      )}

      {/* 예외 완료 — 증거가 생기면 자동 완료되므로 여기는 예외 경로다 */}
      {isSpecial && canComplete && !done[sel] && stepOf(sel) && stepOf(sel)!.status !== 'completed' && (
        <div className="flex items-center gap-2 shrink-0 rounded-lg border border-[#e0ddf5] bg-[#fafaff] px-3 py-1.5">
          <span className="text-[10px] text-[#847ba8]">증거가 생기면 이 단계는 자동 완료됩니다 — 예외 상황에서만 사유를 남기고 완료하세요.</span>
          <button onClick={() => forceComplete(sel)} disabled={completing === stepOf(sel)!.id}
            className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] bg-white text-[11px] text-[#847ba8] hover:bg-[#f5f4ff] disabled:opacity-50">
            {completing === stepOf(sel)!.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} 사유 완료
          </button>
        </div>
      )}

    </div>
  )
}

function Pane({ title, children, cls, head }: { title: string; children: React.ReactNode; cls: string; head: string }) {
  return (
    <section className={cls}>
      <p className={head}>{title}</p>
      <div className="p-2">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-2 text-[11px] text-[#b0acd6]">{children}</p>
}

function Summary({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="px-3 py-2 space-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start gap-2 text-[11px]">
          <dt className="w-28 shrink-0 text-[#847ba8]">{k}</dt>
          <dd className="min-w-0 flex-1 text-[#090c1d]">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** R6-8: 생성물은 문서 목록에 쌓인다 — 타임라인과 같은 GeneratedDocList 재사용 */
function DocPane({ files, customerName, onOpen }: {
  files: Report9File[]
  customerName?: string
  onOpen: (path: string, saveName?: string) => void
}) {
  if (files.length === 0) return <Empty>생성된 문서가 없습니다.</Empty>
  return <GeneratedDocList files={files} onOpen={onOpen} customerName={customerName} />
}

/** 서식 고유값 인라인 (R6-6) — 3단 슬라이드 패널 대신 미리보기 옆 몇 칸.
 *  정의는 annex-fields.tsx 하나, 저장 액션도 패널과 같은 saveAnnexInputsAction이다.
 *  칸을 벗어나면 저장한다 — 값이 비어 있으면 문서는 자동 계산값을 쓴다(오버레이 규칙 유지). */
function AnnexFields({ inspectionId, annexNo, canEdit, onSaved }: {
  inspectionId: string
  annexNo: ComposeAnnexNo
  canEdit: boolean
  /** 저장되면 미리보기가 따라가야 한다 — 고친 값이 문서에 어떻게 나오는지가 이 칸의 존재 이유다 */
  onSaved?: () => void
}) {
  const defs = FIELD_DEFS[annexNo]
  const [fields, setFields] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const savedRef = useRef<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    getAnnexInputsAction(inspectionId, annexNo).then(inp => {
      if (!alive) return
      const f: Record<string, string> = {}
      for (const d of defs) { const v = inp.fields[d.key]; if (typeof v === 'string') f[d.key] = v }
      setFields(f)
      savedRef.current = { ...f }
      setLoading(false)
    })
    return () => { alive = false }
  }, [inspectionId, annexNo, defs])

  function commit() {
    if (!canEdit) return
    if (defs.every(d => (fields[d.key] ?? '') === (savedRef.current[d.key] ?? ''))) return
    setState('saving')
    saveAnnexInputsAction(inspectionId, annexNo, fields).then(res => {
      if (res.error) { setState('error'); return }
      savedRef.current = { ...fields }
      setState('saved')
      onSaved?.()
    })
  }

  if (loading) return <p className="px-1 py-1 text-[10px] text-[#847ba8]">고유값 불러오는 중…</p>

  return (
    <div className="space-y-1.5 px-1" data-annex-fields={annexNo} onBlur={commit}>
      <p className="flex items-center gap-1.5 text-[10px] text-[#847ba8]">
        <span className="inline-flex items-center rounded bg-[#7b68ee] px-1.5 py-0.5 text-[9px] font-medium text-white">입력</span>
        이 서식에서만 쓰는 값 — 비우면 자동 계산값으로 출력
        {state === 'saving' && <Loader2 className="size-3 animate-spin text-[#7b68ee]" />}
        {state === 'saved' && <span className="text-green-600">저장됨</span>}
        {state === 'error' && <span className="text-red-600">저장 실패</span>}
      </p>
      {defs.map(d => (
        <label key={d.key} className="block">
          <span className="block text-[10px] font-medium text-[#514b81]">{d.label}</span>
          <AnnexFieldInput def={d} value={fields[d.key] ?? ''} rows={1}
            onChange={v => setFields(prev => ({ ...prev, [d.key]: v }))} />
        </label>
      ))}
    </div>
  )
}

/** 고유값 + 미리보기 한 칸 — ④처럼 보조 칸이 하나뿐일 때 */
function AnnexPane({ inspectionId, annexNo, canEdit }: {
  inspectionId: string
  annexNo: 'report9' | 'report10' | 'report11'
  canEdit: boolean
}) {
  const [rev, setRev] = useState(0)
  return (
    <div className="space-y-2">
      <AnnexFields inspectionId={inspectionId} annexNo={annexNo} canEdit={canEdit} onSaved={() => setRev(v => v + 1)} />
      <div className="border-t border-[#f3f1fc] pt-2">
        <AnnexPreview inspectionId={inspectionId} reportType={annexNo} watch={rev === 0 ? undefined : String(rev)} />
      </div>
    </div>
  )
}

/** 별지 즉석 미리보기 (R6-4·R6-5, D34-5) — 저장된 PDF가 아니라 현재 데이터로 HTML을 조립해 보여준다.
 *  watch가 바뀌면(불량 수정 등) 디바운스 후 다시 부른다. Gotenberg 미호출이라 파일이 생기지 않는다. */
function AnnexPreview({ inspectionId, reportType, watch }: {
  inspectionId: string
  reportType: 'report9' | 'report10' | 'report11'
  watch?: string
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    getAnnexPreviewHtmlAction(inspectionId, reportType)
      .then(r => {
        if (r.error) { setErr(r.error); setHtml(null) }
        else { setErr(''); setHtml(r.html ?? null); setMissing(r.missing ?? []) }
      })
      .catch(() => setErr('미리보기를 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [inspectionId, reportType])

  useEffect(() => {
    const t = setTimeout(load, watch === undefined ? 0 : 600)
    return () => clearTimeout(t)
  }, [load, watch])

  return (
    <div className="flex h-full min-h-[16rem] flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1">
        {loading && <span className="inline-flex items-center gap-1 text-[10px] text-[#847ba8]"><Loader2 className="size-3 animate-spin" /> 렌더 중…</span>}
        {!loading && missing.length > 0 && <span className="text-[10px] text-amber-600">⚠ 미입력 {missing.length}곳</span>}
        {!loading && !err && missing.length === 0 && <span className="text-[10px] text-green-600">✓ 빈칸 없음</span>}
        <button onClick={load} className="ml-auto text-[10px] text-[#7b68ee] hover:underline">새로고침</button>
      </div>
      {err ? <p className="px-1 text-[11px] text-red-600">{err}</p>
        : html ? <iframe srcDoc={html} title={`${reportType} 미리보기`} className="min-h-[14rem] flex-1 rounded-lg border border-[#e0ddf5] bg-white" />
          : !loading ? <Empty>미리보기를 만들 수 없습니다.</Empty> : null}
    </div>
  )
}
