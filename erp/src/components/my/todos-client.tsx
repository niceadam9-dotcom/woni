'use client'

import { useState, useTransition } from 'react'
import { Plus, X, Pencil, Trash2, CheckCircle2, Circle, AlertTriangle } from 'lucide-react'
import {
  createTodoAction,
  toggleTodoAction,
  updateTodoAction,
  deleteTodoAction,
} from '@/app/(dashboard)/my/todos/actions'
import { DateInput } from '@/components/ui/date-input'

type Todo = {
  id: string
  title: string
  description: string | null
  due_date: string | null
  priority: string
  completed: boolean
  completed_at: string | null
}

const PRIORITY_STYLE: Record<string, string> = {
  높음: 'bg-red-50 text-red-600 border-red-200',
  보통: 'bg-amber-50 text-amber-600 border-amber-200',
  낮음: 'bg-gray-50 text-gray-500 border-gray-200',
}

function TodoModal({
  initial,
  onClose,
  onDone,
}: {
  initial?: Todo
  onClose: () => void
  onDone: () => void
}) {
  const [title,   setTitle]   = useState(initial?.title ?? '')
  const [desc,    setDesc]    = useState(initial?.description ?? '')
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [priority, setPriority] = useState(initial?.priority ?? '보통')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    if (!title.trim()) { setErr('제목을 입력하세요.'); return }
    start(async () => {
      const payload = { title, description: desc || null, dueDate: dueDate || null, priority }
      const res = initial
        ? await updateTodoAction({ id: initial.id, ...payload })
        : await createTodoAction(payload)
      if (res.error) { setErr(res.error); return }
      onDone()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#090c1d]">{initial ? 'ToDo 수정' : 'ToDo 등록'}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">제목 *</label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="할 일 제목"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">우선순위</label>
            <div className="flex gap-2">
              {['높음', '보통', '낮음'].map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-1.5 rounded-lg text-xs border font-medium transition-colors ${
                    priority === p ? PRIORITY_STYLE[p] : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">마감일</label>
            <DateInput
              value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">메모</label>
            <textarea
              value={desc} onChange={e => setDesc(e.target.value)} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="내용 (선택)"
            />
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            취소
          </button>
          <button
            onClick={submit} disabled={pending}
            className="flex-1 bg-[#7b68ee] text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {pending ? '저장 중…' : initial ? '수정' : '등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TodoItem({
  todo,
  today,
  onEdit,
}: {
  todo: Todo
  today: string
  onEdit: (t: Todo) => void
}) {
  const [togglePending, startToggle] = useTransition()
  const [deletePending, startDelete] = useTransition()

  const isOverdue = !todo.completed && todo.due_date && todo.due_date < today

  function handleToggle() {
    startToggle(async () => { await toggleTodoAction(todo.id, !todo.completed) })
  }

  function handleDelete() {
    if (!confirm('삭제하시겠습니까?')) return
    startDelete(async () => { await deleteTodoAction(todo.id) })
  }

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
      todo.completed ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'
    }`}>
      <button
        onClick={handleToggle}
        disabled={togglePending}
        className="mt-0.5 shrink-0 disabled:opacity-50"
      >
        {todo.completed
          ? <CheckCircle2 size={20} className="text-emerald-500" />
          : <Circle size={20} className="text-gray-300 hover:text-[#7b68ee]" />
        }
      </button>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${todo.completed ? 'line-through text-gray-400' : 'text-[#090c1d]'}`}>
          {todo.title}
        </p>
        {todo.description && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{todo.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${PRIORITY_STYLE[todo.priority]}`}>
            {todo.priority}
          </span>
          {todo.due_date && (
            <span className={`text-[10px] flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              {isOverdue && <AlertTriangle size={10} />}
              {todo.due_date}
            </span>
          )}
          {todo.completed && todo.completed_at && (
            <span className="text-[10px] text-emerald-500">
              완료: {todo.completed_at.slice(0, 10)}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-1 shrink-0">
        {!todo.completed && (
          <button onClick={() => onEdit(todo)} className="p-1 text-gray-400 hover:text-[#7b68ee] rounded">
            <Pencil size={13} />
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deletePending}
          className="p-1 text-gray-400 hover:text-red-500 rounded disabled:opacity-50"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

export function TodosClient({
  initialTodos,
  today,
}: {
  initialTodos: Record<string, unknown>[]
  today: string
}) {
  const todos = initialTodos as unknown as Todo[]

  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Todo | null>(null)
  const [filter, setFilter] = useState<'전체' | '미완료' | '완료'>('미완료')

  const pending  = todos.filter(t => !t.completed)
  const done     = todos.filter(t => t.completed)
  const overdue  = pending.filter(t => t.due_date && t.due_date < today)

  const filtered = filter === '전체' ? todos : filter === '미완료' ? pending : done

  // Sort: 높음 → 보통 → 낮음, then by due_date
  const PRIO_ORDER: Record<string, number> = { 높음: 0, 보통: 1, 낮음: 2 }
  const sorted = [...filtered].sort((a, b) => {
    if (!a.completed && !b.completed) {
      const pdiff = (PRIO_ORDER[a.priority] ?? 1) - (PRIO_ORDER[b.priority] ?? 1)
      if (pdiff !== 0) return pdiff
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
    }
    return 0
  })

  return (
    <>
      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '전체', value: todos.length, color: 'text-gray-700' },
          { label: '미완료', value: pending.length, color: 'text-[#7b68ee]' },
          { label: '기한초과', value: overdue.length, color: 'text-red-500' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 컨트롤 */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['미완료', '전체', '완료'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-[#7b68ee] text-white'
                  : 'bg-white border text-gray-500 hover:bg-gray-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowModal(true) }}
          className="flex items-center gap-1.5 bg-[#7b68ee] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#6a5acd]"
        >
          <Plus size={15} /> ToDo 추가
        </button>
      </div>

      {/* 목록 */}
      <div className="space-y-2">
        {sorted.length === 0 ? (
          <div className="bg-white rounded-xl border py-16 text-center">
            <p className="text-gray-400 text-sm">{filter === '완료' ? '완료된 항목이 없습니다.' : '할 일을 추가해보세요!'}</p>
          </div>
        ) : (
          sorted.map(todo => (
            <TodoItem
              key={todo.id}
              todo={todo}
              today={today}
              onEdit={t => { setEditTarget(t); setShowModal(true) }}
            />
          ))
        )}
      </div>

      {showModal && (
        <TodoModal
          initial={editTarget ?? undefined}
          onClose={() => { setShowModal(false); setEditTarget(null) }}
          onDone={() => { setShowModal(false); setEditTarget(null) }}
        />
      )}
    </>
  )
}
