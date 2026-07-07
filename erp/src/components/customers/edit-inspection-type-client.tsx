'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, X, Loader2 } from 'lucide-react'
import { updateCustomerAction } from '@/app/(dashboard)/customers/actions'
import type { InspectionType } from '@/types'

const TYPES: InspectionType[] = ['종합', '작동', '일반관리']

const TYPE_COLORS: Record<InspectionType, string> = {
  '종합':   'bg-[#f5f4ff] text-[#7b68ee]',
  '작동':   'bg-blue-50 text-blue-600',
  '일반관리': 'bg-gray-100 text-gray-600',
}

type Props = {
  customerId: string
  currentType: InspectionType
}

export function EditInspectionTypeClient({ customerId, currentType }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<InspectionType>(currentType)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleSave() {
    setError('')
    startTransition(async () => {
      const result = await updateCustomerAction(customerId, { inspection_type: selected })
      if (result.error) { setError(result.error); return }
      router.refresh()
      setOpen(false)
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="ml-2 inline-flex items-center gap-1 text-xs text-[#514b81] hover:text-[#7b68ee] transition-colors"
      >
        <Pencil className="size-3" />
        수정
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#c8c4d0]">
              <h2 className="text-base font-semibold text-[#090c1d]">점검유형 변경</h2>
              <button onClick={() => setOpen(false)} className="text-[#514b81] hover:text-[#090c1d]">
                <X className="size-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-2 bg-[#f5f4ff] rounded-lg px-3 py-2.5">
                <span className="text-xs text-[#514b81]">현재 유형:</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[currentType]}`}>
                  {currentType}
                </span>
              </div>

              <div className="space-y-2">
                {TYPES.map(type => (
                  <label
                    key={type}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                      selected === type
                        ? 'border-[#7b68ee] bg-[#f5f4ff]'
                        : 'border-[#c8c4d0] hover:bg-[#f8f9fa]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="inspection_type"
                      value={type}
                      checked={selected === type}
                      onChange={() => setSelected(type)}
                      className="accent-[#7b68ee]"
                    />
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[type]}`}>
                      {type}
                    </span>
                    {type === '종합' && (
                      <span className="text-xs text-[#514b81] ml-auto">연 2회</span>
                    )}
                    {type !== '종합' && (
                      <span className="text-xs text-[#514b81] ml-auto">연 1회</span>
                    )}
                  </label>
                ))}
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-[#c8c4d0]">
              <button
                onClick={() => { setOpen(false); setSelected(currentType) }}
                className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={isPending || selected === currentType}
                className="flex-1 h-10 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
