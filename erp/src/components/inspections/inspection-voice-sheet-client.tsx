'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, Loader2, Sparkles, Check, AlertTriangle } from 'lucide-react'
import { parseVoiceSheetAction, applyVoiceSheetAction, type VoiceSheetEntry } from '@/app/(dashboard)/inspections/voice-sheet-actions'

/** V-1 음성 점검표 입력 (§9-4) — Plaud 전사 붙여넣기 → AI 구조화 제안 → 점검자 확인·확정 → 점검표 반영.
 *  무검수 자동확정 금지: 제안 목록에서 항목별 확인 후 [확정 저장]해야 inspection_sheet_responses에 저장된다. */

const RESULT_STYLE: Record<string, string> = {
  O: 'bg-green-50 text-green-700 border-green-200',
  X: 'bg-red-50 text-red-600 border-red-200',
  N: 'bg-gray-100 text-gray-600 border-gray-200',
}

export function InspectionVoiceSheetClient({ inspectionId, canManage }: {
  inspectionId: string
  canManage: boolean
}) {
  const router = useRouter()
  const [transcript, setTranscript] = useState('')
  const [entries, setEntries] = useState<VoiceSheetEntry[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [missing, setMissing] = useState<string[]>([])
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function parse() {
    setMsg('')
    startTransition(async () => {
      const res = await parseVoiceSheetAction(inspectionId, transcript)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setEntries(res.entries ?? [])
      setChecked(new Set((res.entries ?? []).map(e => e.item_code)))
      setMissing(res.missingSheets ?? [])
      if ((res.entries ?? []).length === 0) setMsg('매칭된 항목이 없습니다 — 발화 규칙(층수+시설명+상태)을 확인해주세요.')
    })
  }
  function apply() {
    if (!entries) return
    const rows = entries.filter(e => checked.has(e.item_code))
      .map(e => ({ item_code: e.item_code, result: e.result, memo: e.memo || null }))
    startTransition(async () => {
      const res = await applyVoiceSheetAction(inspectionId, rows, transcript)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ ${res.saved}건 저장됨${(res.defectsAdded ?? 0) > 0 ? ` · 불량 ${res.defectsAdded}건 자동 등록` : ''} — 점검표에 반영됐습니다`)
      setEntries(null)
      setTranscript('')
      router.refresh()
    })
  }

  if (!canManage) return null
  const checkedCount = entries ? entries.filter(e => checked.has(e.item_code)).length : 0

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-2">
        <Mic className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">음성 점검표 입력 (V-1)</h2>
        <span className="text-[11px] text-[#b0acd6]">Plaud 전사 붙여넣기 → AI 구조화 → 확인 후 점검표 반영</span>
      </div>
      <textarea value={transcript} onChange={e => setTranscript(e.target.value)} rows={3}
        placeholder={'발화 규칙: 층수 + 시설명 + 상태 (+사유)\n예: 3층 유도등 불량, 램프 파손 / 소화기 전부 양호 / 자탐 수신기 정상'}
        className="w-full rounded-lg border border-[#d0ccf5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#7b68ee] resize-y" />
      <div className="flex items-center gap-2 mt-2">
        <button onClick={parse} disabled={isPending || !transcript.trim()}
          className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50">
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} AI 구조화
        </button>
        <span className="text-[11px] text-[#b0acd6]">AI 결과는 제안일 뿐 — 점검자 확인 후 저장됩니다</span>
      </div>
      {msg && <p className="text-xs text-[#514b81] mt-2">{msg}</p>}

      {entries && entries.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#e0ddf5]">
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {entries.map(e => (
              <label key={e.item_code} className={`flex items-center gap-2 text-xs rounded px-1.5 py-1 cursor-pointer ${
                e.conflict ? 'bg-amber-50' : 'hover:bg-[#f8f9fa]'}`}>
                <input type="checkbox" checked={checked.has(e.item_code)}
                  onChange={() => setChecked(p => {
                    const n = new Set(p)
                    if (n.has(e.item_code)) n.delete(e.item_code)
                    else n.add(e.item_code)
                    return n
                  })} />
                <span className={`inline-flex items-center justify-center w-6 h-5 rounded border text-[11px] font-bold ${RESULT_STYLE[e.result]}`}>{e.result}</span>
                <span className="text-[#b0acd6] w-40 truncate" title={e.sheet_name}>{e.sheet_name}</span>
                <span className="text-[#090c1d] flex-1 truncate" title={e.item_name}>{e.item_code} {e.item_name}</span>
                {e.memo && <span className="text-[11px] text-[#514b81] truncate max-w-40" title={e.memo}>({e.memo})</span>}
                {e.conflict && <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600"><AlertTriangle className="size-3" /> 기존값과 다름</span>}
              </label>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="text-[11px] text-amber-600 mt-2">⚠ 응답 없는 설치 설비: {missing.join(' · ')} — 확인 필요</p>
          )}
          <button onClick={apply} disabled={isPending || checkedCount === 0}
            className="mt-2 inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            선택 {checkedCount}건 확정 저장
          </button>
        </div>
      )}
    </div>
  )
}
