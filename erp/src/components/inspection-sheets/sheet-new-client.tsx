'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2, GripVertical, Hash } from 'lucide-react'
import { createSheetAction, generateSheetCodeAction, type SheetItemInput } from '@/app/(dashboard)/inspection-sheets/actions'
import type { InspectionType } from '@/types'

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'
const labelCls = 'text-xs font-medium text-[#514b81]'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  )
}

type ItemForm = {
  item_code: string; item_name: string; facility_type: string
  inspection_method: string; judgment_criteria: string
}

const emptyItem = (): ItemForm => ({
  item_code: '', item_name: '', facility_type: '',
  inspection_method: '', judgment_criteria: '',
})

const FACILITY_TYPES = ['소화기', '옥내소화전', '스프링클러', '자동화재탐지설비', '비상경보설비', '피난설비', '소화활동설비', '기타']

export function SheetNewClient() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  const [form, setForm] = useState({
    sheet_code: '',
    sheet_name: '',
    version: '1.0',
    inspection_type: '' as InspectionType | '',
    description: '',
  })
  const [items, setItems] = useState<ItemForm[]>([emptyItem()])

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleGenerateSheetCode() {
    const prefix = form.sheet_code.replace(/[-_]?\d+$/, '').trim() || 'CHK'
    setIsGenerating(true)
    const result = await generateSheetCodeAction(prefix)
    setIsGenerating(false)
    if (result.code) setField('sheet_code', result.code)
  }

  function setItem(idx: number, key: keyof ItemForm, value: string) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: value } : it))
  }

  function addItem() {
    setItems(prev => {
      const nextNum = prev.length + 1
      const newItem = { ...emptyItem(), item_code: String(nextNum).padStart(2, '0') }
      return [...prev, newItem]
    })
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function handleSubmit() {
    setError('')
    if (!form.sheet_code.trim()) { setError('점검표 코드를 입력해주세요.'); return }
    if (!form.sheet_name.trim()) { setError('점검표명을 입력해주세요.'); return }
    if (!form.version.trim()) { setError('버전을 입력해주세요.'); return }

    const validItems = items.filter(it => it.item_code.trim() && it.item_name.trim())

    startTransition(async () => {
      const result = await createSheetAction({
        sheet_code: form.sheet_code.trim(),
        sheet_name: form.sheet_name.trim(),
        version: form.version.trim(),
        inspection_type: (form.inspection_type as InspectionType) || undefined,
        description: form.description.trim() || undefined,
        items: validItems.map((it, i): SheetItemInput => ({
          item_code: it.item_code.trim(),
          item_name: it.item_name.trim(),
          facility_type: it.facility_type || undefined,
          inspection_method: it.inspection_method.trim() || undefined,
          judgment_criteria: it.judgment_criteria.trim() || undefined,
          order_num: i + 1,
        })),
      })
      if (result.error) { setError(result.error); return }
      router.push(`/inspection-sheets/${result.sheetId}`)
      router.refresh()
    })
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* 기본정보 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#090c1d]">점검표 기본정보</h2>

        <div className="grid grid-cols-3 gap-4">
          <Field label="점검표 코드" required>
            <div className="flex gap-1.5">
              <input
                value={form.sheet_code}
                onChange={e => setField('sheet_code', e.target.value.toUpperCase())}
                placeholder="접두어 입력 후 자동생성 (예: CHK)"
                className={`${inputCls} flex-1`}
              />
              <button
                type="button"
                onClick={handleGenerateSheetCode}
                disabled={isGenerating}
                title="현재 입력값을 접두어로 사용해 다음 번호를 자동 생성합니다"
                className="h-10 px-3 rounded-lg bg-[#f5f4ff] hover:bg-[#ebe9ff] text-[#7b68ee] text-xs font-medium transition-colors border border-[#d0ccf5] whitespace-nowrap flex items-center gap-1.5 disabled:opacity-50"
              >
                {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Hash className="size-3.5" />}
                자동생성
              </button>
            </div>
          </Field>
          <Field label="버전" required>
            <input
              value={form.version}
              onChange={e => setField('version', e.target.value)}
              placeholder="예: 1.0"
              className={inputCls}
            />
          </Field>
          <Field label="점검유형">
            <select
              value={form.inspection_type}
              onChange={e => setField('inspection_type', e.target.value)}
              className={inputCls}
            >
              <option value="">공통 (전체)</option>
              <option value="종합">종합</option>
              <option value="최초">최초</option>
              <option value="기타">기타</option>
            </select>
          </Field>
        </div>

        <Field label="점검표명" required>
          <input
            value={form.sheet_name}
            onChange={e => setField('sheet_name', e.target.value)}
            placeholder="예: 종합정밀점검 체크리스트"
            className={inputCls}
          />
        </Field>

        <Field label="설명">
          <textarea
            value={form.description}
            onChange={e => setField('description', e.target.value)}
            placeholder="점검표 설명 (선택)"
            rows={2}
            className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2.5 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
          />
        </Field>
      </section>

      {/* 점검 항목 */}
      <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#090c1d]">점검 항목</h2>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors"
          >
            <Plus className="size-3" />
            항목 추가
          </button>
        </div>

        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="border border-[#c8c4d0] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GripVertical className="size-4 text-[#b0acd6]" />
                  <span className="text-xs font-semibold text-[#514b81]">항목 {idx + 1}</span>
                </div>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="h-6 w-6 flex items-center justify-center rounded text-[#b0acd6] hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>항목코드 <span className="text-red-500">*</span></label>
                  <input
                    value={item.item_code}
                    onChange={e => setItem(idx, 'item_code', e.target.value)}
                    placeholder="예: A-01"
                    className={inputCls}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className={labelCls}>점검 항목명 <span className="text-red-500">*</span></label>
                  <input
                    value={item.item_name}
                    onChange={e => setItem(idx, 'item_name', e.target.value)}
                    placeholder="예: 소화기 외관 점검"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={labelCls}>소방시설 유형</label>
                <select
                  value={item.facility_type}
                  onChange={e => setItem(idx, 'facility_type', e.target.value)}
                  className={inputCls}
                >
                  <option value="">선택</option>
                  {FACILITY_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={labelCls}>점검방법</label>
                  <textarea
                    value={item.inspection_method}
                    onChange={e => setItem(idx, 'inspection_method', e.target.value)}
                    placeholder="점검 방법 기술"
                    rows={2}
                    className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>판정기준</label>
                  <textarea
                    value={item.judgment_criteria}
                    onChange={e => setItem(idx, 'judgment_criteria', e.target.value)}
                    placeholder="양호/불량 판정기준"
                    rows={2}
                    className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition resize-none"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-[#b0acd6]">항목코드·항목명이 없는 행은 저장 시 제외됩니다.</p>
      </section>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

      <div className="flex gap-3 pb-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 h-11 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="flex-1 h-11 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : '점검표 등록'}
        </button>
      </div>
    </div>
  )
}
