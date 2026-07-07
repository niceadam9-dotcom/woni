'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, X, Loader2 } from 'lucide-react'
import {
  createDeptAction, updateDeptAction, deleteDeptAction,
  type DeptInput,
} from '@/app/(dashboard)/admin/users/actions'

type Dept = { id: string; name: string; manager_id: string | null; member_count: number }
type Manager = { id: string; name: string }

type DeptModalProps = {
  mode: 'create' | 'edit'
  dept?: Dept | null
  managers: Manager[]
  onClose: () => void
}

function DeptModal({ mode, dept, managers, onClose }: DeptModalProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [name, setName] = useState(dept?.name ?? '')
  const [managerId, setManagerId] = useState(dept?.manager_id ?? '')

  function handleSubmit() {
    if (!name.trim()) { setError('부서명을 입력해주세요.'); return }
    setError('')
    const input: DeptInput = { name: name.trim(), manager_id: managerId || undefined }
    startTransition(async () => {
      const result = mode === 'create'
        ? await createDeptAction(input)
        : await updateDeptAction(dept!.id, input)
      if (result.error) { setError(result.error); return }
      router.refresh()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#c8c4d0]">
          <h2 className="text-base font-semibold text-[#090c1d]">
            {mode === 'create' ? '부서 추가' : '부서 수정'}
          </h2>
          <button onClick={onClose}><X className="size-5 text-[#514b81]" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#514b81]">부서명 *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 개발팀, 영업부"
              className="w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#514b81]">부서장</label>
            <select
              value={managerId}
              onChange={e => setManagerId(e.target.value)}
              className="w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
            >
              <option value="">없음</option>
              {managers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-[#c8c4d0]">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa]">
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 h-10 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium flex items-center justify-center disabled:opacity-50"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : (mode === 'create' ? '추가' : '저장')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DeptManageClient({ depts, managers }: { depts: Dept[]; managers: Manager[] }) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [editDept, setEditDept] = useState<Dept | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [delError, setDelError] = useState('')
  const [isDeleting, startDelete] = useTransition()

  function handleDelete(deptId: string) {
    setDelError('')
    startDelete(async () => {
      const result = await deleteDeptAction(deptId)
      if (result.error) { setDelError(result.error); return }
      setDeleteId(null)
      router.refresh()
    })
  }

  const managerMap = new Map(managers.map(m => [m.id, m.name]))

  return (
    <>
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
        >
          <Plus className="size-4" />
          부서 추가
        </button>
      </div>

      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {depts.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">등록된 부서가 없습니다</div>
        ) : (
          <div className="divide-y divide-[#c8c4d0]">
            {depts.map(dept => (
              <div key={dept.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-[#090c1d]">{dept.name}</p>
                  <p className="text-xs text-[#514b81] mt-0.5">
                    부서장: {dept.manager_id ? (managerMap.get(dept.manager_id) ?? '알 수 없음') : '없음'}
                    {' · '}
                    직원 {dept.member_count}명
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditDept(dept)}
                    className="p-2 rounded-lg hover:bg-[#f8f9fa] text-[#514b81] hover:text-[#7b68ee] transition-colors"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => { setDeleteId(dept.id); setDelError('') }}
                    className="p-2 rounded-lg hover:bg-red-50 text-[#514b81] hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 삭제 확인 */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-[#090c1d] mb-2">부서 삭제</h3>
            <p className="text-sm text-[#514b81] mb-4">
              이 부서를 삭제하시겠습니까? 소속 직원이 있으면 삭제할 수 없습니다.
            </p>
            {delError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{delError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => { setDeleteId(null); setDelError('') }}
                className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81]"
              >
                취소
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                disabled={isDeleting}
                className="flex-1 h-10 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm flex items-center justify-center disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="size-4 animate-spin" /> : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <DeptModal mode="create" managers={managers} onClose={() => setShowCreate(false)} />
      )}
      {editDept && (
        <DeptModal mode="edit" dept={editDept} managers={managers} onClose={() => setEditDept(null)} />
      )}
    </>
  )
}
