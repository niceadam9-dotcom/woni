'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, X, Loader2, KeyRound, CalendarDays } from 'lucide-react'
import {
  createUserAction, updateUserAction, resetPasswordAction, setLeaveBalanceAction,
  getEmployeeAssignmentCountAction, handoverAssignmentsAction,
  type CreateUserInput, type UpdateUserInput,
} from '@/app/(dashboard)/admin/users/actions'

type User = {
  id: string
  employee_id: string
  name: string
  email: string
  role: 'employee' | 'manager' | 'admin'
  department_id: string | null
  position: string | null
  hire_date: string | null
  is_active: boolean
}

type Dept = { id: string; name: string }

const ROLE_LABELS = { employee: '일반직원', manager: '팀장', admin: '관리자' }
const ROLE_COLORS = {
  employee: 'bg-gray-50 text-gray-600',
  manager: 'bg-blue-50 text-blue-600',
  admin: 'bg-[#f5f4ff] text-[#7b68ee]',
}

const inputCls = 'w-full h-10 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[#514b81]">{label}</label>
      {children}
    </div>
  )
}

type UserModalProps = {
  mode: 'create' | 'edit'
  user?: User | null
  depts: Dept[]
  successors?: User[]  // 인수인계 후보 (활성 직원)
  onClose: () => void
}

function UserModal({ mode, user, depts, successors = [], onClose }: UserModalProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  // 퇴사(비활성 전환) 인수인계 단계
  const [handover, setHandover] = useState<{ count: number } | null>(null)
  const [successorId, setSuccessorId] = useState('')

  const [form, setForm] = useState({
    email: user?.email ?? '',
    password: '',
    name: user?.name ?? '',
    employee_id: user?.employee_id ?? '',
    role: user?.role ?? 'employee' as const,
    department_id: user?.department_id ?? '',
    position: user?.position ?? '',
    hire_date: user?.hire_date ?? '',
    is_active: user?.is_active ?? true,
  })

  function set(key: keyof typeof form, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSubmit() {
    setError('')
    startTransition(async () => {
      let result: { error?: string }
      if (mode === 'create') {
        if (!form.email || !form.password || !form.name || !form.employee_id) {
          setError('필수 항목을 입력해주세요.')
          return
        }
        result = await createUserAction(form as CreateUserInput)
      } else {
        if (!form.name || !form.employee_id) {
          setError('필수 항목을 입력해주세요.')
          return
        }
        result = await updateUserAction(user!.id, form as UpdateUserInput)
      }
      if (result.error) { setError(result.error); return }

      // 퇴사(활성→비활성) 전환 시 담당 고객이 있으면 인수인계 단계로
      if (mode === 'edit' && user && user.is_active && !form.is_active) {
        const { count } = await getEmployeeAssignmentCountAction(user.id)
        if (count > 0) { setHandover({ count }); return }  // 모달 유지, 인수인계 UI 표시
      }
      router.refresh()
      onClose()
    })
  }

  function handleHandover(skip: boolean) {
    setError('')
    startTransition(async () => {
      if (!skip) {
        if (!successorId) { setError('인수인계할 후임 직원을 선택해주세요.'); return }
        const res = await handoverAssignmentsAction(user!.id, successorId)
        if (res.error) { setError(res.error); return }
      }
      router.refresh()
      onClose()
    })
  }

  const title = mode === 'create' ? '직원 추가' : '직원 정보 수정'

  // 퇴사 인수인계 단계 화면
  if (handover) {
    return (
      <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-md">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#c8c4d0]">
            <h2 className="text-base font-semibold text-[#090c1d]">담당 고객 인수인계</h2>
            <button onClick={() => handleHandover(true)} className="text-[#514b81] hover:text-[#090c1d]"><X className="size-5" /></button>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-[#514b81]">
              <span className="font-semibold text-[#090c1d]">{user?.name}</span> 직원이 비활성(퇴사) 처리되었습니다.
              현재 담당 중인 고객 <span className="font-semibold text-red-600">{handover.count}건</span>을 후임 직원에게 인수인계할 수 있습니다.
            </p>
            <Field label="후임 직원">
              <select value={successorId} onChange={e => setSuccessorId(e.target.value)} className={inputCls}>
                <option value="">직원 선택</option>
                {successors.filter(s => s.id !== user?.id).map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.position ? ` (${s.position})` : ''}</option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-[#b0acd6]">인수인계 시 월간계획·점검업무·점검이력의 담당자가 함께 변경됩니다.</p>
            {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          </div>
          <div className="flex gap-3 px-6 py-4 border-t border-[#c8c4d0]">
            <button onClick={() => handleHandover(true)} disabled={isPending}
              className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors disabled:opacity-50">
              나중에 (건너뛰기)
            </button>
            <button onClick={() => handleHandover(false)} disabled={isPending}
              className="flex-1 h-10 rounded-lg bg-[#7b68ee] hover:bg-[#6355d4] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : `${handover.count}건 인수인계`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#c8c4d0]">
          <h2 className="text-base font-semibold text-[#090c1d]">{title}</h2>
          <button onClick={onClose} className="text-[#514b81] hover:text-[#090c1d]">
            <X className="size-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {mode === 'create' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="이메일 *">
                <input
                  type="email"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                  placeholder="user@company.com"
                  className={inputCls}
                />
              </Field>
              <Field label="초기 비밀번호 *">
                <input
                  type="password"
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                  placeholder="6자 이상"
                  className={inputCls}
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="이름 *">
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="홍길동"
                className={inputCls}
              />
            </Field>
            <Field label="사번 *">
              <input
                value={form.employee_id}
                onChange={e => set('employee_id', e.target.value)}
                placeholder="EMP-001"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="역할 *">
              <select
                value={form.role}
                onChange={e => set('role', e.target.value)}
                className={inputCls}
              >
                <option value="employee">일반직원</option>
                <option value="manager">팀장</option>
                <option value="admin">관리자</option>
              </select>
            </Field>
            <Field label="부서">
              <select
                value={form.department_id}
                onChange={e => set('department_id', e.target.value)}
                className={inputCls}
              >
                <option value="">부서 없음</option>
                {depts.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="직책">
              <input
                value={form.position}
                onChange={e => set('position', e.target.value)}
                placeholder="대리, 과장, 팀장..."
                className={inputCls}
              />
            </Field>
            <Field label="입사일">
              <input
                type="date"
                value={form.hire_date}
                onChange={e => set('hire_date', e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          {mode === 'edit' && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)}
                className="size-4 accent-[#7b68ee] rounded"
              />
              <label htmlFor="is_active" className="text-sm text-[#292d34]">
                계정 활성화
              </label>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[#c8c4d0]">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 h-10 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : (mode === 'create' ? '추가하기' : '저장하기')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function handleReset() {
    setError('')
    startTransition(async () => {
      const result = await resetPasswordAction(userId, pw)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[#090c1d]">비밀번호 초기화</h3>
          <button onClick={onClose}><X className="size-5 text-[#514b81]" /></button>
        </div>
        {done ? (
          <div className="text-center py-4">
            <p className="text-sm font-medium text-green-600">비밀번호가 변경되었습니다.</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg bg-[#7b68ee] text-white text-sm">
              닫기
            </button>
          </div>
        ) : (
          <>
            <input
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="새 비밀번호 (6자 이상)"
              className={`${inputCls} mb-3`}
            />
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81]">취소</button>
              <button
                onClick={handleReset}
                disabled={isPending}
                className="flex-1 h-10 rounded-lg bg-[#7b68ee] text-white text-sm flex items-center justify-center disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : '변경'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function LeaveBalanceModal({
  userId, userName, currentDays, onClose
}: { userId: string; userName: string; currentDays: number; onClose: () => void }) {
  const router = useRouter()
  const [days, setDays] = useState(String(currentDays))
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleSave() {
    const d = Number(days)
    const y = Number(year)
    if (!d || d < 0) { setError('유효한 일수를 입력해주세요.'); return }
    startTransition(async () => {
      const result = await setLeaveBalanceAction(userId, y, d)
      if (result.error) setError(result.error)
      else { router.refresh(); onClose() }
    })
  }

  return (
    <div className="fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-[#c8c4d0] w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[#090c1d]">{userName} 연차 설정</h3>
          <button onClick={onClose}><X className="size-5 text-[#514b81]" /></button>
        </div>
        <div className="space-y-3">
          <Field label="연도">
            <input type="number" value={year} onChange={e => setYear(e.target.value)} className={inputCls} />
          </Field>
          <Field label="총 연차 일수">
            <input type="number" min={0} value={days} onChange={e => setDays(e.target.value)} className={inputCls} />
          </Field>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81]">취소</button>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 h-10 rounded-lg bg-[#7b68ee] text-white text-sm flex items-center justify-center disabled:opacity-50"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

type UserWithBalance = User & { total_days?: number; used_days?: number }

export function UserManageClient({
  users, depts,
}: {
  users: UserWithBalance[]
  depts: Dept[]
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [resetPwUser, setResetPwUser] = useState<string | null>(null)
  const [leaveUser, setLeaveUser] = useState<UserWithBalance | null>(null)

  return (
    <>
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
        >
          <Plus className="size-4" />
          직원 추가
        </button>
      </div>

      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {users.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">검색된 직원이 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                  {['사번', '이름', '역할', '부서', '직책', '잔여연차', '상태', '관리'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c8c4d0]">
                {users.map(u => {
                  const remaining = (u.total_days ?? 15) - (u.used_days ?? 0)
                  return (
                    <tr key={u.id} className="hover:bg-[#f8f9fa] transition-colors">
                      <td className="px-4 py-3 text-xs text-[#514b81] font-mono">{u.employee_id}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#090c1d]">{u.name}</p>
                        <p className="text-xs text-[#b0acd6]">{u.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role]}`}>
                          {ROLE_LABELS[u.role]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#292d34]">
                        {depts.find(d => d.id === u.department_id)?.name ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#292d34]">{u.position ?? '-'}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className="font-semibold text-[#7b68ee]">{remaining}</span>
                        <span className="text-[#514b81]">/{u.total_days ?? 15}일</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {u.is_active ? '활성' : '비활성'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditUser(u)}
                            title="수정"
                            className="p-1.5 rounded-lg hover:bg-[#f8f9fa] text-[#514b81] hover:text-[#7b68ee] transition-colors"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => setResetPwUser(u.id)}
                            title="비밀번호 초기화"
                            className="p-1.5 rounded-lg hover:bg-[#f8f9fa] text-[#514b81] hover:text-[#7b68ee] transition-colors"
                          >
                            <KeyRound className="size-3.5" />
                          </button>
                          <button
                            onClick={() => setLeaveUser(u)}
                            title="연차 설정"
                            className="p-1.5 rounded-lg hover:bg-[#f8f9fa] text-[#514b81] hover:text-[#7b68ee] transition-colors"
                          >
                            <CalendarDays className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <UserModal mode="create" depts={depts} onClose={() => setShowCreate(false)} />
      )}
      {editUser && (
        <UserModal mode="edit" user={editUser} depts={depts} successors={users.filter(u => u.is_active)} onClose={() => setEditUser(null)} />
      )}
      {resetPwUser && (
        <ResetPasswordModal userId={resetPwUser} onClose={() => setResetPwUser(null)} />
      )}
      {leaveUser && (
        <LeaveBalanceModal
          userId={leaveUser.id}
          userName={leaveUser.name}
          currentDays={leaveUser.total_days ?? 15}
          onClose={() => setLeaveUser(null)}
        />
      )}
    </>
  )
}
