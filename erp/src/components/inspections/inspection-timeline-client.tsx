'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2, Circle, AlertTriangle, Loader2, FileText, Send, Upload, Download, Package, RefreshCw, ExternalLink, PenLine,
  Check, ChevronDown, ChevronRight, Camera, Clock,
} from 'lucide-react'
import {
  requestReport9Action, getReport9StatusAction, downloadReport9Action,
  type Report9Job, type Report9File,
} from '@/app/(dashboard)/inspections/report9-actions'
import {
  uploadTimelineFileAction, sendOwnerReportAction, recordSubmissionAction, downloadPackageAction,
} from '@/app/(dashboard)/inspections/timeline-actions'
import { forceCompleteStepAction, undoForceCompleteStepAction, recordOwnerReportOfflineAction } from '@/app/(dashboard)/inspections/timeline-actions'
import { evidenceDone, activeStepNums, stepProgress, type StepEvidence } from '@/lib/inspection-step-status'
import { updateInspectionMultidayAction } from '@/app/(dashboard)/inspections/actions'
import { uploadDefectPhotoAction } from '@/app/(dashboard)/inspections/defect-actions'
import { DateInput } from '@/components/ui/date-input'
import { TIMELINE_STEP_LABELS, TIMELINE_STEP_TOOLTIPS, type TimelineStepKey } from '@/lib/doc-requirements'
import { GeneratedDocList } from '@/components/inspections/generated-doc-list'
import { PlacementReportHelper } from '@/components/inspections/placement-report-helper'
import { AnnexComposePanel, type ComposeAnnexNo } from '@/components/inspections/annex-compose-panel'
import { MessageTemplateModal } from '@/components/settings/message-template-modal'
import { getReportDownloadUrl } from '@/app/(dashboard)/inspections/report-actions'
import { STEP_REPORT_LABELS, STEP_REPORT_TYPES, type StepReportType, type ReportType } from '@/app/(dashboard)/inspections/report-constants'
import type { InspectionStep } from '@/types'

/** 문서 타임라인 (§9-9 / P7) — 단계별 상태·D-day·업로드 슬롯·생성·발송·제출 패키지.
 *  단계 구성은 stepDocs(§9-9a): 자체점검 ①~⑥ 상시 표시(D-4 — 불량 0건이면 ⑤⑥ 해당없음 흐림).
 *  ④ 전제조건 = 종전 별지 9호 준비 체크(§9-6⑦ 흡수). 값 입력은 각 원천 화면에서. */

export type PrereqRow = { label: string; ok: boolean; detail: string; href?: string; hrefLabel?: string }

/** ⑤ 전/후 갤러리용 불량 행 (§4-E-2) — photo_url·after_photo_url 기존 컬럼 그대로 */
export type TimelineDefect = {
  id: string
  defect_name: string
  severity: '경미' | '보통' | '중대'
  photo_url: string | null
  after_photo_url: string | null
  action_taken: string | null
  action_completed_at: string | null
}

/** 타임라인 하단 접이식 — 제출 보고서 파일 목록 (InspectionReportsClient 흡수) */
export type TimelineReport = {
  id: string
  report_type: ReportType
  file_name: string
  submitted_at: string | null
  submitted_by_name: string | null
}

export type TimelineData = {
  steps: TimelineStepKey[]
  isGeneral: boolean                    // 일반관리 (① = 외관점검표)
  responded: number                     // 점검표 응답 수
  certFile: { name: string; path: string } | null
  /** 파일은 없지만 종이 보관 후 정리된 회차 — '업로드 필요'가 아니다 (소방계획서_18 D-7 ⚠) */
  certArchived?: boolean
  contractFile: { name: string; path: string } | null
  delivery: { sentTo: string; sentAt: string } | null   // ③ 발송 이력 (최근)
  submit9: { due: string | null; dday: number | null; submittedAt: string | null }
  /** R4-1(독립 검증 D3): 화면 ✓도 서버와 **같은 판정 함수**(evidenceDone)를 쓰기 위한 증거 묶음.
   *  화면이 따로 계산하면 오프라인 보고·사유 완료가 DB에만 반영되는 괴리가 다시 생긴다. */
  evidence?: StepEvidence
  /** R5-8: ④ 기한의 기산 근거 — '왜 이 날짜인지'를 ④에서 바로 보고 고칠 수 있어야 한다.
   *  end가 없으면 시작일이 기산일이다(page.tsx의 due9 계산과 같은 규칙). */
  period?: { start: string | null; end: string | null; days: number }
  submit11: { due: string | null; dday: number | null; submittedAt: string | null }
  defects: { total: number; planned: number; done: number; photoPairs: number }
  prereqs: PrereqRow[]                  // ④ 전제 체크 (§9-6⑦)
  consentOk: boolean                    // ③ 송달 동의+이메일 보유
  // §4-E H-28: 여정 스텝퍼 통합 — inspection_steps 마감·완료 흡수, ⑤ 전/후 갤러리, 제출 보고서 파일
  inspectionSteps: InspectionStep[]     // step_num 1~6 = ①~⑥ (마감일 D-day·완료 처리)
  defectRows: TimelineDefect[]          // ⑤ 전/후 쌍 카드
  reports: TimelineReport[]             // 하단 접이식 제출 보고서
}

function saveBlob(base64: string, fileName: string) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** C1(소방계획서_21 R5): 종전에 페이지에 흩어져 있던 블록을 단계 안으로 끌어들이는 슬롯.
 *  서버 컴포넌트가 데이터를 싣고 렌더한 노드를 그대로 받는다 — 타임라인은 배치만 책임진다.
 *  자체점검 건은 sheet→① / participants→② / defects→⑤,
 *  월간 외관점검 건은 단계가 ① 하나뿐이라 sheet·exterior·participants·defects가 모두 ①로 모인다. */
export type TimelineSlots = {
  multiday?: React.ReactNode
  sheet?: React.ReactNode
  /** 펌프성능시험 실측치 — 법정 별지 4호 "※ 펌프성능시험" 표의 입력처 (R5-7 후속) */
  pumpTest?: React.ReactNode
  exterior?: React.ReactNode
  participants?: React.ReactNode
  defects?: React.ReactNode
}

export function InspectionTimelineClient({ inspectionId, canManage, canComplete, today, data, initialJob, initialFiles, customerName, customerId, slots }: {
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
}) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [files, setFiles] = useState(initialFiles)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const [subDate9, setSubDate9] = useState(data.submit9.submittedAt ?? '')
  const [subDate11, setSubDate11] = useState(data.submit11.submittedAt ?? '')
  const [dragOver, setDragOver] = useState<'cert' | 'contract' | null>(null)   // R0-6 드롭존 하이라이트
  // H-23 작성 패널(별지 9·10·11호 3단 패턴) — [별지 N호 생성] 원클릭은 빠른 경로로 유지, [작성]은 보완·수정 경로(§4-A-2b)
  const [compose, setCompose] = useState<ComposeAnnexNo | null>(null)
  const certRef = useRef<HTMLInputElement>(null)
  const contractRef = useRef<HTMLInputElement>(null)
  const busy = job?.status === 'pending' || job?.status === 'processing'
  // §4-E H-28: 단계 완료 처리 (inspection_steps 흡수) + 완료 단계 자동 접힘
  const [completing, setCompleting] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<TimelineStepKey, boolean>>({} as Record<TimelineStepKey, boolean>)
  const [reportsOpen, setReportsOpen] = useState(false)  // 하단 제출 보고서 접이식
  // R4-2(D2): ③ 방문·유선 보고 기록 — 이메일 발송만 근거로 삼으면 오프라인 보고가 영원히 미완이다
  const [offlineOpen, setOfflineOpen] = useState(false)
  const [offlineDate, setOfflineDate] = useState(today)
  const [offlineMethod, setOfflineMethod] = useState('방문 설명')
  const [offlineMemo, setOfflineMemo] = useState('')
  // R5-8: ④ 기산 근거 인라인 수정 — 종료일 입력은 ①에 두되, 기한을 보는 자리에서도 고칠 수 있게
  const [anchorEdit, setAnchorEdit] = useState(false)
  const [anchorEnd, setAnchorEnd] = useState(data.period?.end ?? '')
  const [anchorMsg, setAnchorMsg] = useState('')
  // §4-E-2: ⑤ 전/후 갤러리 후 사진 업로드
  const afterRef = useRef<HTMLInputElement>(null)
  const afterTarget = useRef<string | null>(null)
  const [afterBusy, setAfterBusy] = useState<string | null>(null)

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
      setMsg('✅ 생성 완료 — 목록에서 PDF를 확인하세요.')
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

  function upload(slot: 'cert' | 'contract', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) doUpload(slot, file)
    e.target.value = ''
  }

  // R0-6: 업로드 슬롯 = 드롭존 (문서 현황 customer-docs와 동일 패턴)
  const dropProps = (slot: 'cert' | 'contract') => canManage ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(slot) },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDragOver(null)
      const f = e.dataTransfer.files?.[0]
      if (f) doUpload(slot, f)
    },
  } : {}

  function sendOwner() {
    setMsg('')
    startTransition(async () => {
      const res = await sendOwnerReportAction(inspectionId)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ 관계인 보고 발송됨 → ${res.sentTo} (발송 이력 기록)`)
      router.refresh()
    })
  }

  function recordSubmit(kind: 'report9' | 'report11', date: string) {
    if (!date) { setMsg('❌ 제출일을 입력해주세요.'); return }
    startTransition(async () => {
      const res = await recordSubmissionAction(inspectionId, kind, date)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ 제출일이 기록됐습니다 — 기한 뱃지·알림이 소멸됩니다.')
      router.refresh()
    })
  }

  /** R5-8: ④에서 기산일(종료일)을 고친다 — 저장하면 서버가 단계 마감일을 종료일 기준으로 재계산한다.
   *  ①의 [점검 기간]과 같은 액션을 쓰므로 두 자리가 갈라지지 않는다(일수는 기존 값을 보존). */
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

  function saveOffline() {
    setMsg('')
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

  function pkg(kind: 'report9' | 'report11') {
    setMsg('')
    startTransition(async () => {
      const res = await downloadPackageAction(inspectionId, kind)
      if (res.error || !res.base64) { setMsg(`❌ ${res.error ?? '패키지 생성 실패'}`); return }
      saveBlob(res.base64, res.fileName ?? 'package.zip')
      setMsg(`✅ 패키지 다운로드 — 포함: ${(res.included ?? []).join(', ')}${(res.skipped?.length ?? 0) > 0 ? ` / 누락: ${res.skipped!.join(', ')}` : ''}`)
    })
  }

  function download(path: string, saveName?: string) {
    startTransition(async () => {
      const res = await downloadReport9Action(inspectionId, path, saveName)
      if (res.error || !res.url) { setMsg(`❌ ${res.error ?? '다운로드 실패'}`); return }
      window.open(res.url, '_blank')
    })
  }

  // R4-3·R4-9(소방계획서_21 B-2): 종전 [단계 완료]는 근거 없이 status만 바꿨다 — 실제로 하지 않은 일이
  // 소방서 제출 이력에 완료로 남는다(D34-2). 이제 단계는 **증거로 스스로 완료**되고, 이 버튼은
  // 정말 예외인 경우를 위한 **사유 필수** 경로다. 사유가 곧 증거라 동기화가 되돌리지 않는다.
  async function forceComplete(stepId: string, stepNum: number, label: string) {
    const reason = window.prompt(
      `${label} 단계를 예외로 완료 처리합니다.\n`
      + '증거(점검표 응답·파일·발송 이력·제출일 등)가 생기면 자동으로 완료되니, 그 경로를 먼저 확인해주세요.\n\n'
      + '완료 사유를 입력하세요 (5자 이상 — 이 사유가 증빙으로 남습니다):',
    )
    if (reason === null) return
    setCompleting(stepId)
    setMsg('')
    const res = await forceCompleteStepAction(inspectionId, stepNum, reason)
    setCompleting(null)
    if (res.error) { setMsg(`❌ ${res.error}`); return }
    setMsg('✅ 사유와 함께 완료 처리했습니다.')
    router.refresh()
  }

  /** D1: 사유 완료 철회 — 마커를 지우는 게 아니라 반대 마커를 남긴다(로그는 append-only) */
  async function undoForce(stepId: string, stepNum: number, label: string) {
    const reason = window.prompt(
      `${label} 단계의 '사유 완료'를 철회합니다.\n`
      + '철회하면 증거만으로 다시 판정하므로, 증거가 없으면 미완료로 돌아갑니다.\n\n'
      + '철회 사유를 입력하세요 (5자 이상 — 철회도 기록으로 남습니다):',
    )
    if (reason === null) return
    setCompleting(stepId)
    setMsg('')
    const res = await undoForceCompleteStepAction(inspectionId, stepNum, reason)
    setCompleting(null)
    if (res.error) { setMsg(`❌ ${res.error}`); return }
    setMsg('✅ 사유 완료를 철회했습니다 — 증거 기준으로 다시 판정합니다.')
    router.refresh()
  }

  // 하단 접이식 제출 보고서 다운로드 (InspectionReportsClient 흡수 — 기존 getReportDownloadUrl 재사용)
  function downloadReport(reportId: string, fileName: string) {
    startTransition(async () => {
      const res = await getReportDownloadUrl(reportId)
      if (res.error || !res.url) { setMsg(`❌ ${res.error ?? '다운로드 실패'}`); return }
      const a = document.createElement('a')
      a.href = res.url; a.download = res.fileName ?? fileName; a.target = '_blank'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    })
  }

  // §4-E-2: ⑤ 후(조치) 사진 업로드 — 기존 uploadDefectPhotoAction 재사용(defect 편집 경로 동일)
  function pickAfter(defectId: string) {
    afterTarget.current = defectId
    afterRef.current?.click()
  }
  function onAfterPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const defectId = afterTarget.current
    e.target.value = ''
    if (!file || !defectId) return
    setAfterBusy(defectId)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('defectId', defectId); fd.append('inspectionId', inspectionId)
      fd.append('file', file); fd.append('field', 'after')
      const res = await uploadDefectPhotoAction(fd)
      setAfterBusy(null)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ 후(조치) 사진을 등록했습니다.')
      router.refresh()
    })
  }

  const dday = (d: number | null, submitted: string | null) => {
    if (submitted) return <span className="text-[10px] text-green-600">제출 {submitted}</span>
    if (d === null) return null
    if (d < 0) return <span className="text-[10px] font-semibold text-red-600">기한 초과 {-d}일 ⚠</span>
    return <span className={`text-[10px] font-semibold ${d <= 3 ? 'text-red-600' : 'text-amber-600'}`}>D-{d}{d <= 7 ? ' ⚠' : ''}</span>
  }

  const stepIcon = (done: boolean, active: boolean) =>
    done ? <CheckCircle2 className="size-4 text-green-600 shrink-0" />
      : active ? <AlertTriangle className="size-4 text-amber-500 shrink-0" />
        : <Circle className="size-4 text-[#d0ccf5] shrink-0" />

  const has = (k: TimelineStepKey) => data.steps.includes(k)
  const hasDefects = data.defects.total > 0
  // R4-1(독립 검증 D3): ✓는 **서버와 같은 판정 함수**로 계산한다. 종전엔 여기서 리터럴로 다시 계산해
  // 오프라인 보고·사유 완료가 DB에서는 완료인데 화면 ✓는 미완으로 남는 새 괴리가 생겼다.
  // evidence가 오지 않는 옛 호출자를 위해 화면이 가진 값으로 같은 모양을 만들어 넘긴다.
  const stepDone = evidenceDone(data.evidence ?? {
    responded: data.responded,
    certFile: !!data.certFile, certArchived: !!data.certArchived,
    delivery: !!data.delivery, offlineReport: false,
    submit9At: data.submit9.submittedAt,
    defectsTotal: data.defects.total, defectsDone: data.defects.done,
    submit11At: data.submit11.submittedAt,
  })
  const done1 = stepDone[1]
  const done2 = stepDone[2]
  const done3 = stepDone[3]
  const done4 = stepDone[4]
  // ⑤ 완료 판정 = 불량 전건 조치 완료 (R10-a — 계약서·사진은 선택 증빙이라 완료 조건에서 제외)
  const done5 = stepDone[5]
  const done6 = stepDone[6]
  /** 이 단계가 증거가 아니라 **사유**로 완료됐는지 — 표시와 철회 버튼에 쓴다(D1) */
  const forcedNums = new Set<number>(data.evidence?.forced ?? [])

  // R10-b: 진행률 — 해당없음(불량 0건의 ⑤⑥)은 분모에서 제외
  const isSpecialTimeline = data.steps.length > 1
  const progress = stepProgress(stepDone, activeStepNums(isSpecialTimeline, hasDefects))
  const doneCount = progress.done
  const progressPct = progress.pct

  // §4-E "다음 할 일" — 활성 단계 중 첫 미완료 (처음 사용자도 바로 알게)
  const orderedSteps: Array<{ key: TimelineStepKey; done: boolean }> = [
    { key: 'checklist' as TimelineStepKey, done: done1 }, { key: 'cert' as TimelineStepKey, done: done2 },
    { key: 'ownerReport' as TimelineStepKey, done: done3 }, { key: 'submit9' as TimelineStepKey, done: done4 },
    ...(hasDefects ? [{ key: 'repair' as TimelineStepKey, done: done5 }, { key: 'submit11' as TimelineStepKey, done: done6 }] : []),
  ].filter(s => has(s.key))
  const nextStep = orderedSteps.find(s => !s.done)

  // §4-E H-28: 타임라인 키 → inspection_step (step_num 1~6 = ①~⑥)
  const STEP_NUM: Record<TimelineStepKey, number> = {
    checklist: 1, cert: 2, ownerReport: 3, submit9: 4, repair: 5, submit11: 6,
  }
  const stepByNum = new Map(data.inspectionSteps.map(s => [s.step_num, s]))
  const stepOf = (k: TimelineStepKey) => stepByNum.get(STEP_NUM[k]) ?? null
  // [사유 완료]는 **미완료 단계 어디서나** 가능하다(R4 잔재 ①). 종전엔 가장 낮은 미완료 단계에만
  // 버튼을 뒀지만, 서버가 순서 강제를 버린 뒤로는 화면만 막는 꼴이었다 — 배치확인서(②)는 협회에서
  // 늦게 오고 점검표(①)는 먼저 채워지는 등 순서가 어긋나는 것이 정상이다.

  // §4-E 완료 단계 자동 접힘: done → 접힘(사용자 클릭 시 펼침), 첫 미완료(nextStep)는 자동 펼침
  const doneMap: Record<TimelineStepKey, boolean> = {
    checklist: done1, cert: done2, ownerReport: done3, submit9: done4, repair: done5, submit11: done6,
  }
  const isOpen = (k: TimelineStepKey) => {
    if (k in expanded) return expanded[k]                 // 사용자 명시적 토글 최우선
    if (nextStep?.key === k) return true                  // 첫 미완료 자동 펼침
    return !doneMap[k]                                    // 완료 단계는 접힘, 미완료는 펼침
  }
  const toggle = (k: TimelineStepKey) => setExpanded(prev => ({ ...prev, [k]: !isOpen(k) }))

  // 완료 단계 한 줄 요약 헤더 (클릭 시 상세 펼침) — 접힘 상태 공용
  const stepDday = (k: TimelineStepKey) => {
    const st = stepOf(k)
    if (!st || !st.due_date) return null
    if (st.status === 'completed') {
      return <span className="text-[10px] text-green-600">완료 {st.completed_at?.split('T')[0] ?? ''}</span>
    }
    const d = Math.round((new Date(st.due_date).getTime() - new Date(today).getTime()) / 86400000)
    if (d < 0) return <span className="text-[10px] font-semibold text-red-600">단계 마감 초과 {-d}일 ⚠</span>
    return <span className={`text-[10px] font-semibold ${d <= 3 ? 'text-red-600' : d <= 7 ? 'text-amber-600' : 'text-[#b0acd6]'}`}>단계 마감 D-{d}</span>
  }

  // 접힘/펼침 클릭 헤더 (아이콘 + 라벨 + D-day/완료일 + 완료 처리 버튼) — 렌더 함수(컴포넌트 생성 금지)
  // collapsedSummary: 접힘 시에도 표면에 남길 업무 상태(제출일 등) — 완료 접힘이 정보를 감추지 않도록
  const stepHeader = ({ k, done, active, extra, collapsedSummary }: {
    k: TimelineStepKey; done: boolean; active: boolean; extra?: React.ReactNode; collapsedSummary?: React.ReactNode
  }) => {
    const st = stepOf(k)
    const open = isOpen(k)
    const canCompleteHere = canComplete && st && st.status !== 'completed'
    return (
      <div className="flex items-center gap-2 w-full">
        <button onClick={() => toggle(k)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          {open ? <ChevronDown className="size-3.5 text-[#b0acd6] shrink-0" /> : <ChevronRight className="size-3.5 text-[#b0acd6] shrink-0" />}
          {stepIcon(done, active)}
          <span className={`text-xs font-semibold shrink-0 ${done ? 'text-[#514b81]' : 'text-[#090c1d]'}`}
            title={TIMELINE_STEP_TOOLTIPS[k]}>{TIMELINE_STEP_LABELS[k]}</span>
          {stepDday(k)}
          {extra}
          {!open && collapsedSummary}
        </button>
        {canCompleteHere && (
          <button onClick={() => forceComplete(st!.id, st!.step_num, TIMELINE_STEP_LABELS[k])} disabled={completing === st!.id}
            className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-white text-[#847ba8] border border-[#d0ccf5] text-[11px] font-medium hover:bg-[#f5f4ff] disabled:opacity-50"
            title="증거가 생기면 이 단계는 자동으로 완료됩니다. 예외 상황에서만 사유를 남기고 완료하세요.">
            {completing === st!.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} 사유 완료
          </button>
        )}
        {/* D1: 사유로 완료한 단계는 **되돌릴 수 있어야 한다** — 마커가 영구히 남으면 하지 않은 일이
            완료로 고정된다. 증거로 완료된 단계에는 이 버튼이 없다(되돌릴 마커가 없으므로) */}
        {canComplete && st && forcedNums.has(st.step_num) && (
          <button onClick={() => undoForce(st.id, st.step_num, TIMELINE_STEP_LABELS[k])} disabled={completing === st.id}
            className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-white text-amber-600 border border-amber-200 text-[11px] font-medium hover:bg-amber-50 disabled:opacity-50"
            title="사유로 완료한 단계입니다. 철회하면 증거만으로 다시 판정합니다.">
            {completing === st.id ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} 사유 완료 철회
          </button>
        )}
      </div>
    )
  }

  const row = 'flex items-start gap-2 py-2 border-b border-[#f3f1fc] last:border-0'
  const label = 'text-xs font-semibold text-[#090c1d] w-44 shrink-0 pt-0.5'
  const btn = 'inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50'
  const btnPri = 'inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium disabled:opacity-50'

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-1">
        <FileText className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">문서 타임라인</h2>
        <span className="text-[11px] text-[#b0acd6]">
          {!isSpecialTimeline ? '정기·일반 — 점검표 작성·2년 보관만 (보고 의무 없음)' : '자체점검 보고 절차 6단계 — ⑤⑥은 불량 발생 시 진행'}
        </span>
        {/* 상호 진입점 역링크 — 소방계획서 트리(별지 서식)로 (소방계획서_8 Phase B) */}
        {customerId && (
          <NextLink href={`/customers/${customerId}?tab=plan&form=annex`}
            title="이 고객의 회차별 문서·별지 현황을 소방계획서 트리에서 봅니다"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline shrink-0">
            소방계획서 트리에서 보기 <ExternalLink className="size-3" />
          </NextLink>
        )}
        {isSpecialTimeline && (
          <span className={`${customerId ? '' : 'ml-auto'} text-[11px] font-semibold text-[#7b68ee] shrink-0`}
            title="해당없음 단계는 분모에서 제외">{doneCount}/{progress.total} 단계 완료</span>
        )}
      </div>
      {isSpecialTimeline && (
        <div className="w-full h-1 bg-[#e0ddf5] rounded-full overflow-hidden mb-2">
          <div className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? 'bg-green-500' : 'bg-[#7b68ee]'}`}
            style={{ width: `${progressPct}%` }} />
        </div>
      )}
      {/* §4-E 다음 할 일 배너 — 지금 무엇을 해야 하는지 화면 상단에 명시 */}
      {isSpecialTimeline && (
        nextStep ? (
          <div className="flex items-center gap-2 mb-3 rounded-lg bg-[#f5f4ff] border border-[#e0ddf5] px-3 py-2">
            <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
            <span className="text-xs text-[#514b81]">다음 할 일:</span>
            <span className="text-xs font-semibold text-[#090c1d]">{TIMELINE_STEP_LABELS[nextStep.key]}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-3 rounded-lg bg-green-50 border border-green-200 px-3 py-2">
            <CheckCircle2 className="size-3.5 text-green-600 shrink-0" />
            <span className="text-xs font-medium text-green-700">모든 단계 완료 — 제출까지 마쳤습니다</span>
          </div>
        )
      )}

      {/* ① 점검표 — 여정 스텝퍼(§4-E): 헤더=아이콘·마감·완료처리 / 펼침부=행동 */}
      <div className={row}>
        <div className="flex-1 min-w-0">
          {isSpecialTimeline ? (
            stepHeader({ k: 'checklist', done: done1, active: true })
          ) : (
            <div className="flex items-center gap-2">
              {stepIcon(done1, true)}
              <span className="text-xs font-semibold text-[#090c1d]" title={TIMELINE_STEP_TOOLTIPS.checklist}>
                {TIMELINE_STEP_LABELS.checklist}{data.isGeneral ? ' (외관점검표)' : ' (소방시설등점검표)'}
              </span>
            </div>
          )}
          {(isSpecialTimeline ? isOpen('checklist') : true) && (
            <div className="flex items-center gap-2 flex-wrap mt-1.5 pl-6">
              <span className={`text-xs ${done1 ? 'text-[#514b81]' : 'text-amber-600'}`}>
                {done1 ? `응답 ${data.responded}건 입력됨` : '응답 없음 — 위 점검표 입력에서 작성해주세요'}
              </span>
              {data.steps.length === 1 && (
                <span className="text-[10px] text-[#b0acd6]">완료 조건 = 점검표 작성 (기한·알림 없음)</span>
              )}
              {/* 별지 4호(소방시설등점검표) 생성 — 자체점검 ① 점검표 행 (소방계획서_7 §4-A-2·H-16 발견 연결) */}
              {isSpecialTimeline && canManage && (
                <button onClick={() => generate('report4')} disabled={isPending || busy} className={`ml-auto ${btn}`}
                  title="소방시설등점검표(별지 4호) 생성 — 점검결과·인력 자동, 3~7쪽 세부현황은 설비 대장(고객 탭 1.4)">
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} 별지 4호 생성
                </button>
              )}
            </div>
          )}
          {/* C1(R5-3·R5-8): ① 안의 실제 작업 — 점검 기간·점검표 입력.
              월간 외관점검 건은 단계가 ① 하나라 외관점검표·참여자·불량까지 여기로 모인다 */}
          {(isSpecialTimeline ? isOpen('checklist') : true) && (
            <div className="mt-2 pl-6 space-y-3">
              {slots?.multiday}
              {slots?.sheet}
              {!isSpecialTimeline && slots?.exterior}
              {!isSpecialTimeline && slots?.participants}
              {!isSpecialTimeline && slots?.defects}
            </div>
          )}
        </div>
      </div>

      {/* ② 점검인력 배치확인서 — 업로드 직감 규칙(R10-c): ✅초록+파일명 / ⚠앰버+[업로드] */}
      {has('cert') && (
        <div className={`${row} ${dragOver === 'cert' ? 'bg-[#f5f4ff] outline outline-1 outline-dashed outline-[#7b68ee] rounded' : ''}`} {...dropProps('cert')}>
          <div className="flex-1 min-w-0">
            {stepHeader({ k: 'cert', done: done2, active: done1 })}
            {isOpen('cert') && (
              <div className="flex items-center gap-2 flex-wrap mt-1.5 pl-6">
                <span className={`text-xs ${done2 ? 'text-[#514b81]' : 'text-amber-600'}`}>
                  {data.certFile ? `업로드됨: ${data.certFile.name}`
                    : data.certArchived ? '종이 보관됨 — 과거본 정리로 ERP 사본은 삭제되었습니다'
                    : '협회 발급본 업로드 필요 (자체점검 대행 시 필수)'}
                </span>
                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                  {/* R7 배치신고 도우미 — 신고값 협회 순서 텍스트로 복사 */}
                  {canManage && <PlacementReportHelper inspectionId={inspectionId} />}
                  <a href="https://www.kfma.kr" target="_blank" rel="noreferrer" className="text-[10px] text-[#b0acd6] hover:text-[#7b68ee] inline-flex items-center gap-0.5">
                    협회 <ExternalLink className="size-2.5" />
                  </a>
                  {data.certFile && (
                    <button onClick={() => download(data.certFile!.path)} className={btn}><Download className="size-3" /> 보기</button>
                  )}
                  {canManage && (<>
                    <input ref={certRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden" onChange={e => upload('cert', e)} />
                    <button onClick={() => certRef.current?.click()} disabled={isPending} className={btn} title="클릭 또는 파일을 이 행에 끌어다 놓으세요"><Upload className="size-3" /> 업로드</button>
                  </>)}
                </span>
              </div>
            )}
            {/* C1(R5-5): 배치확인서가 곧 인력 배치 증빙 — 참여자 편집을 같은 단계 안에 둔다 */}
            {isOpen('cert') && slots?.participants && (
              <div className="mt-2 pl-6">{slots.participants}</div>
            )}
          </div>
        </div>
      )}

      {/* ③ 관계인 보고·협의 (§4-E-1) */}
      {has('ownerReport') && (
        <div className={row}>
          <div className="flex-1 min-w-0">
            {stepHeader({ k: 'ownerReport', done: done3, active: done1 })}
            {isOpen('ownerReport') && (
              <div className="flex items-center gap-2 flex-wrap mt-1.5 pl-6">
                <span className={`text-xs ${done3 ? 'text-[#514b81]' : 'text-amber-600'}`}>
                  {data.delivery
                    ? `발송됨 → ${data.delivery.sentTo} (${data.delivery.sentAt.slice(0, 10)})`
                    : data.evidence?.offlineReport
                      ? '방문·유선으로 보고함 (오프라인 기록됨)'
                      : data.consentOk ? '점검 결과 보고 후 개선·변경 협의 → ④로 (별지 9호 생성 후 이메일 발송)' : '송달 동의·이메일 미입력 — 고객 소방계획서 탭에서 입력'}
                </span>
                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                  {/* R7-3: 문구는 **보내는 자리**에서 고친다 (전용 페이지 없음). 권한은 액션이 판정 */}
                  <MessageTemplateModal templateKey="owner_report" label="관계인 보고 메일"
                    sampleVars={{ 고객명: customerName ?? '', 연도: '', 차수: '', 점검일: '' }} />
                  {canManage && (
                    <button onClick={sendOwner} disabled={isPending || !data.consentOk} className={btnPri}>
                      <Send className="size-3" /> {done3 ? '재발송' : '생성물 이메일 발송'}
                    </button>
                  )}
                  {/* R4-2(독립 검증 D2): 이메일이 전부가 아니다 — 방문·유선 보고를 남길 자리가 없어
                      서버 액션만 있고 쓰이지 못했다. 여기가 그 입력처다 */}
                  {canManage && !offlineOpen && (
                    <button onClick={() => setOfflineOpen(true)} className={btn}>
                      <PenLine className="size-3" /> 방문·유선 보고 기록
                    </button>
                  )}
                </span>
              </div>
            )}
            {isOpen('ownerReport') && offlineOpen && canManage && (
              <div className="mt-1.5 pl-6 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-[#b0acd6]">보고일</span>
                <DateInput value={offlineDate} onChange={e => setOfflineDate(e.target.value)}
                  className="h-7 w-32 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                <select value={offlineMethod} onChange={e => setOfflineMethod(e.target.value)}
                  className="h-7 rounded-lg border border-[#d0ccf5] px-2 text-[11px] outline-none focus:border-[#7b68ee]">
                  <option>방문 설명</option><option>유선 통보</option><option>대면 전달</option><option>기타</option>
                </select>
                <input value={offlineMemo} onChange={e => setOfflineMemo(e.target.value)} placeholder="메모(선택)"
                  className="h-7 w-48 rounded-lg border border-[#d0ccf5] px-2 text-[11px] outline-none focus:border-[#7b68ee]" />
                <button onClick={saveOffline} disabled={isPending} className={btnPri}>기록</button>
                <button onClick={() => setOfflineOpen(false)} className="text-[10px] underline text-[#b0acd6]">취소</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ④ 소방서 제출 (별지 9호+10호) — 전제 = §9-6⑦ 준비 체크 */}
      {has('submit9') && (
        <div className={row}>
          <div className="flex-1 min-w-0">
            {stepHeader({ k: 'submit9', done: done4, active: done1,
              extra: hasDefects ? <span className="text-[10px] text-[#b0acd6]">(+별지 10호 — 불량 시)</span> : undefined,
              collapsedSummary: data.submit9.submittedAt ? <span className="text-[10px] text-green-600">제출 {data.submit9.submittedAt}</span> : undefined })}
          {isOpen('submit9') && (
          <div className="flex-1 min-w-0 space-y-1.5 mt-1.5 pl-6">
            <div className="flex items-center gap-2 flex-wrap">
              {dday(data.submit9.dday, data.submit9.submittedAt)}
              {data.submit9.due && !data.submit9.submittedAt && <span className="text-[10px] text-[#b0acd6]">기한 {data.submit9.due}</span>}
              {canManage && (<>
                <button onClick={() => generate('report9')} disabled={isPending || busy} className={btnPri}>
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} 별지 9호 생성
                </button>
                <button onClick={() => setCompose('report9')} disabled={isPending || busy} className={btn}
                  title="자동 채움 검토 → 고유 값 입력(비고·보고일) → 미리보기·생성 (H-23 작성 패널)">
                  <PenLine className="size-3" /> 9호 작성
                </button>
                {data.defects.total > 0 && (<>
                  <button onClick={() => generate('report10')} disabled={isPending || busy} className={btn}>별지 10호 생성</button>
                  <button onClick={() => setCompose('report10')} disabled={isPending || busy} className={btn}
                    title="자동 채움 검토 → 고유 값 입력(제출일·기간 보정·요약) → 미리보기·생성 (H-23 작성 패널)">
                    <PenLine className="size-3" /> 10호 작성
                  </button>
                </>)}
                {/* R7-9: 별지 4호(점검표)는 9호의 첨부다 — 제출 직전 같이 확인할 수 있게 ④에도 둔다.
                    생성 진입점은 ①이 원천이고 여기서는 조회·재생성 편의만 제공한다 */}
                <button onClick={() => generate('report4')} disabled={isPending || busy} className={btn}
                  title="별지 4호(소방시설등점검표) — 9호의 첨부. 제출 직전 함께 확인">
                  <FileText className="size-3" /> 별지 4호
                </button>
                <button onClick={() => pkg('report9')} disabled={isPending} className={btn}><Package className="size-3" /> 제출 패키지</button>
                <span className="inline-flex items-center gap-1">
                  <DateInput value={subDate9} onChange={e => setSubDate9(e.target.value)} className="h-7 w-32 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                  <button onClick={() => recordSubmit('report9', subDate9)} disabled={isPending} className={btn}>제출일 기록</button>
                </span>
              </>)}
            </div>
            {/* R5-8 기산 근거 — '제출 기한이 왜 이 날짜인지'를 ④에서 바로 보고, 여기서 고칠 수도 있다.
                종료일이 없으면 시작일이 기산일이다(page.tsx due9 규칙과 동일) */}
            {data.period && (data.period.end || data.period.start) && (
              <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-[#b0acd6]">
                <Clock className="size-3 shrink-0" />
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
            {/* 전제 체크 (§9-6⑦ 흡수) */}
            <div className="flex items-center gap-2 flex-wrap text-[10px]">
              <span className="text-[#b0acd6]">└ 전제:</span>
              {data.prereqs.map(p => (
                <span key={p.label} title={p.detail} className={`inline-flex items-center gap-0.5 ${p.ok ? 'text-green-600' : 'text-amber-600'}`}>
                  {p.ok ? '✓' : '⚠'} {p.label}
                  {!p.ok && p.href && <NextLink href={p.href} className="underline hover:text-[#7b68ee]">{p.hrefLabel ?? '입력'}</NextLink>}
                </span>
              ))}
            </div>
            {job?.status === 'failed' && <p className="text-[11px] text-red-600">❌ 생성 실패: {job.error ?? '알 수 없는 오류'}</p>}
            {job?.status === 'done' && (job.missing?.length ?? 0) > 0 && (
              <p className="text-[10px] text-amber-600">누락: {job.missing!.join(' · ')}</p>
            )}
          </div>
          )}
          </div>
        </div>
      )}

      {/* ⑤ 보수·증빙 + 전/후 갤러리 (§4-E-2) — 불량 0건이면 해당없음 흐림. 완료 = 불량 전건 조치(R10-a) */}
      {has('repair') && (hasDefects ? (
        <div className={`${row} ${dragOver === 'contract' ? 'bg-[#f5f4ff] outline outline-1 outline-dashed outline-[#7b68ee] rounded' : ''}`} {...dropProps('contract')}>
          <div className="flex-1 min-w-0">
            {stepHeader({ k: 'repair', done: done5, active: done4,
              extra: <span className="text-[10px] text-[#b0acd6]">불량 {data.defects.done}/{data.defects.total} 조치 · 전후 {data.defects.photoPairs}/{data.defects.total}쌍</span> })}
            {isOpen('repair') && (
              <div className="mt-1.5 pl-6 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs ${done5 ? 'text-[#514b81]' : 'text-amber-600'}`}>
                    불량 {data.defects.total}건 · 계획 {data.defects.planned} · 완료 {data.defects.done}
                    <span className="text-[#b0acd6]" title="수리 계약서·전/후 사진은 선택 증빙 — ⑤ 완료 조건은 불량 전건 조치 완료"> (사진·계약서는 선택)</span>
                    {data.contractFile ? ` · 계약서: ${data.contractFile.name}` : ''}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    {data.contractFile && (
                      <button onClick={() => download(data.contractFile!.path)} className={btn}><Download className="size-3" /> 계약서</button>
                    )}
                    {canManage && (<>
                      <input ref={contractRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden" onChange={e => upload('contract', e)} />
                      <button onClick={() => contractRef.current?.click()} disabled={isPending} className={btn} title="수리 계약서 (선택 증빙) — 클릭 또는 파일을 이 행에 끌어다 놓으세요"><Upload className="size-3" /> 계약서 업로드 (선택)</button>
                    </>)}
                  </span>
                </div>

                {/* §4-E-2 전/후 갤러리 — 불량별 [전 사진 ‖ 후 사진] 쌍 카드 */}
                <div className="w-full h-1 bg-[#e0ddf5] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${data.defects.photoPairs >= data.defects.total ? 'bg-green-500' : 'bg-[#7b68ee]'}`}
                    style={{ width: `${data.defects.total > 0 ? Math.round((data.defects.photoPairs / data.defects.total) * 100) : 0}%` }} />
                </div>
                <p className="text-[10px] text-[#b0acd6]">전/후 사진 {data.defects.photoPairs}/{data.defects.total}쌍 완료</p>
                <input ref={afterRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onAfterPicked} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.defectRows.map(d => (
                    <div key={d.id} className="rounded-lg border border-[#eceafd] p-2">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[11px] font-medium text-[#090c1d] truncate">{d.defect_name}</span>
                        {d.action_completed_at
                          ? <span className="text-[9px] px-1 py-0.5 rounded bg-green-50 text-green-700 shrink-0">조치완료</span>
                          : <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">미조치</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {/* 전(불량) 사진 */}
                        {d.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.photo_url} alt="전(불량)" className="w-full aspect-square object-cover rounded border border-[#eceafd]" />
                        ) : (
                          <div className="w-full aspect-square rounded border border-dashed border-gray-200 flex flex-col items-center justify-center text-[9px] text-gray-300 gap-0.5">
                            <Camera size={13} /> 전 사진 없음
                          </div>
                        )}
                        {/* 후(조치) 사진 — 업로드·교체 (기존 uploadDefectPhotoAction 재사용) */}
                        {d.after_photo_url ? (
                          canManage ? (
                            <button onClick={() => pickAfter(d.id)} disabled={afterBusy === d.id} className="relative group w-full aspect-square">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={d.after_photo_url} alt="후(조치)" className="w-full h-full object-cover rounded border border-[#eceafd]" />
                              <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded transition-opacity">
                                {afterBusy === d.id ? <Upload size={13} className="text-white animate-pulse" /> : <Camera size={13} className="text-white" />}
                              </span>
                            </button>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={d.after_photo_url} alt="후(조치)" className="w-full aspect-square object-cover rounded border border-[#eceafd]" />
                          )
                        ) : canManage ? (
                          <button onClick={() => pickAfter(d.id)} disabled={afterBusy === d.id}
                            className="w-full aspect-square rounded border-2 border-dashed border-amber-300 hover:border-amber-500 flex flex-col items-center justify-center gap-0.5 text-amber-500 disabled:opacity-50">
                            {afterBusy === d.id ? <Upload size={13} className="animate-pulse" /> : <Camera size={13} />}
                            <span className="text-[9px]">후 사진 추가</span>
                          </button>
                        ) : (
                          <div className="w-full aspect-square rounded border border-dashed border-gray-200 flex items-center justify-center text-[9px] text-gray-300">후 사진 없음</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* C1(R5-4): 불량내역 본체 — 조치·증빙과 같은 자리에서 편집한다 */}
                {slots?.defects}
              </div>
            )}
          </div>
        </div>
      ) : (
        // 불량 0건 — 단계는 '해당없음'이지만 **불량 등록 경로는 열어 둔다**(여기서 추가하면 ⑤가 활성화된다)
        <div className={row}>
          <div className="flex-1 min-w-0">
            <button onClick={() => toggle('repair')} className="flex items-center gap-2 w-full text-left opacity-60">
              {isOpen('repair') ? <ChevronDown className="size-3.5 text-[#b0acd6] shrink-0" /> : <ChevronRight className="size-3.5 text-[#b0acd6] shrink-0" />}
              <Circle className="size-4 text-[#d0ccf5] shrink-0" />
              <span className="text-xs font-semibold text-[#090c1d] shrink-0" title={TIMELINE_STEP_TOOLTIPS.repair}>{TIMELINE_STEP_LABELS.repair}</span>
              <span className="text-xs text-[#b0acd6]">해당없음 — 불량 0건 (불량 등록 시 활성화)</span>
            </button>
            {isOpen('repair') && slots?.defects && (
              <div className="mt-2 pl-6">{slots.defects}</div>
            )}
          </div>
        </div>
      ))}

      {/* ⑥ 이행완료 (별지 11호) — 상시 표시(D-4) */}
      {has('submit11') && (hasDefects ? (
        <div className={row}>
          <div className="flex-1 min-w-0">
            {stepHeader({ k: 'submit11', done: done6, active: done5 || data.defects.done > 0,
              collapsedSummary: data.submit11.submittedAt ? <span className="text-[10px] text-green-600">제출 {data.submit11.submittedAt}</span> : undefined })}
            {isOpen('submit11') && (
              <div className="flex items-center gap-2 flex-wrap mt-1.5 pl-6">
                {dday(data.submit11.dday, data.submit11.submittedAt)}
                {data.submit11.due && !data.submit11.submittedAt && <span className="text-[10px] text-[#b0acd6]">기한 {data.submit11.due} (이행기간 종료)</span>}
                {canManage && (<>
                  <button onClick={() => generate('report11')} disabled={isPending || busy} className={btnPri}>별지 11호 생성</button>
                  <button onClick={() => setCompose('report11')} disabled={isPending || busy} className={btn}
                    title="자동 채움 검토 → 고유 값 입력(제출일·완료 보고 문구) → 미리보기·생성 (H-23 작성 패널)">
                    <PenLine className="size-3" /> 11호 작성
                  </button>
                  <button onClick={() => pkg('report11')} disabled={isPending} className={btn}><Package className="size-3" /> 제출 패키지 (⑤ 첨부 자동)</button>
                  <span className="inline-flex items-center gap-1">
                    <DateInput value={subDate11} onChange={e => setSubDate11(e.target.value)} className="h-7 w-32 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                    <button onClick={() => recordSubmit('report11', subDate11)} disabled={isPending} className={btn}>제출일 기록</button>
                  </span>
                </>)}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={`${row} opacity-50`}>
          <Circle className="size-4 text-[#d0ccf5] shrink-0" />
          <span className={label} title={TIMELINE_STEP_TOOLTIPS.submit11}>{TIMELINE_STEP_LABELS.submit11}</span>
          <span className="text-xs text-[#b0acd6]">해당없음 — 불량 0건 (불량 등록 시 활성화)</span>
        </div>
      ))}

      {msg && <p className="text-xs text-[#514b81] mt-2">{msg}</p>}
      {busy && (
        <p className="text-[11px] text-[#b0acd6] mt-2 inline-flex items-center gap-1">
          <RefreshCw className="size-3 animate-spin" /> 생성 중 — 서버에서 PDF 변환 중
        </p>
      )}

      {/* 생성물 목록 — 문서 단위 1행 그룹핑 (⑩ R11 공용 컴포넌트) */}
      {files.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#e0ddf5]">
          <GeneratedDocList files={files} onOpen={download} customerName={customerName} disabled={isPending} />
        </div>
      )}

      {/* §4-E H-28: 제출 보고서 파일 (InspectionReportsClient 흡수) — 타임라인 하단 접이식 보존.
          단계 행동은 위 스텝퍼에 통합, 업로드된 제출본 파일 목록만 여기서 조회·다운로드 */}
      {isSpecialTimeline && data.reports.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#e0ddf5]">
          <button onClick={() => setReportsOpen(o => !o)} className="flex items-center gap-1.5 text-xs font-medium text-[#514b81] hover:text-[#7b68ee]">
            {reportsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            <FileText className="size-3.5" /> 제출 보고서 파일 ({data.reports.length}건)
          </button>
          {reportsOpen && (
            <div className="mt-2 space-y-1.5">
              {data.reports.map(r => (
                <div key={r.id} className="flex items-center gap-2 text-[11px] rounded-lg border border-[#eceafd] px-2.5 py-1.5">
                  <span className="font-medium text-[#090c1d] shrink-0">
                    {STEP_REPORT_TYPES.includes(r.report_type as StepReportType) ? STEP_REPORT_LABELS[r.report_type as StepReportType] : r.report_type}
                  </span>
                  <span className="text-[#514b81] truncate flex-1">{r.file_name}</span>
                  {r.submitted_at && <span className="text-[#b0acd6] shrink-0 inline-flex items-center gap-0.5"><Clock className="size-2.5" />{r.submitted_at.split('T')[0]}{r.submitted_by_name ? ` · ${r.submitted_by_name}` : ''}</span>}
                  <button onClick={() => downloadReport(r.id, r.file_name)} disabled={isPending} className={`${btn} shrink-0`}><Download className="size-3" /> 다운로드</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* H-23 작성 패널 — 3단 패턴(자동 채움 검토 → 고유 값 입력 → 미리보기·생성), 별지 카드 진입점과 화면 1개 공유 */}
      {compose && (
        <AnnexComposePanel
          inspectionId={inspectionId}
          annexNo={compose}
          customerId={customerId}
          onClose={() => setCompose(null)}
          onGenerated={async () => {
            const st = await getReport9StatusAction(inspectionId)
            if (!st.error) { setJob(st.job); setFiles(st.files) }
          }}
        />
      )}
    </div>
  )
}
