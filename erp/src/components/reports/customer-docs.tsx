'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Circle, Upload, FileText, FileType2, Download, Loader2, Pencil, Eye } from 'lucide-react'
import { type DocGroupRef, type InspectionDocs } from '@/app/(dashboard)/reports/docs-actions'
import { DOC_TERMS } from '@/lib/doc-requirements'
import { openAnnexHwp, openAnnexPdf } from '@/lib/annex-filename'
import { type ComposeAnnexNo } from '@/components/inspections/annex-compose-panel'

/** 별지 작성 진입 버튼 (H-24 문서 작업대 §4-B) — 이동 없이 작성 패널 오픈 */
const composeBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-brand-line text-[11px] text-ink-sub hover:bg-brand-tint disabled:opacity-50'

/** 점검 건 문서 행 (소방계획서_5 R2 → 8 H-2 재사용) — 지금 이 파일의 소비자는 회차 카드
 *  (plan-annex-round-card)뿐이다. 고객 문서 현황 화면(CustomerDocsView)은 보고서 센터 해체 후
 *  렌더되는 곳이 없어 보관함 폐지(2026-09-02)와 함께 걷어냈다.
 *  색 규약(R0-1): ✅초록 보유 / ⚠앰버 필요한데 없음 / 회색 흐림 해당없음. 업로드는 그 자리 실행+드롭존(R0-6). */

const rowCls = 'flex items-center gap-2 py-1.5 text-xs border-b border-brand-line-soft last:border-0 flex-wrap'
const hwpBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-blue-200 text-[11px] text-blue-600 hover:bg-blue-50 disabled:opacity-50'
const pdfBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-red-200 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50'
const subBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-brand-line text-[11px] text-brand hover:bg-brand-tint disabled:opacity-50'
const priBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded bg-brand hover:bg-brand-strong text-white text-[11px] font-medium disabled:opacity-50'

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(5, 10) : '')

function StatusIcon({ state }: { state: 'have' | 'warn' | 'na' }) {
  if (state === 'have') return <CheckCircle2 className="size-3.5 text-green-600 shrink-0" />
  if (state === 'warn') return <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
  return <Circle className="size-3.5 text-[#d0ccf5] shrink-0" />
}

/* CustomerDocsView 삭제(2026-09-02) — 시작은 보고서 센터 ① 고객 문서 현황이었으나 센터 해체
 * (소방계획서_8 Phase B → 34 탭 승격) 후 어디서도 렌더되지 않는 죽은 화면이었고, 소방계획서
 * 파일 행이 보관함 폐지로 성립하지 않게 되어 함께 정리했다. getCustomerDocsAction도 동반 은퇴. */

export function InspectionDocRows({ i, customerName, isPending, open, generate, upload, feedback, onCompose, onPreview }: {
  i: InspectionDocs
  customerName: string
  isPending: boolean
  open: (path: string | null | undefined, saveName?: string) => void
  generate: (inspectionId: string, kind: 'report9' | 'report10' | 'report11' | 'exterior', rowKey: string) => void
  upload: (inspectionId: string, slot: 'cert' | 'contract', file: File, rowKey: string) => void
  feedback: (key: string) => React.ReactNode
  onCompose: (inspectionId: string, annexNo: ComposeAnnexNo) => void
  /** 문서 1건만 크게 보기 — 미리보기 캐시를 가진 화면(소방계획서 트리)에서만 전달 */
  onPreview?: (inspectionId: string, type: 'report9' | 'report10' | 'report11') => void
}) {
  const certRef = useRef<HTMLInputElement>(null)
  const contractRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState<'cert' | 'contract' | null>(null)
  const k = (s: string) => `${i.inspectionId}:${s}`
  const statusLabel = i.status === 'completed' ? '완료' : i.status === 'in_progress' ? '진행중' : '예정'
  const date = i.endDate ?? i.startDate

  /** 🔍 크게 보기 — 생성 전에도 조립 결과를 그대로 확인 (생성물과 동일 렌더) */
  const previewBtn = (type: 'report9' | 'report10' | 'report11') => onPreview && (
    <button onClick={() => onPreview(i.inspectionId, type)} className={composeBtn} title="이 문서만 크게 보기 — 생성 전에도 확인 가능">
      <Eye className="size-3" /> 보기
    </button>
  )

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
        <span className="font-semibold text-ink">점검 {i.year}-{i.sequenceNum}차</span>
        <span className="text-ink-faint">{date ? `(${fmtD(date)} ${statusLabel})` : `(${statusLabel})`}</span>
        <Link href={`/inspections/${i.inspectionId}`} className="ml-auto text-[11px] text-brand hover:underline">
          타임라인에서 →
        </Link>
      </div>
      <div className="pl-4 border-l border-brand-tint">
        <>
          {/* 9호 */}
          <div className={rowCls}>
            <StatusIcon state={i.report9 ? 'have' : 'warn'} />
            <span className="font-medium text-ink w-44" title={DOC_TERMS.report9Full}>실시결과 보고서 (9호)</span>
            <button onClick={() => onCompose(i.inspectionId, 'report9')} disabled={isPending} className={composeBtn}
              title="작성 — 보고일·비고 입력 후 미리보기·생성 (이동 없이)"><Pencil className="size-3" /> 작성</button>
            {previewBtn('report9')}
            {i.report9 ? (<>
              <span className="text-ink-sub">✓ {fmtD(i.report9.at)}</span>
              <span className="ml-auto flex items-center gap-1">
                {genButtons9(i.report9, i.inspectionId, isPending)}
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
          <div className={`${rowCls} ${dragOver === 'cert' ? 'bg-brand-tint outline outline-1 outline-dashed outline-brand rounded' : ''}`} {...dropProps('cert')}>
            <StatusIcon state={i.cert || i.certArchived ? 'have' : 'warn'} />
            <span className="font-medium text-ink w-44" title={`${DOC_TERMS.certFull} — 협회 발급본 (자체점검 대행 시 필수)`}>배치확인서</span>
            {i.cert ? (<>
              <span className="text-ink-sub">✓ {fmtD(i.cert.at)}</span>
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => open(i.cert!.path, `${customerName}_점검인력 배치확인서_${(i.cert!.at ?? '').slice(0, 10)}.${i.cert!.path.split('.').pop()}`)} disabled={isPending} className={subBtn}>
                  <Download className="size-3" /> 받기
                </button>
              </span>
            </>) : i.certArchived ? (
              // 종이 보관 후 정리된 회차 — 누락이 아니다 (소방계획서_18 D-7 ⚠)
              <span className="text-ink-soft">종이 보관됨 — 과거본 정리로 ERP 사본 삭제</span>
            ) : (<>
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
          <div className={`${rowCls} ${dragOver === 'contract' ? 'bg-brand-tint outline outline-1 outline-dashed outline-brand rounded' : ''}`} {...dropProps('contract')}>
            <StatusIcon state={i.contract ? 'have' : 'na'} />
            <span className={`font-medium w-44 ${i.contract ? 'text-ink' : 'text-ink-faint'}`} title="수리 계약서 — 선택 증빙 (⑤ 완료 조건 아님)">수리 계약서 (선택)</span>
            {i.contract ? (<>
              <span className="text-ink-sub">✓ {fmtD(i.contract.at)}</span>
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => open(i.contract!.path, `${customerName}_수리 계약서_${(i.contract!.at ?? '').slice(0, 10)}.${i.contract!.path.split('.').pop()}`)} disabled={isPending} className={subBtn}>
                  <Download className="size-3" /> 받기
                </button>
              </span>
            </>) : (<>
              <span className="text-ink-faint">없음 (선택 증빙)</span>
              <span className="ml-auto flex items-center gap-1">
                <input ref={contractRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) upload(i.inspectionId, 'contract', f, k('contract')); e.target.value = '' }} />
                <button onClick={() => contractRef.current?.click()} disabled={isPending} className={subBtn}><Upload className="size-3" /> 업로드</button>
              </span>
            </>)}
            {feedback(k('contract'))}
          </div>
          {/* 전/후 사진 행 폐지 (2026-08-20 사용자 지시) — 별지 서식에서는 조회할 일이 없다.
              사진 자체는 그대로다: 등록·조회는 불량내역([전/후 사진 모아보기])과 타임라인 ⑤에 있고,
              별지 11호 제출 패키지에도 종전대로 자동 첨부된다. 여기서 한 줄 덜어낼 뿐이다. */}
          {/* 10·11호 */}
          {i.defects.total === 0 ? (
            <div className={rowCls}>
              <StatusIcon state="na" />
              <span className="font-medium text-ink-faint w-44" title={`${DOC_TERMS.report10Full} · ${DOC_TERMS.report11Full}`}>이행계획·완료 (10·11호)</span>
              <span className="text-ink-faint">해당없음 — 불량 0건</span>
            </div>
          ) : (<>
            <div className={rowCls}>
              <StatusIcon state={i.report10 ? 'have' : 'warn'} />
              <span className="font-medium text-ink w-44" title={DOC_TERMS.report10Full}>이행계획서 (10호)</span>
              <button onClick={() => onCompose(i.inspectionId, 'report10')} disabled={isPending} className={composeBtn}
                title="작성 — 제출일·이행기간·계획 요약 입력 후 생성"><Pencil className="size-3" /> 작성</button>
              {previewBtn('report10')}
              {i.report10 ? (<>
                <span className="text-ink-sub">✓ {fmtD(i.report10.at)}</span>
                <span className="ml-auto flex items-center gap-1">
                  {genButtons9(i.report10, i.inspectionId, isPending)}
                </span>
              </>) : (<>
                <span className="text-amber-600">불량 {i.defects.total}건 미생성</span>
                <button onClick={() => generate(i.inspectionId, 'report10', k('r10'))} disabled={isPending} className={`ml-auto ${subBtn}`}>바로 생성</button>
              </>)}
              {feedback(k('r10'))}
            </div>
            <div className={rowCls}>
              <StatusIcon state={i.report11 ? 'have' : 'warn'} />
              <span className="font-medium text-ink w-44" title={DOC_TERMS.report11Full}>이행완료 보고서 (11호)</span>
              <button onClick={() => onCompose(i.inspectionId, 'report11')} disabled={isPending} className={composeBtn}
                title="작성 — 제출일·완료 보고 문구 입력 후 생성"><Pencil className="size-3" /> 작성</button>
              {previewBtn('report11')}
              {i.report11 ? (<>
                <span className="text-ink-sub">✓ {fmtD(i.report11.at)}</span>
                <span className="ml-auto flex items-center gap-1">
                  {genButtons9(i.report11, i.inspectionId, isPending)}
                </span>
              </>) : (<>
                <span className="text-amber-600">조치 완료 {i.defects.done}/{i.defects.total} — 미생성</span>
                <button onClick={() => generate(i.inspectionId, 'report11', k('r11'))} disabled={isPending} className={`ml-auto ${subBtn}`}>바로 생성</button>
              </>)}
              {feedback(k('r11'))}
            </div>
          </>)}
        </>
      </div>
    </div>
  )
}

/** 별지 생성물 [HWP][PDF] 버튼 — 저장명은 `/inspections/{id}/doc` 라우트가 붙인다
 *  (별지 4·9호 제출용 이름 규약이 점검 유형에 걸려 있어 서버 단일 출처, lib/annex-filename). */
export function genButtons9(g: DocGroupRef, inspectionId: string, isPending: boolean) {
  return (<>
    {g.hwp && (
      <button onClick={() => openAnnexHwp(inspectionId, g.hwp!.path)} disabled={isPending} title="한글 편집용 원본 내려받기" className={hwpBtn}>
        <FileText className="size-3" /> HWP
      </button>
    )}
    {g.pdf && (
      <button onClick={() => openAnnexPdf(inspectionId, g.pdf!.path)} disabled={isPending} title="바로 보기·인쇄" className={pdfBtn}>
        <FileType2 className="size-3" /> PDF
      </button>
    )}
  </>)
}
