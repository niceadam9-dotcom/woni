'use client'

import { Plus, Trash2 } from 'lucide-react'
import type { PlanTextEditorField, PlanTextSectionDef } from '@/lib/plan-text-sections'

/** 공통 서술 본문 편집기 (소방계획서_21 R1-4) — PlanTextSectionDef.editor 스펙 하나로 8섹션을 담당.
 *
 *  기존 서식 컴포넌트(plan-form111·plan-ch2·plan-ch3 등)를 재사용하지 않는 이유:
 *  props가 customerId에 묶여 있고, 라이브러리에 있으면 안 되는 고객 고유 입력칸(일자·인원·집결지)과
 *  저장 버튼·가져오기 칩을 함께 품는다. 여기는 '서술만' 그린다.
 *
 *  body 모양은 두 가지뿐이다 — 고정키 Record<string,string> 와 Row[]. 그 조합으로 8섹션이 전부 표현된다. */

type Row = Record<string, string>
const dict = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const inputCls = 'w-full rounded-lg border border-[#d0ccf5] bg-white px-2.5 py-1.5 text-xs text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/15 transition disabled:bg-[#fafafa] disabled:text-[#847ba8]'

export function PlanTextBodyEditor({ def, value, onChange, disabled }: {
  def: PlanTextSectionDef
  value: unknown
  onChange: (next: unknown) => void
  disabled?: boolean
}) {
  /** 필드 단위 갱신 — body가 배열 자체인 경우(key 없는 rows)와 객체인 경우를 구분한다 */
  const setAt = (key: string | undefined, next: unknown) => {
    if (key === undefined) { onChange(next); return }
    onChange({ ...dict(value), [key]: next })
  }

  return (
    <div className="space-y-3">
      {def.editor.map((f, i) => <Field key={i} f={f} value={value} setAt={setAt} disabled={disabled} />)}
    </div>
  )
}

function Field({ f, value, setAt, disabled }: {
  f: PlanTextEditorField
  value: unknown
  setAt: (key: string | undefined, next: unknown) => void
  disabled?: boolean
}) {
  if (f.kind === 'text') {
    const v = str(dict(value)[f.key])
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-[#514b81]">{f.label}</label>
        {f.multiline ? (
          <textarea value={v} disabled={disabled} placeholder={f.placeholder} rows={5}
            onChange={e => setAt(f.key, e.target.value)}
            className={`${inputCls} resize-y leading-relaxed`} />
        ) : (
          <input value={v} disabled={disabled} placeholder={f.placeholder}
            onChange={e => setAt(f.key, e.target.value)} className={inputCls} />
        )}
      </div>
    )
  }

  if (f.kind === 'record') {
    const d = dict(value)
    return (
      <div className="space-y-2">
        {f.entries.map(e => (
          <div key={e.key} className="space-y-1">
            <label className="text-[11px] font-medium text-[#514b81]">{e.label}</label>
            <textarea value={str(d[e.key])} disabled={disabled} rows={2}
              onChange={ev => setAt(undefined, { ...d, [e.key]: ev.target.value })}
              className={`${inputCls} resize-y leading-relaxed`} />
          </div>
        ))}
      </div>
    )
  }

  // rows — key 없으면 body 자체가 배열
  const list = rows(f.key === undefined ? value : dict(value)[f.key])
  const write = (next: Row[]) => setAt(f.key, next)
  const blank: Row = Object.fromEntries(f.cols.map(c => [c.key, '']))

  return (
    <div className="space-y-1.5">
      {list.length === 0 && (
        <p className="text-[11px] text-[#b0acd6]">등록된 행이 없습니다 — 아래 버튼으로 추가하세요.</p>
      )}
      {list.map((r, idx) => (
        <div key={idx} className="flex items-start gap-1.5">
          <span className="w-5 shrink-0 pt-2 text-[10px] text-[#b0acd6]">{idx + 1}</span>
          <div className="flex-1 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${f.cols.length}, minmax(0, 1fr))` }}>
            {f.cols.map(c => (
              <div key={c.key} className="space-y-0.5">
                {idx === 0 && <label className="block text-[10px] text-[#847ba8]">{c.label}</label>}
                <input value={str(r[c.key])} disabled={disabled} placeholder={c.label}
                  onChange={e => write(list.map((x, j) => (j === idx ? { ...x, [c.key]: e.target.value } : x)))}
                  className={inputCls} />
              </div>
            ))}
          </div>
          <button type="button" disabled={disabled} title="행 삭제"
            onClick={() => write(list.filter((_, j) => j !== idx))}
            className={`shrink-0 rounded p-1 text-[#b0acd6] hover:bg-red-50 hover:text-red-500 disabled:opacity-40 ${idx === 0 ? 'mt-4' : 'mt-1'}`}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <button type="button" disabled={disabled} onClick={() => write([...list, blank])}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#c3bdf5] px-2.5 py-1 text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
        <Plus className="size-3" /> {f.addLabel ?? '행 추가'}
      </button>
    </div>
  )
}
