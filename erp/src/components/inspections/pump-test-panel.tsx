'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { savePumpTestAction } from '@/app/(dashboard)/inspections/pump-test-actions'
import { useUnsavedWarning } from '@/components/ui/fields'
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
  // V21-3: blur 저장이라 **blur 전에 화면을 떠나면 유실된다**. 아직 커밋되지 않은 행을 추적해
  // 공용 미저장 규약(useUnsavedWarning)에 참여시킨다 — 확인창의 [저장하고 이동]이 여기로 들어온다.
  const [dirty, setDirty] = useState<Set<string>>(new Set())

  const set = (s: number, k: PumpKind, patch: Partial<PumpTestRow>) => {
    setRows(prev => ({ ...prev, [key(s, k)]: { ...prev[key(s, k)], ...patch } }))
    setDirty(prev => new Set(prev).add(key(s, k)))
  }

  /** 한 행 저장. 성공하면 dirty에서 뺀다 — 성공 여부를 돌려줘 일괄 저장이 실패를 알 수 있게 한다 */
  async function saveRow(s: number, k: PumpKind, patch?: Partial<PumpTestRow>): Promise<boolean> {
    if (!canEdit) return true
    const id = key(s, k)
    const row = { ...rows[id], ...patch }
    setSaving(id)
    setErr('')
    const res = await savePumpTestAction(inspectionId, s, k, {
      shutoffFlow: row.shutoffFlow, shutoffPress: row.shutoffPress,
      ratedFlow: row.ratedFlow, ratedPress: row.ratedPress,
      overFlow: row.overFlow, overPress: row.overPress,
      setStartPress: row.setStartPress, setStopPress: row.setStopPress,
      judge1: row.judge1, judge2: row.judge2, judge3: row.judge3, note: row.note,
    })
    setSaving(null)
    if (res.error) { setErr(res.error); return false }
    setDirty(prev => { const n = new Set(prev); n.delete(id); return n })
    setSaved(p => ({ ...p, [id]: true }))
    setTimeout(() => setSaved(p => ({ ...p, [id]: false })), 4000)
    return true
  }

  function commit(s: number, k: PumpKind, patch?: Partial<PumpTestRow>) {
    void saveRow(s, k, patch)
  }

  /** 미저장 확인창의 [저장하고 이동] — 아직 커밋되지 않은 행을 전부 저장한다 */
  async function saveAllDirty(): Promise<boolean> {
    const ids = [...dirty]
    for (const id of ids) {
      const [sRaw, kRaw] = id.split('|')
      const ok = await saveRow(Number(sRaw), kRaw as PumpKind)
      if (!ok) return false
    }
    return true
  }
  useUnsavedWarning(dirty.size > 0, saveAllDirty)

  if (sheetNos.length === 0) return null

  const numCell = 'w-full rounded border border-brand-line-soft px-1 py-0.5 text-right text-[11px] focus:outline-none focus:border-brand disabled:bg-paper'
  const numVal = (v: number | null) => (v == null ? '' : String(v))
  const onNum = (s: number, k: PumpKind, f: Field) => ({
    value: numVal(rows[key(s, k)][f]),
    disabled: !canEdit,
    inputMode: 'decimal' as const,
    className: numCell,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.trim()
      // V21-4: 음수·숫자 아님은 화면에서도 받지 않는다(서버 num()과 같은 규칙) —
      // 토출량·토출압은 물리적으로 음수가 될 수 없고, 음수가 들어가면 판정식이 조용히 뒤집힌다.
      // 0은 유효하다(체절운전 토출량은 통상 0).
      if (raw === '') { set(s, k, { [f]: null } as Partial<PumpTestRow>); return }
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0) return
      set(s, k, { [f]: n } as Partial<PumpTestRow>)
    },
    onBlur: () => commit(s, k),
  })

  return (
    <section className="rounded-lg border border-brand-line-soft bg-surface" data-testid="pump-test-panel">
      <div className="flex items-center gap-1.5 border-b border-brand-tint bg-brand-tint px-2.5 py-1.5">
        <p className="text-[11px] font-semibold text-ink-sub">※ 펌프성능시험</p>
        <span className="text-[10px] text-ink-faint">별지 4호서식 표 — 펌프 명판 및 설계치 참조</span>
      </div>

      {/* 설비가 여러 개면 탭 — 서식도 설비마다 표가 따로 붙는다 */}
      {sheetNos.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-brand-line-soft px-2 py-1.5">
          {sheetNos.map(s => (
            <button key={s} onClick={() => setOpenSheet(s)}
              className={`rounded px-2 py-0.5 text-[10px] ${openSheet === s ? 'bg-brand text-white' : 'text-ink-sub hover:bg-brand-tint'}`}>
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
                <tr className="text-[10px] text-ink-soft">
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
                    <tr key={`${label}-${k}`} className="border-t border-brand-line-soft">
                      <td className="px-1 py-0.5 text-ink-sub">
                        {ki === 0 && <span className="mr-1">{label}</span>}
                        <span className="text-ink-faint">{k}</span>
                      </td>
                      <td className="px-1 py-0.5"><input aria-label={`${PUMP_SHEET_LABELS[s]} ${k}펌프 ${label} 체절운전`} {...onNum(s, k, f1)} /></td>
                      <td className="px-1 py-0.5"><input aria-label={`${PUMP_SHEET_LABELS[s]} ${k}펌프 ${label} 정격운전`} {...onNum(s, k, f2)} /></td>
                      <td className="px-1 py-0.5"><input aria-label={`${PUMP_SHEET_LABELS[s]} ${k}펌프 ${label} 150% 운전`} {...onNum(s, k, f3)} /></td>
                    </tr>
                  )))}
              </tbody>
            </table>

            {/* ㅇ설정압력 — 서식 좌측 블록 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-brand-line-soft pt-1.5 text-[10px] text-ink-sub">
              <span className="text-ink-soft">ㅇ설정압력</span>
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
                {(saving === key(s, '주') || saving === key(s, '예비')) && <Loader2 className="size-3 animate-spin text-brand" />}
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
    <div className="space-y-1 border-t border-brand-line-soft pt-1.5">
      <p className="text-[10px] font-medium text-ink-soft">적정 여부</p>
      {PUMP_JUDGE_LABELS.map((label, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="min-w-0 flex-1 text-ink-sub">{label}</span>
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
                ${manual[i] === v ? 'border-brand bg-brand text-white' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`}>
              {v}
            </button>
          ))}
          {!j.auto[i] && j.reasons[i] && <span className="w-full text-[9px] text-amber-600">⚠ {j.reasons[i]}</span>}
        </div>
      ))}
      <p className="text-[9px] text-ink-faint">
        ①③은 정격토출압 대비 비율이라 실측치만으로 계산됩니다. ②의 &lsquo;규정치&rsquo;는 펌프 명판·설계치라
        시스템에 없어 자동 판정하지 않습니다 — 직접 눌러 주세요.
      </p>
    </div>
  )
}
