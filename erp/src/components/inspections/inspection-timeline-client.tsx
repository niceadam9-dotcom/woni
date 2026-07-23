'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2, Circle, AlertTriangle, Loader2, FileText, Send, Upload, Download, Package, RefreshCw, ExternalLink,
} from 'lucide-react'
import {
  requestReport9Action, getReport9StatusAction, downloadReport9Action,
  type Report9Job, type Report9File,
} from '@/app/(dashboard)/inspections/report9-actions'
import {
  uploadTimelineFileAction, sendOwnerReportAction, recordSubmissionAction, downloadPackageAction,
} from '@/app/(dashboard)/inspections/timeline-actions'
import { DateInput } from '@/components/ui/date-input'
import { TIMELINE_STEP_LABELS, TIMELINE_STEP_TOOLTIPS, type TimelineStepKey } from '@/lib/doc-requirements'
import { GeneratedDocList } from '@/components/inspections/generated-doc-list'
import { PlacementReportHelper } from '@/components/inspections/placement-report-helper'

/** 문서 타임라인 (§9-9 / P7) — 단계별 상태·D-day·업로드 슬롯·생성·발송·제출 패키지.
 *  단계 구성은 stepDocs(§9-9a): 자체점검 ①~⑥ 상시 표시(D-4 — 불량 0건이면 ⑤⑥ 해당없음 흐림).
 *  ④ 전제조건 = 종전 별지 9호 준비 체크(§9-6⑦ 흡수). 값 입력은 각 원천 화면에서. */

export type PrereqRow = { label: string; ok: boolean; detail: string; href?: string; hrefLabel?: string }

export type TimelineData = {
  steps: TimelineStepKey[]
  isGeneral: boolean                    // 일반관리 (① = 외관점검표)
  responded: number                     // 점검표 응답 수
  certFile: { name: string; path: string } | null
  contractFile: { name: string; path: string } | null
  delivery: { sentTo: string; sentAt: string } | null   // ③ 발송 이력 (최근)
  submit9: { due: string | null; dday: number | null; submittedAt: string | null }
  submit11: { due: string | null; dday: number | null; submittedAt: string | null }
  defects: { total: number; planned: number; done: number; photoPairs: number }
  prereqs: PrereqRow[]                  // ④ 전제 체크 (§9-6⑦)
  consentOk: boolean                    // ③ 송달 동의+이메일 보유
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

export function InspectionTimelineClient({ inspectionId, canManage, data, initialJob, initialFiles, customerName }: {
  inspectionId: string
  canManage: boolean
  data: TimelineData
  initialJob: Report9Job | null
  initialFiles: Report9File[]
  customerName?: string
}) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [files, setFiles] = useState(initialFiles)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  const [subDate9, setSubDate9] = useState(data.submit9.submittedAt ?? '')
  const [subDate11, setSubDate11] = useState(data.submit11.submittedAt ?? '')
  const certRef = useRef<HTMLInputElement>(null)
  const contractRef = useRef<HTMLInputElement>(null)
  const busy = job?.status === 'pending' || job?.status === 'processing'

  useEffect(() => {
    if (!busy) return
    const t = setInterval(async () => {
      const res = await getReport9StatusAction(inspectionId)
      if (!res.error) { setJob(res.job); setFiles(res.files) }
    }, 8000)
    return () => clearInterval(t)
  }, [busy, inspectionId])

  function generate(reportType: 'report9' | 'report10' | 'report11' | 'exterior') {
    setMsg('')
    startTransition(async () => {
      const res = await requestReport9Action(inspectionId, reportType)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      const st = await getReport9StatusAction(inspectionId)
      if (!st.error) { setJob(st.job); setFiles(st.files) }
      setMsg('✅ 생성 요청됨 — 워커가 처리하면 목록에 등록됩니다.')
    })
  }

  function upload(slot: 'cert' | 'contract', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const res = await uploadTimelineFileAction(inspectionId, slot, fd)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ ${slot === 'cert' ? '배치확인서' : '계약서'} 업로드됨`)
      router.refresh()
    })
    e.target.value = ''
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

  function recordSubmit(kind: 'report9' | 'report11', date: string) {
    if (!date) { setMsg('❌ 제출일을 입력해주세요.'); return }
    startTransition(async () => {
      const res = await recordSubmissionAction(inspectionId, kind, date)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ 제출일이 기록됐습니다 — 기한 뱃지·알림이 소멸됩니다.')
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
  const done1 = data.responded > 0
  const done2 = !!data.certFile
  const done3 = !!data.delivery
  const done4 = !!data.submit9.submittedAt
  // ⑤ 완료 판정 = 불량 전건 조치 완료 (R10-a — 계약서·사진은 선택 증빙이라 완료 조건에서 제외)
  const done5 = hasDefects && data.defects.done >= data.defects.total
  const done6 = !!data.submit11.submittedAt

  // R10-b: 진행률 — 해당없음(불량 0건의 ⑤⑥)은 분모에서 제외
  const isSpecialTimeline = data.steps.length > 1
  const activeDones = isSpecialTimeline
    ? (hasDefects ? [done1, done2, done3, done4, done5, done6] : [done1, done2, done3, done4])
    : [done1]
  const doneCount = activeDones.filter(Boolean).length
  const progressPct = Math.round((doneCount / activeDones.length) * 100)

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
        {isSpecialTimeline && (
          <span className="ml-auto text-[11px] font-semibold text-[#7b68ee] shrink-0"
            title="해당없음 단계는 분모에서 제외">{doneCount}/{activeDones.length} 단계 완료</span>
        )}
      </div>
      {isSpecialTimeline && (
        <div className="w-full h-1 bg-[#e0ddf5] rounded-full overflow-hidden mb-2">
          <div className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? 'bg-green-500' : 'bg-[#7b68ee]'}`}
            style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {/* ① 점검표 */}
      <div className={row}>
        {stepIcon(done1, true)}
        <span className={label} title={TIMELINE_STEP_TOOLTIPS.checklist}>
          {TIMELINE_STEP_LABELS.checklist}{data.isGeneral ? ' (외관점검표)' : ' (소방시설등점검표)'}
        </span>
        <span className={`text-xs ${done1 ? 'text-[#514b81]' : 'text-amber-600'}`}>
          {done1 ? `응답 ${data.responded}건 입력됨` : '응답 없음 — 위 점검표 입력에서 작성해주세요'}
        </span>
        {data.steps.length === 1 && (
          <span className="ml-auto text-[10px] text-[#b0acd6]">완료 조건 = 점검표 작성 (기한·알림 없음)</span>
        )}
      </div>

      {/* ② 점검인력 배치확인서 — 업로드 직감 규칙(R10-c): ✅초록+파일명 / ⚠앰버+[업로드] */}
      {has('cert') && (
        <div className={row}>
          {stepIcon(done2, done1)}
          <span className={label} title={TIMELINE_STEP_TOOLTIPS.cert}>{TIMELINE_STEP_LABELS.cert}</span>
          <span className={`text-xs ${done2 ? 'text-[#514b81]' : 'text-amber-600'}`}>
            {data.certFile ? `업로드됨: ${data.certFile.name}` : '협회 발급본 업로드 필요 (자체점검 대행 시 필수)'}
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
              <button onClick={() => certRef.current?.click()} disabled={isPending} className={btn}><Upload className="size-3" /> 업로드</button>
            </>)}
          </span>
        </div>
      )}

      {/* ③ 관계인 보고서 발급 */}
      {has('ownerReport') && (
        <div className={row}>
          {stepIcon(done3, done1)}
          <span className={label} title={TIMELINE_STEP_TOOLTIPS.ownerReport}>{TIMELINE_STEP_LABELS.ownerReport}</span>
          <span className={`text-xs ${done3 ? 'text-[#514b81]' : 'text-amber-600'}`}>
            {data.delivery
              ? `발송됨 → ${data.delivery.sentTo} (${data.delivery.sentAt.slice(0, 10)})`
              : data.consentOk ? '별지 9호 생성 후 이메일 발송' : '송달 동의·이메일 미입력 — 고객 소방계획서 탭에서 입력'}
          </span>
          {canManage && (
            <span className="ml-auto shrink-0">
              <button onClick={sendOwner} disabled={isPending || !data.consentOk} className={btnPri}>
                <Send className="size-3" /> {done3 ? '재발송' : '생성물 이메일 발송'}
              </button>
            </span>
          )}
        </div>
      )}

      {/* ④ 소방서 제출 (별지 9호) — 전제 = §9-6⑦ 준비 체크 */}
      {has('submit9') && (
        <div className={row}>
          {stepIcon(done4, done1)}
          <span className={label} title={TIMELINE_STEP_TOOLTIPS.submit9}>④ 소방서 제출 (9호{hasDefects ? '+10호' : ''})</span>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {dday(data.submit9.dday, data.submit9.submittedAt)}
              {data.submit9.due && !data.submit9.submittedAt && <span className="text-[10px] text-[#b0acd6]">기한 {data.submit9.due} (점검 후 15일)</span>}
              {canManage && (<>
                <button onClick={() => generate('report9')} disabled={isPending || busy} className={btnPri}>
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />} 별지 9호 생성
                </button>
                {data.defects.total > 0 && (
                  <button onClick={() => generate('report10')} disabled={isPending || busy} className={btn}>별지 10호 생성</button>
                )}
                <button onClick={() => pkg('report9')} disabled={isPending} className={btn}><Package className="size-3" /> 제출 패키지</button>
                <span className="inline-flex items-center gap-1">
                  <DateInput value={subDate9} onChange={e => setSubDate9(e.target.value)} className="h-7 w-32 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                  <button onClick={() => recordSubmit('report9', subDate9)} disabled={isPending} className={btn}>제출일 기록</button>
                </span>
              </>)}
            </div>
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
        </div>
      )}

      {/* ⑤ 보수·증빙 — 상시 표시(D-4): 불량 0건이면 해당없음 흐림. 완료 판정 = 불량 전건 조치 완료(R10-a) */}
      {has('repair') && (hasDefects ? (
        <div className={row}>
          {stepIcon(done5, done4)}
          <span className={label} title={TIMELINE_STEP_TOOLTIPS.repair}>{TIMELINE_STEP_LABELS.repair}</span>
          <span className={`text-xs ${done5 ? 'text-[#514b81]' : 'text-amber-600'}`}>
            불량 {data.defects.total}건 · 계획 {data.defects.planned} · 완료 {data.defects.done} ·{' '}
            {/* R6-b ⓑ: 전후 사진 쌍 수 클릭 → 갤러리 모달 */}
            <a href="#photos" className="text-[#7b68ee] hover:underline">전후 사진 {data.defects.photoPairs}/{data.defects.total}쌍</a>
            <span className="text-[#b0acd6]" title="수리 계약서·전/후 사진은 선택 증빙 — ⑤ 완료 조건은 불량 전건 조치 완료"> (사진·계약서는 선택)</span>
            {data.contractFile ? ` · 계약서: ${data.contractFile.name}` : ''}
          </span>
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            <a href="#photos" className="text-[10px] text-[#7b68ee] hover:underline">전/후 사진 모아보기 ↓</a>
            {data.contractFile && (
              <button onClick={() => download(data.contractFile!.path)} className={btn}><Download className="size-3" /> 계약서</button>
            )}
            {canManage && (<>
              <input ref={contractRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden" onChange={e => upload('contract', e)} />
              <button onClick={() => contractRef.current?.click()} disabled={isPending} className={btn} title="수리 계약서 (선택 증빙)"><Upload className="size-3" /> 계약서 업로드 (선택)</button>
            </>)}
          </span>
        </div>
      ) : (
        <div className={`${row} opacity-50`}>
          <Circle className="size-4 text-[#d0ccf5] shrink-0" />
          <span className={label} title={TIMELINE_STEP_TOOLTIPS.repair}>{TIMELINE_STEP_LABELS.repair}</span>
          <span className="text-xs text-[#b0acd6]">해당없음 — 불량 0건 (불량 등록 시 활성화)</span>
        </div>
      ))}

      {/* ⑥ 이행완료 (별지 11호) — 상시 표시(D-4) */}
      {has('submit11') && (hasDefects ? (
        <div className={row}>
          {stepIcon(done6, done5 || data.defects.done > 0)}
          <span className={label} title={TIMELINE_STEP_TOOLTIPS.submit11}>{TIMELINE_STEP_LABELS.submit11}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {dday(data.submit11.dday, data.submit11.submittedAt)}
              {data.submit11.due && !data.submit11.submittedAt && <span className="text-[10px] text-[#b0acd6]">기한 {data.submit11.due} (이행기간 종료)</span>}
              {canManage && (<>
                <button onClick={() => generate('report11')} disabled={isPending || busy} className={btnPri}>별지 11호 생성</button>
                <button onClick={() => pkg('report11')} disabled={isPending} className={btn}><Package className="size-3" /> 제출 패키지 (⑤ 첨부 자동)</button>
                <span className="inline-flex items-center gap-1">
                  <DateInput value={subDate11} onChange={e => setSubDate11(e.target.value)} className="h-7 w-32 rounded-lg border border-[#d0ccf5] px-2 text-[11px]" />
                  <button onClick={() => recordSubmit('report11', subDate11)} disabled={isPending} className={btn}>제출일 기록</button>
                </span>
              </>)}
            </div>
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
          <RefreshCw className="size-3 animate-spin" /> 생성 중 — 자동 새로고침 (개발 PC 워커 처리)
        </p>
      )}

      {/* 생성물 목록 — 문서 단위 1행 그룹핑 (⑩ R11 공용 컴포넌트) */}
      {files.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#e0ddf5]">
          <GeneratedDocList files={files} onOpen={download} customerName={customerName} disabled={isPending} />
        </div>
      )}
    </div>
  )
}
