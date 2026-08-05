'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ClipboardList, Loader2, PlayCircle, RefreshCw } from 'lucide-react'
import {
  getCustomerRoundsAction, getDocUrlAction,
  type CustomerRounds, type CustomerRound,
} from '@/app/(dashboard)/reports/docs-actions'
import { uploadTimelineFileAction } from '@/app/(dashboard)/inspections/timeline-actions'
import { requestReport9Action, getAnnexPreviewHtmlAction } from '@/app/(dashboard)/inspections/report9-actions'
import { confirmPlanItemStageOneAction } from '@/app/(dashboard)/inspection-plans/actions'
import { InspectionDocRows } from '@/components/reports/customer-docs'
import { AnnexComposePanel, type ComposeAnnexNo } from '@/components/inspections/annex-compose-panel'
import { inspectionNatureBadge } from '@/lib/inspection-nature'
import type { InspectionType, PlanType } from '@/types'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'

/** 별지 서식 섹션 (소방계획서_8 H-2·H-3·H-5) — 소방계획서 트리의 회차 자동 카드.
 *  최신 회차 즉시 펼침 + 과거 아코디언(D-4), 회차=plan_items∪inspections 자동(D-2),
 *  미시작 회차는 점검일 확정 모달 → 자동 시작(D-3, confirmPlanItemStageOneAction 재사용).
 *  문서 행은 보고서 센터의 InspectionDocRows·AnnexComposePanel 재사용 — 저장 경로 동일(annex_inputs=inspection_id). */

const todayStr = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

function roundKey(r: CustomerRound) { return `${r.year}-${r.sequenceNum}` }

function statePill(r: CustomerRound): { label: string; cls: string } {
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

export function PlanAnnexSection({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CustomerRounds | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [compose, setCompose] = useState<{ inspectionId: string; annexNo: ComposeAnnexNo } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null)
  // H-5c: 회차 전체 미리보기 — prefetch 캐시(회차 펼침 시 백그라운드 렌더 → 클릭 0초)
  type PreviewDoc = { type: 'report9' | 'report4' | 'report10' | 'report11'; label: string; html?: string; missing: string[]; error?: string }
  const [previewCache, setPreviewCache] = useState<Record<string, PreviewDoc[]>>({})
  const [fullPreview, setFullPreview] = useState<{ inspectionId: string; label: string } | null>(null)
  // D-7 데스크톱 호버 퀵뷰 — 문서 행(data-hover-doc) 위에 머물면 prefetch 캐시로 미니 미리보기 (모바일 제외, D-16 Q-4)
  const [hoverDoc, setHoverDoc] = useState<{ inspectionId: string; type: PreviewDoc['type']; top: number } | null>(null)
  // H-3: 미시작 회차 점검일 확정 모달
  const [startModal, setStartModal] = useState<{ planItemId: string; label: string } | null>(null)
  const [startDate, setStartDate] = useState('')
  const [isStarting, startStarting] = useTransition()
  const [startErr, setStartErr] = useState<string | null>(null)

  function reload(first = false) {
    startTransition(async () => {
      const res = await getCustomerRoundsAction(customerId)
      if (res.error || !res.data) { setLoadErr(res.error ?? '조회 실패'); return }
      setLoadErr(null)
      setData(res.data)
      // 독립 검증 지적(2026-08-04): 재생성·저장 후 미리보기 캐시가 낡음 — reload마다 무효화(재열람 시 재렌더)
      if (!first) setPreviewCache({})
      if (first && res.data.rounds.length > 0) {
        setExpanded(new Set([roundKey(res.data.rounds[0])]))   // 최신 회차 자동 펼침 (D-4)
        if (res.data.rounds[0].docs) prefetchPreviews(res.data.rounds[0])  // H-5c: 진입 즉시 prefetch → 클릭 0초
      }
    })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(true) }, [customerId])

  const rounds = useMemo(() => data?.rounds ?? [], [data])

  function toggle(key: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
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
      reload()
    })
  }
  function upload(inspectionId: string, slot: 'cert' | 'contract', file: File, rowKey: string) {
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const res = await uploadTimelineFileAction(inspectionId, slot, fd)
      if (res.error) { setMsg({ key: rowKey, text: `❌ ${res.error}`, ok: false }); return }
      setMsg({ key: rowKey, text: '✅ 업로드됨 — 타임라인과 자동 동기됩니다', ok: true })
      reload()
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

  return (
    <div className="space-y-3">
      {/* 그룹 머리 안내 (D-18) — 입력은 원천 한 곳 원칙 */}
      <p className="text-[11px] text-[#b0acd6]">
        별지는 입력한 데이터로 자동 생성됩니다 — 입력: 점검표(점검 상세)·설비 대장(1.4)·9호 ③(작성 패널)
      </p>

      {rounds.length === 0 && (
        <p className="text-xs text-[#b0acd6] py-4 text-center">
          자체점검 회차가 없습니다 — 연간 계획 생성 후 자동으로 나타납니다 (<Link href="/inspection-plans" className="text-[#7b68ee] hover:underline">점검계획</Link>)
        </p>
      )}

      {rounds.map(r => {
        const key = roundKey(r)
        const isOpen = expanded.has(key)
        const nb = inspectionNatureBadge(data.inspectionType as InspectionType, r.planType as PlanType | null)
        const pill = statePill(r)
        const done = r.state === 'completed'
        return (
          <div key={key} className={`rounded-xl border ${isOpen ? 'border-[#d0ccf5]' : 'border-[#e8e6f5]'} ${done ? 'bg-[#fafafa]' : 'bg-white'}`}>
            {/* 회차 헤더 */}
            <button onClick={() => { toggle(key); if (!isOpen) prefetchPreviews(r) }} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
              {isOpen ? <ChevronDown className="size-3.5 text-[#b0acd6] shrink-0" /> : <ChevronRight className="size-3.5 text-[#b0acd6] shrink-0" />}
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${nb.className}`}>{nb.label}</span>
              <span className="text-xs font-semibold text-[#090c1d]">{r.year}년 {r.sequenceNum}차</span>
              {r.plannedDate && <span className="text-[11px] text-[#b0acd6]">{r.plannedDate.slice(5, 10)}</span>}
              {r.docs && isOpen && (
                <span
                  role="button" tabIndex={0}
                  onClick={e => { e.stopPropagation(); prefetchPreviews(r); setFullPreview({ inspectionId: r.docs!.inspectionId, label: `${r.year}년 ${r.sequenceNum}차` }) }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); prefetchPreviews(r); setFullPreview({ inspectionId: r.docs!.inspectionId, label: `${r.year}년 ${r.sequenceNum}차` }) } }}
                  className="text-[11px] text-[#7b68ee] border border-[#d0ccf5] rounded-lg px-2 py-0.5 hover:bg-[#f5f4ff] shrink-0 cursor-pointer">
                  🔍 전체 미리보기
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
              <div className="px-4 pb-3"
                onMouseOver={e => {
                  // D-7 호버 퀵뷰 — 데스크톱만, 행 델리게이션(data-hover-doc)
                  if (!r.docs || window.innerWidth < 768) return
                  const row = (e.target as HTMLElement).closest('[data-hover-doc]')
                  if (!row) { setHoverDoc(null); return }
                  const type = row.getAttribute('data-hover-doc') as PreviewDoc['type']
                  const top = row.getBoundingClientRect().top
                  setHoverDoc(prev =>
                    prev && prev.inspectionId === r.docs!.inspectionId && prev.type === type ? prev
                      : { inspectionId: r.docs!.inspectionId, type, top })
                }}
                onMouseLeave={() => setHoverDoc(null)}>
                {r.docs ? (
                  <>
                    {/* 📝 점검표 행 (D-11) — [입력] 원천, 점검 상세 딥링크 */}
                    <div className="flex items-center gap-2 py-1.5 text-xs border-b border-[#f3f1fc]">
                      <ClipboardList className="size-3.5 text-[#7b68ee] shrink-0" />
                      <span className="font-medium text-[#090c1d] w-44">점검표 입력</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#f5f4ff] text-[#7b68ee]">입력</span>
                      <span className="text-[#514b81]">응답 {r.docs.sheetResponses} · 불량 {r.docs.defects.total}</span>
                      <Link href={`/inspections/${r.docs.inspectionId}`} className="ml-auto text-[11px] text-[#7b68ee] hover:underline">
                        점검 상세에서 입력 →
                      </Link>
                    </div>
                    {/* ④ 별지 4호 행 — [자동] 점검표+설비 대장에서 생성 (D-18: 입력 없음) */}
                    <div className="flex items-center gap-2 py-1.5 text-xs border-b border-[#f3f1fc] flex-wrap" data-hover-doc="report4">
                      <span className="font-medium text-[#090c1d] w-44 pl-5">별지 4호 점검표</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">자동</span>
                      {r.docs.report4 ? (
                        <span className="text-[#514b81]">✓ {(r.docs.report4.at ?? '').slice(5, 10)}</span>
                      ) : (
                        <span className="text-amber-600">미생성 — 점검표·설비 대장(1.4)에서 자동</span>
                      )}
                      <span className="ml-auto flex items-center gap-1">
                        {r.docs.report4?.pdf && (
                          <button onClick={() => open(r.docs!.report4!.pdf!.path)} disabled={isPending}
                            className="inline-flex items-center gap-1 h-6 px-2 rounded border border-red-200 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50">PDF</button>
                        )}
                        <button onClick={() => generate(r.docs!.inspectionId, 'report4', `${r.docs!.inspectionId}:r4`)} disabled={isPending}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
                          {r.docs.report4 ? '재생성' : '생성'}
                        </button>
                      </span>
                      {feedback(`${r.docs.inspectionId}:r4`)}
                    </div>
                    {/* 문서 행 — 보고서 센터 InspectionDocRows 재사용 (9호·배치확인서·계약서·사진·10·11호) */}
                    <InspectionDocRows
                      i={r.docs} customerName={data.customerName}
                      isPending={isPending} open={open} generate={generate} upload={upload} feedback={feedback}
                      onCompose={(inspectionId, annexNo) => setCompose({ inspectionId, annexNo })} />
                  </>
                ) : (
                  /* 미시작(계획) 회차 (H-3) */
                  <div className="flex items-center gap-2 py-2 text-xs">
                    <span className="text-[#514b81]">아직 점검 미시작 — 시작하면 점검표·별지 작성이 열립니다</span>
                    <button onClick={() => openStart(r)} disabled={isStarting}
                      className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium disabled:opacity-50">
                      <PlayCircle className="size-3.5" /> 이 회차 시작
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      <button onClick={() => reload()} disabled={isPending}
        className="text-[11px] text-[#b0acd6] hover:text-[#7b68ee] inline-flex items-center gap-1 disabled:opacity-50">
        <RefreshCw className={`size-3 ${isPending ? 'animate-spin' : ''}`} /> 새로고침
      </button>

      {/* D-7 호버 퀵뷰 팝업 — prefetch 캐시 즉시 표시 (렌더 전이면 준비 안내), 클릭 방해 없게 pointer-events-none */}
      {hoverDoc && (() => {
        const doc = (previewCache[hoverDoc.inspectionId] ?? []).find(d => d.type === hoverDoc.type)
        const top = Math.max(8, Math.min(hoverDoc.top, window.innerHeight - 440))
        return (
          <div className="hidden md:block fixed right-4 w-[360px] h-[430px] z-50 pointer-events-none rounded-xl border border-[#d0ccf5] bg-white shadow-2xl overflow-hidden"
            style={{ top }}>
            <p className="px-3 py-1.5 text-[10px] text-[#514b81] bg-[#fafaff] border-b border-[#eeecf8]">
              🔍 {doc?.label ?? '미리보기'} — 퀵뷰 (클릭하면 전체 미리보기)
              {doc && doc.missing.length > 0 && <span className="text-amber-600 ml-1">⚠ 미입력 {doc.missing.length}곳</span>}
            </p>
            {doc?.html ? (
              <iframe srcDoc={doc.html} title="호버 퀵뷰" className="w-full h-full bg-white" />
            ) : (
              <p className="p-4 text-[11px] text-[#b0acd6]">미리보기 준비 중… (렌더가 끝나면 즉시 표시됩니다)</p>
            )}
          </div>
        )
      })()}

      {/* 별지 작성 패널 — 문서 작업대와 동일 컴포넌트 (H-24 재사용) */}
      {compose && (
        <AnnexComposePanel
          inspectionId={compose.inspectionId}
          annexNo={compose.annexNo}
          customerId={customerId}
          onClose={() => setCompose(null)}
          onGenerated={() => reload()}
        />
      )}

      {/* H-5c 회차 전체 미리보기 — 전 별지 세로 연결 + 요약 바(미입력 집계·점프) */}
      {fullPreview && (() => {
        const docsForPreview = previewCache[fullPreview.inspectionId] ?? []
        const allLoaded = docsForPreview.length > 0 && docsForPreview.every(d => d.html || d.error)
        const totalMissing = docsForPreview.reduce((n, d) => n + d.missing.length, 0)
        const curRound = rounds.find(r => r.docs?.inspectionId === fullPreview.inspectionId)
        const certMissing = curRound?.docs ? !curRound.docs.cert : false
        return (
          <>
            <div className="fixed inset-0 bg-black/40 z-[60]" onClick={() => setFullPreview(null)} />
            <div className="fixed inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 top-6 bottom-6 md:w-[860px] bg-white rounded-2xl shadow-2xl z-[70] flex flex-col">
              {/* 요약 바 (고정 상단) */}
              <div className="px-5 py-3 border-b border-[#e0ddf5] shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-[#090c1d]">{fullPreview.label} — 전체 미리보기</p>
                  <button onClick={() => setFullPreview(null)} className="ml-auto text-[#b0acd6] hover:text-[#514b81]">✕</button>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px]">
                  {docsForPreview.map(d => (
                    <button key={d.type}
                      onClick={() => document.getElementById(`fp-${d.type}`)?.scrollIntoView({ behavior: 'smooth' })}
                      className={`px-2 py-0.5 rounded-full border ${d.missing.length > 0 ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                      {d.label.replace(' 점검표', '').replace(' 실시결과 보고서', '').replace(' 이행계획서', '').replace(' 이행완료 보고서', '')} {d.missing.length > 0 ? `⚠${d.missing.length}곳` : '✓'}
                    </button>
                  ))}
                  <span className={`px-2 py-0.5 rounded-full border ${certMissing ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                    배치확인서 {certMissing ? '⚠없음' : '✓'}
                  </span>
                  {allLoaded && totalMissing === 0 && !certMissing && (
                    <span className="text-green-700 font-medium">✅ 제출 준비 완료 — 빈칸 없음</span>
                  )}
                  {allLoaded && totalMissing > 0 && (
                    <span className="text-[#b0acd6]">미입력 총 {totalMissing}곳 — 본문 노란 하이라이트 확인</span>
                  )}
                </div>
              </div>
              {/* 본문 — 문서별 렌더 세로 연결 (생성물과 동일 렌더·미입력 하이라이트) */}
              <div className="flex-1 overflow-y-auto bg-[#f3f4f6] p-4 space-y-4">
                {!allLoaded && (
                  <p className="text-xs text-[#514b81] inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> 미리보기 렌더 중…</p>
                )}
                {docsForPreview.map(d => (
                  <div key={d.type} id={`fp-${d.type}`}>
                    <p className="text-xs font-semibold text-[#514b81] mb-1.5">▌{d.label} {d.missing.length > 0 && <span className="text-amber-600">⚠ 미입력 {d.missing.length}곳: {d.missing.slice(0, 4).join(' · ')}{d.missing.length > 4 ? ' …' : ''}</span>}</p>
                    {d.error ? (
                      <p className="text-xs text-red-600 bg-white rounded-lg p-3">{d.error}</p>
                    ) : d.html ? (
                      <iframe srcDoc={d.html} title={d.label} className="w-full h-[540px] bg-white rounded-lg border border-[#e0ddf5]" />
                    ) : (
                      <div className="h-24 bg-white rounded-lg border border-[#e0ddf5] animate-pulse" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      })()}

      {/* H-3 점검일 확정 모달 — 확정=자동 시작 (confirmPlanItemStageOneAction) */}
      {startModal && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => !isStarting && setStartModal(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] bg-white rounded-2xl shadow-2xl z-[70] p-5">
            <p className="font-semibold text-sm text-[#090c1d]">{startModal.label} 점검을 시작합니다</p>
            <p className="text-xs text-[#514b81] mt-1">점검일을 확정하면 점검이 자동 시작되고 6단계 마감일이 계산됩니다.</p>
            <div className="mt-3">
              <label className="text-xs font-medium text-[#514b81]">점검일</label>
              <DateInput value={startDate} onChange={e => setStartDate(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-[#d0ccf5] px-2 text-sm" />
            </div>
            {startErr && <p className="text-[11px] text-red-600 mt-2">{startErr}</p>}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setStartModal(null)} disabled={isStarting}
                className="h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f8f9fa] disabled:opacity-50">취소</button>
              <button onClick={runStart} disabled={isStarting}
                className="h-8 px-3.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1">
                {isStarting ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />} 확정·시작
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
