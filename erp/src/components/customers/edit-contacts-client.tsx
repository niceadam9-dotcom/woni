'use client'

import { useState, useTransition } from 'react'
import { Phone, Mail, Pencil, Plus, Check, X, User, Briefcase, BookUser, Copy, Flame, MessageSquare } from 'lucide-react'
import { upsertContactAction, getMyAddressContactsAction, setContactSmsRecipientAction } from '@/app/(dashboard)/customers/actions'
import { InspectionSmsModal } from '@/components/sms/inspection-sms-modal'
import { DateInput } from '@/components/ui/date-input'
import { formatPhoneKR } from '@/components/ui/fields'
import { formatTel } from '@/lib/format-contact'
import type { CustomerContact, ContactRole } from '@/types'

const ROLES: ContactRole[] = ['대표', '직원1', '직원2']

type AddressEntry = { name: string; phone: string; email: string; position: string }

interface Props {
  customerId: string
  /** 임의 발송 모달 제목·문구 치환용 (소방계획서_24 Q-17) */
  customerName?: string
  /** 사전 안내 문자 발송 권한 (inspection_sms_send) */
  canSendSms?: boolean
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

export function EditContactsClient({ customerId, customerName = '', canSendSms = false, contacts, canManage, brigadeByName = {} }: Props) {
  // 임의 발송(Q-17) — 재방문·불량 보수·AS 판단은 그 고객을 보면서 한다. 가장 자연스러운 자리다.
  const [smsOpen, setSmsOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<ContactRole | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', phone: '', email: '', position: '', birth_date: '' })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // §6-E: [주소록에서 가져오기]
  const [book, setBook] = useState<AddressEntry[] | null>(null)
  const [showBook, setShowBook] = useState(false)
  const [copied, setCopied] = useState('')
  // 문자 수신 지정(Q-10) — 서버 왕복을 기다리지 않고 화면을 먼저 반영한다(체크 반응이 느리면 두 번 누른다)
  const [smsPick, setSmsPick] = useState<Record<string, boolean>>(
    Object.fromEntries(contacts.map(c => [c.id, c.sms_recipient === true])))

  const pickedCount = Object.values(smsPick).filter(Boolean).length

  function toggleSms(contactId: string) {
    const next = !smsPick[contactId]
    setSmsPick(s => ({ ...s, [contactId]: next }))
    startTransition(async () => {
      const res = await setContactSmsRecipientAction(customerId, contactId, next)
      if (res.error) { setError(res.error); setSmsPick(s => ({ ...s, [contactId]: !next })) }
    })
  }

  function openBook() {
    setShowBook(v => !v)
    if (book === null) {
      getMyAddressContactsAction().then(r => setBook(r.contacts)).catch(() => setBook([]))
    }
  }
  function applyBookEntry(e: AddressEntry) {
    setForm(s => ({ ...s, name: e.name, phone: e.phone ? formatTel(e.phone) : s.phone, email: e.email || s.email, position: e.position || s.position }))
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
      phone: formatTel(existing?.phone),
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
        <p className="text-xs text-ink-meta">등록된 관계인이 없습니다</p>
      )}
      {/* 체크 인원 = 회차당 통수 (소방계획서_24 S5-b) — 문자 비용이 정해지는 지점은 발송 모달이 아니라
          여기다. 정기점검 고객이면 3명 체크 = 연 36통이 되는데 그 사실이 화면에 드러나지 않았다. */}
      {visibleRoles.length > 0 && (
        <div data-testid="sms-recipient-summary"
          className="flex items-center gap-1.5 text-[11px] text-ink-sub bg-brand-tint border border-brand-line-soft rounded-lg px-3 py-1.5">
          <MessageSquare className="size-3 text-brand" />
          {pickedCount > 0 ? (
            <>사전 안내 문자 <b className="text-ink">{pickedCount}명</b> 지정 — <b>점검 1회당 {pickedCount}통</b>이 나갑니다.</>
          ) : (
            <>문자 수신자 <b className="text-ink">미지정</b> — 대표(또는 지정관계인)에게 <b>1통</b>만 나갑니다.</>
          )}
          {canSendSms && (
            <button
              data-testid="customer-adhoc-sms"
              onClick={() => setSmsOpen(true)}
              title="계획에 없는 방문(재방문·불량 보수·AS 등)을 안내합니다 — 점검 회차로 잡히지 않습니다"
              className="ml-auto h-6 px-2 rounded-lg border border-brand-line text-[10px] text-brand hover:bg-surface transition-colors"
            >
              문자 보내기
            </button>
          )}
        </div>
      )}
      {smsOpen && (
        <InspectionSmsModal
          source={{ kind: 'adhoc', customerId, customerName }}
          onClose={() => setSmsOpen(false)}
        />
      )}
      {visibleRoles.map(role => {
        const contact = contacts.find(c => c.role === role)
        const isEditing = editingRole === role

        if (isEditing) {
          return (
            <div key={role} className="bg-brand-tint rounded-lg p-3.5 border border-brand-line">
              <div className="flex items-center gap-2 mb-3">
                <div className="size-8 rounded-lg bg-brand flex items-center justify-center shrink-0">
                  <User className="size-4 text-white" />
                </div>
                <span className="text-xs font-semibold text-brand">{role === '대표' ? '대표' : '추가 관계인'}</span>
                <button onClick={openBook}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-brand hover:underline">
                  <BookUser className="size-3" /> 주소록에서 가져오기
                </button>
              </div>
              {showBook && (
                <div className="mb-2 rounded-lg border border-brand-line bg-surface shadow-lg max-h-40 overflow-y-auto">
                  {book === null ? (
                    <p className="px-3 py-2 text-[11px] text-ink-meta">불러오는 중…</p>
                  ) : book.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-ink-meta">주소록이 비어 있습니다 (마이페이지 &gt; 주소록)</p>
                  ) : book.map((e, i) => (
                    <button key={i} onClick={() => applyBookEntry(e)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-brand-tint flex justify-between gap-2">
                      <span>{e.name}{e.position && <span className="text-ink-meta"> · {e.position}</span>}</span>
                      <span className="text-ink-meta">{formatTel(e.phone)}</span>
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
                  className="w-full text-sm px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <input
                  type="tel"
                  placeholder="연락처"
                  value={form.phone}
                  onChange={e => setForm(s => ({ ...s, phone: formatPhoneKR(e.target.value) }))}
                  className="w-full text-sm px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <input
                  type="email"
                  placeholder="이메일"
                  value={form.email}
                  onChange={e => setForm(s => ({ ...s, email: e.target.value }))}
                  className="w-full text-sm px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="직위 (예: 소방안전관리자)"
                    value={form.position}
                    onChange={e => setForm(s => ({ ...s, position: e.target.value }))}
                    className="w-full text-sm px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <DateInput
                    placeholder="생년월일"
                    value={form.birth_date}
                    onChange={e => setForm(s => ({ ...s, birth_date: e.target.value }))}
                    className="w-full text-sm px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
                <p className="text-[11px] text-ink-meta">직위·생년월일은 보고서 공문·위임장에 사용됩니다</p>
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => handleSave(role)}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-brand text-white text-xs font-medium rounded-lg hover:bg-brand-strong disabled:opacity-50 transition-colors"
                >
                  <Check className="size-3" />
                  저장
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-line text-ink-sub text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  <X className="size-3" />
                  취소
                </button>
              </div>
            </div>
          )
        }

        return (
          <div key={role} className="flex items-start gap-4 bg-paper rounded-lg p-3.5">
            <div className="size-8 rounded-lg bg-brand-tint flex items-center justify-center shrink-0">
              <User className="size-4 text-brand" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-sub">{contact!.role === '대표' ? '대표' : '추가 관계인'}</span>
                <span className="text-sm font-medium text-ink">{contact!.name}</span>
                {contact!.position && (
                  <span className="flex items-center gap-1 text-xs text-brand">
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
                  <span className="flex items-center gap-1 text-xs text-ink-sub">
                    <Phone className="size-3 text-ink-faint" />
                    {/* href는 숫자만 — 하이픈이 섞인 tel: URI를 못 다루는 기기가 있다. 보이는 글자만 하이픈 */}
                    <a href={`tel:${contact!.phone.replace(/\D/g, '')}`} className="hover:text-brand hover:underline">{formatTel(contact!.phone)}</a>
                    <button onClick={() => copyPhone(contact!.phone!)} title="복사"
                      className="p-0.5 text-ink-meta hover:text-brand">
                      <Copy className="size-3" />
                    </button>
                    {copied === contact!.phone && <span className="text-[10px] text-green-600">복사됨</span>}
                  </span>
                )}
                {contact!.email && (
                  <span className="flex items-center gap-1 text-xs text-ink-sub">
                    <Mail className="size-3 text-ink-faint" />
                    {contact!.email}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {canManage && (
                <button
                  onClick={() => startEdit(role)}
                  className="flex items-center gap-1 text-xs text-ink-sub hover:text-brand transition-colors"
                >
                  <Pencil className="size-3" />
                  수정
                </button>
              )}
              {/* 문자 받음 (소방계획서_24 Q-10) — 번호가 없으면 체크해도 못 보내므로 그 사실을 말한다 */}
              <label
                data-testid="sms-recipient-toggle"
                title={contact!.phone ? '사전 안내 문자를 이 사람에게 보냅니다' : '전화번호가 없어 발송되지 않습니다'}
                className={`flex items-center gap-1 text-[11px] ${canManage ? 'cursor-pointer' : 'opacity-60'} ${
                  contact!.phone ? 'text-ink-sub' : 'text-ink-meta'}`}
              >
                <input
                  type="checkbox"
                  disabled={!canManage || isPending}
                  checked={!!smsPick[contact!.id]}
                  onChange={() => toggleSms(contact!.id)}
                  className="accent-brand"
                />
                <MessageSquare className="size-3" /> 문자 받음
              </label>
              {smsPick[contact!.id] && !contact!.phone && (
                <span className="text-[10px] text-red-500">번호가 없어 발송되지 않습니다</span>
              )}
            </div>
          </div>
        )
      })}
      {canManage && firstEmptyRole && editingRole === null && (
        <button
          onClick={() => startEdit(firstEmptyRole)}
          className="flex items-center justify-center gap-1 text-xs font-medium text-brand hover:bg-brand-tint border border-dashed border-brand-line rounded-lg py-2.5 transition-colors"
        >
          <Plus className="size-3" />
          관계인 추가
        </button>
      )}
    </div>
  )
}
