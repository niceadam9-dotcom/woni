'use client'

/** 가스계 「※ 약제저장량 점검리스트」 입력 (통합계획 C3 1단계, 2026-10-02)
 *  점검표 화면에서 9-B-001(CO2)·11-B-001(할론)이 든 시트를 열면 보인다.
 *  용기 목록 = 고객 설비 대장의 가스용기(묶음 qty n은 용기 No.1..n). 손실률 5% 초과 = 불량(서식 문구).
 *  ⚠ 점검표 응답(○/✕)은 바꾸지 않는다 — 측정 결과는 별지 4호 「약제저장량 점검리스트」 쪽으로만 간다. */
import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { getGasStorageAction, saveGasStorageAction, type GasCylinderSlot } from '@/app/(dashboard)/customers/equipment-actions'
import { lossOf, numOrNull, type GasMeasure } from '@/lib/gas-storage'

type Cell = { tempC: string; heightCm: string; chargeKg: string; nominalKg: string }
const EMPTY: Cell = { tempC: '', heightCm: '', chargeKg: '', nominalKg: '' }
const keyOf = (s: { assetId: string; cylNo: number }) => `${s.assetId}#${s.cylNo}`
const str = (v: number | null) => (v == null ? '' : String(v))

export function GasStoragePanel({ inspectionId, customerId, canEdit }: { inspectionId: string; customerId: string; canEdit: boolean }) {
  const [slots, setSlots] = useState<GasCylinderSlot[] | null>(null)
  const [cells, setCells] = useState<Record<string, Cell>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    let alive = true
    getGasStorageAction(inspectionId).then(res => {
      if (!alive) return
      if (res.error) setMsg(res.error)
      const c: Record<string, Cell> = {}
      for (const m of res.measures) c[keyOf(m)] = { tempC: str(m.tempC), heightCm: str(m.heightCm), chargeKg: str(m.chargeKg), nominalKg: str(m.nominalKg) }
      setCells(c)
      setSlots(res.slots)
    })
    return () => { alive = false }
  }, [inspectionId])

  if (slots === null) return null
  const set = (k: string, f: keyof Cell, v: string) => setCells(p => ({ ...p, [k]: { ...(p[k] ?? EMPTY), [f]: v } }))

  const save = () => start(async () => {
    setMsg(null)
    const rows: GasMeasure[] = slots.map(s => {
      const c = cells[keyOf(s)] ?? EMPTY
      return { assetId: s.assetId, cylNo: s.cylNo, location: s.location, tempC: numOrNull(c.tempC), heightCm: numOrNull(c.heightCm), chargeKg: numOrNull(c.chargeKg), nominalKg: numOrNull(c.nominalKg) }
    })
    const res = await saveGasStorageAction(inspectionId, rows)
    setMsg(res.error ?? `${res.saved}줄 저장했습니다. 별지 4호 「약제저장량 점검리스트」에 실립니다.`)
  })

  const defects = slots.filter(s => {
    const c = cells[keyOf(s)] ?? EMPTY
    return lossOf({ chargeKg: numOrNull(c.chargeKg), nominalKg: numOrNull(c.nominalKg) }).result === '불량'
  }).length

  return (
    <section className="mt-3 rounded border border-line bg-white p-3" data-testid="gas-storage">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-form-sm font-semibold">약제저장량 점검리스트</h3>
        <span className="text-form-xs text-ink-meta">손실량 = 기준 충전량 − 측정 충전량 · 5% 초과 불량</span>
        {defects > 0 && <span className="text-form-xs font-semibold text-red-700" data-testid="gas-storage-defects">불량 {defects}병 — ✕와 불량내용은 직접 확인하세요</span>}
      </div>
      {slots.length === 0 ? (
        <p className="text-form-xs text-ink-sub" data-testid="gas-storage-empty">
          설비 대장에 가스용기가 없습니다. <Link className="underline" href={`/customers/${customerId}?tab=facilities&form=1.4`}>고객 [공통] 1.4 설비 대장</Link>에서 「가스계 용기」를 먼저 넣으세요.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-form-xs" data-testid="gas-storage-table">
              <thead><tr className="text-ink-meta">
                <th className="px-1 text-left">설치위치</th><th className="px-1">용기 No.</th><th className="px-1">실내온도(℃)</th><th className="px-1">약제높이(cm)</th>
                <th className="px-1">충전량(kg)</th><th className="px-1">기준량(kg)</th><th className="px-1">손실량(kg)</th><th className="px-1">결과</th>
              </tr></thead>
              <tbody>
                {slots.map(s => {
                  const k = keyOf(s); const c = cells[k] ?? EMPTY
                  const l = lossOf({ chargeKg: numOrNull(c.chargeKg), nominalKg: numOrNull(c.nominalKg) })
                  const inp = (f: keyof Cell) => (
                    <input value={c[f]} onChange={e => set(k, f, e.target.value)} disabled={!canEdit} inputMode="decimal"
                      className="w-20 rounded border border-line px-1 py-0.5 text-right" data-gas={`${f}-${s.cylNo}`} />
                  )
                  return (
                    <tr key={k} className="border-t border-line" data-testid="gas-storage-row">
                      <td className="px-1">{s.location ?? '-'}{s.subType ? ` (${s.subType})` : ''}</td>
                      <td className="px-1 text-center">{s.cylNo}</td>
                      <td className="px-1 text-center">{inp('tempC')}</td><td className="px-1 text-center">{inp('heightCm')}</td>
                      <td className="px-1 text-center">{inp('chargeKg')}</td><td className="px-1 text-center">{inp('nominalKg')}</td>
                      <td className="px-1 text-right">{l.lossKg ?? ''}</td>
                      <td className={`px-1 text-center ${l.result === '불량' ? 'font-semibold text-red-700' : ''}`} data-gas-result={s.cylNo}>{l.result ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <button onClick={save} disabled={pending} className="mt-2 rounded bg-blue-600 px-3 py-1 text-form-xs text-white disabled:opacity-50" data-testid="gas-storage-save">
              {pending ? '저장 중…' : '측정값 저장'}
            </button>
          )}
        </>
      )}
      {msg && <p className="mt-1 text-form-xs text-ink-sub" data-testid="gas-storage-msg">{msg}</p>}
    </section>
  )
}
