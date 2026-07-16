'use client'

import { useState, useTransition } from 'react'
import { Phone, Mail, Pencil, Plus, Check, X, User, Briefcase, BookUser, Copy, Flame } from 'lucide-react'
import { upsertContactAction, getMyAddressContactsAction } from '@/app/(dashboard)/customers/actions'
import { DateInput } from '@/components/ui/date-input'
import type { CustomerContact, ContactRole } from '@/types'

const ROLES: ContactRole[] = ['대표', '직원1', '직원2']

type AddressEntry = { name: string; phone: string; email: string; position: string }

interface Props {
  customerId: string
  contacts: CustomerContact[]
  canManage: boolean
  /** §6-E: 자위소방대 편성 교차 표시 — 이름 → 구분(자위소방대장 등) */
  brigadeByName?: Record<string, string>
}

interface FormState {
  name: string
  phone: string
  email: string
  position: string
  birth_date: string
}

export function EditContactsClient({ customerId, contacts, canManage, brigadeByName = {} }: Props) {
  const [editingRole, setEditingRole] = useState<ContactRole | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', phone: '', email: '', position: '', birth_date: '' })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // §6-E: [주소록에서 가져오기]
  const [book, setBook] = useState<AddressEntry[] | null>(null)
  const [showBook, setShowBook] = useState(false)
  const [copied, setCopied] = useState('')

  function openBook() {
    setShowBook(v => !v)
    if (book === null) {
      getMyAddressContactsAction().then(r => setBook(r.contacts)).catch(() => setBook([]))
    }
  }
  function applyBookEntry(e: AddressEntry) {
    setForm(s => ({ ...s, name: e.name, phone: e.phone || s.phone, email: e.email || s.email, position: e.position || s.position }))
    setShowBook(false)
  }
  function copyPhone(phone: string) {
    navigator.clipboard?.writeText(phone).then(() => {
      setCopied(phone)
      setTimeout(() => setCopied(''), 1500)
    }).catch(() => null)
  }

  function startEdit(role: ContactRole) {
    const existing = contacts.find(c => c.role === role)
    setForm({
      name: existing?.name ?? '',
      phone: existing?.phone ?? '',
      email: existing?.email ?? '',
      position: existing?.position ?? '',
      birth_date: existing?.birth_date ?? '',
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
        position: form.position.trim() || undefined,
        birth_date: form.birth_date || undefined,
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
                  <User className="size-4 text-white" />
                </div>
                <span className="text-xs font-semibold text-[#7b68ee]">{role === '대표' ? '대표' : '추가 관계인'}</span>
                <button onClick={openBook}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline">
                  <BookUser className="size-3" /> 주소록에서 가져오기
                </button>
              </div>
              {showBook && (
                <div className="mb-2 rounded-lg border border-[#d0ccf5] bg-white shadow-lg max-h-40 overflow-y-auto">
                  {book === null ? (
                    <p className="px-3 py-2 text-[11px] text-[#b0acd6]">불러오는 중…</p>
                  ) : book.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-[#b0acd6]">주소록이 비어 있습니다 (마이페이지 &gt; 주소록)</p>
                  ) : book.map((e, i) => (
                    <button key={i} onClick={() => applyBookEntry(e)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#f5f4ff] flex justify-between gap-2">
                      <span>{e.name}{e.position && <span className="text-[#b0acd6]"> · {e.position}</span>}</span>
                      <span className="text-[#b0acd6]">{e.phone}</span>
                    </button>
                  ))}
                </div>
              )}
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
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="직위 (예: 소방안전관리자)"
                    value={form.position}
                    onChange={e => setForm(s => ({ ...s, position: e.target.value }))}
                    className="w-full text-sm px-3 py-2 border border-[#c8c4d0] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
                  />
                  <DateInput
                    placeholder="생년월일"
                    value={form.birth_date}
                    onChange={e => setForm(s => ({ ...s, birth_date: e.target.value }))}
                    className="w-full text-sm px-3 py-2 border border-[#c8c4d0] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#7b68ee]"
                  />
                </div>
                <p className="text-[11px] text-[#b0acd6]">직위·생년월일은 보고서 공문·위임장에 사용됩니다</p>
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
              <User className="size-4 text-[#7b68ee]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#514b81]">{contact!.role === '대표' ? '대표' : '추가 관계인'}</span>
                <span className="text-sm font-medium text-[#090c1d]">{contact!.name}</span>
                {contact!.position && (
                  <span className="flex items-center gap-1 text-xs text-[#7b68ee]">
                    <Briefcase className="size-3" />{contact!.position}
                  </span>
                )}
                {brigadeByName[contact!.name] && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600"
                    title="자위소방대 편성됨 (소방계획서 탭)">
                    <Flame className="size-2.5" /> {brigadeByName[contact!.name]}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                {contact!.phone && (
                  <span className="flex items-center gap-1 text-xs text-[#514b81]">
                    <Phone className="size-3 text-[#b0acd6]" />
                    <a href={`tel:${contact!.phone}`} className="hover:text-[#7b68ee] hover:underline">{contact!.phone}</a>
                    <button onClick={() => copyPhone(contact!.phone!)} title="복사"
                      className="p-0.5 text-[#b0acd6] hover:text-[#7b68ee]">
                      <Copy className="size-3" />
                    </button>
                    {copied === contact!.phone && <span className="text-[10px] text-green-600">복사됨</span>}
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
