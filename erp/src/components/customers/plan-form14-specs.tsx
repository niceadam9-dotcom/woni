'use client'

import { useMemo, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Loader2, Save } from 'lucide-react'
import { saveFacilitySpecAction } from '@/app/(dashboard)/customers/facility-spec-actions'
import { FACILITY_SPEC_SECTIONS, type SpecBlock, type SpecField } from '@/lib/facility-spec-schema'

/** 설비 대장 — 설비 세부 제원 입력 (S3A/H-19, 소방계획서_7.md §4-A-2)
 *  별지 4호 3~7쪽 = 별지 9호 4~7쪽 "소방시설등의 세부 현황" 공용 원본(customer_facility_specs).
 *  폼은 H-18 카탈로그(FACILITY_SPEC_SECTIONS)만으로 렌더 — 필드 하드코딩 금지.
 *  facilityHint 블록은 1.4 표에서 설치(√)된 설비만 펼침 가능(§4-A-2 입력량 최소화),
 *  힌트 없는 블록(3-2 수계 공통 등)은 항상 입력 가능. 저장은 섹션 단위(건물 축 = 1.4의 bidx). */

type FieldValue = string | boolean | string[]
type SectionValues = Record<string, Record<string, FieldValue>> // blockKey → fieldKey → 값

function initFieldValue(f: SpecField, raw: unknown): FieldValue {
  if (f.type === 'check') return raw === true
  if (f.type === 'multicheck') return Array.isArray(raw) ? raw.map(String) : []
  return raw == null ? '' : String(raw)
}
function isFilled(v: FieldValue): boolean {
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.length > 0
  return v.trim() !== ''
}
function hintCodes(b: SpecBlock): string[] {
  return (b.facilityHint ?? '').split(',').map(c => c.trim()).filter(Boolean)
}

const CATALOG_TOTAL = FACILITY_SPEC_SECTIONS.reduce(
  (n, s) => n + s.blocks.reduce((m, b) => m + b.fields.length, 0), 0)

export function PlanForm14Specs({ customerId, buildingId, installed, initialSpecs, receiverLocation, canManage }: {
  customerId: string
  buildingId: string
  /** 1.4 표의 현재 설치(√) 상태 — facility_code → installed (라이브 연동) */
  installed: Record<string, boolean>
  /** 서버 초기값: sectionKey → { blockKey: { fieldKey: 값 } } */
  initialSpecs: Record<string, Record<string, unknown>>
  /** 기존 필드 자동 연결(§4-A-1) — 빠른 입력의 수신기 위치(회색 표시, 재입력 금지) */
  receiverLocation?: string | null
  canManage: boolean
}) {
  const [values, setValues] = useState<Record<string, SectionValues>>(() => {
    const out: Record<string, SectionValues> = {}
    for (const sec of FACILITY_SPEC_SECTIONS) {
      const rawSec = (initialSpecs[sec.key] ?? {}) as Record<string, unknown>
      const sv: SectionValues = {}
      for (const bl of sec.blocks) {
        const rawBl = (rawSec[bl.key] ?? {}) as Record<string, unknown>
        sv[bl.key] = {}
        for (const f of bl.fields) sv[bl.key][f.key] = initFieldValue(f, rawBl[f.key])
      }
      out[sec.key] = sv
    }
    return out
  })
  const [openSec, setOpenSec] = useState<string | null>(null)
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState<string | null>(null) // 미설치 블록 클릭 안내 대상
  const [msg, setMsg] = useState('')
  const [savingSec, setSavingSec] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const enabled = (b: SpecBlock) => !b.facilityHint || hintCodes(b).some(c => installed[c])

  // 완성도 — 전체(카탈로그) + 설치 설비 기준(펼침 가능 블록만 분모)
  const gauge = useMemo(() => {
    const per: Record<string, { filled: number; total: number }> = {}
    let filledAll = 0, filledOn = 0, totalOn = 0
    for (const sec of FACILITY_SPEC_SECTIONS) {
      let f = 0, t = 0
      for (const bl of sec.blocks) {
        const on = enabled(bl)
        for (const fd of bl.fields) {
          const filled = isFilled(values[sec.key][bl.key][fd.key])
          if (filled) filledAll++
          if (on) { t++; if (filled) f++ }
        }
      }
      per[sec.key] = { filled: f, total: t }
      filledOn += f; totalOn += t
    }
    return { per, filledAll, filledOn, totalOn }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, installed])

  function setField(secKey: string, blKey: string, fKey: string, v: FieldValue) {
    setValues(p => ({ ...p, [secKey]: { ...p[secKey], [blKey]: { ...p[secKey][blKey], [fKey]: v } } }))
    setDirty(p => ({ ...p, [secKey]: true }))
  }

  function saveSection(secKey: string) {
    const sec = FACILITY_SPEC_SECTIONS.find(s => s.key === secKey)
    if (!sec || !canManage) return
    // 값 있는 필드만 JSONB로 — 비운 필드는 저장에서 제거(값 삭제), 미설치 블록의 기존 값도 보존
    const spec: Record<string, Record<string, unknown>> = {}
    for (const bl of sec.blocks) {
      const out: Record<string, unknown> = {}
      for (const f of bl.fields) {
        const v = values[secKey][bl.key][f.key]
        if (!isFilled(v)) continue
        if (f.type === 'number' && typeof v === 'string') {
          const n = Number(v)
          out[f.key] = Number.isFinite(n) ? n : v
        } else out[f.key] = v
      }
      if (Object.keys(out).length > 0) spec[bl.key] = out
    }
    setSavingSec(secKey)
    startTransition(async () => {
      const res = await saveFacilitySpecAction(customerId, buildingId, secKey, spec)
      setSavingSec(null)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(p => ({ ...p, [secKey]: false }))
      setMsg(`✅ ${sec.no} ${sec.label} 제원 저장됨 — 별지 4호(3~7쪽)·9호(4~7쪽) 세부현황에 반영됩니다`)
    })
  }

  /** 필드 1개 위젯 — type별 렌더, 미입력은 옅은 주황 하이라이트(§4-A-2) */
  function fieldWidget(secKey: string, bl: SpecBlock, f: SpecField, blockOn: boolean) {
    const v = values[secKey][bl.key][f.key]
    const empty = !isFilled(v)
    const dis = !canManage || !blockOn
    const box = `h-7 w-full rounded border px-1.5 text-xs outline-none focus:border-[#7b68ee] disabled:opacity-60 ${
      empty ? 'border-amber-200 bg-amber-50/40' : 'border-[#d0ccf5] bg-white'}`
    if (f.type === 'check') {
      return (
        <button type="button" disabled={dis} onClick={() => setField(secKey, bl.key, f.key, !(v as boolean))}
          aria-label={f.label}
          className={`inline-flex items-center gap-1 h-7 text-xs ${v ? 'font-bold text-[#090c1d]' : 'text-[#514b81] hover:text-[#7b68ee]'} disabled:opacity-60`}>
          <span className="text-sm leading-none">{v ? '☑' : '☐'}</span> 해당
        </button>
      )
    }
    if (f.type === 'multicheck') {
      const arr = v as string[]
      return (
        <div className="flex flex-wrap gap-x-2.5 gap-y-1 py-1">
          {(f.options ?? []).map(o => {
            const on = arr.includes(o)
            return (
              <button key={o} type="button" disabled={dis}
                onClick={() => setField(secKey, bl.key, f.key, on ? arr.filter(x => x !== o) : [...arr, o])}
                className={`inline-flex items-center gap-1 text-[11px] ${on ? 'font-bold text-[#090c1d]' : 'text-[#514b81] hover:text-[#7b68ee]'} disabled:opacity-60`}>
                <span>{on ? '☑' : '☐'}</span>{o}
              </button>
            )
          })}
        </div>
      )
    }
    if (f.type === 'select') {
      return (
        <select value={v as string} disabled={dis} aria-label={f.label}
          onChange={e => setField(secKey, bl.key, f.key, e.target.value)} className={box}>
          <option value="">—</option>
          {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    return (
      <div className="flex items-center gap-1">
        <input value={v as string} disabled={dis} aria-label={f.label}
          inputMode={f.type === 'number' ? 'decimal' : undefined}
          onChange={e => setField(secKey, bl.key, f.key, e.target.value)} className={box} />
        {f.unit && <span className="text-[10px] text-[#b0acd6] shrink-0">{f.unit}</span>}
      </div>
    )
  }

  return (
    <details className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] px-4 py-2">
      <summary className="text-xs font-semibold text-[#514b81] cursor-pointer select-none">
        설비 대장 — 설비 세부 제원
        <span className="ml-1.5 font-normal text-[#b0acd6]">(별지 4호 3~7쪽·9호 4~7쪽 세부현황)</span>
        <span className="ml-2 font-normal text-[#7b68ee]">
          제원 입력 {gauge.filledAll}/{CATALOG_TOTAL} — 설치 설비 기준 {gauge.filledOn}/{gauge.totalOn}
        </span>
      </summary>

      <div className="mt-2 space-y-2">
        <p className="text-[11px] text-[#514b81]">
          <span className="inline-flex items-center rounded bg-[#7b68ee]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#7b68ee] mr-1">입력</span>
          이 영역이 설비 제원의 단일 원본입니다 — 별지 4호 1·2쪽 대상물·점검결과는
          <span className="inline-flex items-center rounded bg-[#eeecf8] px-1.5 py-0.5 text-[10px] font-semibold text-[#514b81] mx-1">자동</span>
          (고객정보·점검표에서 채움). 설치(√)한 설비 블록만 펼쳐 입력합니다.
        </p>

        {FACILITY_SPEC_SECTIONS.map(sec => {
          const g = gauge.per[sec.key]
          const secOpen = openSec === sec.key
          const pct = g.total > 0 ? Math.round((g.filled / g.total) * 100) : 0
          return (
            <div key={sec.key} data-spec-section={sec.key} className="rounded-lg border border-[#e0ddf5] bg-white">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <button type="button" onClick={() => { setOpenSec(secOpen ? null : sec.key); setNotice(null) }}
                  className="flex flex-1 items-center gap-2 text-left min-w-0">
                  {secOpen ? <ChevronDown className="size-3.5 text-[#b0acd6] shrink-0" /> : <ChevronRight className="size-3.5 text-[#b0acd6] shrink-0" />}
                  <span className="text-xs font-semibold text-[#090c1d] truncate">{sec.no} {sec.label}</span>
                  {dirty[sec.key] && <span className="text-[10px] text-amber-500">● 미저장</span>}
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    <span className="h-1 w-16 rounded bg-[#eeecf8] overflow-hidden">
                      <span className="block h-full bg-[#7b68ee]" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-[10px] text-[#514b81] tabular-nums">{g.total > 0 ? `${g.filled}/${g.total}` : '—'}</span>
                  </span>
                </button>
                {canManage && secOpen && (
                  <button type="button" onClick={() => saveSection(sec.key)} disabled={savingSec === sec.key}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded-lg bg-[#7b68ee] text-white text-[11px] font-medium disabled:opacity-50 shrink-0">
                    {savingSec === sec.key ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} 제원 저장
                  </button>
                )}
              </div>

              {secOpen && (
                <div className="border-t border-[#eeecf8] px-3 py-2 space-y-2">
                  {sec.blocks.map(bl => {
                    const on = enabled(bl)
                    const bid = `${sec.key}.${bl.key}`
                    const blOpen = on && !!openBlocks[bid]
                    const blFilled = bl.fields.filter(f => isFilled(values[sec.key][bl.key][f.key])).length
                    return (
                      <div key={bl.key} data-spec-block={bl.key}
                        className={`rounded-lg border ${on ? 'border-[#e0ddf5]' : 'border-[#eeecf8] bg-[#f8f8fb]'}`}>
                        <button type="button"
                          onClick={() => {
                            if (!on) { setNotice(notice === bid ? null : bid); return }
                            setOpenBlocks(p => ({ ...p, [bid]: !p[bid] }))
                          }}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
                          {on
                            ? (blOpen ? <ChevronDown className="size-3 text-[#b0acd6] shrink-0" /> : <ChevronRight className="size-3 text-[#b0acd6] shrink-0" />)
                            : <span className="inline-flex items-center rounded bg-[#eeecf8] px-1.5 py-0.5 text-[10px] text-[#b0acd6] shrink-0">미설치</span>}
                          <span className={`text-[11px] ${on ? 'font-medium text-[#090c1d]' : 'text-[#b0acd6]'}`}>{bl.label}</span>
                          {on && blFilled > 0 && <span className="ml-auto text-[10px] text-[#7b68ee] tabular-nums">{blFilled}/{bl.fields.length}</span>}
                        </button>
                        {!on && notice === bid && (
                          <p className="px-2.5 pb-1.5 text-[10px] text-[#514b81]">
                            1.4 설비 표에서 &lsquo;{hintCodes(bl)[0]}&rsquo;{hintCodes(bl).length > 1 ? ' 등' : ''} 설치 체크 후 입력할 수 있습니다.
                          </p>
                        )}
                        {blOpen && (
                          <div className="border-t border-[#eeecf8] px-2.5 py-2">
                            {receiverLocation && (bl.key === 'fire_detection' || bl.key === 'fire_alert') && (
                              <p className="mb-1.5 text-[10px] text-[#b0acd6]">
                                <span className="inline-flex items-center rounded bg-[#eeecf8] px-1 py-px font-semibold text-[#514b81] mr-1">자동</span>
                                빠른 입력의 수신기 위치: {receiverLocation} — 수정은 계획서 정보(1.1)에서
                              </p>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1.5">
                              {bl.fields.map(f => (
                                <div key={f.key} className={f.type === 'multicheck' ? 'col-span-full' : ''}>
                                  <p className="mb-0.5 text-[10px] text-[#514b81]">{f.label}{f.unit ? ` (${f.unit})` : ''}</p>
                                  {fieldWidget(sec.key, bl, f, on)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {msg && <p className="text-xs text-[#514b81]">{msg}</p>}
      </div>
    </details>
  )
}
