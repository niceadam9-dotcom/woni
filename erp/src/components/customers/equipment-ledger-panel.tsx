'use client'

/** 설비 대장 패널 — 고객 [공통] 탭 1.4 소방시설 아래 (통합계획 C3 1단계, 2026-10-02)
 *
 *  머리 집계(총·내용연수 초과·12개월 내 만료·연장 중) · 품목별 행 표(묶음 행) · 직접 추가 · 엑셀 가져오기 · 교체/폐기 · 묶음 쪼개기.
 *  3-1 동별 수량과는 **대조만** 한다 — 「대장 분말 n대 / 3-1 분말 m대」를 나란히 보이고 어느 쪽도 덮어쓰지 않는다.
 *  탭이 열릴 때 액션으로 한 번 읽는다(lazy — 고객 상세 서버 물결에 얹지 않는다). */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Boxes, Loader2, Plus, Upload, X } from 'lucide-react'
import {
  listEquipmentAction, addEquipmentRowsAction, closeEquipmentAction, splitEquipmentAction, getS31TotalsAction,
  type EquipmentRow, type EquipmentInput,
} from '@/app/(dashboard)/customers/equipment-actions'
import {
  CATEGORIES, CATEGORY_LABEL, DEFAULT_RULE, RULE_LABEL, expiryOf, expiryState, tallyAssets, type EquipmentCategory,
} from '@/lib/equipment-lifespan'
import { parseEquipmentGrid } from '@/lib/equipment-import'

type Building = { id: string; building_name: string }

const STATE_STYLE = { expired: 'bg-red-100 text-red-700', soon: 'bg-amber-100 text-amber-800', ok: 'bg-green-50 text-green-700', unknown: 'bg-gray-100 text-gray-500', none: 'bg-gray-50 text-gray-400' } as const
const STATE_LABEL = { expired: '내용연수 경과', soon: '12개월 내 만료', ok: '정상', unknown: '제조연월 미입력', none: '연수 판정 없음' } as const

export function EquipmentLedgerPanel({ customerId, buildings, canManage }: { customerId: string; buildings: Building[]; canManage: boolean }) {
  const [rows, setRows] = useState<EquipmentRow[] | null>(null)
  const [s31, setS31] = useState<{ powder: number; autoDiffuse: number; other: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [today] = useState(() => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10))
  const [adding, setAdding] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ inputs: EquipmentInput[]; errors: string[] } | null>(null)

  const load = async () => {
    const [r, t] = await Promise.all([listEquipmentAction(customerId), getS31TotalsAction(customerId)])
    if (r.error) setMsg(`⚠ ${r.error}`); else setRows(r.rows)
    setS31(t)
  }
  useEffect(() => {
    let alive = true
    Promise.all([listEquipmentAction(customerId), getS31TotalsAction(customerId)]).then(([r, t]) => {
      if (!alive) return
      if (r.error) setMsg(`⚠ ${r.error}`); else setRows(r.rows)
      setS31(t)
    })
    return () => { alive = false }
  }, [customerId])

  const tally = useMemo(() => tallyAssets(rows ?? [], today), [rows, today])
  const powderInLedger = useMemo(() => (rows ?? []).filter(r => r.category === 'powder').reduce((s, r) => s + r.qty, 0), [rows])
  const bName = (id: string | null) => buildings.find(b => b.id === id)?.building_name ?? (id ? '?' : '공통')

  const run = (fn: () => Promise<{ error?: string } & Record<string, unknown>>, ok: string) => start(async () => {
    setMsg(null)
    const r = await fn()
    if (r.error) { setMsg(`⚠ ${r.error}`); return }
    setMsg(`✅ ${ok}`)
    await load()
  })

  const onFile = async (file: File) => {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })
    const { rows: parsed, errors } = parseEquipmentGrid(grid)
    const inputs: EquipmentInput[] = parsed.map(p => ({
      category: p.category, qty: p.qty, manufacturedYm: p.manufacturedYm, location: p.location, subType: p.subType,
      buildingId: p.building ? buildings.find(b => b.building_name.replace(/\s/g, '') === p.building!.replace(/\s/g, ''))?.id ?? null : (buildings.length === 1 ? buildings[0].id : null),
    }))
    setPreview({ inputs, errors })
  }

  const th = 'px-2 py-1.5 text-left font-medium'
  return (
    <div className="rounded-xl border border-brand-line-soft bg-surface p-4 space-y-3" data-testid="equipment-ledger">
      <div className="flex flex-wrap items-center gap-2">
        <Boxes className="size-4 text-brand" />
        <h2 className="text-form-base-title font-semibold text-ink">설비 대장</h2>
        <span className="text-form-2xs text-ink-meta">제조연월이 판정을 바꾸는 품목 — 분말소화기(법정 10년)·자동확산·완강기·호스·연기감지기·가스용기·펌프</span>
        {pending && <Loader2 className="size-3.5 animate-spin text-ink-meta" />}
      </div>
      {rows && (
        <div className="flex flex-wrap gap-2 text-form-sm" data-testid="equipment-tally">
          <span className="rounded-lg border px-2 py-1">총 <b>{tally.total}</b>대</span>
          <span className={`rounded-lg px-2 py-1 ${tally.expired ? 'bg-red-100 text-red-700' : 'border'}`} data-testid="equipment-expired">내용연수 초과 <b>{tally.expired}</b></span>
          <span className={`rounded-lg px-2 py-1 ${tally.soon ? 'bg-amber-100 text-amber-800' : 'border'}`}>12개월 내 만료 <b>{tally.soon}</b></span>
          <span className="rounded-lg border px-2 py-1">연장 중 <b>{tally.extended}</b></span>
          {tally.unknown > 0 && <span className="rounded-lg border px-2 py-1 text-ink-meta">제조연월 미입력 {tally.unknown}</span>}
          {s31 && (s31.powder > 0 || powderInLedger > 0) && (
            <span className={`rounded-lg px-2 py-1 ${s31.powder !== powderInLedger ? 'bg-blue-50 text-blue-800' : 'border text-ink-meta'}`} data-testid="equipment-s31-compare"
              title="3-1 동별 수량은 1.4 세부제원에서 사람이 적은 값입니다. 대장은 그 값을 바꾸지 않습니다 — 다르면 어느 쪽이 맞는지 확인해 고치세요.">
              분말 — 대장 {powderInLedger}대 / 3-1 수량 {s31.powder}대{s31.powder !== powderInLedger ? ' (차이)' : ''}
            </span>
          )}
        </div>
      )}
      {msg && <p className="text-form-sm text-ink-sub" role="status" data-testid="equipment-msg">{msg}</p>}
      {!rows && !msg && <p className="flex items-center gap-1 text-form-sm text-ink-meta"><Loader2 className="size-3.5 animate-spin" /> 불러오는 중…</p>}

      {canManage && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setAdding(a => !a)} disabled={pending} data-testid="equipment-add-open"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-brand-line px-3 text-form-sm text-brand hover:bg-brand-tint"><Plus className="size-3.5" /> 행 추가</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" data-testid="equipment-import-file"
            onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={pending}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-brand-line-soft px-3 text-form-sm text-ink-sub hover:bg-brand-tint"><Upload className="size-3.5" /> 엑셀 가져오기</button>
          <span className="text-form-2xs text-ink-meta">엑셀 열: 품목·수량·제조연월(필수) + 위치·규격·건물(선택). 같은 위치·제조연월·규격은 한 줄에 수량으로(묶음 행).</span>
        </div>
      )}

      {adding && canManage && <AddForm buildings={buildings} disabled={pending} onCancel={() => setAdding(false)}
        onSubmit={inp => run(async () => { const r = await addEquipmentRowsAction(customerId, [inp]); if (!r.error) setAdding(false); return r }, '대장에 추가했습니다')} />}

      {preview && (
        <div className="rounded-lg border border-brand-line bg-brand-tint/30 p-2 space-y-1.5 text-form-sm" data-testid="equipment-import-preview">
          <p>엑셀에서 <b>{preview.inputs.length}</b>줄을 읽었습니다{preview.errors.length ? <> · <span className="text-red-600">오류 {preview.errors.length}줄(건너뜀)</span></> : null}.</p>
          {preview.errors.slice(0, 5).map((e, i) => <p key={i} className="text-form-2xs text-red-600">{e}</p>)}
          <div className="flex gap-1.5">
            <button disabled={pending || preview.inputs.length === 0} data-testid="equipment-import-apply"
              onClick={() => { const inputs = preview.inputs; setPreview(null); run(() => addEquipmentRowsAction(customerId, inputs), `엑셀에서 ${inputs.length}줄을 추가했습니다`) }}
              className="h-8 rounded-lg bg-brand px-3 text-white disabled:opacity-50">{preview.inputs.length}줄 추가</button>
            <button onClick={() => setPreview(null)} className="h-8 rounded-lg border px-2"><X className="size-3.5" /></button>
          </div>
        </div>
      )}

      {rows && rows.length === 0 && <p className="text-form-sm text-ink-meta">대장이 비어 있습니다. 현장에서 적어 온 명판 목록을 엑셀로 올리거나 행을 추가하세요.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-form-sm" data-testid="equipment-table">
            <thead><tr className="border-b text-ink-sub">
              <th className={th}>품목</th><th className={th}>건물</th><th className={th}>위치</th><th className={`${th} text-right`}>수량</th>
              <th className={th}>제조연월</th><th className={th}>규칙</th><th className={th}>만료</th><th className={th}>상태</th>{canManage && <th className={th}></th>}
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const st = expiryState(r, today)
                return (
                  <tr key={r.id} className="border-b last:border-0" data-testid="equipment-row">
                    <td className="px-2 py-1.5">{CATEGORY_LABEL[r.category]}{r.sub_type ? <span className="text-ink-meta"> · {r.sub_type}</span> : null}</td>
                    <td className="px-2 py-1.5">{bName(r.building_id)}</td>
                    <td className="px-2 py-1.5">{r.location ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right">{r.qty}</td>
                    <td className="px-2 py-1.5">{r.manufactured_on?.slice(0, 7) ?? '—'}</td>
                    <td className="px-2 py-1.5 text-ink-meta">{RULE_LABEL[r.lifespan_rule]}{r.extension_until ? ' · 연장' : ''}</td>
                    <td className="px-2 py-1.5">{expiryOf(r) ?? '—'}</td>
                    <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-form-2xs ${STATE_STYLE[st]}`}>{STATE_LABEL[st]}</span></td>
                    {canManage && (
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {r.qty > 1 && (
                          <button disabled={pending} className="mr-1 underline text-ink-sub" title="묶음에서 일부를 떼어 새 행으로(한두 대만 교체할 때)"
                            onClick={() => { const k = Number(prompt(`${r.qty}대 중 몇 대를 떼어 낼까요?`, '1')); if (k) run(() => splitEquipmentAction(customerId, r.id, k), `${k}대를 새 행으로 나눴습니다`) }}>쪼개기</button>
                        )}
                        <button disabled={pending} className="underline text-red-600" data-testid="equipment-close"
                          onClick={() => { if (confirm(`${CATEGORY_LABEL[r.category]} ${r.qty}대를 교체됨으로 닫을까요? (행은 이력으로 남습니다)`)) run(() => closeEquipmentAction(customerId, r.id, 'replaced'), '교체됨으로 닫았습니다') }}>교체됨</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AddForm({ buildings, disabled, onSubmit, onCancel }: { buildings: Building[]; disabled: boolean; onSubmit: (i: EquipmentInput) => void; onCancel: () => void }) {
  const [cat, setCat] = useState<EquipmentCategory>('powder')
  const [b, setB] = useState(buildings.length === 1 ? buildings[0].id : '')
  const [loc, setLoc] = useState('')
  const [qty, setQty] = useState('1')
  const [ym, setYm] = useState('')
  const [sub, setSub] = useState('')
  const field = 'h-8 rounded border border-brand-line px-2 text-form-sm'
  return (
    <div className="flex flex-wrap items-end gap-1.5 rounded-lg border border-brand-line bg-brand-tint/30 p-2" data-testid="equipment-add-form">
      <label className="text-form-2xs">품목<br />
        <select value={cat} onChange={e => setCat(e.target.value as EquipmentCategory)} className={field} disabled={disabled} data-testid="equipment-add-category">
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select></label>
      <label className="text-form-2xs">건물<br />
        <select value={b} onChange={e => setB(e.target.value)} className={field} disabled={disabled}>
          <option value="">공통</option>{buildings.map(x => <option key={x.id} value={x.id}>{x.building_name}</option>)}
        </select></label>
      <label className="text-form-2xs">위치(층·실)<br /><input value={loc} onChange={e => setLoc(e.target.value)} className={`${field} w-28`} disabled={disabled} data-testid="equipment-add-location" /></label>
      <label className="text-form-2xs">수량<br /><input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} className={`${field} w-16 text-right`} disabled={disabled} data-testid="equipment-add-qty" /></label>
      <label className="text-form-2xs">제조연월<br /><input value={ym} onChange={e => setYm(e.target.value)} placeholder="2015-03" className={`${field} w-24`} disabled={disabled} data-testid="equipment-add-ym" /></label>
      <label className="text-form-2xs">규격<br /><input value={sub} onChange={e => setSub(e.target.value)} placeholder="ABC 3.3kg" className={`${field} w-28`} disabled={disabled} /></label>
      <span className="text-form-2xs text-ink-meta">규칙: {RULE_LABEL[DEFAULT_RULE[cat]]}</span>
      <button disabled={disabled} data-testid="equipment-add-submit"
        onClick={() => onSubmit({ category: cat, buildingId: b || null, location: loc, qty: Number(qty), manufacturedYm: ym, subType: sub })}
        className="h-8 rounded-lg bg-brand px-3 text-form-sm text-white disabled:opacity-50">추가</button>
      <button onClick={onCancel} disabled={disabled} className="h-8 rounded-lg border px-2"><X className="size-3.5" /></button>
    </div>
  )
}
