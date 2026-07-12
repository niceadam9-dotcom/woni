'use client'

import { useState, useTransition } from 'react'
import { Plus, X, ChevronDown, Check, Ban } from 'lucide-react'
import {
  createVoucherAction,
  approveVoucherAction,
  cancelVoucherAction,
  type VoucherLine,
} from '@/app/(dashboard)/accounting/vouchers/actions'
import { DateInput } from '@/components/ui/date-input'

type AccountCode = { id: string; code: string; name: string; account_type: string }
type VoucherLineRow = {
  id: string; debit_amount: number; credit_amount: number; description: string | null
  account_codes: AccountCode | null
}
type Voucher = {
  id: string; voucher_number: string; voucher_date: string; voucher_type: string
  description: string; total_amount: number; status: string
  profiles: { name: string } | null
  voucher_lines: VoucherLineRow[]
}

const TYPE_STYLE: Record<string, string> = {
  입금: 'bg-blue-100 text-blue-700',
  출금: 'bg-red-100 text-red-600',
  대체: 'bg-purple-100 text-purple-700',
}
const STATUS_STYLE: Record<string, string> = {
  작성중: 'bg-gray-100 text-gray-500',
  승인:   'bg-emerald-100 text-emerald-700',
  취소:   'bg-red-100 text-red-400',
}
function fmt(n: number) { return n.toLocaleString('ko-KR') }

function LinesEditor({
  lines,
  accountCodes,
  onChange,
}: {
  lines: VoucherLine[]
  accountCodes: AccountCode[]
  onChange: (l: VoucherLine[]) => void
}) {
  function update(idx: number, field: keyof VoucherLine, val: string | number | null) {
    onChange(lines.map((l, i) => i === idx ? { ...l, [field]: val } : l))
  }
  const totalDebit  = lines.reduce((s, l) => s + l.debit_amount,  0)
  const totalCredit = lines.reduce((s, l) => s + l.credit_amount, 0)
  const balanced    = Math.round(totalDebit) === Math.round(totalCredit)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-1 text-xs text-gray-400 px-1">
        <div className="col-span-4">계정과목</div>
        <div className="col-span-3 text-right">차변</div>
        <div className="col-span-3 text-right">대변</div>
        <div className="col-span-1" /><div className="col-span-1" />
      </div>
      {lines.map((line, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-1 items-center">
          <select
            className="col-span-4 border rounded px-2 py-1.5 text-xs"
            value={line.account_code_id}
            onChange={e => update(idx, 'account_code_id', e.target.value)}
          >
            <option value="">계정 선택</option>
            {accountCodes.map(a => (
              <option key={a.id} value={a.id}>[{a.code}] {a.name}</option>
            ))}
          </select>
          <input type="number" min={0}
            className="col-span-3 border rounded px-2 py-1.5 text-xs text-right"
            value={line.debit_amount || ''}
            placeholder="차변"
            onChange={e => update(idx, 'debit_amount', Number(e.target.value))}
          />
          <input type="number" min={0}
            className="col-span-3 border rounded px-2 py-1.5 text-xs text-right"
            value={line.credit_amount || ''}
            placeholder="대변"
            onChange={e => update(idx, 'credit_amount', Number(e.target.value))}
          />
          <input
            className="col-span-1 border rounded px-1 py-1.5 text-xs"
            placeholder="적요"
            value={line.description ?? ''}
            onChange={e => update(idx, 'description', e.target.value)}
          />
          <button onClick={() => onChange(lines.filter((_, i) => i !== idx))}
            className="col-span-1 text-gray-300 hover:text-red-400 text-center">
            <X size={12} />
          </button>
        </div>
      ))}

      <button
        onClick={() => onChange([...lines, { account_code_id: '', debit_amount: 0, credit_amount: 0, description: null }])}
        className="flex items-center gap-1 text-xs text-[#7b68ee] hover:underline"
      >
        <Plus size={12} /> 행 추가
      </button>

      <div className={`flex justify-between text-xs font-semibold px-1 pt-1 border-t ${balanced ? 'text-emerald-600' : 'text-red-500'}`}>
        <span>차변 합계: {fmt(totalDebit)}</span>
        <span>{balanced ? '✓ 균형' : '✗ 불균형'}</span>
        <span>대변 합계: {fmt(totalCredit)}</span>
      </div>
    </div>
  )
}

function VoucherModal({
  accountCodes,
  onClose,
  onDone,
}: {
  accountCodes: AccountCode[]
  onClose: () => void
  onDone: () => void
}) {
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().split('T')[0])
  const [voucherType, setVoucherType] = useState('대체')
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<VoucherLine[]>([
    { account_code_id: '', debit_amount: 0, credit_amount: 0, description: null },
    { account_code_id: '', debit_amount: 0, credit_amount: 0, description: null },
  ])
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    if (!description.trim()) { setErr('적요를 입력하세요.'); return }
    const validLines = lines.filter(l => l.account_code_id)
    if (validLines.length < 2) { setErr('최소 2개의 계정을 입력하세요.'); return }
    start(async () => {
      const res = await createVoucherAction({ voucherDate, voucherType, description, lines: validLines })
      if (res.error) { setErr(res.error); return }
      onDone()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#090c1d]">전표 등록</span>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">전표일자 *</label>
            <DateInput value={voucherDate} onChange={e => setVoucherDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">전표 구분</label>
            <div className="flex gap-1">
              {['입금', '출금', '대체'].map(t => (
                <button key={t} onClick={() => setVoucherType(t)}
                  className={`flex-1 py-2 rounded-lg text-xs border font-medium transition-colors ${
                    voucherType === t ? TYPE_STYLE[t] : 'bg-white border-gray-200 text-gray-400'
                  }`}>{t}</button>
              ))}
            </div>
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-gray-500 mb-1">적요 *</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="전표 내용 요약" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-2">계정 명세 (차변/대변)</label>
          <LinesEditor lines={lines} accountCodes={accountCodes} onChange={setLines} />
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
          <button onClick={submit} disabled={pending}
            className="flex-1 bg-[#7b68ee] text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {pending ? '등록 중…' : '등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function VouchersClient({
  vouchers,
  accountCodes,
}: {
  vouchers: Record<string, unknown>[]
  accountCodes: Record<string, unknown>[]
}) {
  const rows  = vouchers     as unknown as Voucher[]
  const codes = accountCodes as unknown as AccountCode[]

  const [typeFilter,   setTypeFilter]   = useState('전체')
  const [statusFilter, setStatusFilter] = useState('전체')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [approvePending, startApprove] = useTransition()
  const [cancelPending,  startCancel]  = useTransition()

  const filtered = rows.filter(r => {
    if (typeFilter !== '전체' && r.voucher_type !== typeFilter) return false
    if (statusFilter !== '전체' && r.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!r.description.toLowerCase().includes(q) &&
          !r.voucher_number.toLowerCase().includes(q)) return false
    }
    return true
  })

  const summary = {
    total:    rows.length,
    pending:  rows.filter(r => r.status === '작성중').length,
    approved: rows.filter(r => r.status === '승인').length,
    totalAmt: rows.filter(r => r.status === '승인').reduce((s, r) => s + r.total_amount, 0),
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '전체 전표', value: summary.total,    color: 'text-gray-700' },
          { label: '작성중',   value: summary.pending,   color: 'text-amber-600' },
          { label: '승인',     value: summary.approved,  color: 'text-emerald-600' },
          { label: '승인 합계', value: `${fmt(summary.totalAmt)}원`, color: 'text-[#7b68ee]' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {['전체', '입금', '출금', '대체'].map(f => (
            <button key={f} onClick={() => setTypeFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                typeFilter === f ? 'bg-[#7b68ee] text-white' : 'bg-white border text-gray-500 hover:bg-gray-50'
              }`}>{f}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {['전체', '작성중', '승인', '취소'].map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === f ? 'bg-gray-700 text-white' : 'bg-white border text-gray-500 hover:bg-gray-50'
              }`}>{f}</button>
          ))}
        </div>
        <input type="text" placeholder="적요 / 전표번호 검색"
          value={search} onChange={e => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm w-48" />
        <div className="ml-auto">
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[#7b68ee] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#6a5acd]">
            <Plus size={15} /> 전표 등록
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                {['전표일', '전표번호', '구분', '적요', '금액', '상태', '등록자', '처리'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400 text-sm">전표가 없습니다.</td></tr>
              ) : (
                filtered.map(row => (
                  <>
                    <tr key={row.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-500">{row.voucher_date}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{row.voucher_number}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_STYLE[row.voucher_type] ?? ''}`}>
                          {row.voucher_type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">{row.description}</td>
                      <td className="px-3 py-2.5 text-right font-medium">{fmt(row.total_amount)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[row.status] ?? ''}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-400">{row.profiles?.name ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                            className="p-1 text-gray-400 hover:text-[#7b68ee]">
                            <ChevronDown size={13} className={`transition-transform ${expanded === row.id ? 'rotate-180' : ''}`} />
                          </button>
                          {row.status === '작성중' && (
                            <>
                              <button onClick={() => startApprove(async () => { await approveVoucherAction(row.id) })}
                                disabled={approvePending}
                                className="p-1 text-gray-400 hover:text-emerald-500 disabled:opacity-50" title="승인">
                                <Check size={13} />
                              </button>
                              <button onClick={() => startCancel(async () => { await cancelVoucherAction(row.id) })}
                                disabled={cancelPending}
                                className="p-1 text-gray-400 hover:text-red-400 disabled:opacity-50" title="취소">
                                <Ban size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === row.id && (
                      <tr key={`${row.id}-exp`} className="border-b bg-gray-50">
                        <td colSpan={8} className="px-6 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="text-left pb-1 w-1/3">계정과목</th>
                                <th className="text-right pb-1">차변</th>
                                <th className="text-right pb-1">대변</th>
                                <th className="text-left pb-1 pl-3">적요</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.voucher_lines.map(l => (
                                <tr key={l.id}>
                                  <td className="py-0.5">
                                    [{l.account_codes?.code}] {l.account_codes?.name}
                                  </td>
                                  <td className="text-right py-0.5">{l.debit_amount  > 0 ? fmt(l.debit_amount)  : '—'}</td>
                                  <td className="text-right py-0.5">{l.credit_amount > 0 ? fmt(l.credit_amount) : '—'}</td>
                                  <td className="pl-3 py-0.5 text-gray-400">{l.description ?? ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <VoucherModal
          accountCodes={codes}
          onClose={() => setShowModal(false)}
          onDone={() => setShowModal(false)}
        />
      )}
    </>
  )
}
