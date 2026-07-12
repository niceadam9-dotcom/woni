'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, X, Check } from 'lucide-react'
import { updateSheetAction } from '@/app/(dashboard)/inspection-sheets/actions'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

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
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#090c1d]">기본정보</h2>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
            >
              <Pencil className="size-3" />수정
            </button>
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={() => { setIsEditing(false); setError('') }}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                <X className="size-3" />취소
              </button>
              <button
                onClick={handleSave}
                disabled={isPending}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}저장
              </button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#514b81]">점검표명<span className="text-red-500 ml-0.5">*</span></label>
              <input value={form.sheet_name} onChange={e => setForm(p => ({ ...p, sheet_name: e.target.value }))} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#514b81]">설명</label>
              <textarea
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-[#514b81]">활성 상태</span>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.is_active ? 'bg-[#7b68ee]' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-xs text-[#514b81]">{form.is_active ? '활성' : '비활성'}</span>
            </div>
          </div>
        ) : (
          <dl className="space-y-3">
            <div>
              <dt className="text-xs text-[#514b81]">점검표명</dt>
              <dd className="mt-1 text-sm font-medium text-[#090c1d]">{sheet.sheet_name}</dd>
            </div>
            {sheet.description && (
              <div>
                <dt className="text-xs text-[#514b81]">설명</dt>
                <dd className="mt-1 text-sm text-[#090c1d]">{sheet.description}</dd>
              </div>
            )}
          </dl>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      </section>

      {/* 점검 항목 목록 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#c8c4d0] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#090c1d]">점검 항목 <span className="text-[#b0acd6] font-normal">({items.length}개)</span></h2>
        </div>
        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#b0acd6]">등록된 점검 항목이 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                  {['순번', '항목코드', '항목명', '시설유형', '점검방법', '판정기준'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c8c4d0]">
                {items.map(it => (
                  <tr key={it.id} className="hover:bg-[#f8f9fa] transition-colors">
                    <td className="px-4 py-3 text-xs text-[#b0acd6]">{it.order_num}</td>
                    <td className="px-4 py-3 text-xs font-mono text-[#514b81]">{it.item_code}</td>
                    <td className="px-4 py-3 font-medium text-[#090c1d]">{it.item_name}</td>
                    <td className="px-4 py-3">
                      {it.facility_type ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f4ff] text-[#7b68ee]">{it.facility_type}</span>
                      ) : <span className="text-xs text-[#b0acd6]">-</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81] max-w-[180px]">
                      {it.inspection_method ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81] max-w-[180px]">
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
