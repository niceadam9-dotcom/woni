'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { getActiveSpecialInspectionAction } from '@/app/(dashboard)/customers/facility-spec-actions'
import { getInspectionSheetOverviewAction, getEtcSheetProgressAction } from '@/app/(dashboard)/inspections/sheet-actions'
import { ETC_LEDGER_CODE, ETC_KEYS, type EtcKey } from '@/lib/etc-sheet-map'
import { saveEtcFacilitiesAction } from '@/app/(dashboard)/customers/facilities-actions'
import { usePlanSaveHandler } from '@/components/ui/unsaved-nav'
import type { SheetOverview } from '@/lib/sheet-overview'
import { SaveBar } from '@/components/customers/key-fields'

/** 기타 점검대상 입력 카드 — 1.4 「기타」 7종(ETC_ITEMS)이 두 자리로 갈라진 것(2026-09-20 사용자 확정):
 *   · 보고서(별지) 탭 「기타 점검대상」 = 방화문·방화셔터 / 비상구·피난통로 / 방염 (자체점검 「기타사항」 시트)
 *   · 소방계획서 1.6 「기타」 = 위험물 저장·취급 / 화기 / 가연성 가스 / 전기 (외관점검 시트)
 *  저장 축은 종전 그대로 **건물별 fire_facilities 행**이다 — sheet-facility-map을 타고 그 점검표의
 *  installed 축이 되는 배선(facility-codes.ts ETC_ITEMS 주석)은 한 글자도 안 바뀐다. 갈라진 것은 UI뿐.
 *  점검 귀속 화면(/inspections/[id]/facilities)의 1.4는 7종을 그대로 든다(무변경 대조군).
 *
 *  🚨 진행 배지는 2026-09-21에 **항목 단위**로 올렸다. 종전에는 시트 단위(STD-31 하나)를 세 칸에
 *  같이 붙였는데, 한 시트가 3항목을 덮으므로 **방화문만 입력해도 비상구까지 「입력 완료」**로 보였다
 *  (실측 용문3 — 사용자가 「체크했는데 왜 결과가 없나」로 읽은 직접 원인). 값은
 *  getEtcSheetProgressAction이 항목 코드로 갈라서 준다(lib/etc-sheet-map 단일 원천).
 *  ⚠ 「항목별 ○/×를 만들지 말라」는 종전 경계는 그대로다 — 여기서 만드는 건 **진행 표시**이고,
 *  결과 마크는 여전히 report9-assemble의 롤업이 유일 생산자다. 두 축을 섞지 않는다.
 *
 *  두 모드:
 *   · standalone(보고서 탭) — 자기 [저장] 버튼, saveEtcFacilitiesAction 직행.
 *   · embedded(1.6) — 버튼 없이 registerSave로 부모 통합 [저장]에 등록(plan-form14 registerSpecsSave 전례).
 *  건물 상태는 **건물별로 들고 있어** 전환해도 미저장 편집이 유실되지 않는다(확인창 불필요). */

export type EtcItemDef = { code: string; sheetName: string; note: string }
export type EtcBuildingInit = {
  id: string
  name: string
  /** code → 현재 저장값 (fire_facilities 행에서 조립 — 행이 없으면 installed=false·note='') */
  etc: Record<string, { installed: boolean; note: string }>
}

export function EtcItemsPanel({
  customerId, items, buildings, defaultBuildingId, canManage, canRegister = false,
  linkFrom, title, description, embedded = false, registerSave, onDirtyChange,
}: {
  customerId: string
  /** ETC_ITEMS의 부분집합 — 어느 쪽 갈래인지는 마운트하는 쪽이 정한다 */
  items: readonly EtcItemDef[]
  buildings: EtcBuildingInit[]
  /** 처음 보여줄 건물 — 대표동(lib/primary-building) id. 없으면 첫 건물 */
  defaultBuildingId?: string | null
  canManage: boolean
  /** 점검표 링크·진행 배지 축(inspection_register) — canManage와 축이 다르다(plan-form14와 동일) */
  canRegister?: boolean
  /** 점검표 화면의 복귀(?from=) 목적지 — 마운트한 탭이 자기 URL을 넘긴다 */
  linkFrom: string
  title: string
  description?: string
  embedded?: boolean
  /** embedded — 부모 통합 [저장]이 await 할 저장 함수 등록 지점 */
  registerSave?: (fn: () => Promise<boolean>) => void
  /** embedded — 부모 저장 버튼 활성화·이탈 가드용 dirty 통지 */
  onDirtyChange?: (dirty: boolean) => void
}) {
  type ItemState = Record<string, { installed: boolean; note: string }>
  const [vals, setVals] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(buildings.map(bd => [bd.id, { ...bd.etc }])))
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set())
  const [bidx, setBidx] = useState(() => Math.max(0, buildings.findIndex(bd => bd.id === defaultBuildingId)))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const b = buildings[bidx]
  const dirty = dirtyIds.size > 0

  // 점검결과 배지 컨텍스트 — plan-form14와 같은 규약: 실패(권한·네트워크)는 조용히 생략,
  // 배지는 보조 정보고 체크 입력 본연은 그대로 동작해야 한다
  const [resultCtx, setResultCtx] = useState<{ inspection: { id: string; label: string } | null; reason?: string } | null>(null)
  const [overview, setOverview] = useState<SheetOverview | null>(null)
  /** 항목 단위 진행 — key별 {total, responded, outOfScope}. 시트 단위 배지를 대체한다(2026-09-21) */
  const [etcProgress, setEtcProgress] = useState<Record<EtcKey, { total: number; responded: number; outOfScope: number }> | null>(null)
  const fetched = useRef(false)
  useEffect(() => {
    if (!canRegister || fetched.current) return
    fetched.current = true
    getActiveSpecialInspectionAction(customerId)
      .then(async ctx => {
        setResultCtx(ctx)
        if (!ctx.inspection) return
        const [ov, etc] = await Promise.all([
          getInspectionSheetOverviewAction([ctx.inspection.id], { withGroups: true }),
          getEtcSheetProgressAction(ctx.inspection.id),
        ])
        const o = ov.overviews?.[ctx.inspection.id]
        if (o) setOverview(o)
        if (etc.progress) setEtcProgress(etc.progress)
      })
      .catch(() => {})
  }, [canRegister, customerId])

  /** 대장 코드 → 항목 단위 진행. 기타 3종이 아닌 코드(1.6의 위험물·화기 등)는 없다 —
   *  그쪽은 시트를 1:1로 쓰므로 종전 시트 단위 배지가 그대로 맞다. */
  const progressByCode = useMemo(() => {
    const m: Record<string, { total: number; responded: number; outOfScope: number }> = {}
    if (etcProgress) for (const k of ETC_KEYS) m[ETC_LEDGER_CODE[k]] = etcProgress[k]
    return m
  }, [etcProgress])

  const sheetProgress = useMemo(() => {
    const m: Record<string, { total: number; responded: number }> = {}
    for (const s of overview?.sheets ?? []) m[s.sheetName] = { total: s.total, responded: s.responded }
    return m
  }, [overview])
  const canInputResult = canRegister && !!resultCtx?.inspection && (overview?.canEdit ?? false)
  const fromParam = encodeURIComponent(linkFrom)

  function toggle(code: string) {
    if (!canManage || !b) return
    setVals(p => ({
      ...p,
      [b.id]: { ...p[b.id], [code]: { ...(p[b.id]?.[code] ?? { installed: false, note: '' }), installed: !(p[b.id]?.[code]?.installed ?? false) } },
    }))
    setDirtyIds(p => new Set(p).add(b.id))
    onDirtyChange?.(true)
  }

  async function save(): Promise<boolean> {
    if (!canManage || saving) return false
    if (dirtyIds.size === 0) return true   // 저장할 것 없음 = 성공 (부모 통합 저장이 헛돌지 않게)
    setSaving(true)
    setMsg('')
    try {
      const ids = [...dirtyIds]
      const results = await Promise.all(ids.map(id =>
        saveEtcFacilitiesAction(id, customerId, items.map(it => ({
          code: it.code,
          installed: vals[id]?.[it.code]?.installed ?? false,
          note: vals[id]?.[it.code]?.note ?? null,
        })))))
      const firstErr = results.find(r => r.error)?.error
      if (firstErr) { setMsg(`❌ ${firstErr}`); return false }
      setDirtyIds(new Set())
      onDirtyChange?.(false)
      setMsg('✅ 저장됨 — 해당 점검표의 대상(installed) 축에 반영됩니다')
      return true
    } catch {
      setMsg('❌ 저장 중 오류가 발생했습니다 — 잠시 후 다시 시도해주세요')
      return false
    } finally {
      setSaving(false)
    }
  }
  // 최신 클로저 유지 — 부모 등록·이동 확인창이 오래된 state로 저장하지 않게 (plan-form14 saveRef 전례)
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })
  useEffect(() => { registerSave?.(() => saveRef.current()) }, [registerSave])
  // standalone — 탭 이동·링크 이탈 확인창의 [저장하고 이동]이 이 저장을 await 한다.
  // embedded는 부모(1.6)가 통합 dirty로 등록하므로 여기서 이중 등록하지 않는다.
  usePlanSaveHandler(save, !embedded && canManage && dirty)
  useEffect(() => {
    if (embedded || !dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [embedded, dirty])

  if (!b) return null   // 건물 미등록 — 입력할 축 자체가 없다(1.4의 안내와 달리 이 카드는 조용히 접는다)

  const cur = vals[b.id] ?? {}
  return (
    <div className="rounded-xl border border-brand-line-soft bg-brand-tint px-4 py-2.5 space-y-1.5" data-testid="etc-items-panel">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-form-sm font-semibold text-ink">{title}</span>
        {description && (
          <span className="text-form-xs text-ink-meta">{description}</span>
        )}
        {buildings.length > 1 && (
          <select value={bidx} onChange={e => setBidx(parseInt(e.target.value, 10))}
            className="ml-auto h-form-7 rounded-lg border border-brand-line bg-surface px-2 text-form-sm outline-none">
            {buildings.map((bb, i) => <option key={bb.id} value={i}>{bb.name}</option>)}
          </select>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-0.5">
        {items.map(it => {
          const st = cur[it.code] ?? { installed: false, note: '' }
          // 기타 3종은 **항목 단위**(한 시트를 셋이 나눠 쓴다), 1.6 4종은 시트를 1:1로 써서 종전 그대로
          const itemProg = progressByCode[it.code]
          const prog = itemProg ?? sheetProgress[it.sheetName]
          const blank = prog ? prog.total - prog.responded : null
          // 작동 회차의 종합 전용(●) — 미입력이 아니라 **이 회차의 점검 항목이 아니다**.
          // 서식 각주 「●는 종합점검의 경우에만 해당한다」(별지 4호). 전용 입력 화면과 같은 어휘를 쓴다.
          const scopeOnly = !!itemProg && itemProg.total === 0 && itemProg.outOfScope > 0
          return (
            <div key={it.code} className="flex items-center gap-1 min-h-7 select-none">
              <button type="button" aria-disabled={!canManage} aria-pressed={st.installed}
                aria-label={`${it.code} 해당 체크`} data-testid={`etc-check-${it.code}`}
                onClick={() => toggle(it.code)}
                title={canManage ? `${it.code} 해당 여부를 체크합니다` : undefined}
                className={`shrink-0 inline-flex items-center justify-center w-7 h-form-7 rounded ${
                  canManage ? 'cursor-pointer hover:bg-surface' : 'cursor-not-allowed text-ink-faint'}`}>
                <span className="text-form-base leading-none">{st.installed ? '☑' : '☐'}</span>
              </button>
              <span className={`min-w-0 truncate text-form-sm ${st.installed ? 'font-bold text-ink' : 'text-ink-sub'}`}
                title={`${it.code} — 점검 결과는 ${it.note}에서 입력합니다`}>
                {it.code}
              </span>
              {st.note && <span className="text-form-2xs text-amber-600 truncate max-w-24" title={st.note}>({st.note})</span>}
              {/* 체크한 것만 입력 링크를 준다 — 해당하지도 않는 시트로 보내면 ／만 늘린다.
                  ?facility= 해석은 전용 페이지가 서버에서 한 번만 한다(plan-form14 resultBadge와 같은 규약). */}
              {st.installed && canInputResult && (
                scopeOnly
                  /* 🚨 링크가 아니다 — 이 회차엔 입력할 칸이 없다. 보내 봐야 빈 화면을 보게 된다
                     (annex-missing-list의 '추측으로 링크를 걸면 없는 것보다 나쁘다'와 같은 축). */
                  ? <span data-testid={`etc-scope-${it.code}`}
                      title="종합점검 전용(●) 항목 — 작동점검에서는 해당없음(／)으로 자동 인쇄됩니다 (입력 불가)"
                      /* 갈 곳 자체는 사실이라 남겨 둔다 — 칩은 링크가 아니지만, 같은 자리가 종합 회차에선
                         링크가 되므로 **목적지 계약을 이 갈래에서도 검사**할 수 있어야 한다 */
                      data-sheet-href={`/inspections/${resultCtx!.inspection!.id}/sheet?facility=${encodeURIComponent(it.code)}&from=${fromParam}`}
                      className="ml-auto shrink-0 h-5 px-1.5 rounded-full border border-brand-line bg-paper text-form-2xs font-bold text-ink-soft inline-flex items-center justify-center">
                      종합점검 전용
                    </span>
                  : <Link href={`/inspections/${resultCtx!.inspection!.id}/sheet?facility=${encodeURIComponent(it.code)}&from=${fromParam}`}
                      data-testid={`etc-link-${it.code}`}
                      title={`${it.note} — 클릭하면 점검표 입력 화면이 열립니다`}
                      className={`ml-auto shrink-0 h-5 px-1.5 rounded-full border text-form-2xs font-bold inline-flex items-center justify-center ${
                        blank === null ? 'text-ink-soft border-brand-line bg-paper'
                          : blank > 0 ? 'text-amber-700 border-amber-300 bg-amber-50'
                            : 'text-green-600 border-green-300 bg-green-50'}`}>
                      {blank === null ? '점검표' : blank > 0 ? `미입력 ${blank}` : '입력 완료'}
                    </Link>
              )}
            </div>
          )
        })}
      </div>
      {/* 저장 줄 — 고객 화면 공용 SaveBar(2026-09-23). embedded(1.6 안)이면 1.6 저장이 대신한다 */}
      {!embedded && canManage && (
        <SaveBar saveTestId="etc-items-save" dirty={dirty} pending={saving} onSave={() => { void save() }}
          status={msg ? <span className={msg.startsWith('❌') ? 'text-red-600' : msg.startsWith('✅') ? 'text-green-700' : 'text-ink-sub'}>{msg}</span> : undefined} />
      )}
      {embedded && msg && <p className="text-form-xs text-ink-sub">{msg}</p>}
    </div>
  )
}
