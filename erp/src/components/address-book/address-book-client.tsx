'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Pencil, Trash2, Check, X, Phone, Mail, Building2, Search } from 'lucide-react'
import { createContactAction, updateContactAction, deleteContactAction } from '@/app/(dashboard)/my/address-book/actions'

const inputCls = 'w-full h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition'

type Contact = {
  id: string; name: string; company: string | null; department: string | null
  position: string | null; phone: string | null; mobile: string | null
  email: string | null; address: string | null; notes: string | null; group_name: string | null
}

const EMPTY_FORM = {
  name: '', company: '', department: '', position: '',
  phone: '', mobile: '', email: '', address: '', notes: '', group_name: '',
}

export function AddressBookClient({ contacts }: { contacts: Record<string, unknown>[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')

  const rows = contacts as Contact[]
  const groups = [...new Set(rows.map(c => c.group_name).filter(Boolean))] as string[]

  const filtered = rows.filter(c => {
    const q = search.toLowerCase()
    const matchSearch = !q || c.name.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q) || c.phone?.includes(q) || c.mobile?.includes(q)
    const matchGroup = !groupFilter || c.group_name === groupFilter
    return matchSearch && matchGroup
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  function startEdit(c: Contact) {
    setEditId(c.id)
    setForm({
      name: c.name, company: c.company ?? '', department: c.department ?? '',
      position: c.position ?? '', phone: c.phone ?? '', mobile: c.mobile ?? '',
      email: c.email ?? '', address: c.address ?? '', notes: c.notes ?? '', group_name: c.group_name ?? '',
    })
  }

  function handleSave() {
    setError('')
    if (!form.name.trim()) { setError('이름을 입력해주세요.'); return }
    startTransition(async () => {
      const input = {
        name: form.name.trim(), company: form.company || undefined, department: form.department || undefined,
        position: form.position || undefined, phone: form.phone || undefined, mobile: form.mobile || undefined,
        email: form.email || undefined, address: form.address || undefined, notes: form.notes || undefined,
        group_name: form.group_name || undefined,
      }
      const result = editId
        ? await updateContactAction(editId, input)
        : await createContactAction(input)
      if (result.error) { setError(result.error); return }
      setShowNew(false); setEditId(null); setForm(EMPTY_FORM)
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    if (!confirm('연락처를 삭제하시겠습니까?')) return
    startTransition(async () => {
      await deleteContactAction(id)
      router.refresh()
    })
  }

  const isFormOpen = showNew || editId !== null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#b0acd6]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="이름·회사·전화번호 검색" className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#c8c4d0] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition" />
        </div>
        {groups.length > 0 && (
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            className="h-10 rounded-lg border border-[#c8c4d0] px-2 text-sm text-[#514b81] outline-none bg-white">
            <option value="">전체 그룹</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        <button onClick={() => { setShowNew(true); setEditId(null); setForm(EMPTY_FORM) }}
          className="h-10 px-4 rounded-lg bg-[#202023] text-white text-sm font-medium hover:bg-[#292d34] transition-colors flex items-center gap-1.5">
          <Plus className="size-4" />추가
        </button>
      </div>

      {isFormOpen && (
        <div className="bg-[#fafafe] border border-[#d0ccf5] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><label className="text-xs text-[#514b81]">이름<span className="text-red-500 ml-0.5">*</span></label><input value={form.name} onChange={set('name')} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">회사</label><input value={form.company} onChange={set('company')} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">그룹</label><input value={form.group_name} onChange={set('group_name')} placeholder="고객사, 협력사 등" className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><label className="text-xs text-[#514b81]">부서</label><input value={form.department} onChange={set('department')} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">직책</label><input value={form.position} onChange={set('position')} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">이메일</label><input type="email" value={form.email} onChange={set('email')} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><label className="text-xs text-[#514b81]">전화번호</label><input value={form.phone} onChange={set('phone')} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">휴대폰</label><input value={form.mobile} onChange={set('mobile')} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs text-[#514b81]">주소</label><input value={form.address} onChange={set('address')} className={inputCls} /></div>
          </div>
          <textarea value={form.notes} onChange={set('notes')} placeholder="메모" rows={2}
            className="w-full rounded-lg border border-[#d0ccf5] bg-white px-3 py-2 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition resize-none" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(false); setEditId(null); setError('') }}
              className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center gap-1"><X className="size-3" />취소</button>
            <button onClick={handleSave} disabled={isPending}
              className="h-8 px-4 rounded-lg bg-[#7b68ee] text-white text-xs font-medium hover:bg-[#6a57dd] transition-colors disabled:opacity-50 flex items-center gap-1">
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}저장</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <div className="col-span-full py-12 text-center text-sm text-[#514b81] bg-white rounded-xl border border-[#c8c4d0]">
            {search ? '검색 결과가 없습니다' : '등록된 연락처가 없습니다'}
          </div>
        ) : filtered.map(c => (
          <div key={c.id} className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#090c1d]">{c.name}</span>
                  {c.group_name && <span className="text-xs bg-[#f5f4ff] text-[#7b68ee] px-1.5 py-0.5 rounded">{c.group_name}</span>}
                </div>
                {(c.company || c.position) && (
                  <p className="text-xs text-[#514b81] mt-0.5 flex items-center gap-1">
                    <Building2 className="size-3" />{[c.company, c.department, c.position].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => startEdit(c)} className="size-7 rounded-lg hover:bg-[#f8f9fa] flex items-center justify-center text-[#b0acd6] hover:text-[#7b68ee] transition-colors">
                  <Pencil className="size-3.5" />
                </button>
                <button onClick={() => handleDelete(c.id)} disabled={isPending} className="size-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#b0acd6] hover:text-red-500 transition-colors">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-2 space-y-1">
              {c.phone && <p className="text-xs text-[#514b81] flex items-center gap-1.5"><Phone className="size-3 text-[#b0acd6]" />{c.phone}</p>}
              {c.mobile && <p className="text-xs text-[#514b81] flex items-center gap-1.5"><Phone className="size-3 text-[#b0acd6]" />{c.mobile} (휴대)</p>}
              {c.email && <p className="text-xs text-[#514b81] flex items-center gap-1.5"><Mail className="size-3 text-[#b0acd6]" />{c.email}</p>}
            </div>
            {c.notes && <p className="text-xs text-[#b0acd6] mt-2 truncate">{c.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
