'use client'

import { useEffect, useState, useTransition } from 'react'
import { Bookmark, Loader2, Plus, Printer, Trash2, X } from 'lucide-react'
import { listPointsAction, addPointAction, deletePointAction, type PointRow } from '@/app/(dashboard)/customers/point-actions'
import { tagHuman } from '@/lib/equipment-tag'

/** 설비 지점(책갈피 QR) 패널 — 고객 [공통] 1.4, 대장 아래 (통합 실행계획 C4 — QR 절 3단계, 2026-10-03)
 *  과잉 등록 방지: 「회차마다 가는 자리만」 문구가 기준이다 — 개체(소화기 등)는 대장·개체 QR의 일. */

type Building = { id: string; building_name: string }
type SheetOpt = { code: string; name: string }

const field = 'h-8 rounded border border-brand-line px-2 text-form-sm'

export function EquipmentPointPanel({ customerId, buildings, sheets, canManage }: {
  customerId: string; buildings: Building[]; sheets: SheetOpt[]; canManage: boolean
}) {
  const [rows, setRows] = useState<PointRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const bName = new Map(buildings.map(b => [b.id, b.building_name]))
  const sName = new Map(sheets.map(s => [s.code, s.name]))

  useEffect(() => { void listPointsAction(customerId).then(r => setRows(r.rows)) }, [customerId])

  const run = (fn: () => Promise<{ error?: string }>, ok: string) => {
    setMsg(null)
    start(async () => {
      const r = await fn()
      if (r.error) { setMsg(r.error); return }
      setMsg(ok)
      setAdding(false)
      const l = await listPointsAction(customerId)
      setRows(l.rows)
    })
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3" data-testid="point-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Bookmark className="size-4 text-brand" /> 지점 QR (책갈피)</h3>
        <span className="text-form-2xs text-ink-meta">수신기·펌프실처럼 <b>회차마다 가는 자리</b>에만 — 찍으면 그 자리의 점검표가 열립니다. 소화기 같은 개체는 위 대장의 QR로.</span>
        <span className="flex-1" />
        {rows && rows.length > 0 && (
          <a href={`/customers/${customerId}/equipment-point-labels`} target="_blank" rel="noreferrer" data-testid="point-labels-link"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-brand-line-soft px-3 text-form-sm text-ink-sub hover:bg-brand-tint">
            <Printer className="size-3.5" /> 라벨 인쇄 ({rows.length})
          </a>
        )}
        {canManage && !adding && (
          <button onClick={() => setAdding(true)} data-testid="point-add-open"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-brand-line px-3 text-form-sm text-brand hover:bg-brand-tint">
            <Plus className="size-3.5" /> 지점 추가
          </button>
        )}
      </div>

      {adding && canManage && (
        <AddPointForm buildings={buildings} sheets={sheets} disabled={pending} onCancel={() => setAdding(false)}
          onSubmit={inp => run(() => addPointAction(customerId, inp), '지점을 추가했습니다 — 라벨을 인쇄해 붙이세요.')} />
      )}

      {rows === null ? <p className="text-form-sm text-ink-meta">불러오는 중…</p> : rows.length === 0 ? (
        <p className="text-form-sm text-ink-meta" data-testid="point-empty">지점이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line text-form-sm" data-testid="point-list">
          {rows.map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <b className="text-ink">{r.label}</b>
              <span className="text-ink-sub">{[r.building_id ? bName.get(r.building_id) : null, r.floor && `${r.floor}층`, r.room].filter(Boolean).join(' · ')}</span>
              {r.sheet_codes.map(c => <span key={c} className="rounded-full bg-brand-tint px-1.5 py-0.5 text-form-2xs text-brand" title={sName.get(c) ?? ''}>{c}</span>)}
              <span className="flex-1" />
              {r.tag_code && <span className="font-mono text-form-2xs text-ink-meta">{tagHuman(r.tag_code)}</span>}
              <a href={`/customers/${customerId}/equipment-point-labels?ids=${r.id}`} target="_blank" rel="noreferrer"
                className="text-form-2xs text-ink-sub underline" title="이 지점 라벨 1장 재인쇄">라벨</a>
              {canManage && (
                <button disabled={pending} onClick={() => { if (confirm(`지점 「${r.label}」을 지울까요? 붙인 라벨은 무효가 됩니다.`)) run(() => deletePointAction(customerId, r.id), '지점을 지웠습니다.') }}
                  className="text-ink-faint hover:text-red-600" title="삭제" data-testid="point-delete"><Trash2 className="size-3.5" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-form-sm text-ink-sub" data-testid="point-msg">{msg}</p>}
    </div>
  )
}

function AddPointForm({ buildings, sheets, disabled, onSubmit, onCancel }: {
  buildings: Building[]; sheets: SheetOpt[]; disabled: boolean
  onSubmit: (i: { label: string; buildingId: string | null; floor: string; room: string; sheetCodes: string[] }) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState('')
  const [b, setB] = useState(buildings.length === 1 ? buildings[0].id : '')
  const [floor, setFloor] = useState('')
  const [room, setRoom] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const toggle = (c: string) => setCodes(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c])
  return (
    <div className="space-y-2 rounded-lg border border-brand-line bg-brand-tint/30 p-2" data-testid="point-add-form">
      <div className="flex flex-wrap items-end gap-1.5">
        <label className="text-form-2xs">지점 이름<br />
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="수신기(방재실)" className={`${field} w-44`} disabled={disabled} data-testid="point-add-label" /></label>
        <label className="text-form-2xs">건물<br />
          <select value={b} onChange={e => setB(e.target.value)} className={field} disabled={disabled}>
            <option value="">공통</option>{buildings.map(x => <option key={x.id} value={x.id}>{x.building_name}</option>)}
          </select></label>
        <label className="text-form-2xs">층<br /><input value={floor} onChange={e => setFloor(e.target.value)} placeholder="B1" className={`${field} w-14`} disabled={disabled} /></label>
        <label className="text-form-2xs">실<br /><input value={room} onChange={e => setRoom(e.target.value)} placeholder="방재실" className={`${field} w-24`} disabled={disabled} /></label>
        <button disabled={disabled || !label.trim()} data-testid="point-add-submit"
          onClick={() => onSubmit({ label, buildingId: b || null, floor, room, sheetCodes: codes })}
          className="h-8 rounded-lg bg-brand px-3 text-form-sm text-white disabled:opacity-50">{disabled ? <Loader2 className="size-3.5 animate-spin" /> : '추가'}</button>
        <button onClick={onCancel} disabled={disabled} className="h-8 rounded-lg border px-2"><X className="size-3.5" /></button>
      </div>
      <div className="max-h-28 overflow-auto rounded border border-brand-line-soft bg-surface p-1.5" data-testid="point-add-sheets">
        <p className="mb-1 text-form-2xs text-ink-meta">이 자리에서 입력하는 점검표 시트(복수) — 찍으면 여기로 갑니다</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {sheets.map(s => (
            <label key={s.code} className="inline-flex items-center gap-1 text-form-2xs">
              <input type="checkbox" checked={codes.includes(s.code)} onChange={() => toggle(s.code)} disabled={disabled} />
              <span title={s.name}>{s.code} {s.name.length > 14 ? `${s.name.slice(0, 14)}…` : s.name}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
