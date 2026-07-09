'use client'

import { useState, useTransition } from 'react'
import { Phone, Mail, Pencil, Plus, Check, X } from 'lucide-react'
import { upsertContactAction } from '@/app/(dashboard)/customers/actions'
import type { CustomerContact, ContactRole } from '@/types'

const ROLES: ContactRole[] = ['대표', '직원1', '직원2']
const ROLE_ABBR: Record<ContactRole, string> = { '대표': '대', '직원1': '1', '직원2': '2' }

interface Props {
  customerId: string
  contacts: CustomerContact[]
  canManage: boolean
}

interface FormState {
  name: string
  phone: string
  email: string
}

export function EditContactsClient({ customerId, contacts, canManage }: Props) {
  const [editingRole, setEditingRole] = useState<ContactRole | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', phone: '', email: '' })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function startEdit(role: ContactRole) {
    const existing = contacts.find(c => c.role === role)
    setForm({
      name: existing?.name ?? '',
      phone: existing?.phone ?? '',
      email: existing?.email ?? '',
    })
    setError(null)
    setEditingRole(role)
  }

  function cancelEdit() {
    setEditingRole(null)
    setError(null)
  }

  function handleSave(role: ContactRole) {
    if (!form.name.trim()) {
      setError('이름은 필수입니다')
      return
    }
    startTransition(async () => {
      const result = await upsertContactAction(customerId, {
        role,
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setEditingRole(null)
        setError(null)
      }
    })
  }

  // ADD-3 신규 화면과 동일 패턴: 등록된 관계인만 표시, 빈 role은 [관계인 추가]로 진입 (미등록 슬롯 나열 안 함)
  const visibleRoles = ROLES.filter(
    role => contacts.some(c => c.role === role) || editingRole === role
  )
  const firstEmptyRole = ROLES.find(role => !contacts.some(c => c.role === role))

  return (
    <div className="grid grid-cols-1 gap-3">
      {visibleRoles.length === 0 && (
        <p className="text-xs text-[#b0acd6]">등록된 관계인이 없습니다</p>
      )}
      {visibleRoles.map(role => {
        const contact = contacts.find(c => c.role === role)
        const isEditing = editingRole === role

        if (isEditing) {
          return (
            <div key={role} className="bg-[#f5f4ff] rounded-lg p-3.5 border border-[#c3bdf5]">
              <div className="flex items-center gap-2 mb-3">
                <div className="size-8 rounded-lg bg-[#7b68ee] flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-white">{ROLE_ABBR[role]}</span>
                </div>
                <span className="text-xs font-semibold text-[#7b68ee]">{role}</span>
              </div>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="이름 *"
                  value={form.name}
                  onChange={e => setForm(s => ({ ...s, name: e.target.value }))}
                  className="w-full text-sm px-3 py-2 border border-[#c8c4d0] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
                />
                <input
                  type="tel"
                  placeholder="연락처"
                  value={form.phone}
                  onChange={e => setForm(s => ({ ...s, phone: e.target.value }))}
                  className="w-full text-sm px-3 py-2 border border-[#c8c4d0] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
                />
                <input
                  type="email"
                  placeholder="이메일"
                  value={form.email}
                  onChange={e => setForm(s => ({ ...s, email: e.target.value }))}
                  className="w-full text-sm px-3 py-2 border border-[#c8c4d0] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => handleSave(role)}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7b68ee] text-white text-xs font-medium rounded-lg hover:bg-[#6a58d6] disabled:opacity-50 transition-colors"
                >
                  <Check className="size-3" />
                  저장
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#c8c4d0] text-[#514b81] text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  <X className="size-3" />
                  취소
                </button>
              </div>
            </div>
          )
        }

        return (
          <div key={role} className="flex items-start gap-4 bg-[#f8f9fa] rounded-lg p-3.5">
            <div className="size-8 rounded-lg bg-[#f5f4ff] flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-[#7b68ee]">{ROLE_ABBR[role]}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#514b81]">{contact!.role}</span>
                <span className="text-sm font-medium text-[#090c1d]">{contact!.name}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                {contact!.phone && (
                  <span className="flex items-center gap-1 text-xs text-[#514b81]">
                    <Phone className="size-3 text-[#b0acd6]" />
                    {contact!.phone}
                  </span>
                )}
                {contact!.email && (
                  <span className="flex items-center gap-1 text-xs text-[#514b81]">
                    <Mail className="size-3 text-[#b0acd6]" />
                    {contact!.email}
                  </span>
                )}
              </div>
            </div>
            {canManage && (
              <button
                onClick={() => startEdit(role)}
                className="flex items-center gap-1 text-xs text-[#514b81] hover:text-[#7b68ee] transition-colors shrink-0"
              >
                <Pencil className="size-3" />
                수정
              </button>
            )}
          </div>
        )
      })}
      {canManage && firstEmptyRole && editingRole === null && (
        <button
          onClick={() => startEdit(firstEmptyRole)}
          className="flex items-center justify-center gap-1 text-xs font-medium text-[#7b68ee] hover:bg-[#f5f4ff] border border-dashed border-[#c3bdf5] rounded-lg py-2.5 transition-colors"
        >
          <Plus className="size-3" />
          관계인 추가
        </button>
      )}
    </div>
  )
}
