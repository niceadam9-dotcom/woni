'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { savePumpTestAction } from '@/app/(dashboard)/inspections/pump-test-actions'
import {
  PUMP_KINDS, PUMP_JUDGE_LABELS, PUMP_SHEET_LABELS, emptyPumpRow, judgePumpTest,
  type PumpKind, type PumpTestRow,
} from '@/lib/pump-test'

/** 펌프성능시험 실측치 입력 (소방계획서_21 R5-7 후속)
 *
 *  법정 별지 4호서식의 "※ 펌프성능시험" 표를 화면에서 그대로 채운다. 37시트 엑셀에만 있던
 *  실측치의 새 기록처이고, 이게 생겨야 엑셀 생성(R5-6)을 지울 수 있다.
 *  칸을 벗어나면 저장한다 — 불량 표(defect-grid)와 같은 규약. */

type Field = keyof Pick<PumpTestRow,
  'shutoffFlow' | 'shutoffPress' | 'ratedFlow' | 'ratedPress' | 'overFlow' | 'overPress'
  | 'setStartPress' | 'setStopPress'>

export function PumpTestPanel({ inspectionId, sheetNos, initial, canEdit }: {
  inspectionId: string
  /** 이 점검 건에 실제로 포함된 설비 중 펌프성능시험 대상 번호 */
  sheetNos: number[]
  initial: PumpTestRow[]
  canEdit: boolean
}) {
  const key = (s: number, k: PumpKind) => `${s}|${k}`
  const [rows, setRows] = useState<Record<string, PumpTestRow>>(() => {
    const m: Record<string, PumpTestRow> = {}
    for (const s of sheetNos) for (const k of PUMP_KINDS) m[key(s, k)] = emptyPumpRow(s, k)
    for (const r of initial) m[key(r.sheetNo, r.pumpKind)] = r
    return m
  })
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  const [openSheet, setOpenSheet] = useState<number | null>(sheetNos[0] ?? null)

  if (sheetNos.length === 0) return null

  const set = (s: number, k: PumpKind, patch: Partial<PumpTestRow>) =>
    setRows(prev => ({ ...prev, [key(s, k)]: { ...prev[key(s, k)], ...patch } }))

  function commit(s: number, k: PumpKind, patch?: Partial<PumpTestRow>) {
    if (!canEdit) return
    const id = key(s, k)
    const row = { ...rows[id], ...patch }
    setSaving(id)
    setErr('')
    void savePumpTestAction(inspectionId, s, k, {
      shutoffFlow: row.shutoffFlow, shutoffPress: row.shutoffPress,
      ratedFlow: row.ratedFlow, ratedPress: row.ratedPress,
      overFlow: row.overFlow, overPress: row.overPress,
      setStartPress: row.setStartPress, setStopPress: row.setStopPress,
      judge1: row.judge1, judge2: row.judge2, judge3: row.judge3, note: row.note,
    }).then(res => {
      setSaving(null)
      if (res.error) { setErr(res.error); return }
      setSaved(p => ({ ...p, [id]: true }))
      setTimeout(() => setSaved(p => ({ ...p, [id]: false })), 4000)
    })
  }

  const numCell = 'w-full rounded border border-[#e0ddf5] px-1 py-0.5 text-right text-[11px] focus:outline-none focus:border-[#7b68ee] disabled:bg-[#fafafa]'
  const numVal = (v: number | null) => (v == null ? '' : String(v))
  const onNum = (s: number, k: PumpKind, f: Field) => ({
    value: numVal(rows[key(s, k)][f]),
    disabled: !canEdit,
    inputMode: 'decimal' as const,
    className: numCell,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.trim()
      set(s, k, { [f]: raw === '' ? null : Number(raw) } as Partial<PumpTestRow>)
    },
    onBlur: () => commit(s, k),
  })

  return (
    <section className="rounded-lg border border-[#e0ddf5] bg-white" data-testid="pump-test-panel">
      <div className="flex items-center gap-1.5 border-b border-[#eceafd] bg-[#fafaff] px-2.5 py-1.5">
        <p className="text-[11px] font-semibold text-[#514b81]">※ 펌프성능시험</p>
        <span className="text-[10px] text-[#b0acd6]">별지 4호서식 표 — 펌프 명판 및 설계치 참조</span>
      </div>

      {/* 설비가 여러 개면 탭 — 서식도 설비마다 표가 따로 붙는다 */}
      {sheetNos.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-[#f3f1fc] px-2 py-1.5">
          {sheetNos.map(s => (
            <button key={s} onClick={() => setOpenSheet(s)}
              className={`rounded px-2 py-0.5 text-[10px] ${openSheet === s ? 'bg-[#7b68ee] text-white' : 'text-[#514b81] hover:bg-[#f5f4ff]'}`}>
              {PUMP_SHEET_LABELS[s] ?? `설비 ${s}`}
            </button>
          ))}
        </div>
      )}

      {err && <p className="px-2.5 pt-1.5 text-[11px] text-red-600">❌ {err}</p>}

      {sheetNos.filter(s => sheetNos.length === 1 || s === openSheet).map(s => {
        const main = rows[key(s, '주')], sub = rows[key(s, '예비')]
        return (
          <div key={s} className="space-y-2 p-2" data-pump-sheet={s}>
            <table className="w-full table-fixed border-collapse text-[11px]">
              <thead>
                <tr className="text-[10px] text-[#847ba8]">
                  <th className="w-[22%] px-1 pb-1 text-left font-medium">구분</th>
                  <th className="px-1 pb-1 font-medium">체절운전</th>
                  <th className="px-1 pb-1 font-medium">정격운전(100%)</th>
                  <th className="px-1 pb-1 font-medium">정격유량의 150% 운전</th>
                </tr>
              </thead>
              <tbody>
                {([['토출량 (ℓ/min)', 'shutoffFlow', 'ratedFlow', 'overFlow'],
                   ['토출압 (MPa)', 'shutoffPress', 'ratedPress', 'overPress']] as Array<[string, Field, Field, Field]>)
                  .map(([label, f1, f2, f3]) => PUMP_KINDS.map((k, ki) => (
                    <tr key={`${label}-${k}`} className="border-t border-[#f3f1fc]">
                      <td className="px-1 py-0.5 text-[#514b81]">
                        {ki === 0 && <span className="mr-1">{label}</span>}
                        <span className="text-[#b0acd6]">{k}</span>
                      </td>
                      <td className="px-1 py-0.5"><input aria-label={`${PUMP_SHEET_LABELS[s]} ${k}펌프 ${label} 체절운전`} {...onNum(s, k, f1)} /></td>
                      <td className="px-1 py-0.5"><input aria-label={`${PUMP_SHEET_LABELS[s]} ${k}펌프 ${label} 정격운전`} {...onNum(s, k, f2)} /></td>
                      <td className="px-1 py-0.5"><input aria-label={`${PUMP_SHEET_LABELS[s]} ${k}펌프 ${label} 150% 운전`} {...onNum(s, k, f3)} /></td>
                    </tr>
                  )))}
              </tbody>
            </table>

            {/* ㅇ설정압력 — 서식 좌측 블록 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#f3f1fc] pt-1.5 text-[10px] text-[#514b81]">
              <span className="text-[#847ba8]">ㅇ설정압력</span>
              {PUMP_KINDS.map(k => (
                <span key={k} className="inline-flex items-center gap-1">
                  {k}펌프 기동
                  <input aria-label={`${PUMP_SHEET_LABELS[s]} ${k}펌프 기동압력`} {...onNum(s, k, 'setStartPress')} className={`${numCell} w-14`} />
                  정지
                  <input aria-label={`${PUMP_SHEET_LABELS[s]} ${k}펌프 정지압력`} {...onNum(s, k, 'setStopPress')} className={`${numCell} w-14`} />
                  MPa
                </span>
              ))}
              <span className="ml-auto inline-flex h-3 items-center gap-1">
                {(saving === key(s, '주') || saving === key(s, '예비')) && <Loader2 className="size-3 animate-spin text-[#7b68ee]" />}
                {(saved[key(s, '주')] || saved[key(s, '예비')]) && saving === null && (
                  <span className="inline-flex items-center gap-0.5 text-green-600"><Check className="size-3" /> 저장됨</span>
                )}
              </span>
            </div>

            {/* 적정 여부 — 주펌프 기준으로 판정한다(서식도 표당 한 벌) */}
            <JudgeBlock row={main} other={sub} canEdit={canEdit}
              onPick={(idx, v) => {
                const f = (['judge1', 'judge2', 'judge3'] as const)[idx]
                set(s, '주', { [f]: v } as Partial<PumpTestRow>)
                commit(s, '주', { [f]: v } as Partial<PumpTestRow>)
              }} />
          </div>
        )
      })}
    </section>
  )
}

function JudgeBlock({ row, other, canEdit, onPick }: {
  row: PumpTestRow
  other: PumpTestRow
  canEdit: boolean
  onPick: (idx: number, v: 'O' | 'X' | null) => void
}) {
  const j = judgePumpTest(row)
  const manual = [row.judge1, row.judge2, row.judge3]
  void other
  return (
    <div className="space-y-1 border-t border-[#f3f1fc] pt-1.5">
      <p className="text-[10px] font-medium text-[#847ba8]">적정 여부</p>
      {PUMP_JUDGE_LABELS.map((label, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="min-w-0 flex-1 text-[#514b81]">{label}</span>
          {j.auto[i] && !manual[i] && (
            <span className={`rounded px-1 ${j.auto[i] === 'O' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              자동 {j.auto[i]}
            </span>
          )}
          {(['O', 'X'] as const).map(v => (
            <button key={v} disabled={!canEdit}
              aria-label={`${label} ${v}`}
              onClick={() => onPick(i, manual[i] === v ? null : v)}
              className={`h-5 w-6 rounded border text-[10px] disabled:opacity-50
                ${manual[i] === v ? 'border-[#7b68ee] bg-[#7b68ee] text-white' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`}>
              {v}
            </button>
          ))}
          {!j.auto[i] && j.reasons[i] && <span className="w-full text-[9px] text-amber-600">⚠ {j.reasons[i]}</span>}
        </div>
      ))}
      <p className="text-[9px] text-[#b0acd6]">
        ①③은 정격토출압 대비 비율이라 실측치만으로 계산됩니다. ②의 &lsquo;규정치&rsquo;는 펌프 명판·설계치라
        시스템에 없어 자동 판정하지 않습니다 — 직접 눌러 주세요.
      </p>
    </div>
  )
}
