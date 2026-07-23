'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Circle, Upload, FileText, FileType2, Download, Camera, Loader2 } from 'lucide-react'
import { getDocUrlAction, type CustomerDocs, type DocGroupRef, type InspectionDocs } from '@/app/(dashboard)/reports/docs-actions'
import { uploadTimelineFileAction } from '@/app/(dashboard)/inspections/timeline-actions'
import { requestReport9Action } from '@/app/(dashboard)/inspections/report9-actions'
import { getFirePlanFileUrlAction } from '@/app/(dashboard)/customers/fire-plan-actions'
import { DOC_TERMS } from '@/lib/doc-requirements'

/** ① 고객 문서 현황 (소방계획서_5 R2) — 생성+업로드 통합 조회.
 *  행 정렬 고정: 소방계획서 → 점검 건(최신 차수 먼저) → 9호→배치확인서→계약서→사진→10·11호.
 *  색 규약(R0-1): ✅초록 보유 / ⚠앰버 필요한데 없음 / 회색 흐림 해당없음. 업로드는 그 자리 실행+드롭존(R0-6). */

const rowCls = 'flex items-center gap-2 py-1.5 text-xs border-b border-[#f3f1fc] last:border-0 flex-wrap'
const hwpBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-blue-200 text-[11px] text-blue-600 hover:bg-blue-50 disabled:opacity-50'
const pdfBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-red-200 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50'
const subBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50'
const priBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium disabled:opacity-50'

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(5, 10) : '')

function StatusIcon({ state }: { state: 'have' | 'warn' | 'na' }) {
  if (state === 'have') return <CheckCircle2 className="size-3.5 text-green-600 shrink-0" />
  if (state === 'warn') return <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
  return <Circle className="size-3.5 text-[#d0ccf5] shrink-0" />
}

export function CustomerDocsView({ docs, onChanged }: { docs: CustomerDocs; onChanged: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null)

  function open(path: string | null | undefined, saveName?: string) {
    if (!path) return
    startTransition(async () => {
      const res = await getDocUrlAction(path, saveName)
      if (res.url) window.open(res.url, '_blank')
    })
  }

  function openPlanFile(kind: 'pdf' | 'hwp') {
    if (!docs.firePlan) return
    startTransition(async () => {
      const res = await getFirePlanFileUrlAction(docs.firePlan!.id, kind)
      if (res.error || !res.url) { setMsg({ key: 'plan', text: `❌ ${res.error ?? '다운로드 실패'}`, ok: false }); return }
      window.open(res.url, '_blank')
    })
  }

  function generate(inspectionId: string, kind: 'report9' | 'report10' | 'report11' | 'exterior', rowKey: string) {
    startTransition(async () => {
      const res = await requestReport9Action(inspectionId, kind)
      if (res.error) { setMsg({ key: rowKey, text: `❌ ${res.error}`, ok: false }); return }
      setMsg({ key: rowKey, text: '✅ 생성 요청됨 — 워커가 처리하면 이 행에 [HWP][PDF]가 생깁니다 (잠시 후 새로고침)', ok: true })
    })
  }

  function upload(inspectionId: string, slot: 'cert' | 'contract', file: File, rowKey: string) {
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const res = await uploadTimelineFileAction(inspectionId, slot, fd)
      if (res.error) { setMsg({ key: rowKey, text: `❌ ${res.error}`, ok: false }); return }
      setMsg({ key: rowKey, text: '✅ 업로드됨 — 타임라인과 자동 동기됩니다', ok: true })
      onChanged()
    })
  }

  const feedback = (key: string) => msg?.key === key && (
    <p className={`w-full text-[11px] ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
  )

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      {/* 상단 요약 게이지 (R2-c) */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <h2 className="text-sm font-semibold text-[#090c1d]">{docs.customerName}</h2>
        <span className="text-[11px] text-[#514b81]">· {docs.inspectionType}</span>
        <span className="text-[11px] font-medium text-[#7b68ee]">
          필요 문서 {docs.summary.need}종 중 {docs.summary.have}종 보유
        </span>
        {docs.summary.warns > 0 && (
          <span className="text-[11px] text-amber-600 font-medium">⚠ {docs.summary.warns}건 처리 필요</span>
        )}
        <Link href={`/customers/${docs.customerId}?tab=plan`} className="ml-auto text-[11px] text-[#7b68ee] hover:underline">
          고객 소방계획서 탭 →
        </Link>
      </div>

      {/* 소방계획서 행 */}
      <div className={rowCls}>
        {docs.isGeneral ? (<>
          <StatusIcon state="na" />
          <span className="font-medium text-[#b0acd6] w-44" title={DOC_TERMS.firePlan}>소방계획서</span>
          <span className="text-[#b0acd6]">해당없음 — 일반관리는 작성 대상 아님</span>
        </>) : docs.firePlan ? (<>
          <StatusIcon state="have" />
          <span className="font-medium text-[#090c1d] w-44" title={DOC_TERMS.firePlan}>소방계획서</span>
          <span className="text-[#514b81]">
            ✓ {docs.firePlan.year}{docs.firePlan.revision ? ` (개정${docs.firePlan.revision})` : ''} {fmtD(docs.firePlan.updatedAt)}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {docs.firePlan.hwpPath && (
              <button onClick={() => openPlanFile('hwp')} disabled={isPending} title="한글 편집용 원본 내려받기" className={hwpBtn}>
                <FileText className="size-3" /> HWP
              </button>
            )}
            {docs.firePlan.pdfPath && (
              <button onClick={() => openPlanFile('pdf')} disabled={isPending} title="바로 보기·인쇄" className={pdfBtn}>
                <FileType2 className="size-3" /> PDF
              </button>
            )}
          </span>
        </>) : (<>
          <StatusIcon state="warn" />
          <span className="font-medium text-[#090c1d] w-44" title={DOC_TERMS.firePlan}>소방계획서</span>
          <span className="text-amber-600">미생성 — 고객 탭 또는 서식 카드에서 생성</span>
          <Link href={`/reports?form=fire_plan`} className={`ml-auto ${priBtn}`}>바로 생성 →</Link>
        </>)}
        {feedback('plan')}
      </div>

      {docs.inspections.length === 0 && (
        <p className="text-xs text-[#b0acd6] py-4 text-center">
          자체점검 건이 없습니다 — 점검 일정은 점검계획에서 확정하세요
        </p>
      )}

      {/* 점검 건별 (최신 차수 먼저) */}
      {docs.inspections.map(i => (
        <InspectionDocRows key={i.inspectionId} i={i} isGeneral={docs.isGeneral} customerName={docs.customerName}
          isPending={isPending} open={open} generate={generate} upload={upload} feedback={feedback} />
      ))}
    </div>
  )
}

function InspectionDocRows({ i, isGeneral, customerName, isPending, open, generate, upload, feedback }: {
  i: InspectionDocs
  isGeneral: boolean
  customerName: string
  isPending: boolean
  open: (path: string | null | undefined, saveName?: string) => void
  generate: (inspectionId: string, kind: 'report9' | 'report10' | 'report11' | 'exterior', rowKey: string) => void
  upload: (inspectionId: string, slot: 'cert' | 'contract', file: File, rowKey: string) => void
  feedback: (key: string) => React.ReactNode
}) {
  const certRef = useRef<HTMLInputElement>(null)
  const contractRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState<'cert' | 'contract' | null>(null)
  const k = (s: string) => `${i.inspectionId}:${s}`
  const statusLabel = i.status === 'completed' ? '완료' : i.status === 'in_progress' ? '진행중' : '예정'
  const date = i.endDate ?? i.startDate

  // R0-6: 업로드 행 = 드롭존
  const dropProps = (slot: 'cert' | 'contract') => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(slot) },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDragOver(null)
      const f = e.dataTransfer.files?.[0]
      if (f) upload(i.inspectionId, slot, f, k(slot))
    },
  })

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 text-xs py-1">
        <span className="font-semibold text-[#090c1d]">점검 {i.year}-{i.sequenceNum}차</span>
        <span className="text-[#b0acd6]">{date ? `(${fmtD(date)} ${statusLabel})` : `(${statusLabel})`}</span>
        <Link href={`/inspections/${i.inspectionId}`} className="ml-auto text-[11px] text-[#7b68ee] hover:underline">
          타임라인에서 →
        </Link>
      </div>
      <div className="pl-4 border-l border-[#eceafd]">
        {isGeneral ? (
          <div className={rowCls}>
            {i.exterior ? <StatusIcon state="have" /> : <StatusIcon state="warn" />}
            <span className="font-medium text-[#090c1d] w-44" title={`${DOC_TERMS.checklistExterior} — 작성 후 2년 보관`}>외관점검표</span>
            {i.exterior ? (<>
              <span className="text-[#514b81]">✓ {fmtD(i.exterior.at)}</span>
              <span className="ml-auto flex items-center gap-1">
                {genButtons9(i.exterior, `${customerName}_외관점검표_${(i.exterior.at ?? '').slice(0, 10)}`, open, isPending)}
              </span>
            </>) : (<>
              <span className="text-amber-600">미생성</span>
              <button onClick={() => generate(i.inspectionId, 'exterior', k('ext'))} disabled={isPending} className={`ml-auto ${priBtn}`}>바로 생성</button>
            </>)}
            {feedback(k('ext'))}
          </div>
        ) : (<>
          {/* 9호 */}
          <div className={rowCls}>
            <StatusIcon state={i.report9 ? 'have' : 'warn'} />
            <span className="font-medium text-[#090c1d] w-44" title={DOC_TERMS.report9Full}>실시결과 보고서 (9호)</span>
            {i.report9 ? (<>
              <span className="text-[#514b81]">✓ {fmtD(i.report9.at)}</span>
              <span className="ml-auto flex items-center gap-1">
                {genButtons9(i.report9, `${customerName}_실시결과 보고서_${(i.report9.at ?? '').slice(0, 10)}`, open, isPending)}
              </span>
            </>) : (<>
              <span className="text-amber-600">미생성</span>
              <button onClick={() => generate(i.inspectionId, 'report9', k('r9'))} disabled={isPending} className={`ml-auto ${priBtn}`}>
                {isPending ? <Loader2 className="size-3 animate-spin" /> : null} 바로 생성
              </button>
            </>)}
            {feedback(k('r9'))}
          </div>
          {/* 배치확인서 */}
          <div className={`${rowCls} ${dragOver === 'cert' ? 'bg-[#f5f4ff] outline outline-1 outline-dashed outline-[#7b68ee] rounded' : ''}`} {...dropProps('cert')}>
            <StatusIcon state={i.cert ? 'have' : 'warn'} />
            <span className="font-medium text-[#090c1d] w-44" title={`${DOC_TERMS.certFull} — 협회 발급본 (자체점검 대행 시 필수)`}>배치확인서</span>
            {i.cert ? (<>
              <span className="text-[#514b81]">✓ {fmtD(i.cert.at)}</span>
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => open(i.cert!.path, `${customerName}_점검인력 배치확인서_${(i.cert!.at ?? '').slice(0, 10)}.${i.cert!.path.split('.').pop()}`)} disabled={isPending} className={subBtn}>
                  <Download className="size-3" /> 받기
                </button>
              </span>
            </>) : (<>
              <span className="text-amber-600">미업로드 — 협회 발급본 (파일을 끌어다 놓아도 됩니다)</span>
              <span className="ml-auto flex items-center gap-1">
                <input ref={certRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) upload(i.inspectionId, 'cert', f, k('cert')); e.target.value = '' }} />
                <button onClick={() => certRef.current?.click()} disabled={isPending} className={subBtn}><Upload className="size-3" /> 업로드</button>
              </span>
            </>)}
            {feedback(k('cert'))}
          </div>
          {/* 수리 계약서 (선택) */}
          <div className={`${rowCls} ${dragOver === 'contract' ? 'bg-[#f5f4ff] outline outline-1 outline-dashed outline-[#7b68ee] rounded' : ''}`} {...dropProps('contract')}>
            <StatusIcon state={i.contract ? 'have' : 'na'} />
            <span className={`font-medium w-44 ${i.contract ? 'text-[#090c1d]' : 'text-[#b0acd6]'}`} title="수리 계약서 — 선택 증빙 (⑤ 완료 조건 아님)">수리 계약서 (선택)</span>
            {i.contract ? (<>
              <span className="text-[#514b81]">✓ {fmtD(i.contract.at)}</span>
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => open(i.contract!.path, `${customerName}_수리 계약서_${(i.contract!.at ?? '').slice(0, 10)}.${i.contract!.path.split('.').pop()}`)} disabled={isPending} className={subBtn}>
                  <Download className="size-3" /> 받기
                </button>
              </span>
            </>) : (<>
              <span className="text-[#b0acd6]">없음 (선택 증빙)</span>
              <span className="ml-auto flex items-center gap-1">
                <input ref={contractRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) upload(i.inspectionId, 'contract', f, k('contract')); e.target.value = '' }} />
                <button onClick={() => contractRef.current?.click()} disabled={isPending} className={subBtn}><Upload className="size-3" /> 업로드</button>
              </span>
            </>)}
            {feedback(k('contract'))}
          </div>
          {/* 전/후 사진 */}
          <div className={rowCls}>
            {i.defects.total === 0 ? (<>
              <StatusIcon state="na" />
              <span className="font-medium text-[#b0acd6] w-44">전/후 사진</span>
              <span className="text-[#b0acd6]">해당없음 — 불량 0건</span>
            </>) : (<>
              <StatusIcon state={i.defects.photoPairs >= i.defects.total ? 'have' : 'warn'} />
              <span className="font-medium text-[#090c1d] w-44" title="전/후 사진 — 선택 증빙 (별지 11호 패키지 자동 첨부)">전/후 사진 (선택)</span>
              <span className={i.defects.photoPairs >= i.defects.total ? 'text-[#514b81]' : 'text-amber-600'}>
                {i.defects.photoPairs}/{i.defects.total}쌍
              </span>
              <Link href={`/inspections/${i.inspectionId}#photos`} className={`ml-auto ${subBtn}`}>
                <Camera className="size-3" /> 사진 보기
              </Link>
            </>)}
          </div>
          {/* 10·11호 */}
          {i.defects.total === 0 ? (
            <div className={rowCls}>
              <StatusIcon state="na" />
              <span className="font-medium text-[#b0acd6] w-44" title={`${DOC_TERMS.report10Full} · ${DOC_TERMS.report11Full}`}>이행계획·완료 (10·11호)</span>
              <span className="text-[#b0acd6]">해당없음 — 불량 0건</span>
            </div>
          ) : (<>
            <div className={rowCls}>
              <StatusIcon state={i.report10 ? 'have' : 'warn'} />
              <span className="font-medium text-[#090c1d] w-44" title={DOC_TERMS.report10Full}>이행계획서 (10호)</span>
              {i.report10 ? (<>
                <span className="text-[#514b81]">✓ {fmtD(i.report10.at)}</span>
                <span className="ml-auto flex items-center gap-1">
                  {genButtons9(i.report10, `${customerName}_이행계획서_${(i.report10.at ?? '').slice(0, 10)}`, open, isPending)}
                </span>
              </>) : (<>
                <span className="text-amber-600">불량 {i.defects.total}건 미생성</span>
                <button onClick={() => generate(i.inspectionId, 'report10', k('r10'))} disabled={isPending} className={`ml-auto ${subBtn}`}>바로 생성</button>
              </>)}
              {feedback(k('r10'))}
            </div>
            <div className={rowCls}>
              <StatusIcon state={i.report11 ? 'have' : 'warn'} />
              <span className="font-medium text-[#090c1d] w-44" title={DOC_TERMS.report11Full}>이행완료 보고서 (11호)</span>
              {i.report11 ? (<>
                <span className="text-[#514b81]">✓ {fmtD(i.report11.at)}</span>
                <span className="ml-auto flex items-center gap-1">
                  {genButtons9(i.report11, `${customerName}_이행완료 보고서_${(i.report11.at ?? '').slice(0, 10)}`, open, isPending)}
                </span>
              </>) : (<>
                <span className="text-amber-600">조치 완료 {i.defects.done}/{i.defects.total} — 미생성</span>
                <button onClick={() => generate(i.inspectionId, 'report11', k('r11'))} disabled={isPending} className={`ml-auto ${subBtn}`}>바로 생성</button>
              </>)}
              {feedback(k('r11'))}
            </div>
          </>)}
        </>)}
      </div>
    </div>
  )
}

function genButtons9(
  g: DocGroupRef, saveBase: string,
  open: (path: string | null | undefined, saveName?: string) => void, isPending: boolean,
) {
  return (<>
    {g.hwp && (
      <button onClick={() => open(g.hwp!.path, `${saveBase}.hwp`)} disabled={isPending} title="한글 편집용 원본 내려받기" className={hwpBtn}>
        <FileText className="size-3" /> HWP
      </button>
    )}
    {g.pdf && (
      <button onClick={() => open(g.pdf!.path)} disabled={isPending} title="바로 보기·인쇄" className={pdfBtn}>
        <FileType2 className="size-3" /> PDF
      </button>
    )}
  </>)
}
