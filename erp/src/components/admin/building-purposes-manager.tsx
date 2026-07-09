'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Loader2, ChevronUp, ChevronDown } from 'lucide-react'
import {
  addBuildingPurposeAction,
  deleteBuildingPurposeAction,
  moveBuildingPurposeAction,
} from '@/app/(dashboard)/admin/building-purposes/actions'

interface Props {
  purposes: Array<{ id: string; name: string; sort_order: number; count: number }>
}

export function BuildingPurposesManager({ purposes }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  function handleAdd() {
    if (!name.trim()) return
    setError('')
    startTransition(async () => {
      const res = await addBuildingPurposeAction(name)
      if (res.error) { setError(res.error); return }
      setName('')
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    setError('')
    setDeletingId(id)
    startTransition(async () => {
      const res = await deleteBuildingPurposeAction(id)
      setDeletingId(null)
      setConfirmId(null)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  function handleMove(id: string, direction: 'up' | 'down') {
    setError('')
    startTransition(async () => {
      const res = await moveBuildingPurposeAction(id, direction)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <div className="max-w-xl space-y-4">
      {/* 추가 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="추가할 용도명 (예: 노유자시설)"
            maxLength={30}
            className="flex-1 h-9 px-3 text-sm border border-[#d0ccf5] rounded-lg outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition"
          />
          <button
            onClick={handleAdd}
            disabled={isPending || !name.trim()}
            className="flex items-center gap-1.5 h-9 px-4 bg-[#7b68ee] text-white text-sm font-medium rounded-lg hover:bg-[#6a58d6] disabled:opacity-50 transition-colors"
          >
            {isPending && !deletingId ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            추가
          </button>
        </div>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
        {purposes.length === 0 ? (
          <p className="py-10 text-center text-sm text-[#514b81]">등록된 용도가 없습니다</p>
        ) : (
          <ul className="divide-y divide-[#e0ddf5]">
            {purposes.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex flex-col -my-1">
                  <button
                    onClick={() => handleMove(p.id, 'up')}
                    disabled={isPending || i === 0}
                    title="위로"
                    className="p-0.5 rounded text-[#b0acd6] hover:text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    onClick={() => handleMove(p.id, 'down')}
                    disabled={isPending || i === purposes.length - 1}
                    title="아래로"
                    className="p-0.5 rounded text-[#b0acd6] hover:text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </span>
                <span className="text-sm text-[#090c1d] flex-1">{p.name}</span>
                <span className="text-xs text-[#b0acd6]">
                  {p.count > 0 ? `건물 ${p.count}동 사용 중` : '미사용'}
                </span>
                {confirmId === p.id ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs text-red-600">삭제할까요?</span>
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={isPending}
                      className="text-xs px-2 py-1 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                    >
                      {deletingId === p.id ? <Loader2 className="size-3 animate-spin" /> : '삭제'}
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="text-xs px-2 py-1 rounded-md border border-[#c8c4d0] text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
                    >
                      취소
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmId(p.id)}
                    title="삭제"
                    className="p-1.5 rounded-lg text-[#b0acd6] hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-[#b0acd6]">
        삭제해도 이미 그 용도로 등록된 건물의 값은 바뀌지 않으며, 선택 목록에서만 사라집니다.
      </p>
    </div>
  )
}
