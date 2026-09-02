'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, X, Loader2 } from 'lucide-react'
import { updateCustomerAction } from '@/app/(dashboard)/customers/actions'
import type { InspectionType } from '@/types'

/** 관리유형 × 점검 종류 4개 조합 카드 (소방계획서_6 W-1·D-2 — 2026-08-03 사용자 선택 구조).
 *  소방안전관리는 inspection_type이 곧 종류('종합'|'작동'), 일반관리는 sub_type으로 종류 저장 */
type Combo = {
  key: string
  category: '소방안전관리' | '일반관리'
  sub: '종합' | '작동'
  type: InspectionType            // 저장할 inspection_type
  cycle: string
}

const COMBOS: Combo[] = [
  { key: 'fire-종합', category: '소방안전관리', sub: '종합', type: '종합',     cycle: '자체점검 연 2회 + 정기 매월' },
  { key: 'fire-작동', category: '소방안전관리', sub: '작동', type: '작동',     cycle: '자체점검 연 1회 + 정기 매월' },
  { key: 'gen-종합',  category: '일반관리',     sub: '종합', type: '일반관리', cycle: '자체점검 연 2회 (정기 없음)' },
  { key: 'gen-작동',  category: '일반관리',     sub: '작동', type: '일반관리', cycle: '자체점검 연 1회 (정기 없음)' },
]

const CATEGORY_COLORS: Record<Combo['category'], string> = {
  '소방안전관리': 'bg-brand-tint text-brand',
  '일반관리':     'bg-gray-100 text-gray-600',
}
const SUB_COLORS: Record<Combo['sub'], string> = {
  '종합': 'bg-brand-tint text-brand',
  '작동': 'bg-blue-50 text-blue-600',
}

function comboOf(type: InspectionType, sub: '종합' | '작동'): Combo {
  return COMBOS.find(c => (type === '일반관리' ? c.type === '일반관리' && c.sub === sub : c.type === type))!
}

type Props = {
  customerId: string
  currentType: InspectionType
  /** 일반관리 자체점검 종류 (110 백필 기본 '작동') — 종합 대상만 여기서 개별 수정 (D-2) */
  currentSubType: '종합' | '작동'
}

export function EditInspectionTypeClient({ customerId, currentType, currentSubType }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const current = comboOf(currentType, currentSubType)
  const [selected, setSelected] = useState<string>(current.key)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleSave() {
    const combo = COMBOS.find(c => c.key === selected)
    if (!combo) return
    setError('')
    startTransition(async () => {
      const result = await updateCustomerAction(customerId, {
        inspection_type: combo.type,
        // 일반관리는 종합/작동 종류 함께 저장 (소방안전관리는 inspection_type에서 유도)
        ...(combo.type === '일반관리' ? { inspection_sub_type: combo.sub } : {}),
      })
      if (result.error) { setError(result.error); return }
      router.refresh()
      setOpen(false)
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="ml-2 inline-flex items-center gap-1 text-form-sm text-ink-sub hover:text-brand transition-colors"
      >
        <Pencil className="size-3" />
        수정
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/25 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl border border-line w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <h2 className="text-form-lg-title font-semibold text-ink">점검유형 변경</h2>
              <button onClick={() => setOpen(false)} className="text-ink-sub hover:text-ink">
                <X className="size-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-2 bg-brand-tint rounded-lg px-3 py-2.5">
                <span className="text-form-sm text-ink-sub">현재 유형:</span>
                <span className={`text-form-sm font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[current.category]}`}>
                  {current.category} › {current.sub}
                </span>
              </div>

              {/* 관리유형 × 종류 4개 조합 — 소방안전관리/일반(종합·작동) 한눈에 구별 조회 */}
              <div className="space-y-2">
                {COMBOS.map(combo => (
                  <label
                    key={combo.key}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                      selected === combo.key
                        ? 'border-brand bg-brand-tint'
                        : 'border-line hover:bg-paper'
                    }`}
                  >
                    <input
                      type="radio"
                      name="inspection_combo"
                      value={combo.key}
                      checked={selected === combo.key}
                      onChange={() => setSelected(combo.key)}
                      className="accent-brand"
                    />
                    <span className={`text-form-sm font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[combo.category]}`}>
                      {combo.category}
                    </span>
                    <span className={`text-form-sm font-medium px-2 py-0.5 rounded-full ${SUB_COLORS[combo.sub]}`}>
                      {combo.sub}
                    </span>
                    <span className="text-form-xs text-ink-sub ml-auto text-right">{combo.cycle}</span>
                  </label>
                ))}
              </div>

              {error && (
                <p className="text-form-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-line">
              <button
                onClick={() => { setOpen(false); setSelected(current.key) }}
                className="flex-1 h-form-10 rounded-lg border border-line text-form-base text-ink-sub hover:bg-paper transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={isPending || selected === current.key}
                className="flex-1 h-form-10 rounded-lg bg-brand hover:bg-brand-strong text-white text-form-base font-medium transition-colors flex items-center justify-center disabled:opacity-50"
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
