'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Eye, PlayCircle, FileSpreadsheet, Loader2 } from 'lucide-react'
import type { CustomerRound } from '@/app/(dashboard)/reports/docs-actions'
import type { ComposeAnnexNo } from '@/components/inspections/annex-compose-panel'
import { InspectionDocRows } from '@/components/reports/customer-docs'
import { PlanAnnexSheetTree, PlanAnnexSheetHeader } from '@/components/customers/plan-annex-sheet-tree'
import { inspectionNatureBadge } from '@/lib/inspection-nature'
import { openAnnexPdf } from '@/lib/annex-filename'
import type { InspectionType, PlanType } from '@/types'
import type { PreviewDoc } from '@/components/customers/plan-annex-full-preview'

/** 회차 카드 1건 (소방계획서_8 H-2 → 소방계획서_20 S3에서 분리).
 *  본문 2블록: 별지 생성·확인(고정 6~8행, 회차 수명 대부분의 용무) → 점검표 진행(설비 수만큼 가변).
 *  화면 순서가 작업 순서(점검표 → 별지)와 반대인 이유(2026-08-28): 긴 가변 블록이 위에 오면
 *  별지 행들이 매번 스크롤 밖으로 밀린다. 대신 번호(①②)를 떼 순서 오독을 막고,
 *  미입력 경고는 별지 블록 제목에 복제한다 — [생성]을 누르기 전에 눈에 걸려야 한다(물분무 공란 사고 가드).
 *  ⚠ 블록 제목에 '점검표 입력' 문자열을 쓰지 말 것 —
 *     test-annex-interaction.mts가 그 문자열 개수로 회차 펼침 상태를 판정한다(PlanAnnexSheetHeader가 유일 출처). */

const todayStr = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const blockTitleCls = 'text-[11px] font-semibold text-ink-sub pt-1 pb-0.5'
const chipCls = 'text-[11px] text-brand border border-brand-line rounded-lg px-2 py-0.5 hover:bg-brand-tint shrink-0 cursor-pointer'

/** 회차 묶음 인쇄(소방계획서_18 S1) 가능 여부 — 병합 대상은 PDF뿐이라 HWP·HTML만 있으면 열지 않는다.
 *  bundle 라우트의 TYPE_ORDER와 같은 축. */
function hasBundlePdf(d: NonNullable<CustomerRound['docs']>): boolean {
  return [d.report9, d.report4, d.report10, d.report11, d.exterior].some(g => !!g?.pdf)
}

/** 서버가 정한 저장명(`filename*=UTF-8''…`)을 그대로 쓴다 — 이름 규약을 화면이 다시 짜지 않는다 */
function fileNameOf(res: Response): string | null {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('Content-Disposition') ?? '')
  return m ? decodeURIComponent(m[1]) : null
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
  return { label: '진행중', cls: 'bg-brand-tint text-brand' }
}

export function PlanAnnexRoundCard({
  r, isOpen, alwaysOpen = false, inspectionType, customerName, canRegister, isPending, isStarting, entryFrom,
  onToggle, onFullPreview, onPreviewSingle, onOpenFile, onGenerate, onUpload, onCompose, onSheetSaved, onStart, feedback,
}: {
  r: CustomerRound
  isOpen: boolean
  /** 현재 회차는 접을 수 없다 (2026-09-02 사용자 확정 — 접으면 '지금 할 일'이 숨는다).
   *  토글·셰브론을 감추고 항상 펼친다. 예정·지난 접힘 섹션 안의 카드만 토글을 유지한다. */
  alwaysOpen?: boolean
  inspectionType: string
  customerName: string
  canRegister: boolean
  isPending: boolean
  isStarting: boolean
  /** 점검표 입력 화면의 뒤로가기 복귀 경로(?from=) — 이 카드가 그려진 화면의 딥링크 */
  entryFrom?: string
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
  // 소방계획서_27 — 갑지 통합 워크북 내려받기 상태(이 카드 안에서만 쓴다)
  const [xlsx, setXlsx] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: '', ok: true })
  // 설치 설비 중 응답 0건 수 — 아래 점검표 트리가 조회한 값을 위 별지 블록 제목에 복제한다
  const [sheetBlanks, setSheetBlanks] = useState(0)

  /** 엑셀(갑지 워크북) 즉석 생성 — 저장하지 않으므로 받는 순간이 곧 생성이다.
   *
   *  `location.assign`으로 바로 열지 않는 이유: 이 라우트는 실패를 **JSON 안내문**으로 돌려준다
   *  (권한 없음·템플릿 없음·앵커 불일치·주입 값 누락). 통째로 이동시키면 사용자는 회차 목록을 잃고
   *  날 JSON을 보게 된다. 받아서 성공일 때만 내려받고, 실패는 서버 문장 그대로 보여준다
   *  (print-pdf-client.tsx:18과 같은 규약 — 서버가 담아 보낸 안내를 버리지 않는다).
   *  성공 응답의 `X-Workbook-Missing`은 조립 함수가 알린 공란 목록이다(S4-5). */
  async function downloadWorkbook(inspectionId: string) {
    setXlsx({ busy: true, msg: '', ok: true })
    try {
      const res = await fetch(`/inspections/${inspectionId}/workbook`)
      if (!res.ok) {
        const m = await res.json().then(j => j?.error as string | undefined).catch(() => undefined)
        throw new Error(m ?? `HTTP ${res.status}`)
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = fileNameOf(res) ?? `${customerName}_점검결과보고서_${r.year}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      // ⚠ 라벨을 '공란으로 나간 항목'으로 두면 안 된다 — 이 헤더의 **맨 앞은 점검표 착지 집계**라
      //   («점검표 항목 243건 중 182건 반영 …») 반영에 **성공한** 건수가 '공란'으로 읽힌다
      //   (2026-08-30 판정 지적). 착지 집계를 맨 앞으로 옮긴 수리의 부작용이었다.
      //   헤더는 성공·누락이 섞인 요약이므로 중립어로 받는다.
      const note = decodeURIComponent(res.headers.get('X-Workbook-Missing') ?? '').trim()
      setXlsx({ busy: false, ok: true, msg: note ? `받았습니다 — ${note}` : '엑셀을 받았습니다.' })
    } catch (e) {
      setXlsx({ busy: false, ok: false, msg: `엑셀을 만들지 못했습니다 — ${(e as Error).message}` })
    }
  }

  return (
    <div className={`rounded-xl border ${isOpen ? 'border-brand-line' : 'border-brand-line-soft'} ${done ? 'bg-paper' : 'bg-surface'}`}>
      {/* 회차 헤더 — S3: 펼침만으로 미리보기를 렌더하지 않는다([보기]·[전체 미리보기]에서 로드) */}
      <button onClick={alwaysOpen ? undefined : onToggle}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left ${alwaysOpen ? 'cursor-default' : ''}`}>
        {!alwaysOpen && (isOpen ? <ChevronDown className="size-3.5 text-ink-faint shrink-0" /> : <ChevronRight className="size-3.5 text-ink-faint shrink-0" />)}
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${nb.className}`}>{nb.label}</span>
        <span className="text-xs font-semibold text-ink">{label}</span>
        {r.plannedDate && <span className="text-[11px] text-ink-meta">{r.plannedDate.slice(5, 10)}</span>}
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
        {/* 소방계획서_27 — 갑지 통합 워크북. 전체 인쇄(PDF)와 같은 회차 단위 산출물이라 나란히 둔다.
            ⚠ hasBundlePdf로 막지 않는다 — 이건 생성된 별지 PDF를 묶는 게 아니라 갑지 서식에
            값을 주입해 즉석으로 만든다. 별지가 하나도 없어도 만들어진다(그래서 '작성 전'에도 쓸 수 있다).
            권한은 라우트가 inspection_register를 요구하므로 화면에서도 같은 축으로 가린다 —
            안 그러면 눌러 봐야 403 JSON이다. */}
        {r.docs && isOpen && canRegister && (
          <span role="button" tabIndex={xlsx.busy ? -1 : 0}
            title="이 회차를 갑지 서식 엑셀로 받기 — PDF와 달리 받은 뒤 고쳐 쓸 수 있습니다"
            onClick={e => { e.stopPropagation(); if (!xlsx.busy) void downloadWorkbook(r.docs!.inspectionId) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); if (!xlsx.busy) void downloadWorkbook(r.docs!.inspectionId) } }}
            className={`${chipCls} inline-flex items-center gap-1 ${xlsx.busy ? 'opacity-50 cursor-default' : ''}`}
            data-testid="round-workbook-download">
            {xlsx.busy ? <Loader2 className="size-3 animate-spin" /> : <FileSpreadsheet className="size-3" />}
            엑셀
          </span>
        )}
        <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${pill.cls}`}>{pill.label}</span>
        {r.docs && (
          <span className="text-[10px] text-ink-meta shrink-0">
            ④{r.docs.report4 ? '✓' : '·'} ⑨{r.docs.report9 ? '✓' : '·'}
            {r.docs.defects.total > 0 && <> ⑩{r.docs.report10 ? '✓' : '·'} ⑪{r.docs.report11 ? '✓' : '·'}</>}
            {' '}불량 {r.docs.defects.total}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="px-4 pb-3">
          {/* 엑셀 내려받기 결과 — 헤더는 <button>이라 그 안에 안내를 키울 수 없어 본문 머리에 둔다 */}
          {xlsx.msg && (
            <p className={`mb-1 rounded-lg px-2 py-1 text-[11px] ${xlsx.ok ? 'bg-brand-tint text-ink-sub' : 'bg-red-50 text-red-600'}`}
              data-testid="round-workbook-msg">{xlsx.msg}</p>
          )}
          {r.docs ? (
            <>
              <p className={blockTitleCls}>
                별지 생성·확인 <span className="font-normal text-ink-meta">— 입력된 점검표에서 자동 생성</span>
                {/* 미입력 경고 복제 — 트리가 [생성] 아래로 내려갔으므로 생성 전에 걸릴 신호를 여기 둔다 */}
                {sheetBlanks > 0 && (
                  <span className="ml-2 font-medium text-amber-600">⚠ 설치 설비 중 미입력 {sheetBlanks}개 — 결과칸이 공란으로 인쇄됩니다</span>
                )}
              </p>
              {/* ④ 별지 4호 행 — [자동] 점검표+설비 대장에서 생성 (D-18: 입력 없음) */}
              <div className="flex items-center gap-2 py-1.5 text-xs border-b border-brand-line-soft flex-wrap">
                <span className="font-medium text-ink w-44 pl-5">별지 4호 점검표</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">자동</span>
                {r.docs.report4 ? (
                  <span className="text-ink-sub">✓ {(r.docs.report4.at ?? '').slice(5, 10)}</span>
                ) : (
                  <span className="text-amber-600">미생성 — 점검표·설비 대장(1.4)에서 자동</span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <button onClick={() => onPreviewSingle('report4')}
                    title="이 문서만 크게 보기 — 생성 전에도 확인 가능"
                    className="inline-flex items-center gap-1 h-6 px-2 rounded border border-brand-line text-[11px] text-ink-sub hover:bg-brand-tint">
                    <Eye className="size-3" /> 보기
                  </button>
                  {r.docs.report4?.pdf && (
                    <button onClick={() => openAnnexPdf(r.docs!.inspectionId, r.docs!.report4!.pdf!.path)} disabled={isPending}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded border border-red-200 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50">PDF</button>
                  )}
                  <button onClick={() => onGenerate(r.docs!.inspectionId, 'report4', `${r.docs!.inspectionId}:r4`)} disabled={isPending}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded border border-brand-line text-[11px] text-brand hover:bg-brand-tint disabled:opacity-50">
                    {r.docs.report4 ? '재생성' : '생성'}
                  </button>
                </span>
                {feedback(`${r.docs.inspectionId}:r4`)}
              </div>
              {/* 문서 행 — 보고서 센터 InspectionDocRows 재사용 (9호·배치확인서·계약서·10·11호).
                  전/후 사진 행은 2026-08-20 폐지 — 별지 서식에서는 조회할 일이 없다 */}
              <InspectionDocRows
                i={r.docs} customerName={customerName}
                isPending={isPending} open={onOpenFile} generate={onGenerate} upload={onUpload} feedback={feedback}
                onCompose={onCompose}
                onPreview={(_id, type) => onPreviewSingle(type)} />

              <p className={`${blockTitleCls} mt-3`}>점검표 진행 <span className="font-normal text-ink-meta">— 현장 결과를 설비별로 입력</span></p>
              {/* 📝 점검표 노드 (D-11 → 소방계획서_16 S4 → 소방계획서_28 조회 전용) — 머리줄 + 설비별 진행 트리 */}
              <PlanAnnexSheetHeader inspectionId={r.docs.inspectionId}
                responded={r.docs.sheetResponses} defects={r.docs.defects.total} from={entryFrom} />
              <PlanAnnexSheetTree inspectionId={r.docs.inspectionId} canRegister={canRegister}
                onSaved={onSheetSaved} onBlankCount={setSheetBlanks} from={entryFrom} />
            </>
          ) : (
            /* 미시작 — [작성 시작] 한 번으로 오늘이 점검 시작일로 자동 기록되고 점검표·별지가 열린다
               (H-3 → 2026-09-02: 점검일 모달·회차 선택 폐지 — 회차는 ERP가 알아서) */
            <div className="flex items-center gap-2 py-2 text-xs">
              <span className="text-ink-sub">점검표·별지를 작성하려면 시작하세요 — 오늘이 점검 시작일로 자동 기록됩니다</span>
              <button onClick={onStart} disabled={isStarting}
                className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-[11px] font-medium disabled:opacity-50">
                <PlayCircle className="size-3.5" /> 작성 시작
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
