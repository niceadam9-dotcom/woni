'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, Loader2, RotateCcw, Save, Settings2 } from 'lucide-react'
import { getFirePlanPresetsAction, saveFirePlanPresetAction } from '@/app/(dashboard)/fire-plans/generate/actions'
import { PRESET_TYPES, defaultPreset, type FirePlanPreset, type PresetType } from '@/lib/fire-plan-presets'

/** 7차 — 공통 수기 프리셋 관리 (건물 유형별 문구 편집)
 *  양식 기본값(find)을 유형별 문구(value)로 치환. 문구를 비우거나 기본값과 같게 두면 양식 기본값 유지 */
export function FirePlanPresetManager() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<PresetType>('주택형')
  const [presets, setPresets] = useState<FirePlanPreset[] | null>(null)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && !presets) {
      startTransition(async () => {
        const r = await getFirePlanPresetsAction()
        setPresets(r.presets)
      })
    }
  }

  const current = presets?.find(p => p.type === tab)

  function setValue(idx: number, value: string) {
    if (!presets) return
    setPresets(presets.map(p => p.type !== tab ? p : {
      ...p, entries: p.entries.map((e, i) => i === idx ? { ...e, value } : e),
    }))
  }

  function restoreDefault() {
    if (!presets) return
    setPresets(presets.map(p => p.type !== tab ? p : defaultPreset(tab)))
    setMessage(`${tab} 문구를 기본값으로 되돌렸습니다 — [저장]을 눌러야 반영됩니다`)
  }

  function save() {
    if (!current) return
    setMessage('')
    startTransition(async () => {
      const res = await saveFirePlanPresetAction(current)
      setMessage(res.error ? `❌ ${res.error}` : `✅ ${tab} 프리셋 저장 완료 — 이후 생성 요청부터 적용됩니다`)
    })
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0]">
      <button onClick={toggle}
        className="w-full flex items-center gap-2 px-5 py-3 text-sm font-semibold text-[#514b81] hover:bg-[#f5f4ff] rounded-xl transition-colors">
        <Settings2 className="size-4 text-[#7b68ee]" />
        공통 수기 프리셋 관리 (건물 유형별 문구)
        <span className="ml-auto">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          <p className="text-[11px] text-[#b0acd6]">
            훈련 시나리오·피난 절차 등 양식의 수기 문구를 유형별로 관리합니다.
            문구를 기본값 그대로 두면 양식 기본값이 유지되며, 고객 데이터가 있는 항목은 항상 고객 데이터가 우선합니다.
          </p>
          <div className="flex items-center gap-1">
            {PRESET_TYPES.map(t => (
              <button key={t} onClick={() => { setTab(t); setMessage('') }}
                className={`h-8 px-4 rounded-lg text-sm font-medium transition-colors ${
                  tab === t ? 'bg-[#7b68ee] text-white' : 'bg-[#f5f4ff] text-[#514b81] hover:bg-[#e8e5fb]'
                }`}>
                {t}
              </button>
            ))}
            {current?.updatedAt && (
              <span className="ml-auto text-[11px] text-[#b0acd6]">
                수정 {current.updatedAt.slice(0, 16).replace('T', ' ')}{current.updatedBy ? ` · ${current.updatedBy}` : ''}
              </span>
            )}
          </div>
          {!presets ? (
            <p className="text-sm text-[#b0acd6] flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> 불러오는 중…</p>
          ) : current && (
            <>
              <p className="text-xs text-[#514b81]">{current.description}</p>
              <div className="space-y-2">
                {current.entries.map((e, i) => (
                  <div key={i} className="rounded-lg border border-[#e5e2f0] p-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-[#090c1d]">{e.title}</span>
                      <span className="text-[#b0acd6]">{e.section}</span>
                    </div>
                    <p className="text-[11px] text-[#b0acd6] mt-1 truncate">양식 기본값: {e.find}</p>
                    <textarea value={e.value} rows={e.value.length > 60 ? 2 : 1}
                      onChange={ev => setValue(i, ev.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#7b68ee] resize-y" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={save} disabled={isPending}
                  className="h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} 저장
                </button>
                <button onClick={restoreDefault} disabled={isPending}
                  className="h-9 px-4 rounded-lg border border-[#d0ccf5] text-[#514b81] text-sm font-medium hover:bg-[#f5f4ff] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">
                  <RotateCcw className="size-4" /> 기본값 복원
                </button>
                {message && <span className="text-xs text-[#514b81]">{message}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
