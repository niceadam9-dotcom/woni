'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import {
  getCustomerRoundsAction, getRoundDocsAction, getDocUrlAction,
  type CustomerRounds, type CustomerRound,
} from '@/app/(dashboard)/reports/docs-actions'
import { uploadTimelineFileAction } from '@/app/(dashboard)/inspections/timeline-actions'
import { requestReport9Action, getAnnexPreviewHtmlAction } from '@/app/(dashboard)/inspections/report9-actions'
import { confirmPlanItemStageOneAction } from '@/app/(dashboard)/inspection-plans/actions'
import { AnnexComposePanel, type ComposeAnnexNo } from '@/components/inspections/annex-compose-panel'
import { inspectionNatureBadge } from '@/lib/inspection-nature'
import type { InspectionType, PlanType } from '@/types'
import { isCompleteDate } from '@/components/ui/date-input'
import { PlanAnnexRoundCard } from '@/components/customers/plan-annex-round-card'
import { PlanAnnexFullPreview, type PreviewDoc, type FullPreviewState } from '@/components/customers/plan-annex-full-preview'
import { PlanAnnexStartModal } from '@/components/customers/plan-annex-start-modal'

/** 별지 서식 섹션 (소방계획서_8 H-2·H-3·H-5) — 소방계획서 트리의 회차 자동 카드.
 *  최신 회차 즉시 펼침 + 과거 아코디언(D-4), 회차=plan_items∪inspections 자동(D-2),
 *  미시작 회차는 점검일 확정 모달 → 자동 시작(D-3, confirmPlanItemStageOneAction 재사용).
 *  문서 행은 보고서 센터의 InspectionDocRows·AnnexComposePanel 재사용 — 저장 경로 동일(annex_inputs=inspection_id). */

const todayStr = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

function roundKey(r: CustomerRound) { return `${r.year}-${r.sequenceNum}` }

export function PlanAnnexSection({ customerId, canRegister = false }: {
  customerId: string
  /** 역할 축 권한 — 점검표 인라인 입력 노출 게이트(점검 건 축은 액션이 반환) */
  canRegister?: boolean
}) {
  const [data, setData] = useState<CustomerRounds | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [compose, setCompose] = useState<{ inspectionId: string; annexNo: ComposeAnnexNo } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null)
  // H-5c: 회차 전체 미리보기 — prefetch 캐시([보기]·[전체 미리보기] 클릭 시 렌더, 재오픈 0초)
  const [previewCache, setPreviewCache] = useState<Record<string, PreviewDoc[]>>({})
  // only=undefined → 전 별지 세로 연결(종전 전체 미리보기), only=타입 → 그 문서 1건만 전체 높이로 (2026-08-10 #13)
  const [fullPreview, setFullPreview] = useState<FullPreviewState | null>(null)
  // D-7 호버 퀵뷰 폐지(S3, 2026-08-12) — 프리페치를 지연화하면 호버 시점엔 캐시가 비어 '준비 중' 빈 팝업만
  // 뜨는 경우가 대부분이라 가치가 사라졌다. 같은 일을 [보기](단일 문서 모달)가 확실하게 한다.
  // customer-docs.tsx의 data-hover-doc 속성은 그대로 둔다 — 18 세션 diff를 늘리지 않고, 셀렉터 앵커로도 쓰인다.
  // S2(소방계획서_20): 완료 회차는 "지난 회차 N건" 접힘 섹션 — 기본 닫힘, 상세는 클릭 시 지연 로드
  const [pastOpen, setPastOpen] = useState(false)
  const [loadingRound, setLoadingRound] = useState<string | null>(null)
  // H-3: 미시작 회차 점검일 확정 모달
  const [startModal, setStartModal] = useState<{ planItemId: string; label: string } | null>(null)
  const [startDate, setStartDate] = useState('')
  const [isStarting, startStarting] = useTransition()
  const [startErr, setStartErr] = useState<string | null>(null)

  /** 점검표 인라인 저장 후 회차 머리줄의 응답 수만 갱신 — reload()는 미리보기 캐시를 통째로 버려
   *  펼친 회차의 iframe이 전부 다시 렌더된다(68행). 부분 패치로 그 비용을 피한다. */
  function patchSheetResponses(inspectionId: string, responded: number) {
    setData(prev => prev && ({
      ...prev,
      rounds: prev.rounds.map(r => r.docs?.inspectionId === inspectionId
        ? { ...r, docs: { ...r.docs, sheetResponses: responded } }
        : r),
    }))
  }

  /** 회차 1건 문서 상태만 재조회·패치 (소방계획서_20 S1) — 생성·업로드 후 전면 reload(3+3N 왕복) 대신.
   *  미리보기 캐시도 이 회차 키만 무효화해, 다른 펼친 회차의 iframe 재렌더를 막는다. */
  function refreshRound(inspectionId: string) {
    startTransition(async () => {
      const res = await getRoundDocsAction(customerId, inspectionId)
      if (res.error || !res.docs) { reload(); return }   // 회차가 사라진 경우 등 — 전면 재조회 폴백
      const docs = res.docs
      setData(prev => prev && ({
        ...prev,
        rounds: prev.rounds.map(r => r.docs?.inspectionId === inspectionId ? { ...r, docs } : r),
      }))
      setPreviewCache(prev => {
        if (!(inspectionId in prev)) return prev
        const next = { ...prev }
        delete next[inspectionId]
        return next
      })
    })
  }

  function reload(first = false) {
    startTransition(async () => {
      const res = await getCustomerRoundsAction(customerId)
      if (res.error || !res.data) { setLoadErr(res.error ?? '조회 실패'); return }
      setLoadErr(null)
      setData(res.data)
      // 독립 검증 지적(2026-08-04): 재생성·저장 후 미리보기 캐시가 낡음 — reload마다 무효화(재열람 시 재렌더)
      if (!first) setPreviewCache({})
      if (first) {
        // 최신 회차 자동 펼침 (D-4). S2 이후 완료 회차는 접힘 섹션 안이라 자동 펼침 대상에서 뺀다 —
        // 열어도 보이지 않고, 상세를 지연 로드하려는 취지와도 어긋난다.
        const firstActive = res.data.rounds.find(r => r.state !== 'completed')
        if (firstActive) {
          setExpanded(new Set([roundKey(firstActive)]))
          // S3: 진입 즉시 별지 4종을 렌더하면 마운트와 12~20왕복이 겹친다.
          // 화면이 자리 잡은 뒤(유휴) 최신 회차 1건만 미리 데워 클릭 0초 체감은 남긴다.
          if (firstActive.docs) {
            window.setTimeout(() => {
              if (!document.hidden) prefetchPreviews(firstActive)
            }, 2500)
          }
        }
      }
    })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(true) }, [customerId])

  const rounds = useMemo(() => data?.rounds ?? [], [data])

  function toggle(key: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  /** 지난(완료) 회차 열기 (S2) — 요약(docsLite)만 실려 있으므로 이 시점에 상세를 지연 로드한다.
   *  한 번 받은 회차는 docs가 채워져 다시 열 때 왕복이 없다. */
  function openPastRound(r: CustomerRound) {
    const key = roundKey(r)
    if (expanded.has(key)) { toggle(key); return }
    if (r.docs || !r.docsLite) { toggle(key); return }
    const inspectionId = r.docsLite.inspectionId
    setLoadingRound(key)
    startTransition(async () => {
      const res = await getRoundDocsAction(customerId, inspectionId)
      setLoadingRound(null)
      if (res.error || !res.docs) { setMsg({ key, text: `❌ ${res.error ?? '회차를 불러오지 못했습니다'}`, ok: false }); return }
      const docs = res.docs
      setData(prev => prev && ({
        ...prev,
        rounds: prev.rounds.map(x => x.docsLite?.inspectionId === inspectionId ? { ...x, docs } : x),
      }))
      toggle(key)
    })
  }

  /* ── H-5c: 미리보기 prefetch — 회차 펼침·전체 미리보기 오픈 시 백그라운드 렌더 ── */
  function prefetchPreviews(r: CustomerRound) {
    if (!r.docs || previewCache[r.docs.inspectionId]) return
    const inspectionId = r.docs.inspectionId
    const types: PreviewDoc[] = [
      { type: 'report4', label: '별지 4호 점검표', missing: [] },
      { type: 'report9', label: '별지 9호 실시결과 보고서', missing: [] },
      ...(r.docs.defects.total > 0
        ? [{ type: 'report10' as const, label: '별지 10호 이행계획서', missing: [] },
           { type: 'report11' as const, label: '별지 11호 이행완료 보고서', missing: [] }]
        : []),
    ]
    // 캐시 슬롯 예약(중복 요청 방지) 후 각 문서 병렬 렌더
    setPreviewCache(prev => ({ ...prev, [inspectionId]: types }))
    void Promise.all(types.map(async t => {
      try {
        const res = await getAnnexPreviewHtmlAction(inspectionId, t.type)
        return { ...t, html: res.html, missing: res.missing ?? [], error: res.error }
      } catch {
        return { ...t, missing: [], error: '미리보기 렌더 실패 — 다시 시도해주세요' }
      }
    })).then(loaded => setPreviewCache(prev => ({ ...prev, [inspectionId]: loaded })))
  }

  /** 문서 1건만 크게 보기 — 회차 라벨을 붙여 같은 모달을 단일 문서 모드로 연다 */
  function openSingle(r: CustomerRound, type: PreviewDoc['type']) {
    if (!r.docs) return
    prefetchPreviews(r)
    setFullPreview({ inspectionId: r.docs.inspectionId, label: `${r.year}년 ${r.sequenceNum}차`, only: type })
  }

  /* ── 문서 행 배선 — CustomerDocsView와 동일 (재사용 규약) ── */
  function open(path: string | null | undefined, saveName?: string) {
    if (!path) return
    startTransition(async () => {
      const res = await getDocUrlAction(path, saveName)
      if (res.url) window.open(res.url, '_blank')
    })
  }
  function generate(inspectionId: string, kind: 'report4' | 'report9' | 'report10' | 'report11' | 'exterior', rowKey: string) {
    startTransition(async () => {
      const res = await requestReport9Action(inspectionId, kind)
      if (res.error) { setMsg({ key: rowKey, text: `❌ ${res.error}`, ok: false }); return }
      setMsg({ key: rowKey, text: '✅ 생성 완료 — 이 행에 [PDF] 링크가 표시됩니다', ok: true })
      refreshRound(inspectionId)
    })
  }
  function upload(inspectionId: string, slot: 'cert' | 'contract', file: File, rowKey: string) {
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const res = await uploadTimelineFileAction(inspectionId, slot, fd)
      if (res.error) { setMsg({ key: rowKey, text: `❌ ${res.error}`, ok: false }); return }
      setMsg({ key: rowKey, text: '✅ 업로드됨 — 타임라인과 자동 동기됩니다', ok: true })
      refreshRound(inspectionId)
    })
  }
  const feedback = (key: string) => msg?.key === key && (
    <p className={`w-full text-[11px] ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
  )

  /* ── H-3: 미시작 회차 시작 (확정=자동 시작, 기존 규칙 재사용) ── */
  function openStart(r: CustomerRound) {
    if (!r.planItemId) return
    const base = r.plannedDate && r.plannedDate >= todayStr() ? r.plannedDate : todayStr()
    setStartDate(base)
    setStartErr(null)
    setStartModal({ planItemId: r.planItemId, label: `${r.year}년 ${r.sequenceNum}차` })
  }
  function runStart() {
    if (!startModal) return
    if (!isCompleteDate(startDate)) { setStartErr('점검일을 입력해주세요.'); return }
    startStarting(async () => {
      try {
        const res = await confirmPlanItemStageOneAction(startModal.planItemId, startDate)
        if (res.error) { setStartErr(res.error); return }
        setStartModal(null)
        reload()
      } catch {
        // 권한 없음(requirePermission 리다이렉트) 등 — 모달이 잠긴 채 남지 않게
        setStartErr('처리하지 못했습니다 — 권한이 없으면 점검계획에서 확정해주세요.')
      }
    })
  }

  if (loadErr) {
    return <p className="text-xs text-red-600 py-4">{loadErr} — 권한이 없거나 일시 오류입니다.</p>
  }
  if (!data) {
    return <p className="text-xs text-[#b0acd6] py-4 inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> 회차를 불러오는 중…</p>
  }

  // S2: 진행 중·예정만 카드로 펼쳐 두고 완료 회차는 접힘 섹션으로 내린다.
  // 방치된 예정(과거 연도 planned)은 완료가 아니므로 접힘에 숨기지 않는다 — 눈에 띄어야 한다.
  const activeRounds = rounds.filter(r => r.state !== 'completed')
  const pastRounds = rounds.filter(r => r.state === 'completed')
  const pastYears = [...new Map(pastRounds.map(r => [r.year, [] as CustomerRound[]])).entries()]
    .map(([y]) => [y, pastRounds.filter(r => r.year === y)] as const)

  /** 지난 회차 요약 행 (S2) — 상세를 받기 전 상태. ✓는 '생성 이력'(gen_jobs)이지 파일 존재가 아니다 */
  const renderPastSummary = (r: CustomerRound) => {
    const key = roundKey(r)
    const lite = r.docsLite
    const nb = inspectionNatureBadge(data.inspectionType as InspectionType, r.planType as PlanType | null)
    const loading = loadingRound === key
    return (
      <div key={key}>
        <button onClick={() => openPastRound(r)} disabled={loading}
          title="펼치면 실제 파일·점검표를 불러옵니다 (요약의 ✓는 생성 이력)"
          className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-xl border border-[#e8e6f5] bg-[#fafafa] hover:bg-[#f5f4ff] disabled:opacity-60">
          {loading ? <Loader2 className="size-3.5 text-[#b0acd6] shrink-0 animate-spin" /> : <ChevronRight className="size-3.5 text-[#b0acd6] shrink-0" />}
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${nb.className}`}>{nb.label}</span>
          <span className="text-xs font-semibold text-[#090c1d]">{r.year}년 {r.sequenceNum}차</span>
          {lite?.endDate && <span className="text-[11px] text-[#b0acd6]">완료 {lite.endDate.slice(5, 10)}</span>}
          <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 bg-green-50 text-green-700">완료</span>
          {lite && (
            <span className="text-[10px] text-[#b0acd6] shrink-0" title="생성 이력 기준 — 과거본 정리로 파일이 없을 수 있습니다">
              ④{lite.generated.report4 ? '✓' : '·'} ⑨{lite.generated.report9 ? '✓' : '·'}
              {lite.defectsTotal > 0 && <> ⑩{lite.generated.report10 ? '✓' : '·'} ⑪{lite.generated.report11 ? '✓' : '·'}</>}
              {' '}불량 {lite.defectsTotal}
            </span>
          )}
        </button>
        {feedback(key)}
      </div>
    )
  }

  const renderCard = (r: CustomerRound) => {
    const key = roundKey(r)
    const label = `${r.year}년 ${r.sequenceNum}차`
    return (
      <PlanAnnexRoundCard
        key={key} r={r} isOpen={expanded.has(key)}
        inspectionType={data.inspectionType} customerName={data.customerName}
        canRegister={canRegister} isPending={isPending} isStarting={isStarting}
        onToggle={() => toggle(key)}
        onFullPreview={() => { prefetchPreviews(r); setFullPreview({ inspectionId: r.docs!.inspectionId, label }) }}
        onPreviewSingle={type => openSingle(r, type)}
        onOpenFile={open} onGenerate={generate} onUpload={upload}
        onCompose={(inspectionId, annexNo) => setCompose({ inspectionId, annexNo })}
        onSheetSaved={responded => patchSheetResponses(r.docs!.inspectionId, responded)}
        onStart={() => openStart(r)}
        feedback={feedback} />
    )
  }

  return (
    <div className="space-y-3">
      {/* 그룹 머리 안내 (D-18) — 입력은 원천 한 곳 원칙 */}
      <p className="text-[11px] text-[#b0acd6]">
        별지는 입력한 데이터로 자동 생성됩니다 — 점검표는 이 화면에서 설비별로 바로 입력할 수 있고(저장 위치는 점검 상세와 동일),
        나머지 입력은 설비 대장(1.4)·9호 ③(작성 패널)
      </p>

      {rounds.length === 0 && (
        <p className="text-xs text-[#b0acd6] py-4 text-center">
          자체점검 회차가 없습니다 — 연간 계획 생성 후 자동으로 나타납니다 (<Link href="/inspection-plans" className="text-[#7b68ee] hover:underline">점검계획</Link>)
        </p>
      )}

      {activeRounds.map(r => renderCard(r))}

      {/* S2: 지난(완료) 회차 — 기본 접힘. 요약만 싣고 상세는 열 때 지연 로드해 마운트 왕복을 줄인다 */}
      {pastRounds.length > 0 && (
        <div className="pt-1">
          <button onClick={() => setPastOpen(v => !v)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-[#847ba8] hover:bg-[#f8f8ff] rounded-lg">
            {pastOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            지난 회차 {pastRounds.length}건
            {!pastOpen && <span className="text-[#b0acd6] font-normal">— 완료된 회차입니다 (펼치면 조회·인쇄 가능)</span>}
          </button>
          {pastOpen && (
            <div className="mt-1.5 space-y-3">
              {pastYears.map(([year, list]) => (
                <div key={year} className="space-y-1.5">
                  <p className="px-2 text-[10px] font-semibold text-[#b0acd6]">{year}년 · {list.length}건</p>
                  {list.map(r => expanded.has(roundKey(r)) || r.docs
                    ? renderCard(r)
                    : renderPastSummary(r))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button onClick={() => reload()} disabled={isPending}
        className="text-[11px] text-[#b0acd6] hover:text-[#7b68ee] inline-flex items-center gap-1 disabled:opacity-50">
        <RefreshCw className={`size-3 ${isPending ? 'animate-spin' : ''}`} /> 새로고침
      </button>

      {/* 별지 작성 패널 — 문서 작업대와 동일 컴포넌트 (H-24 재사용) */}
      {compose && (
        <AnnexComposePanel
          inspectionId={compose.inspectionId}
          annexNo={compose.annexNo}
          customerId={customerId}
          onClose={() => setCompose(null)}
          onGenerated={() => refreshRound(compose.inspectionId)}
        />
      )}

      {/* H-5c 회차 전체 미리보기 (S3에서 컴포넌트 분리 — 문자열·#fp-* 앵커 불변) */}
      {fullPreview && (
        <PlanAnnexFullPreview
          state={fullPreview} setState={setFullPreview}
          docsForPreview={previewCache[fullPreview.inspectionId] ?? []}
          curRound={rounds.find(r => r.docs?.inspectionId === fullPreview.inspectionId)}
          customerName={data.customerName}
          open={open} upload={upload} feedback={feedback} />
      )}

      {/* H-3 점검일 확정 모달 — 확정=자동 시작 (S3에서 컴포넌트 분리) */}
      {startModal && (
        <PlanAnnexStartModal
          label={startModal.label} date={startDate} onDateChange={setStartDate}
          error={startErr} isPending={isStarting}
          onCancel={() => setStartModal(null)} onConfirm={runStart} />
      )}
    </div>
  )
}
