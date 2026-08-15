'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, ChevronDown, Loader2, Package } from 'lucide-react'
import { getBundleChecklistAction, generateBundleAction } from '@/app/(dashboard)/inspections/bundle-actions'
import type { BundleChecklist, BundleGenResult } from '@/lib/bundle-status'
import type { AnnexType } from '@/app/(dashboard)/inspections/report9-actions'

/** [번들 생성] 원클릭 패널 (소방계획서_22 S13 — Q-13)
 *
 *  동선: 펼치면 구성요소 체크리스트(S13-4 — ✓ 최신 / ⚠stale / ✗미생성)와 시트별 공란
 *  사전 리포트(S13-3 — 경고만, 진행은 사용자 선택)를 보여주고, [필요분 생성] 또는
 *  [전체 재생성]으로 병렬 생성(S13-2) 후 병합 라우트(/bundle)를 연다. */
export function BundleGeneratePanel({ inspectionId, disabled }: { inspectionId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [cl, setCl] = useState<BundleChecklist | null>(null)
  const [results, setResults] = useState<BundleGenResult[] | null>(null)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function load() {
    startTransition(async () => {
      const res = await getBundleChecklistAction(inspectionId)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setCl(res.checklist ?? null)
      setMsg('')
    })
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && !cl) load()
  }

  function generate(types: AnnexType[]) {
    if (!types.length) { setMsg('이미 전부 최신입니다 — 재생성할 문서가 없습니다.'); return }
    setResults(null)
    startTransition(async () => {
      const res = await generateBundleAction(inspectionId, types)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setResults(res.results ?? [])
      const failed = (res.results ?? []).filter(r => !r.ok)
      setMsg(failed.length ? `⚠ ${failed.length}건 실패 — 아래 상세 확인` : '✅ 생성 완료 — [번들 열기]로 병합본을 확인하세요.')
      // 생성 직후 체크리스트 갱신 — stale 뱃지가 그대로 남으면 방금 누른 사람이 혼란스럽다
      const re = await getBundleChecklistAction(inspectionId)
      if (!re.error) setCl(re.checklist ?? null)
    })
  }

  const staleTypes = (cl?.items ?? []).filter(i => i.stale).map(i => i.type)
  const allTypes = (cl?.items ?? []).map(i => i.type)
  const fmt = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(5, 16) : '')

  return (
    <div className="rounded-lg border border-[#eceafd]">
      <button onClick={toggle} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#514b81] hover:text-[#7b68ee]"
        data-testid="bundle-panel-toggle">
        <Package className="size-3.5" /> 번들 생성 (공문→표지→본문 일괄)
        <ChevronDown className={`ml-auto size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-[#f3f1fc] px-2.5 py-2 text-[11px]">
          {isPending && !cl && <p className="flex items-center gap-1 text-[#b0acd6]"><Loader2 className="size-3 animate-spin" /> 상태 확인 중…</p>}
          {cl && (<>
            {/* 구성요소 체크리스트 (S13-4) — [번들 생성]의 대상 미리보기를 겸한다 */}
            <ul className="space-y-0.5" data-testid="bundle-checklist">
              {cl.items.map(i => (
                <li key={i.type} className="flex items-center gap-1.5">
                  {i.reason === null
                    ? <span className="text-green-600">✓</span>
                    : i.reason === 'stale' ? <span className="text-amber-600">⚠</span> : <span className="text-red-500">✗</span>}
                  <span className="text-[#090c1d]">{i.label}</span>
                  <span className="text-[#b0acd6]">
                    {i.reason === null && `최신 ${fmt(i.generatedAt)}`}
                    {i.reason === 'stale' && `구본 ${fmt(i.generatedAt)} — 데이터 수정 ${fmt(cl.dataMaxAt)} 이후 재생성 필요`}
                    {i.reason === '미생성' && '미생성'}
                  </span>
                </li>
              ))}
            </ul>
            {/* 공란 사전 리포트 (S13-3) — 경고만, 진행은 사용자 선택(차단 아님) */}
            {cl.blanks.length > 0 && (
              <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800" data-testid="bundle-blank-report">
                <p className="font-medium">미점검 공란이 인쇄됩니다:</p>
                {cl.blanks.map(b => (
                  <p key={b.sheetName}>· {b.sheetName} — 공란 {b.blank}/{b.total}</p>
                ))}
                <p className="mt-0.5 text-[10px]">점검표에서 마저 입력하거나, 이대로 진행할 수 있습니다.</p>
              </div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={() => generate(staleTypes)} disabled={isPending || disabled || cl.regenBlocked}
                className="inline-flex items-center gap-1 rounded-lg bg-[#7b68ee] px-2.5 py-1 font-medium text-white disabled:opacity-40"
                data-testid="bundle-generate">
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Package className="size-3" />}
                필요분 생성 ({staleTypes.length}건)
              </button>
              <button onClick={() => generate(allTypes)} disabled={isPending || disabled || cl.regenBlocked}
                className="rounded-lg border border-[#d0ccf5] px-2.5 py-1 text-[#514b81] disabled:opacity-40">
                전체 재생성
              </button>
              <a href={`/inspections/${inspectionId}/bundle`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-[#d0ccf5] px-2.5 py-1 text-[#514b81] hover:border-[#7b68ee]">
                <CheckCircle2 className="size-3" /> 번들 열기
              </a>
              <button onClick={load} disabled={isPending} className="text-[10px] text-[#b0acd6] underline">새로고침</button>
            </div>
            {results && results.some(r => !r.ok) && (
              <ul className="space-y-0.5 text-red-600">
                {results.filter(r => !r.ok).map(r => <li key={r.type}>❌ {r.label}: {r.error}</li>)}
              </ul>
            )}
          </>)}
          {msg && <p className={msg.startsWith('❌') || msg.startsWith('⚠') ? 'text-red-600' : 'text-green-600'}>{msg}</p>}
        </div>
      )}
    </div>
  )
}
