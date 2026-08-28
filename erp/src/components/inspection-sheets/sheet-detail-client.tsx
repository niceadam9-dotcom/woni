'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, X, Check } from 'lucide-react'
import { updateSheetAction } from '@/app/(dashboard)/inspection-sheets/actions'

const inputCls = 'w-full h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition'

type Sheet = {
  id: string; sheet_name: string; description: string | null; is_active: boolean
}
type SheetItem = {
  id: string; item_code: string; item_name: string; facility_type: string | null
  inspection_method: string | null; judgment_criteria: string | null; order_num: number
}

export function SheetDetailClient({ sheet, items }: { sheet: Sheet; items: SheetItem[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    sheet_name: sheet.sheet_name,
    description: sheet.description ?? '',
    is_active: sheet.is_active,
  })

  function handleSave() {
    setError('')
    if (!form.sheet_name.trim()) { setError('점검표명을 입력해주세요.'); return }
    startTransition(async () => {
      const result = await updateSheetAction({
        id: sheet.id,
        sheet_name: form.sheet_name.trim(),
        description: form.description.trim() || undefined,
        is_active: form.is_active,
      })
      if (result.error) { setError(result.error); return }
      setIsEditing(false)
      router.refresh()
    })
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* 기본정보 수정 */}
      <section className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">기본정보</h2>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors"
            >
              <Pencil className="size-3" />수정
            </button>
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={() => { setIsEditing(false); setError('') }}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-line text-xs text-ink-sub hover:bg-paper transition-colors"
              >
                <X className="size-3" />취소
              </button>
              <button
                onClick={handleSave}
                disabled={isPending}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-strong transition-colors disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}저장
              </button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-sub">점검표명<span className="text-red-500 ml-0.5">*</span></label>
              <input value={form.sheet_name} onChange={e => setForm(p => ({ ...p, sheet_name: e.target.value }))} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-sub">설명</label>
              <textarea
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition resize-none"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-ink-sub">활성 상태</span>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.is_active ? 'bg-brand' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-xs text-ink-sub">{form.is_active ? '활성' : '비활성'}</span>
            </div>
          </div>
        ) : (
          <dl className="space-y-3">
            <div>
              <dt className="text-xs text-ink-sub">점검표명</dt>
              <dd className="mt-1 text-sm font-medium text-ink">{sheet.sheet_name}</dd>
            </div>
            {sheet.description && (
              <div>
                <dt className="text-xs text-ink-sub">설명</dt>
                <dd className="mt-1 text-sm text-ink">{sheet.description}</dd>
              </div>
            )}
          </dl>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      </section>

      {/* 점검 항목 목록 */}
      <section className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">점검 항목 <span className="text-ink-faint font-normal">({items.length}개)</span></h2>
        </div>
        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink-faint">등록된 점검 항목이 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper">
                  {['순번', '항목코드', '항목명', '시설유형', '점검방법', '판정기준'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-ink-sub whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map(it => (
                  <tr key={it.id} className="hover:bg-paper transition-colors">
                    <td className="px-4 py-3 text-xs text-ink-faint">{it.order_num}</td>
                    <td className="px-4 py-3 text-xs font-mono text-ink-sub">{it.item_code}</td>
                    <td className="px-4 py-3 font-medium text-ink">{it.item_name}</td>
                    <td className="px-4 py-3">
                      {it.facility_type ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-brand-tint text-brand">{it.facility_type}</span>
                      ) : <span className="text-xs text-ink-faint">-</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-sub max-w-[180px]">
                      {it.inspection_method ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-sub max-w-[180px]">
                      {it.judgment_criteria ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
