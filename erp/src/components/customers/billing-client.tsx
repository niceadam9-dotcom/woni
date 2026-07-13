'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Receipt, Landmark, Save, Eye, Loader2, ShieldCheck, Users } from 'lucide-react'
import {
  saveBillingProfileAction, saveAutopayAction, revealAccountAction,
  type BillingProfileInput, type AutopayInput,
} from '@/app/(dashboard)/customers/billing-actions'
import { createOwnerAction, assignOwnerAction, type OwnerOption } from '@/app/(dashboard)/customers/owner-actions'

export type BillingProfile = {
  business_no: string | null; company_name: string | null; rep_name: string | null
  address: string | null; business_type: string | null; business_item: string | null
  tax_email: string | null; note: string | null
}
export type Autopay = {
  bank_name: string | null; account_holder: string | null
  account_no_last4: string | null; withdraw_day: number | null; note: string | null
}

const field = 'h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm outline-none focus:border-[#7b68ee] w-full'
const label = 'text-[11px] text-[#514b81] mb-1 block'

export function BillingClient({ customerId, profile, autopay, owners, ownerId, canManage }: {
  customerId: string
  profile: BillingProfile | null
  autopay: Autopay | null
  owners: OwnerOption[]
  ownerId: string | null
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  // 소유자 그룹 (P4-4)
  const [ownerList, setOwnerList] = useState<OwnerOption[]>(owners)
  const [curOwner, setCurOwner] = useState<string>(ownerId ?? '')
  const [newOwner, setNewOwner] = useState('')
  const [addingOwner, setAddingOwner] = useState(false)

  function assignOwner(id: string) {
    setErr(''); setMsg(''); setCurOwner(id)
    startTransition(async () => {
      const res = await assignOwnerAction(customerId, id || null)
      if (res.error) { setErr(res.error) } else { setMsg('소유자 그룹을 저장했습니다.'); router.refresh() }
    })
  }
  function addOwner() {
    const name = newOwner.trim()
    if (!name) return
    setErr(''); setMsg('')
    startTransition(async () => {
      const res = await createOwnerAction({ name })
      if (res.error || !res.owner) { setErr(res.error ?? '소유자 생성 실패'); return }
      setOwnerList(l => [...l, res.owner!].sort((a, b) => a.name.localeCompare(b.name)))
      setNewOwner(''); setAddingOwner(false)
      assignOwner(res.owner.id)
    })
  }

  // 사업자정보 폼
  const [bp, setBp] = useState<BillingProfileInput>({
    business_no: profile?.business_no ?? '', company_name: profile?.company_name ?? '',
    rep_name: profile?.rep_name ?? '', address: profile?.address ?? '',
    business_type: profile?.business_type ?? '', business_item: profile?.business_item ?? '',
    tax_email: profile?.tax_email ?? '', note: profile?.note ?? '',
  })

  // 자동이체 폼
  const [ap, setAp] = useState<AutopayInput>({
    bank_name: autopay?.bank_name ?? '', account_holder: autopay?.account_holder ?? '',
    account_no: '', withdraw_day: autopay?.withdraw_day ? String(autopay.withdraw_day) : '', note: autopay?.note ?? '',
  })
  const [revealed, setRevealed] = useState<string | null>(null)

  function notify(res: { error?: string }, ok: string) {
    if (res.error) { setErr(res.error); setMsg('') } else { setMsg(ok); setErr(''); router.refresh() }
  }
  function saveProfile() {
    setErr(''); setMsg('')
    startTransition(async () => notify(await saveBillingProfileAction(customerId, bp), '사업자정보를 저장했습니다.'))
  }
  function saveAutopay() {
    setErr(''); setMsg('')
    startTransition(async () => notify(await saveAutopayAction(customerId, ap), '자동이체 정보를 저장했습니다.'))
  }
  function reveal() {
    setErr(''); setMsg('')
    startTransition(async () => {
      const res = await revealAccountAction(customerId)
      if (res.error) { setErr(res.error) } else { setRevealed(res.account_no ?? ''); setMsg('열람 기록이 저장되었습니다.') }
    })
  }

  const cardCls = 'bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5'

  return (
    <div className="space-y-4">
      {/* 소유자 그룹 (선택적, P4-4) */}
      <div className={cardCls}>
        <div className="flex items-center gap-2 mb-3">
          <Users className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">소유자 그룹 <span className="text-xs font-normal text-[#b0acd6]">통합청구·입금배분</span></h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select disabled={!canManage || isPending} value={curOwner} onChange={e => assignOwner(e.target.value)}
            className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm outline-none focus:border-[#7b68ee] min-w-[200px]">
            <option value="">개별 관리 (그룹 없음)</option>
            {ownerList.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {canManage && !addingOwner && (
            <button onClick={() => setAddingOwner(true)} className="h-9 px-3 rounded-lg border border-[#d0ccf5] text-sm text-[#7b68ee] hover:bg-[#f5f4ff]">+ 새 소유자</button>
          )}
          {canManage && addingOwner && (
            <div className="flex items-center gap-1.5">
              <input value={newOwner} onChange={e => setNewOwner(e.target.value)} placeholder="소유자명"
                className="h-9 rounded-lg border border-[#d0ccf5] px-3 text-sm outline-none focus:border-[#7b68ee]" autoFocus />
              <button onClick={addOwner} disabled={isPending} className="h-9 px-3 rounded-lg bg-[#7b68ee] text-white text-sm disabled:opacity-50">추가</button>
              <button onClick={() => { setAddingOwner(false); setNewOwner('') }} className="h-9 px-2 text-sm text-[#514b81]">취소</button>
            </div>
          )}
        </div>
      </div>

      {/* 사업자정보 (세금계산서) */}
      <div className={cardCls}>
        <div className="flex items-center gap-2 mb-4">
          <Receipt className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">사업자정보 <span className="text-xs font-normal text-[#b0acd6]">세금계산서</span></h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><span className={label}>사업자등록번호</span><input disabled={!canManage} value={bp.business_no} onChange={e => setBp({ ...bp, business_no: e.target.value })} placeholder="000-00-00000" className={field} /></div>
          <div><span className={label}>상호(법인명)</span><input disabled={!canManage} value={bp.company_name} onChange={e => setBp({ ...bp, company_name: e.target.value })} className={field} /></div>
          <div><span className={label}>대표자</span><input disabled={!canManage} value={bp.rep_name} onChange={e => setBp({ ...bp, rep_name: e.target.value })} className={field} /></div>
          <div><span className={label}>계산서 이메일</span><input disabled={!canManage} value={bp.tax_email} onChange={e => setBp({ ...bp, tax_email: e.target.value })} className={field} /></div>
          <div className="col-span-2"><span className={label}>사업장 주소</span><input disabled={!canManage} value={bp.address} onChange={e => setBp({ ...bp, address: e.target.value })} className={field} /></div>
          <div><span className={label}>업태</span><input disabled={!canManage} value={bp.business_type} onChange={e => setBp({ ...bp, business_type: e.target.value })} className={field} /></div>
          <div><span className={label}>종목</span><input disabled={!canManage} value={bp.business_item} onChange={e => setBp({ ...bp, business_item: e.target.value })} className={field} /></div>
        </div>
        {canManage && (
          <button onClick={saveProfile} disabled={isPending} className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-sm font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} 저장
          </button>
        )}
      </div>

      {/* 자동이체 (계좌 암호화) */}
      <div className={cardCls}>
        <div className="flex items-center gap-2 mb-4">
          <Landmark className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">자동이체</h2>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-green-600"><ShieldCheck className="size-3.5" /> AES-256 암호화</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><span className={label}>은행</span><input disabled={!canManage} value={ap.bank_name} onChange={e => setAp({ ...ap, bank_name: e.target.value })} className={field} /></div>
          <div><span className={label}>예금주</span><input disabled={!canManage} value={ap.account_holder} onChange={e => setAp({ ...ap, account_holder: e.target.value })} className={field} /></div>
          <div className="col-span-2">
            <span className={label}>계좌번호 {autopay?.account_no_last4 && !revealed && <span className="text-[#b0acd6]">(등록됨 ****{autopay.account_no_last4})</span>}</span>
            <div className="flex gap-2">
              <input disabled={!canManage} value={ap.account_no} onChange={e => setAp({ ...ap, account_no: e.target.value })}
                placeholder={autopay?.account_no_last4 ? '변경 시에만 입력' : '숫자만 입력'} className={field} />
              {autopay?.account_no_last4 && (
                <button onClick={reveal} disabled={isPending} type="button" className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-[#d0ccf5] text-sm text-[#514b81] hover:bg-[#f5f4ff] disabled:opacity-50">
                  <Eye className="size-3.5" /> 열람
                </button>
              )}
            </div>
            {revealed && <p className="mt-1 text-sm font-mono text-[#090c1d] bg-[#f5f4ff] rounded px-2 py-1 inline-block">{revealed}</p>}
          </div>
          <div><span className={label}>자동이체일</span><input disabled={!canManage} value={ap.withdraw_day} onChange={e => setAp({ ...ap, withdraw_day: e.target.value.replace(/\D/g, '') })} placeholder="1~31" className={field} /></div>
        </div>
        {canManage && (
          <button onClick={saveAutopay} disabled={isPending} className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-sm font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} 저장
          </button>
        )}
      </div>

      {msg && <p className="text-xs text-green-600">{msg}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}
