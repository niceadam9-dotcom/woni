'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2, Search, Star } from 'lucide-react'
import { searchCustomersForPlanAction } from '@/app/(dashboard)/fire-plans/generate/actions'
import {
  previewPlanTextsFromCustomerAction, importPlanTextsFromCustomerAction,
  type PlanTextImportPreviewRow,
} from '@/app/(dashboard)/customers/plan-text-library-actions'

/** [고객에서 불러오기] (소방계획서_21 R1-8, D1-6)
 *
 *  도입 시 8섹션을 채우는 가장 빠른 길이다 — 빈 화면에 타이핑하는 대신 잘 작성된 고객 하나를 통째로 승격한다.
 *  미리보기는 서버가 pick을 태운 결과라, 고객 고유 필드(일시·장소·인원·집결지)는 이 시점에 이미 빠져 있다. */

type PickState = { checked: boolean; title: string; makeDefault: boolean }

export function PlanTextImportDialog({ onClose, onDone }: {
  onClose: () => void
  onDone: (created: number) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([])
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [rows, setRows] = useState<PlanTextImportPreviewRow[] | null>(null)
  const [state, setState] = useState<Record<string, PickState>>({})
  const [err, setErr] = useState('')
  const [isBusy, startBusy] = useTransition()

  // 고객 검색 — 300ms 디바운스 (점검표 빠른 입력과 같은 패턴)
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) { setResults([]); return }
      searchCustomersForPlanAction(q)
        .then(r => setResults(r.customers.map(c => ({ id: c.id, name: c.name }))))
        .catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  function choose(c: { id: string; name: string }) {
    setPicked(c); setRows(null); setErr('')
    startBusy(async () => {
      const res = await previewPlanTextsFromCustomerAction(c.id)
      if (res.error || !res.rows) { setErr(res.error ?? '미리보기 실패'); return }
      setRows(res.rows)
      // 서술이 있는 섹션만 기본 체크 — 빈 섹션을 등록하면 자동주입이 빈 값을 채우는 셈이다
      setState(Object.fromEntries(res.rows.map(r => [
        r.sectionKey,
        { checked: !r.empty, title: `${c.name} ${r.label.replace(/^[\d.]+\s*/, '')}`, makeDefault: false },
      ])))
    })
  }

  function run() {
    if (!picked || !rows) return
    const picks = rows
      .filter(r => state[r.sectionKey]?.checked && !r.empty)
      .map(r => ({ sectionKey: r.sectionKey, title: state[r.sectionKey].title, makeDefault: state[r.sectionKey].makeDefault }))
    if (picks.length === 0) { setErr('가져올 섹션을 하나 이상 선택해주세요.'); return }
    setErr('')
    startBusy(async () => {
      const res = await importPlanTextsFromCustomerAction(picked.id, picks)
      if (res.error) { setErr(res.error); return }
      onDone(res.created?.length ?? 0)
    })
  }

  const selectable = (rows ?? []).filter(r => !r.empty)
  const checkedCount = selectable.filter(r => state[r.sectionKey]?.checked).length

  return (
    <>
      <div className="fixed inset-0 bg-black/40 dark:bg-black/60 z-[60]" onClick={() => !isBusy && onClose()} />
      <div className="fixed inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 top-8 bottom-8 md:w-[760px] bg-surface rounded-2xl shadow-2xl z-[70] flex flex-col">
        <div className="px-5 py-3 border-b border-brand-line-soft shrink-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm text-ink">고객에서 불러오기</p>
            <button onClick={onClose} disabled={isBusy} className="ml-auto text-ink-faint hover:text-ink-sub disabled:opacity-50">✕</button>
          </div>
          <p className="mt-1 text-[11px] text-ink-soft">
            잘 작성된 고객의 서술 8섹션을 공통문구로 승격합니다. 일시·장소·인원 같은 고객 고유 값은 자동으로 제외됩니다.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
            <input value={picked ? picked.name : q} disabled={isBusy}
              onChange={e => { setPicked(null); setRows(null); setQ(e.target.value) }}
              placeholder="고객명 2자 이상 입력"
              className="h-9 w-full rounded-lg border border-brand-line pl-8 pr-3 text-sm outline-none focus:border-brand" />
          </div>

          {!picked && results.length > 0 && (
            <div className="rounded-lg border border-brand-line-soft divide-y divide-brand-tint max-h-48 overflow-y-auto">
              {results.map(c => (
                <button key={c.id} onClick={() => choose(c)}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-brand-tint">{c.name}</button>
              ))}
            </div>
          )}

          {isBusy && !rows && <p className="text-xs text-ink-sub inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> 불러오는 중…</p>}

          {rows && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-ink-soft">
                서술이 있는 섹션 {selectable.length}개 · 선택 {checkedCount}개
                {rows.length - selectable.length > 0 && <span className="text-ink-meta"> (빈 섹션 {rows.length - selectable.length}개는 가져올 수 없습니다)</span>}
              </p>
              {rows.map(r => {
                const st = state[r.sectionKey]
                return (
                  <div key={r.sectionKey} className={`rounded-lg border px-3 py-2 ${r.empty ? 'border-brand-line-soft bg-paper' : 'border-brand-line-soft'}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input type="checkbox" disabled={r.empty || isBusy} checked={!!st?.checked}
                        onChange={e => setState(s => ({ ...s, [r.sectionKey]: { ...s[r.sectionKey], checked: e.target.checked } }))}
                        className="size-3.5" />
                      <span className="text-xs font-medium text-ink">{r.label}</span>
                      {r.empty
                        ? <span className="text-[10px] text-ink-meta">이 고객에 서술 없음</span>
                        : <span className="text-[11px] text-ink-soft truncate max-w-[22rem]">{r.preview}</span>}
                    </div>
                    {!r.empty && st?.checked && (
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap pl-6">
                        <input value={st.title} disabled={isBusy}
                          onChange={e => setState(s => ({ ...s, [r.sectionKey]: { ...s[r.sectionKey], title: e.target.value } }))}
                          placeholder="항목 이름"
                          className="h-7 flex-1 basis-52 min-w-0 rounded border border-brand-line px-2 text-[11px] outline-none focus:border-brand" />
                        <label className="inline-flex items-center gap-1 text-[10px] text-ink-soft cursor-pointer">
                          <input type="checkbox" disabled={isBusy} checked={st.makeDefault}
                            onChange={e => setState(s => ({ ...s, [r.sectionKey]: { ...s[r.sectionKey], makeDefault: e.target.checked } }))}
                            className="size-3" />
                          <Star className="size-3 text-amber-500" /> 기본으로
                        </label>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-brand-line-soft shrink-0 flex items-center gap-2">
          <p className="text-[10px] text-ink-meta">기존 항목을 덮어쓰지 않고 새 항목으로 등록합니다.</p>
          <button onClick={onClose} disabled={isBusy}
            className="ml-auto h-8 px-3 rounded-lg border border-brand-line text-xs text-ink-sub hover:bg-paper disabled:opacity-50">취소</button>
          <button onClick={run} disabled={isBusy || checkedCount === 0}
            className="h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1">
            {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null} {checkedCount}개 등록
          </button>
        </div>
      </div>
    </>
  )
}
