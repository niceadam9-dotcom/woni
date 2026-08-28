'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, Copy, Download, Loader2, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import {
  listPlanTextLibraryAction, getPlanTextUsageAction,
  savePlanTextAction, renamePlanTextAction, setPlanTextDefaultAction, deletePlanTextAction,
  type PlanTextLibraryEntry, type PlanTextUsageRow,
} from '@/app/(dashboard)/customers/plan-text-library-actions'
import { PLAN_TEXT_CHAPTERS, emptyPlanTextBody, planTextBodyEquals, planTextBodyIsEmpty, type PlanTextSectionDef } from '@/lib/plan-text-sections'
import { PlanTextBodyEditor } from '@/components/customers/plan-text-body-editor'
import { PlanTextImportDialog } from '@/components/customers/plan-text-import-dialog'

/** 계획서 공통문구 관리 — '표준 계획서 한 장' (소방계획서_21 R1, D1-5)
 *
 *  3단 트리가 아니라 8섹션을 세로로 이어 붙인 단일 문서다. 전체 항목이 10~25개라 감출 것이 없고,
 *  가장 잦은 일이 '도입 시 8섹션 채우기'인데 트리는 한 번에 하나만 보여준다.
 *  화면의 최대 가치는 ⭐/○ — 기본문구가 없는 섹션에서는 신규 고객 자동주입이 조용히 아무 일도 하지 않는다. */

type Draft = { title: string; body: unknown }

export function PlanTextLibraryPage({ initialSection }: { initialSection?: string }) {
  const [entries, setEntries] = useState<PlanTextLibraryEntry[] | null>(null)
  const [noDefault, setNoDefault] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [isLoading, startLoading] = useTransition()
  const [isBusy, startBusy] = useTransition()
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null)
  /** 섹션별 현재 선택 항목(대안 문구 전환 — R1-6) */
  const [selected, setSelected] = useState<Record<string, string>>({})
  /** 섹션별 편집 중 초안 — 저장 전까지 서버에 보내지 않는다 */
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const [usage, setUsage] = useState<Record<string, PlanTextUsageRow[]>>({})
  const [importOpen, setImportOpen] = useState(false)
  const scrolledRef = useRef(false)

  const load = useCallback((keepDraft = false) => {
    startLoading(async () => {
      const res = await listPlanTextLibraryAction()
      if (res.error || !res.data) { setErr(res.error ?? '조회 실패'); return }
      setErr(null)
      setEntries(res.data.entries)
      setNoDefault(res.data.sectionsWithoutDefault)
      if (!keepDraft) setDraft({})
      // 섹션별 선택은 ⭐기본 → 첫 항목 순으로 초기화(이미 고른 섹션은 유지)
      setSelected(prev => {
        const next = { ...prev }
        for (const g of PLAN_TEXT_CHAPTERS) {
          for (const def of g.sections) {
            const list = res.data!.entries.filter(e => e.sectionKey === def.key)
            if (next[def.key] && list.some(e => e.id === next[def.key])) continue
            const pick = list.find(e => e.isDefault) ?? list[0]
            if (pick) next[def.key] = pick.id
            else delete next[def.key]
          }
        }
        return next
      })
    })
  }, [])

  useEffect(() => { load() }, [load])

  // ?section={key} 딥링크 — 서식 팝오버의 '전체 관리 ↗'가 새 탭으로 연다 (R1-10 ②)
  useEffect(() => {
    if (scrolledRef.current || !entries || !initialSection) return
    const el = document.getElementById(`sec-${initialSection}`)
    if (!el) return
    scrolledRef.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [entries, initialSection])

  const bySection = useMemo(() => {
    const m: Record<string, PlanTextLibraryEntry[]> = {}
    for (const e of entries ?? []) (m[e.sectionKey] ??= []).push(e)
    return m
  }, [entries])

  const notify = (key: string, text: string, ok = true) => setMsg({ key, text, ok })

  function currentEntry(sectionKey: string): PlanTextLibraryEntry | undefined {
    const id = selected[sectionKey]
    return (bySection[sectionKey] ?? []).find(e => e.id === id)
  }
  function draftOf(sectionKey: string): Draft | null {
    const cur = currentEntry(sectionKey)
    if (!cur) return null
    return draft[sectionKey] ?? { title: cur.title, body: cur.body }
  }
  function setDraftFor(sectionKey: string, patch: Partial<Draft>) {
    const base = draftOf(sectionKey)
    if (!base) return
    setDraft(d => ({ ...d, [sectionKey]: { ...base, ...patch } }))
  }
  function isDirty(sectionKey: string): boolean {
    const cur = currentEntry(sectionKey)
    const d = draft[sectionKey]
    if (!cur || !d) return false
    return d.title !== cur.title || !planTextBodyEquals(d.body, cur.body)
  }

  /** 섹션 독립 저장 (R1-5) — 이름만 바뀌었으면 renamePlanTextAction(version 미증가 규약) */
  function save(sectionKey: string) {
    const cur = currentEntry(sectionKey)
    const d = draft[sectionKey]
    if (!cur || !d) return
    const nameChanged = d.title !== cur.title
    const bodyChanged = !planTextBodyEquals(d.body, cur.body)
    if (!nameChanged && !bodyChanged) { notify(sectionKey, '변경된 내용이 없습니다.', false); return }
    startBusy(async () => {
      if (bodyChanged) {
        // savePlanTextAction은 서버에서 pick을 다시 태운다 — 멱등이라 편집한 body를 그대로 넘겨도 된다
        const res = await savePlanTextAction(sectionKey, d.title, d.body, cur.id)
        if (res.error) { notify(sectionKey, `❌ ${res.error}`, false); return }
      } else {
        const res = await renamePlanTextAction(cur.id, d.title)
        if (res.error) { notify(sectionKey, `❌ ${res.error}`, false); return }
      }
      setDraft(x => { const n = { ...x }; delete n[sectionKey]; return n })
      notify(sectionKey, bodyChanged ? '✅ 저장됨 (개정 +1)' : '✅ 이름 변경됨 (개정 유지)')
      load(true)
    })
  }

  function makeDefault(sectionKey: string, id: string) {
    startBusy(async () => {
      const res = await setPlanTextDefaultAction(id, true)
      if (res.error) { notify(sectionKey, `❌ ${res.error}`, false); return }
      notify(sectionKey, '⭐ 기본문구로 지정 — 이후 신규 고객에 자동 주입됩니다')
      load(true)
    })
  }

  function remove(sectionKey: string, e: PlanTextLibraryEntry) {
    // 삭제·기본변경 시 사용처 건수를 함께 보여준다 (D1-2)
    const warn = e.usageCount > 0
      ? `\n\n이미 ${e.usageCount}개 고객이 가져갔습니다. 가져간 내용은 그대로 남고, 앞으로 목록에서만 사라집니다.`
      : ''
    if (!window.confirm(`'${e.title}'을(를) 삭제할까요?${warn}`)) return
    startBusy(async () => {
      const res = await deletePlanTextAction(e.id)
      if (res.error) { notify(sectionKey, `❌ ${res.error}`, false); return }
      setSelected(s => { const n = { ...s }; delete n[sectionKey]; return n })
      notify(sectionKey, '삭제되었습니다.')
      load(true)
    })
  }

  /** 빈 섹션이 있는지 — 상단 [새로 만들기](일괄)의 대상 */
  const emptySections = PLAN_TEXT_CHAPTERS.flatMap(g => g.sections).filter(d => (bySection[d.key] ?? []).length === 0)

  /** [새로 만들기] — 문구가 없는 섹션에 빈 문서를 **한 번에** 만든다.
   *  이 화면의 가장 잦은 일이 '도입 시 8섹션 채우기'이고 [고객에서 불러오기]도 여러 섹션을 한 번에
   *  등록한다 — 그 짝이 되도록 일괄로 둔다. 섹션마다 눌러 이름을 8번 묻는 구조는 도입을 방해했다.
   *  ⭐ 기본 지정은 하지 않는다 — 내용이 빈 채로 '기본문구 있음'이 되면 요약 바가 거짓말을 한다. */
  function createAll() {
    if (emptySections.length === 0) return
    if (!window.confirm(`문구가 없는 ${emptySections.length}개 섹션에 빈 문구를 만듭니다.\n(${emptySections.map(d => d.label).join(' · ')})\n\n만든 뒤 내용을 채우고 [이 섹션 저장] → [기본으로]를 눌러야 신규 고객 자동주입 대상이 됩니다.`)) return
    startBusy(async () => {
      const made: string[] = []
      const failed: string[] = []
      for (const def of emptySections) {
        const res = await savePlanTextAction(def.key, '기본 문구', emptyPlanTextBody(def))
        if (res.error) { failed.push(`${def.label}: ${res.error}`); continue }
        made.push(def.label)
        if (res.id) setSelected(s => ({ ...s, [def.key]: res.id! }))
      }
      setDraft({})
      notify('bulk',
        failed.length === 0
          ? `✅ ${made.length}개 섹션에 빈 문구를 만들었습니다 — 위에서부터 내용을 채우세요`
          : `⚠ ${made.length}개 생성 · ${failed.length}개 실패 (${failed.join(' / ')})`,
        failed.length === 0)
      load(true)
    })
  }

  /** 섹션별 [새로 만들기] — 이미 문구가 있는 섹션에 **대안 문구를 하나 더** 추가한다.
   *  빈 섹션은 상단 일괄 버튼이 담당하므로 여기 버튼은 항목이 있을 때만 노출한다(같은 일을 하는 버튼 9개 방지). */
  function create(def: PlanTextSectionDef) {
    const name = window.prompt(`'${def.label}' 새 문구 이름`, '대안 문구')?.trim()
    if (!name) return
    startBusy(async () => {
      const res = await savePlanTextAction(def.key, name, emptyPlanTextBody(def))
      if (res.error) { notify(def.key, `❌ ${res.error}`, false); return }
      if (res.id) setSelected(s => ({ ...s, [def.key]: res.id! }))
      setDraft(x => { const n = { ...x }; delete n[def.key]; return n })
      notify(def.key, `✅ '${name}' 생성 — 아래에 내용을 입력한 뒤 [이 섹션 저장]을 누르세요`)
      load(true)
    })
  }

  /** [복제] (R1-9) — 신규 액션 없이 현재 본문을 새 이름으로 등록 */
  function duplicate(sectionKey: string) {
    const cur = currentEntry(sectionKey)
    const d = draftOf(sectionKey)
    if (!cur || !d) return
    const name = window.prompt('복제본 이름', `${cur.title} 사본`)?.trim()
    if (!name) return
    startBusy(async () => {
      const res = await savePlanTextAction(sectionKey, name, d.body)
      if (res.error) { notify(sectionKey, `❌ ${res.error}`, false); return }
      if (res.id) setSelected(s => ({ ...s, [sectionKey]: res.id! }))
      setDraft(x => { const n = { ...x }; delete n[sectionKey]; return n })
      notify(sectionKey, `✅ '${name}' 복제됨 — 원본은 그대로입니다`)
      load(true)
    })
  }

  function toggleUsage(id: string) {
    if (usage[id]) { setUsage(u => { const n = { ...u }; delete n[id]; return n }); return }
    startBusy(async () => {
      const res = await getPlanTextUsageAction(id)
      if (res.error) { notify(id, `❌ ${res.error}`, false); return }
      setUsage(u => ({ ...u, [id]: res.rows ?? [] }))
    })
  }

  if (err) return <p className="py-6 text-sm text-red-600">{err} — 권한이 없거나 일시 오류입니다.</p>
  if (!entries) {
    return <p className="py-6 text-sm text-ink-faint inline-flex items-center gap-1.5"><Loader2 className="size-4 animate-spin" /> 공통문구를 불러오는 중…</p>
  }

  const emptyCount = noDefault.length

  return (
    <div className="flex gap-5 items-start">
      {/* 좌측 목차 — 장 → 섹션 2단 점프 (R1-2). ⭐/○로 기본문구 유무를 한눈에 (R1-3) */}
      <aside className="hidden lg:block w-56 shrink-0 sticky top-2 rounded-xl border border-brand-line-soft bg-brand-tint p-2 space-y-2">
        {PLAN_TEXT_CHAPTERS.map(g => (
          <div key={g.chapter}>
            <p className="px-2 py-1 text-[10px] font-bold text-ink-soft">{g.chapter}</p>
            {g.sections.map(def => {
              const has = !noDefault.includes(def.key)
              const n = (bySection[def.key] ?? []).length
              return (
                <a key={def.key} href={`#sec-${def.key}`}
                  className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-[11px] text-ink-sub hover:bg-brand-tint">
                  <span className={has ? 'text-amber-500' : 'text-ink-faint'}>{has ? '⭐' : '○'}</span>
                  <span className="truncate">{def.label}</span>
                  <span className="ml-auto text-[10px] text-ink-faint">{n}</span>
                </a>
              )
            })}
          </div>
        ))}
      </aside>

      <div className="flex-1 min-w-0 space-y-4">
        {/* 요약 바 — 이 화면의 최대 가치를 맨 위에 (R1-3) */}
        {/* 버튼 3종을 한 줄에 나란히, 안내 문구는 그 아래로 (2026-08-13 사용자 요청) —
            종전에는 문구와 버튼이 같은 줄이라 문구가 길면 버튼이 줄바꿈돼 흩어졌다 */}
        <div className="rounded-xl border border-brand-line-soft bg-surface px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            {/* 도입 동선 두 갈래를 나란히 — 가져와서 시작 / 빈 문서로 시작. 둘 다 여러 섹션을 한 번에 다룬다 */}
            <button onClick={() => setImportOpen(true)} disabled={isBusy}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-brand hover:bg-brand-strong text-white text-[11px] font-medium whitespace-nowrap disabled:opacity-50">
              <Download className="size-3.5" /> 고객에서 불러오기
            </button>
            <button onClick={createAll} disabled={isBusy || emptySections.length === 0}
              title={emptySections.length === 0
                ? '모든 섹션에 문구가 있습니다 — 하나 더 추가하려면 섹션의 [새로 만들기]를 쓰세요'
                : `문구가 없는 ${emptySections.length}개 섹션에 빈 문서를 한 번에 만듭니다`}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-brand-line text-[11px] font-medium text-ink-sub hover:bg-brand-tint whitespace-nowrap disabled:opacity-40">
              <Plus className="size-3.5" /> 새로 만들기{emptySections.length > 0 ? ` (${emptySections.length})` : ''}
            </button>
            <button onClick={() => load()} disabled={isLoading}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-brand-line text-[11px] text-ink-sub hover:bg-brand-tint whitespace-nowrap disabled:opacity-50">
              <RefreshCw className={`size-3 ${isLoading ? 'animate-spin' : ''}`} /> 새로고침
            </button>
          </div>
          {emptyCount > 0 ? (
            <p className="text-xs text-amber-700">
              ⚠ 기본문구가 없는 섹션 <b>{emptyCount}개</b> — 이 섹션은 신규 고객이 들어와도 자동으로 채워지지 않습니다.
              <span className="text-ink-soft"> ({noDefault.map(k => sectionLabel(k)).join(' · ')})</span>
            </p>
          ) : (
            <p className="text-xs text-green-700">✅ 8섹션 모두 기본문구가 있습니다 — 신규 고객 진입 시 자동 주입됩니다.</p>
          )}
        </div>

        {PLAN_TEXT_CHAPTERS.map(g => (
          <div key={g.chapter} className="space-y-4">
            <p className="text-[11px] font-bold text-ink-soft pt-1">{g.chapter}</p>
            {g.sections.map(def => {
              const list = bySection[def.key] ?? []
              const cur = currentEntry(def.key)
              const d = draftOf(def.key)
              const dirty = isDirty(def.key)
              const hasDefault = !noDefault.includes(def.key)
              return (
                <section key={def.key} id={`sec-${def.key}`} className="scroll-mt-4 rounded-xl border border-line bg-surface">
                  {/* 섹션 헤더 — 대안 문구 드롭다운 + ⭐ 승격 (R1-6) */}
                  <div className="flex items-center gap-2 flex-wrap border-b border-brand-tint px-4 py-2.5">
                    <span className={hasDefault ? 'text-amber-500' : 'text-ink-faint'}>{hasDefault ? '⭐' : '○'}</span>
                    <h2 className="text-sm font-semibold text-ink">{def.label}</h2>
                    {!hasDefault && <span className="text-[10px] text-amber-600">기본문구 없음 — 자동주입 대상 아님</span>}

                    {list.length > 0 && (
                      <div className="relative ml-2">
                        <select value={selected[def.key] ?? ''}
                          onChange={e => { setSelected(s => ({ ...s, [def.key]: e.target.value })); setDraft(x => { const n = { ...x }; delete n[def.key]; return n }) }}
                          className="h-7 appearance-none rounded-lg border border-brand-line bg-surface pl-2 pr-6 text-[11px] text-ink-sub outline-none focus:border-brand">
                          {list.map(e => (
                            <option key={e.id} value={e.id}>{e.isDefault ? '⭐ ' : ''}{e.title} (v{e.version})</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 size-3 text-ink-faint" />
                      </div>
                    )}

                    {/* 빈 섹션은 상단 일괄 버튼이 담당한다 — 여기는 '대안 문구 하나 더'용 */}
                    {list.length > 0 && (
                      <button onClick={() => create(def)} disabled={isBusy}
                        title="이 섹션에 대안 문구를 하나 더 만듭니다 (빈 문서로 시작)"
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-brand-line text-[11px] text-ink-sub hover:bg-brand-tint disabled:opacity-50">
                        <Plus className="size-3" /> 새로 만들기
                      </button>
                    )}

                    {cur && !cur.isDefault && (
                      <button onClick={() => makeDefault(def.key, cur.id)} disabled={isBusy}
                        title="이 문구를 신규 고객 자동주입 대상으로 지정합니다 (섹션당 1개)"
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-amber-300 bg-amber-50 text-[11px] text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                        <Star className="size-3" /> 기본으로
                      </button>
                    )}
                    {cur && (
                      <>
                        <button onClick={() => duplicate(def.key)} disabled={isBusy}
                          title="현재 본문을 새 이름으로 복제 — 원본 개정은 올라가지 않습니다"
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-brand-line text-[11px] text-ink-sub hover:bg-brand-tint disabled:opacity-50">
                          <Copy className="size-3" /> 복제
                        </button>
                        <button onClick={() => remove(def.key, cur)} disabled={isBusy}
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-brand-line text-[11px] text-ink-sub hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                          <Trash2 className="size-3" /> 삭제
                        </button>
                      </>
                    )}
                  </div>

                  <div className="px-4 py-3 space-y-3">
                    {/* 알림은 cur 바깥에 — 섹션의 마지막 항목을 지우면 cur이 사라져 '삭제되었습니다'가
                        같이 증발한다(E2E에서 발견). 결과 메시지는 항목 유무와 무관해야 한다 */}
                    {msg?.key === def.key && (
                      <p className={`text-[11px] ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
                    )}
                    {!cur ? (
                      <p className="text-xs text-ink-soft">
                        등록된 문구가 없습니다 — 맨 위 <b className="text-brand">[새로 만들기]</b>로 빈 섹션을 한 번에 만들거나,
                        <b className="text-brand">[고객에서 불러오기]</b>로 잘 작성된 고객에서 가져오세요. 서식 화면의 [공통으로 등록]으로 올릴 수도 있습니다.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 flex-wrap">
                          <label className="text-[11px] font-medium text-ink-sub">항목 이름</label>
                          <input value={d?.title ?? ''} disabled={isBusy}
                            onChange={e => setDraftFor(def.key, { title: e.target.value })}
                            className="h-8 flex-1 basis-48 min-w-0 rounded-lg border border-brand-line px-2.5 text-xs outline-none focus:border-brand" />
                          <span className="text-[10px] text-ink-faint">개정 v{cur.version} · {cur.updatedAt}</span>
                        </div>

                        <PlanTextBodyEditor def={def} value={d?.body} disabled={isBusy}
                          onChange={next => setDraftFor(def.key, { body: next })} />

                        {d && planTextBodyIsEmpty(def.key, d.body) && (
                          <p className="text-[11px] text-amber-600">⚠ 내용이 비어 있습니다 — 이대로 저장하면 자동주입이 아무 값도 채우지 않습니다.</p>
                        )}

                        <div className="flex items-center gap-2 flex-wrap">
                          <button onClick={() => save(def.key)} disabled={isBusy || !dirty}
                            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-brand hover:bg-brand-strong text-white text-[11px] font-medium disabled:opacity-40">
                            {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} 이 섹션 저장
                          </button>
                          {dirty && <span className="text-[11px] text-amber-600">저장하지 않은 변경이 있습니다</span>}
                          <button onClick={() => toggleUsage(cur.id)} disabled={isBusy}
                            className="ml-auto text-[11px] text-brand hover:underline disabled:opacity-50">
                            사용처 {cur.usageCount}곳{cur.staleCount > 0 ? ` · 개정됨 ${cur.staleCount}` : ''} {usage[cur.id] ? '접기' : '보기'}
                          </button>
                        </div>

                        {/* 사용처 목록 (R1-7) — 조회 전용. 일괄 반영 버튼은 만들지 않는다(D1-4) */}
                        {usage[cur.id] && (
                          <div className="rounded-lg border border-brand-tint bg-brand-tint p-2">
                            {usage[cur.id].length === 0 ? (
                              <p className="text-[11px] text-ink-faint">아직 가져간 고객이 없습니다.</p>
                            ) : (
                              <div className="space-y-1">
                                {usage[cur.id].map(u => (
                                  <div key={`${u.customerId}-${u.appliedAt}`} className="flex items-center gap-2 text-[11px]">
                                    <Link href={`/customers/${u.customerId}?tab=plan&form=${formAnchor(def.key)}`}
                                      className="text-brand hover:underline truncate max-w-[14rem]">{u.customerName}</Link>
                                    <span className="text-[10px] text-ink-soft">{u.source === 'default' ? '자동주입' : '가져오기'}</span>
                                    <span className="text-[10px] text-ink-faint">v{u.version} · {u.appliedAt}</span>
                                    {u.stale && (
                                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
                                        title="가져간 뒤 공통문구가 개정되었습니다 — 반영은 고객 화면에서 개별로">개정됨</span>
                                    )}
                                  </div>
                                ))}
                                <p className="pt-1 text-[10px] text-ink-faint">조회 전용 — 일괄 덮어쓰기는 제공하지 않습니다(제출 문서·고객 수정분 보호).</p>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        ))}
      </div>

      {importOpen && (
        <PlanTextImportDialog
          onClose={() => setImportOpen(false)}
          onDone={n => { setImportOpen(false); notify('import', `✅ ${n}개 섹션을 등록했습니다.`); load() }} />
      )}
    </div>
  )
}

function sectionLabel(key: string): string {
  for (const g of PLAN_TEXT_CHAPTERS) {
    const d = g.sections.find(s => s.key === key)
    if (d) return d.label
  }
  return key
}

/** 사용처 → 고객 서식 딥링크 (R1-10 ③) — 섹션이 실제로 입력되는 서식 노드로 보낸다 */
function formAnchor(sectionKey: string): string {
  switch (sectionKey) {
    case 'training': return '1.11'
    case 'fireworkLog': case 'constructionLog': case 'promoLog': case 'recoveryLog': return '1.12'
    case 'brigadeTeams': return 'ch2'
    default: return 'ch3'
  }
}
