'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Receipt, Landmark, Save, Eye, Loader2, ShieldCheck, Users, Download, ExternalLink } from 'lucide-react'
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

// §6-E: 은행 프리셋 (datalist — 직접 입력도 허용)
const BANKS = ['국민은행', '신한은행', '우리은행', '하나은행', '농협', 'IBK기업은행', 'SC제일은행', '카카오뱅크', '토스뱅크', '새마을금고', '신협', '우체국', '수협', '대구은행', '부산은행']

/** 사업자등록번호 자동 하이픈 (000-00-00000) */
export function formatBizNo(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
}

/** 사업자등록번호 체크섬 검증 (국세청 10자리 알고리즘) — 10자리 완성 시에만 판정 */
export function isValidBizNo(v: string): boolean | null {
  const d = v.replace(/\D/g, '')
  if (d.length !== 10) return null
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * w[i]
  sum += Math.floor((parseInt(d[8], 10) * 5) / 10)
  return (10 - (sum % 10)) % 10 === parseInt(d[9], 10)
}

export function BillingClient({ customerId, profile, autopay, owners, ownerId, canManage, customerName, repName, customerAddress }: {
  customerId: string
  profile: BillingProfile | null
  autopay: Autopay | null
  owners: OwnerOption[]
  ownerId: string | null
  canManage: boolean
  /** §6-E: [고객 정보에서 가져오기] — 상호=고객명, 대표자=대표 관계인, 주소=고객 주소 */
  customerName?: string
  repName?: string | null
  customerAddress?: string | null
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
          {canManage && (customerName || repName || customerAddress) && (
            <button type="button"
              onClick={() => setBp(p => ({
                ...p,
                company_name: p.company_name || (customerName ?? ''),
                rep_name: p.rep_name || (repName ?? ''),
                address: p.address || (customerAddress ?? ''),
              }))}
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline">
              <Download className="size-3" /> 고객 정보에서 가져오기
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>사업자등록번호</span>
            <input disabled={!canManage} value={bp.business_no}
              onChange={e => setBp({ ...bp, business_no: formatBizNo(e.target.value) })}
              placeholder="000-00-00000"
              className={`${field}${isValidBizNo(bp.business_no) === false ? ' !border-red-400' : ''}`} />
            {isValidBizNo(bp.business_no) === false && (
              <p className="text-[10px] text-red-500 mt-0.5">사업자번호 검증 실패 — 번호를 확인해주세요</p>
            )}
          </div>
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
          <div>
            <span className={label}>은행</span>
            <input disabled={!canManage} value={ap.bank_name} onChange={e => setAp({ ...ap, bank_name: e.target.value })}
              list="bank-presets" placeholder="선택/입력" className={field} />
            <datalist id="bank-presets">{BANKS.map(b => <option key={b} value={b} />)}</datalist>
          </div>
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
          <div>
            <span className={label}>자동이체일</span>
            <select disabled={!canManage} value={ap.withdraw_day} onChange={e => setAp({ ...ap, withdraw_day: e.target.value })} className={field}>
              <option value="">선택</option>
              {Array.from({ length: 31 }, (_, i) => String(i + 1)).map(d => <option key={d} value={d}>{d}일</option>)}
            </select>
          </div>
        </div>
        {canManage && (
          <button onClick={saveAutopay} disabled={isPending} className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-sm font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} 저장
          </button>
        )}
      </div>

      {/* §6-E: 청구 업무 딥링크 */}
      <div className="flex items-center gap-3">
        <Link href="/tax-invoices" className="inline-flex items-center gap-1 text-xs text-[#7b68ee] hover:underline">
          <ExternalLink className="size-3" /> 세금계산서 발행 →
        </Link>
        <Link href="/billing/status" className="inline-flex items-center gap-1 text-xs text-[#7b68ee] hover:underline">
          <ExternalLink className="size-3" /> 정산현황 →
        </Link>
      </div>

      {msg && <p className="text-xs text-green-600">{msg}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}
