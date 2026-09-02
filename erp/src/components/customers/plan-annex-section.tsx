'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw } from 'lucide-react'
import {
  getCustomerRoundsAction, getRoundDocsAction, getDocUrlAction,
  type CustomerRounds, type CustomerRound,
} from '@/app/(dashboard)/reports/docs-actions'
import { uploadTimelineFileAction } from '@/app/(dashboard)/inspections/timeline-actions'
import { requestReport9Action, getAnnexPreviewHtmlAction } from '@/app/(dashboard)/inspections/report9-actions'
import { confirmPlanItemStageOneAction } from '@/app/(dashboard)/inspection-plans/actions'
import dynamic from 'next/dynamic'
import type { ComposeAnnexNo } from '@/components/inspections/annex-compose-panel'
import { PlanAnnexRoundCard } from '@/components/customers/plan-annex-round-card'
import type { PreviewDoc, FullPreviewState } from '@/components/customers/plan-annex-full-preview'

// 조건부로만 뜨는 무거운 모달 2종은 지연 로드 — 탭에 들어오기만 한 사용자는 내려받지 않는다.
// 회차 카드(PlanAnnexRoundCard)·점검표 트리는 **의도적으로 정적**이다: 최신 회차가 자동으로
// 펼쳐져 즉시 렌더되므로 동적화하면 청크 워터폴만 늘어난다.
// 점검일 확정 모달(2.2KB)도 정적 유지 — 청크 왕복 비용이 이득보다 크다.
const AnnexComposePanel = dynamic(
  () => import('@/components/inspections/annex-compose-panel').then(m => m.AnnexComposePanel))
const PlanAnnexFullPreview = dynamic(
  () => import('@/components/customers/plan-annex-full-preview').then(m => m.PlanAnnexFullPreview))

/** 별지 서식 섹션 (소방계획서_8 H-2·H-3·H-5 → 2026-09-02 회차 자동화 재편).
 *  회차는 사용자가 관리하지 않는다 — ERP가 자동 판정한 **현재 회차 1건**의 문서·점검표만 보인다
 *  (연도·차수·종합/작동은 롤링 생성기의 사용승인일 법정 축, 최초점검은 60일 규칙 자동).
 *  예정·지난 회차 목록/아코디언/점검일 모달 전부 폐지 — 일정 관리는 점검 달력·점검계획이 담당.
 *  미시작이면 [작성 시작] 한 번으로 오늘이 점검 시작일로 기록되며 열린다(H-3 규칙 재사용).
 *  문서 행은 InspectionDocRows·AnnexComposePanel 재사용 — 저장 경로 동일(annex_inputs=inspection_id). */

const todayStr = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

function roundKey(r: CustomerRound) { return `${r.year}-${r.sequenceNum}` }

/** 현재 회차 자동 판정 (2026-09-02 사용자 확정 — "회차는 ERP가 알아서").
 *
 *  사용자는 회차를 고르지도 관리하지도 않는다 — 이 화면은 **지금 데이터가 귀속될 회차 1건**만
 *  자동으로 정해 그 문서·점검표를 보여준다. 판정 규칙:
 *   · 시작된 회차(진행 중)가 있으면 그것 — 입력 중인 점검이 곧 현재다.
 *   · 없으면 예정일이 가장 가까운 미시작 회차(지난 예정 포함) — 시기가 오면 자동 교대된다.
 *  회차의 연도·차수·종합/작동은 롤링 생성기가 사용승인일 법정 축으로 이미 계산해 둔 값이고,
 *  최초점검 여부는 시작 시 60일 규칙으로 자동 기입된다 — 문서에는 전부 자동으로 찍힌다.
 *  예정·지난 회차 목록 UI는 폐지 — 일정 관리는 점검 달력·점검계획 화면이 담당한다. */
function currentRoundOf(rounds: CustomerRound[]): CustomerRound | null {
  const active = rounds.filter(r => r.state !== 'completed')
  const dateKey = (r: CustomerRound) => r.plannedDate ?? `${r.year}-${String(r.sequenceNum * 6).padStart(2, '0')}`
  const started = active.filter(r => r.state !== 'planned')
    .sort((a, b) => dateKey(a).localeCompare(dateKey(b)))
  if (started.length > 0) return started[0]
  const planned = active.filter(r => r.state === 'planned')
    .sort((a, b) => dateKey(a).localeCompare(dateKey(b)))
  return planned[0] ?? null
}

export function PlanAnnexSection({ customerId, canRegister = false, initialData = null }: {
  customerId: string
  /** 역할 축 권한 — 점검표 인라인 입력 노출 게이트(점검 건 축은 액션이 반환) */
  canRegister?: boolean
  /** 서버 프리페치 (2026-09-02 성능) — ?tab=annex 진입 시 page.tsx가 실어 보낸다.
   *  있으면 첫 클라이언트 왕복("회차를 불러오는 중…" 스피너)이 통째로 사라진다. */
  initialData?: CustomerRounds | null
}) {
  const [data, setData] = useState<CustomerRounds | null>(initialData)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [compose, setCompose] = useState<{ inspectionId: string; annexNo: ComposeAnnexNo } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null)
  // H-5c: 회차 전체 미리보기 — prefetch 캐시([보기]·[전체 미리보기] 클릭 시 렌더, 재오픈 0초)
  const [previewCache, setPreviewCache] = useState<Record<string, PreviewDoc[]>>({})
  // only=undefined → 전 별지 세로 연결(종전 전체 미리보기), only=타입 → 그 문서 1건만 전체 높이로 (2026-08-10 #13)
  const [fullPreview, setFullPreview] = useState<FullPreviewState | null>(null)
  // D-7 호버 퀵뷰 폐지(S3, 2026-08-12) — 프리페치를 지연화하면 호버 시점엔 캐시가 비어 '준비 중' 빈 팝업만
  // 뜨는 경우가 대부분이라 가치가 사라졌다. 같은 일을 [보기](단일 문서 모달)가 확실하게 한다.
  // 예정·지난 회차 접힘 섹션 폐지(2026-09-02) — 회차는 자동 판정 1건만. 시작도 모달 없이 즉시(오늘).
  const [isStarting, startStarting] = useTransition()

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
      // 유휴 예열 폐지(2026-08-20) — [보기]·[전체 미리보기]를 누른 시점에만 별지를 렌더한다.
    })
  }
  // 서버 프리페치가 실려 오면 첫 왕복을 건너뛴다 (2026-09-02 — "불러오는 중" 스피너 소멸)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!initialData) reload(true) }, [customerId])

  const rounds = useMemo(() => data?.rounds ?? [], [data])

  /** 회차의 미리보기 문서 목록(순서 = 인쇄 순서). 불량이 없으면 ⑩⑪은 대상이 아니다. */
  function previewTypesOf(r: CustomerRound): PreviewDoc[] {
    return [
      { type: 'report4', label: '별지 4호 점검표', missing: [] },
      { type: 'report9', label: '별지 9호 실시결과 보고서', missing: [] },
      ...((r.docs?.defects.total ?? 0) > 0
        ? [{ type: 'report10' as const, label: '별지 10호 이행계획서', missing: [] },
           { type: 'report11' as const, label: '별지 11호 이행완료 보고서', missing: [] }]
        : []),
    ]
  }

  /** 미리보기 렌더 — `only`를 주면 **그 문서 1건만** 조립한다 (2026-08-20).
   *
   *  종전엔 [보기]로 9호 하나를 열어도 4종을 전부 조립했다. 별지 조립은 카탈로그 전건 조회 +
   *  8쪽 HTML 렌더이고 4호는 부속 점검표까지 얹어 특히 무겁다(pdf 변환에 timeoutMs 120초를 따로 줄 정도).
   *  이미 받아둔 문서는 건너뛰고 없는 것만 채운 뒤, 순서는 인쇄 순서로 되돌린다. */
  function prefetchPreviews(r: CustomerRound, only?: PreviewDoc['type']) {
    if (!r.docs) return
    const inspectionId = r.docs.inspectionId
    const all = previewTypesOf(r)
    const cached = previewCache[inspectionId]
    const pending = all.filter(t => (!only || t.type === only)
      && !cached?.some(c => c.type === t.type && (c.html !== undefined || c.error !== undefined)))
    if (pending.length === 0) return

    // 캐시 슬롯 예약(중복 요청 방지) — 이미 있는 항목은 보존한다
    setPreviewCache(prev => {
      const base = prev[inspectionId] ?? []
      const byType = new Map(base.map(d => [d.type, d]))
      for (const t of pending) if (!byType.has(t.type)) byType.set(t.type, t)
      return { ...prev, [inspectionId]: all.filter(t => byType.has(t.type)).map(t => byType.get(t.type)!) }
    })
    void Promise.all(pending.map(async t => {
      try {
        const res = await getAnnexPreviewHtmlAction(inspectionId, t.type)
        return { ...t, html: res.html, missing: res.missing ?? [], error: res.error }
      } catch {
        return { ...t, missing: [], error: '미리보기 렌더 실패 — 다시 시도해주세요' }
      }
    })).then(loaded => setPreviewCache(prev => {
      const byType = new Map((prev[inspectionId] ?? []).map(d => [d.type, d]))
      for (const d of loaded) byType.set(d.type, d)
      return { ...prev, [inspectionId]: all.filter(t => byType.has(t.type)).map(t => byType.get(t.type)!) }
    }))
  }

  /** 문서 1건만 크게 보기 — 회차 라벨을 붙여 같은 모달을 단일 문서 모드로 연다 */
  function openSingle(r: CustomerRound, type: PreviewDoc['type']) {
    if (!r.docs) return
    prefetchPreviews(r, type)   // 연 문서 1건만 조립한다(나머지 3종은 누를 때)
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

  /* ── 작성 시작 — 모달 없이 즉시 (2026-09-02 사용자 확정: 회차는 ERP가 알아서).
   *  점검일 = 오늘 자동 기록(실제 작성 행위가 곧 기록). 확정=자동 시작 규칙(H-3)은 재사용. */
  function startNow(r: CustomerRound) {
    if (!r.planItemId) return
    startStarting(async () => {
      try {
        const res = await confirmPlanItemStageOneAction(r.planItemId!, todayStr())
        if (res.error) { setMsg({ key: roundKey(r), text: `❌ ${res.error}`, ok: false }); return }
        reload()
      } catch {
        setMsg({ key: roundKey(r), text: '❌ 처리하지 못했습니다 — 권한이 없으면 점검계획에서 확정해주세요.', ok: false })
      }
    })
  }

  if (loadErr) {
    return <p className="text-xs text-red-600 py-4">{loadErr} — 권한이 없거나 일시 오류입니다.</p>
  }
  if (!data) {
    return <p className="text-xs text-ink-meta py-4 inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> 회차를 불러오는 중…</p>
  }

  // 자동 판정된 현재 회차 1건만 — 회차 목록·접힘 UI 폐지 (2026-09-02 사용자 확정)
  const current = currentRoundOf(rounds)

  const renderCard = (r: CustomerRound) => {
    const label = `${r.year}년 ${r.sequenceNum}차`
    return (
      <PlanAnnexRoundCard
        key={roundKey(r)} r={r} isOpen alwaysOpen
        inspectionType={data.inspectionType} customerName={data.customerName}
        canRegister={canRegister} isPending={isPending} isStarting={isStarting}
        entryFrom={`/customers/${customerId}?tab=annex`}
        onToggle={() => {}}
        onFullPreview={() => { prefetchPreviews(r); setFullPreview({ inspectionId: r.docs!.inspectionId, label }) }}
        onPreviewSingle={type => openSingle(r, type)}
        onOpenFile={open} onGenerate={generate} onUpload={upload}
        onCompose={(inspectionId, annexNo) => setCompose({ inspectionId, annexNo })}
        onSheetSaved={responded => patchSheetResponses(r.docs!.inspectionId, responded)}
        onStart={() => startNow(r)}
        feedback={feedback} />
    )
  }

  return (
    <div className="space-y-3">
      {/* 머리 안내 — 회차·종류·연도는 전부 자동 (사용승인일 법정 축) */}
      <p className="text-[11px] text-ink-meta">
        연도·차수·종합/작동/최초는 사용승인일 기준으로 ERP가 자동 판정해 문서에 기입합니다 —
        점검표는 여기서 바로 입력하고, 별지는 누를 때 현재 데이터로 생성됩니다
      </p>

      {rounds.length === 0 && (
        <p className="text-xs text-ink-meta py-4 text-center">
          자체점검 일정이 없습니다 — 연간 계획 생성 후 자동으로 나타납니다 (<Link href="/inspection-plans" className="text-brand hover:underline">점검계획</Link>)
        </p>
      )}

      {current && renderCard(current)}

      <button onClick={() => reload()} disabled={isPending}
        className="text-[11px] text-ink-faint hover:text-brand inline-flex items-center gap-1 disabled:opacity-50">
        <RefreshCw className={`size-3 ${isPending ? 'animate-spin' : ''}`} /> 새로고침
      </button>

      {/* 별지 작성 패널 — 문서 작업대와 동일 컴포넌트 (H-24 재사용) */}
      {compose && (
        <AnnexComposePanel
          inspectionId={compose.inspectionId}
          annexNo={compose.annexNo}
          customerId={customerId}
          from={`/customers/${customerId}?tab=annex`}
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

      {/* 점검일 확정 모달 폐지(2026-09-02) — 작성 시작 클릭 = 오늘이 점검 시작일로 자동 기록 */}
    </div>
  )
}
