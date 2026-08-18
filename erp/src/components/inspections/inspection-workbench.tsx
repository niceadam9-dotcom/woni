'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, Check, CheckCircle2, Circle, Download, ExternalLink, Eye, FileText, Loader2,
  Maximize2, Package, Send, Trash2, Upload, X,
} from 'lucide-react'
import {
  requestReport9Action, getReport9StatusAction, getAnnexPreviewHtmlAction,
  type Report9Job, type Report9File,
} from '@/app/(dashboard)/inspections/report9-actions'
import { getAnnexInputsAction, saveAnnexInputsAction } from '@/app/(dashboard)/customers/facility-spec-actions'
import {
  uploadTimelineFileAction, sendOwnerReportAction, recordSubmissionAction, downloadPackageAction,
  forceCompleteStepAction, undoForceCompleteStepAction, recordOwnerReportOfflineAction,
  deleteTimelineFileAction, recordCertPaperAction,
} from '@/app/(dashboard)/inspections/timeline-actions'
import { updateInspectionMultidayAction } from '@/app/(dashboard)/inspections/actions'
import { getReportDownloadUrl } from '@/app/(dashboard)/inspections/report-actions'
import { DateInput } from '@/components/ui/date-input'
import { TIMELINE_STEP_LABELS, TIMELINE_STEP_TOOLTIPS, type TimelineStepKey } from '@/lib/doc-requirements'
import { evidenceDone, activeStepNums, stepProgress, type StepNum } from '@/lib/inspection-step-status'
import { isRegenBlocked } from '@/lib/annex-regen-policy'
import { BundleGeneratePanel } from '@/components/inspections/bundle-generate-panel'
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

/** 3번째 칸이 A4 서식 실시간 미리보기인 단계 — 이 단계에서만 폭을 미리보기 쪽으로 재배분한다 */
const PREVIEW_STEPS = new Set<StepKey>(['submit9', 'repair', 'submit11'])

export function InspectionWorkbench({
  inspectionId, canManage, canComplete, today, data, initialJob, initialFiles, customerName, customerId, slots, defectRows,
  initialStepNum = null,
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
  /** 딥링크 `?step=N`(1~6) — 진입 시 펼칠 단계. 해당없음 단계면 무시하고 기본값을 쓴다 */
  initialStepNum?: number | null
}) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [files, setFiles] = useState(initialFiles)
  const [msg, setMsg] = useState('')
  // 22 S8 후속 — [위임장 보기]가 아래 접힘 영역을 열고 그리로 스크롤한다
  const [delegationOpen, setDelegationOpen] = useState(false)
  const delegationRef = useRef<HTMLDetailsElement>(null)
  const [isPending, startTransition] = useTransition()
  const [subDate9, setSubDate9] = useState(data.submit9.submittedAt ?? '')
  const [subDate11, setSubDate11] = useState(data.submit11.submittedAt ?? '')
  /** 서버가 저장을 확인해 준 제출일 — 무거운 재조회가 끝나기 전까지 화면이 쓸 값 */
  const [justSubmitted, setJustSubmitted] = useState<{ report9: string | null; report11: string | null }>(
    { report9: null, report11: null },
  )
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
  // 제안1: ② 배치확인서 종이 보관 기록 입력 (③ 오프라인 보고와 같은 구조)
  const [paperOpen, setPaperOpen] = useState(false)
  const [paperDate, setPaperDate] = useState(today)
  const [paperLocation, setPaperLocation] = useState('')
  const [paperMemo, setPaperMemo] = useState('')
  const [dragOver, setDragOver] = useState<'cert' | 'contract' | null>(null)
  const certRef = useRef<HTMLInputElement>(null)
  const contractRef = useRef<HTMLInputElement>(null)
  const busy = job?.status === 'pending' || job?.status === 'processing'
  // 22 S15(Q-12) — 과거 건 재생성 차단. 서버(requestReport9Action)와 같은 순수 함수로 판정해
  // 화면 비활성과 서버 거부가 갈라지지 않는다. 기준일 축도 서버와 동일(종료일 → 시작일 폴백)
  const regenBlocked = isRegenBlocked({
    inspection_end_date: data.period?.end ?? null,
    inspection_start_date: data.period?.start ?? null,
  })

  /* ── 판정 — 서버(syncInspectionSteps)와 **같은 함수**를 쓴다 (R4-1).
   *  여기서 규칙을 다시 쓰면 화면 ✓와 DB status가 갈라진다 — 오프라인 보고·사유 완료가
   *  DB에만 반영되던 그 괴리가 되살아난다. data.evidence가 없는 과도기에만 옛 규칙으로 폴백한다. */
  const hasDefects = data.defects.total > 0
  const isSpecial = data.steps.length > 1
  // 방금 기록한 제출일을 화면에 즉시 반영한다 (2026-08-18 실측: router.refresh()가 이 무거운
  // 상세 페이지를 통째로 다시 그리느라 **약 5초** 걸려 "눌러도 반응이 없다"로 보였다).
  // 서버 응답이 온 뒤에만 세우므로 낙관적 추정이 아니라 '확정된 값의 선반영'이고,
  // 새 데이터가 도착하면(props 갱신) 그 값이 우선이라 어긋난 채 남지 않는다.
  const submit9At = data.submit9.submittedAt ?? justSubmitted.report9
  const submit11At = data.submit11.submittedAt ?? justSubmitted.report11
  const doneByNum = data.evidence
    ? evidenceDone({ ...data.evidence, submit9At, submit11At })
    : ({
      1: data.responded > 0,
      2: !!data.certFile || !!data.certArchived,
      3: !!data.delivery,
      4: !!submit9At,
      5: hasDefects && data.defects.done >= data.defects.total,
      6: !!submit11At,
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

  /** 딥링크 `?step=N`이 지정한 단계 — **활성 단계일 때만** 인정한다. 불량 0건이면 ⑤⑥이 해당없음이라
   *  (activeSteps) 그 칸을 억지로 펼치면 빈 화면이 뜬다. 그럴 땐 조용히 기본값으로 떨어진다. */
  const linkedStep = initialStepNum
    ? activeSteps.find(k => STEP_NUM[k] === initialStepNum)
    : undefined

  // 진입 화면은 딥링크 → 첫 미완료 단계 순 — '지금 무엇을 해야 하는지'가 곧 초기 화면이다
  const [sel, setSel] = useState<StepKey>(() => linkedStep ?? nextStep ?? data.steps[0] ?? 'checklist')

  const stepByNum = new Map(data.inspectionSteps.map(s => [s.step_num, s]))
  const stepOf = (k: StepKey) => stepByNum.get(STEP_NUM[k]) ?? null

  const ddayText = (k: StepKey) => {
    const st = stepOf(k)
    if (st?.status === 'completed') return { text: `완료 ${st.completed_at?.split('T')[0] ?? ''}`, cls: 'text-green-600' }
    // ④⑥ 기한은 법정 규칙(9호 = 점검 종료일+15일 / 11호 = 이행기간 종료)이 원천이고
    // inspection_steps.due_date는 그 사본이라 어긋날 수 있다 — 지켜야 하는 날짜를 보여준다
    const legal = k === 'submit9' ? data.submit9 : k === 'submit11' ? data.submit11 : null
    const legalAt = k === 'submit9' ? submit9At : k === 'submit11' ? submit11At : null
    if (legalAt) return { text: `제출 ${legalAt}`, cls: 'text-green-600' }
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

  function generate(reportType: 'report4' | 'report9' | 'report10' | 'report11' | 'exterior' | 'cover' | 'official' | 'delegation') {
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
      // 저장이 확인된 값을 먼저 화면에 세운다 — router.refresh()는 상세 전체를 다시 그려 느리다
      setJustSubmitted(prev => ({ ...prev, [kind]: date || null }))
      setMsg(date ? `✅ 제출일 ${date} 기록됨` : '✅ 제출일 지움')
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

  /** 제안1: ② 배치확인서를 종이로만 받은 경우 — 예외가 아니라 증거로 기록한다 */
  function savePaper() {
    startTransition(async () => {
      const res = await recordCertPaperAction(inspectionId, {
        date: paperDate, location: paperLocation, memo: paperMemo,
      })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setPaperOpen(false); setPaperMemo('')
      setMsg('✅ 종이 보관으로 기록했습니다 — ②가 근거로 완료됩니다.')
      router.refresh()
    })
  }

  /** 제안2: 잘못 올린 업로드 파일 삭제 — 근거가 사라지므로 단계도 다시 판정된다 */
  function removeFile(slot: 'cert' | 'contract') {
    const label = slot === 'cert' ? '배치확인서' : '계약서'
    if (!window.confirm(`${label} 파일을 삭제합니다.\n${slot === 'cert' ? '삭제하면 ② 단계가 다시 미완료로 돌아갑니다.\n' : ''}계속할까요?`)) return
    startTransition(async () => {
      const res = await deleteTimelineFileAction(inspectionId, slot)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ ${label} 파일을 삭제했습니다 (${res.deleted ?? 0}건).`)
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

      {/* 3칸 — 데스크톱 전용. 좁은 화면은 세로 스택 폴백(R6-10, 현장은 폰이다).
          점검표 드로어는 createPortal 오버레이(소방계획서_23 Q-4·Q-15)라 이 grid 밖에 뜬다 — 3칸 비율은 개폐와 무관하게 고정.

          ④⑤⑥은 3번째 칸이 **A4 서식 미리보기**라 폭이 곧 세로 스크롤이다: A4 표는 폭이 좁을수록
          세로로 늘어난다(실측 2026-08-18, 불량 3건 기준 — 폭 385px면 문서가 950px을 요구해 527px만
          보이지만, 505px로 넓히면 756px만 요구해 표시율이 55%→70%가 된다).
          2xl에서 더 밀면 1920 기준 87%→99%로 사실상 스크롤이 사라진다.
          ⚠ 이 재배분은 날짜 칸 병목(annex-fields 총 이행기간·defect-grid 날짜 열)을 먼저 푼 뒤에야
          가로 넘침 없이 성립한다 — 그 두 곳을 되돌리면 여기도 함께 되돌려야 한다. */}
      <div className={`grid min-h-0 flex-1 grid-cols-1 gap-2 ${
        PREVIEW_STEPS.has(sel)
          ? 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)_minmax(0,1.5fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.8fr)]'
          : 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]'
      }`}
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
                  : data.certPaper
                    ? `종이 보관 중 — ${data.certPaper.date} 수령 · ${data.certPaper.location}`
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
                  {/* 제안2: 잘못 올린 파일을 되돌린다 — ②는 파일이 곧 완료 근거라 지우면 다시 미완료가 된다 */}
                  {data.certFile && (
                    <button onClick={() => removeFile('cert')} disabled={isPending} data-testid="cert-delete"
                      className="inline-flex items-center gap-1 h-6 px-2 rounded border border-red-200 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50">
                      <Trash2 className="size-3" /> 삭제
                    </button>
                  )}
                  {/* 제안1: 종이로만 받은 경우 — 예외([사유 완료])가 아니라 증거로 기록한다 */}
                  {!data.certFile && !paperOpen && (
                    <button onClick={() => setPaperOpen(true)} disabled={isPending} data-testid="cert-paper-open"
                      className={btn}><FileText className="size-3" /> 종이 보관 기록</button>
                  )}
                </>)}
              </div>

              {canManage && paperOpen && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-[#f3f1fc] pt-2">
                  <DateInput value={paperDate} onChange={e => setPaperDate(e.target.value)}
                    className="h-7 w-32 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                  <input value={paperLocation} onChange={e => setPaperLocation(e.target.value)}
                    placeholder="보관 위치 (예: 사무실 캐비닛 A)" data-testid="cert-paper-location"
                    className="h-7 w-52 rounded-lg border border-[#d0ccf5] px-2 text-[11px] outline-none focus:border-[#7b68ee]" />
                  <input value={paperMemo} onChange={e => setPaperMemo(e.target.value)}
                    placeholder="메모 (선택)"
                    className="h-7 w-40 rounded-lg border border-[#d0ccf5] px-2 text-[11px] outline-none focus:border-[#7b68ee]" />
                  <button onClick={savePaper} disabled={isPending} data-testid="cert-paper-save"
                    className="h-7 px-2.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium disabled:opacity-50">기록</button>
                  <button onClick={() => setPaperOpen(false)} className="h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#514b81]">취소</button>
                  <p className="w-full text-[10px] text-[#b0acd6]">
                    스캔본이 없어도 종이로 갖고 있으면 이 단계는 완료입니다 — 나중에 업로드하면 파일이 우선 근거가 됩니다.
                  </p>
                </div>
              )}
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
              {/* 22 S15(Q-12) — 규약 전환일 이전 건은 재생성 차단(서버 가드와 같은 판정 함수).
                  CUTOFF가 null인 동안은 아무 건도 막지 않으므로 이 배너는 안 뜬다 */}
              {regenBlocked && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                  구 규약(미선택=해당없음)으로 작성된 점검 — 재생성하면 결과 표기가 달라져 생성이 차단됩니다. 보관함 원본을 사용하세요.
                  {customerId && (
                    <NextLink href={`/customers/${customerId}`} className="ml-1 underline hover:text-amber-900">고객 문서 보관함 열기</NextLink>
                  )}
                  <span className="ml-1">원본이 없으면 관리자에게 문의해주세요.</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                {canManage && (<>
                  <button onClick={() => generate('report9')} disabled={isPending || busy || regenBlocked} className={btnPri}>
                    {busy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} 별지 9호 생성
                  </button>
                  <button onClick={() => generate('report4')} disabled={isPending || busy || regenBlocked} className={btn}><FileText className="size-3" /> 별지 4호</button>
                  {/* 소방계획서_22 S5·S7·S8 — 납품 번들 앞장 3종. 번들 순서는 공문 → 위임장 → 표지 → 본문(bundle TYPE_ORDER) */}
                  <button onClick={() => generate('official')} disabled={isPending || busy || regenBlocked} className={btn}><FileText className="size-3" /> 공문</button>
                  <button onClick={() => generate('delegation')} disabled={isPending || busy || regenBlocked} className={btn}><FileText className="size-3" /> 위임장</button>
                  {/* 22 S8 후속 — 만들기 전에 확인. 아래 접힘 영역(입력+즉석 미리보기)을 연다 */}
                  <button onClick={() => { setDelegationOpen(true); setTimeout(() => delegationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50) }}
                    title="위임장 미리보기 — 생성 전에 내용을 확인합니다"
                    className={btn}><Eye className="size-3" /> 위임장 보기</button>
                  <button onClick={() => generate('cover')} disabled={isPending || busy || regenBlocked} className={btn}><FileText className="size-3" /> 표지</button>
                  <button onClick={() => pkg('report9')} disabled={isPending} className={btn}><Package className="size-3" /> 제출 패키지</button>
                </>)}
              </div>
              {/* 22 S13(Q-13) — 원클릭 번들: stale 자동 판정 + 병렬 생성 + 공란 사전 리포트 + 구성요소 체크리스트 */}
              {canManage && <BundleGeneratePanel inspectionId={inspectionId} disabled={isPending || busy || regenBlocked} />}
              {/* 22 S7 보강 — 공문 ③ 고유값 진입점. 정의·저장 경로(Q-14)는 있었는데 여는 화면이 없어
                  자동 제안 문서번호를 수정할 방법이 없었다(2026-08-15 S8 배선 중 발견) */}
              {canManage && (
                <details className="border-t border-[#f3f1fc] pt-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-[#514b81] hover:text-[#7b68ee]">
                    공문 입력 (문서번호·수신·참조)
                  </summary>
                  <div className="mt-1.5">
                    <AnnexFields inspectionId={inspectionId} annexNo="official" canEdit={canManage} />
                  </div>
                </details>
              )}
              {/* 22 S8 — 위임장 ③ 고유값(생년월일 등 시스템 미보유 값). 자동 기본값 위에 수동 우선.
                  [위임장 보기]가 이 영역을 여는 구조라 open을 상태로 잡는다(details 기본 토글도 그대로 유지) */}
              {canManage && (
                <details ref={delegationRef} open={delegationOpen}
                  onToggle={e => setDelegationOpen((e.currentTarget as HTMLDetailsElement).open)}
                  className="border-t border-[#f3f1fc] pt-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-[#514b81] hover:text-[#7b68ee]">
                    위임장 입력·미리보기 (관계인·대리인 생년월일 등)
                  </summary>
                  <div className="mt-1.5">
                    {/* 열렸을 때만 렌더 — 닫힌 채로 미리보기를 조립하면 불필요한 왕복이 생긴다 */}
                    {delegationOpen && <AnnexInlineCompose inspectionId={inspectionId} annexNo="delegation" canEdit={canManage} />}
                  </div>
                </details>
              )}
              <div className="flex items-center gap-1.5 flex-wrap border-t border-[#f3f1fc] pt-2">
                <span className="text-[11px] text-[#514b81]">소방서 제출일</span>
                <DateInput value={subDate9} onChange={e => setSubDate9(e.target.value)}
                  className="h-7 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                {canManage && <button onClick={() => submit('report9', subDate9)} disabled={isPending} className={btn}>기록</button>}
                {submit9At
                  ? <span className="text-[10px] text-green-600">✓ 기록됨 {submit9At} — ④ 완료</span>
                  : data.submit9.due && (
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
          <Pane title="9호 고유값·미리보기" cls={paneCls} head={paneHead} fill>
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
                {data.contractFile && (
                  <button onClick={() => removeFile('contract')} disabled={isPending} data-testid="contract-delete"
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-red-200 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="size-3" /> 삭제
                  </button>
                )}
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
          <Pane title="10호 실시간 미리보기" cls={paneCls} head={paneHead} fill>
            <AnnexPreview inspectionId={inspectionId} reportType="report10"
              watch={`${data.defects.planned}-${data.defects.done}-${data.defects.total}-${defectRev}`} />
          </Pane>
        </>)}

        {sel === 'submit11' && (<>
          {/* R6-7: 완료 내용·완료일·후 사진을 같은 표에서.
              ⚠ 제목은 '불량 조치'다 — 이 숫자는 불량별 조치완료일 개수이지 ⑥의 완료 조건(제출일)이
              아니다. 종전 '이행완료 N/M'은 제출일을 넣어도 안 바뀌어 '반응이 없다'로 읽혔다. */}
          <Pane title={`불량 조치 ${data.defects.done}/${data.defects.total}`} cls={paneCls} head={paneHead}>
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
                {/* 기록 여부를 그 자리에서 — ⑥ 완료 조건은 이 날짜뿐이다(위 표의 조치 수가 아니라) */}
                {submit11At
                  ? <span className="text-[10px] text-green-600">✓ 기록됨 {submit11At} — ⑥ 완료</span>
                  : <span className="text-[10px] text-[#b0acd6]">
                      미기록 — 이 날짜가 ⑥ 완료 조건{data.submit11.due ? ` · 기한 ${data.submit11.due}` : ''}
                    </span>}
              </div>
              <div className="border-t border-[#f3f1fc] pt-2">
                <DocPane files={files} customerName={customerName} onOpen={download} />
              </div>
            </div>
          </Pane>
          {/* R6-5 */}
          <Pane title="11호 실시간 미리보기" cls={paneCls} head={paneHead} fill>
            <AnnexPreview inspectionId={inspectionId} reportType="report11"
              watch={`${data.defects.done}-${data.defects.photoPairs}-${defectRev}`} />
          </Pane>
        </>)}
      </div>

      {/* D1: 사유로 완료한 단계는 되돌릴 수 있어야 한다 — 증거로 완료된 단계엔 나오지 않는다.
          ⚠ isSpecial로 막지 않는다(2차 독립 검증 지적): 달력 일괄·계획 패널은 plan_type을 가리지 않고
          마커를 찍으므로 월간·일반 건에도 사유 완료가 생긴다 — 찍히는데 되돌릴 수 없으면 안 된다 */}
      {canComplete && stepOf(sel) && forcedNums.has(stepOf(sel)!.step_num) && (
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

/** fill=true — 본문이 **칸 높이를 끝까지 쓴다**.
 *
 *  기본(false)은 내용만큼만 커지고 남으면 빈 채로 둔다. 그래도 되는 칸이 대부분인데,
 *  미리보기 칸만은 그게 곧 손해였다: 칸은 594px인데 iframe이 min-h(224px)에 갇혀
 *  A4 문서(872px 필요)의 **27%만 보이고 나머지는 내부 스크롤**이었다(실측 2026-08-18).
 *  section을 flex 열로 만들고 본문에 flex-1/min-h-0을 물려야 자식의 h-full이 실제 높이로 풀린다. */
function Pane({ title, children, cls, head, fill = false }: {
  title: string; children: React.ReactNode; cls: string; head: string; fill?: boolean
}) {
  return (
    <section className={fill ? `${cls} flex flex-col` : cls}>
      <p className={head}>{title}</p>
      <div className={fill ? 'flex min-h-0 flex-1 flex-col p-2' : 'p-2'}>{children}</div>
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

/** 앞장류 입력 + 즉석 미리보기 (22 S8) — 접힘 영역용. AnnexPane과 같은 구성이지만
 *  Pane이 물려주는 높이가 없는 자리라 미리보기 높이를 직접 준다.
 *  왜 필요한가: 공문·위임장은 생성 버튼만 있고 **만들기 전에 내용을 볼 방법이 없었다** —
 *  생년월일 같은 ③ 입력이 문서에 어떻게 찍히는지 확인하려면 일단 PDF를 만들어야 했다. */
function AnnexInlineCompose({ inspectionId, annexNo, canEdit }: {
  inspectionId: string
  annexNo: 'official' | 'delegation'
  canEdit: boolean
}) {
  const [rev, setRev] = useState(0)
  return (
    <div className="space-y-2">
      <AnnexFields inspectionId={inspectionId} annexNo={annexNo} canEdit={canEdit} onSaved={() => setRev(v => v + 1)} />
      <div className="h-[30rem] border-t border-[#f3f1fc] pt-2">
        <AnnexPreview inspectionId={inspectionId} reportType={annexNo} watch={rev === 0 ? undefined : String(rev)} />
      </div>
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
  // 고유값 칸은 내용만큼(shrink-0), 남는 높이는 전부 미리보기에 — Pane fill이 물려준 높이를 여기서 흘려보낸다
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="shrink-0">
        <AnnexFields inspectionId={inspectionId} annexNo={annexNo} canEdit={canEdit} onSaved={() => setRev(v => v + 1)} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t border-[#f3f1fc] pt-2">
        <AnnexPreview inspectionId={inspectionId} reportType={annexNo} watch={rev === 0 ? undefined : String(rev)} />
      </div>
    </div>
  )
}

/** 별지 즉석 미리보기 (R6-4·R6-5, D34-5) — 저장된 PDF가 아니라 현재 데이터로 HTML을 조립해 보여준다.
 *  watch가 바뀌면(불량 수정 등) 디바운스 후 다시 부른다. Gotenberg 미호출이라 파일이 생기지 않는다. */
function AnnexPreview({ inspectionId, reportType, watch }: {
  inspectionId: string
  /** 앞장류(공문·위임장·표지)도 같은 즉석 렌더를 탄다 — 액션이 전 종류를 처리한다(22 S5·S7·S8) */
  reportType: 'report9' | 'report10' | 'report11' | 'official' | 'delegation' | 'cover'
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

  // [크게 보기] — 칸을 다 채워도 A4 한 장이 다 들어가지 않는다(폭 640px에서 626px 필요 vs 약 560px 확보).
  // 스크롤을 아예 없애려면 화면 전체가 필요해 포털 오버레이를 둔다. SheetDrawer와 같은 관례:
  // 'use client' + mounted 가드(SSR엔 document가 없다) · ESC 닫기 · body 스크롤 잠금.
  const [zoom, setZoom] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (!zoom) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(false) }
    document.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = prev }
  }, [zoom])

  // 제목은 내부 코드명('delegation')이 아니라 사람이 읽는 이름 — 스크린리더가 읽는 값이다
  const frame = (cls: string) => html
    ? <iframe srcDoc={html} title={`${ANNEX_PREVIEW_TITLES[reportType]} 미리보기`} className={cls} />
    : null

  return (
    <div className="flex h-full min-h-[16rem] flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1">
        {loading && <span className="inline-flex items-center gap-1 text-[10px] text-[#847ba8]"><Loader2 className="size-3 animate-spin" /> 렌더 중…</span>}
        {!loading && missing.length > 0 && <span className="text-[10px] text-amber-600">⚠ 미입력 {missing.length}곳</span>}
        {!loading && !err && missing.length === 0 && <span className="text-[10px] text-green-600">✓ 빈칸 없음</span>}
        <span className="ml-auto flex items-center gap-2">
          {html && (
            <button onClick={() => setZoom(true)} data-testid="preview-zoom"
              title="화면 전체로 크게 보기 — 스크롤 없이 한 장을 봅니다 (ESC로 닫기)"
              className="inline-flex items-center gap-1 text-[10px] font-medium text-[#7b68ee] hover:underline">
              <Maximize2 className="size-3" /> 크게 보기
            </button>
          )}
          <button onClick={load} className="text-[10px] text-[#7b68ee] hover:underline">새로고침</button>
        </span>
      </div>
      {err ? <p className="px-1 text-[11px] text-red-600">{err}</p>
        : html ? frame('min-h-[14rem] flex-1 rounded-lg border border-[#e0ddf5] bg-white')
          : !loading ? <Empty>미리보기를 만들 수 없습니다.</Empty> : null}

      {mounted && zoom && html && createPortal(
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/50 p-4" data-testid="preview-zoom-overlay"
          onClick={e => { if (e.target === e.currentTarget) setZoom(false) }}>
          <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center gap-2 border-b border-[#e0ddf5] bg-[#fafaff] px-4 py-2">
              <FileText className="size-4 text-[#7b68ee]" />
              <p className="text-xs font-semibold text-[#514b81]">{ANNEX_PREVIEW_TITLES[reportType]} 미리보기</p>
              {missing.length > 0 && <span className="text-[10px] text-amber-600">⚠ 미입력 {missing.length}곳</span>}
              <button onClick={() => setZoom(false)} data-testid="preview-zoom-close"
                className="ml-auto text-[#847ba8] hover:text-[#514b81]" title="닫기 (ESC)">
                <X className="size-4" />
              </button>
            </div>
            {frame('min-h-0 flex-1 bg-white')}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

const ANNEX_PREVIEW_TITLES: Record<'report9' | 'report10' | 'report11' | 'official' | 'delegation' | 'cover', string> = {
  report9: '별지 9호', report10: '별지 10호', report11: '별지 11호',
  official: '제출 공문', delegation: '위임장', cover: '보고서 표지',
}
