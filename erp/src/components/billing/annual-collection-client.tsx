'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { ShieldCheck, Download, Search, LayoutGrid, Receipt, Landmark, Building } from 'lucide-react'

export type CollectionRow = {
  id: string; name: string; type: string; feeKind: string
  region: string; fireStation: string; fee: number
  billed: number[]; paid: number[]
  bizNo: string; bizName: string; taxEmail: string
  bank: string; holder: string; last4: string; withdrawDay: number | null
  ownerId: string | null; ownerName: string
}
export type StationRow = { region: string; fireStation: string; regionSi: string }

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const won = (n: number) => n.toLocaleString('ko-KR')

type Tab = 'board' | 'biz' | 'autopay' | 'agency'
const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'board', label: '수금 현황판', icon: LayoutGrid },
  { key: 'biz', label: '사업자정보', icon: Receipt },
  { key: 'autopay', label: '자동이체', icon: Landmark },
  { key: 'agency', label: '관할기관', icon: Building },
]

export function AnnualCollectionClient({ year, rows, stations }: {
  year: string; rows: CollectionRow[]; stations: StationRow[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('board')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [byOwner, setByOwner] = useState(false)

  const filtered = useMemo(() => rows.filter(r =>
    (!q || r.name.includes(q)) && (!kind || r.feeKind === kind)
  ), [rows, q, kind])

  // 소유자별 그룹 (통합청구/소유자별 보기, P4-4). 소유자 없는 고객은 '개별' 그룹.
  const ownerGroups = useMemo(() => {
    const map = new Map<string, { name: string; rows: CollectionRow[] }>()
    for (const r of filtered) {
      const key = r.ownerId ?? '__none__'
      if (!map.has(key)) map.set(key, { name: r.ownerId ? (r.ownerName || '(소유자)') : '개별 관리', rows: [] })
      map.get(key)!.rows.push(r)
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] === '__none__' ? 1 : b[0] === '__none__' ? -1 : a[1].name.localeCompare(b[1].name)))
      .map(([key, g]) => {
        const unpaid = g.rows.reduce((s, r) => s + r.billed.reduce((a, b) => a + b, 0) - r.paid.reduce((a, b) => a + b, 0), 0)
        return { key, name: g.name, rows: g.rows, count: g.rows.length, unpaid }
      })
  }, [filtered])

  const totals = useMemo(() => {
    const billed = Array(12).fill(0), paid = Array(12).fill(0)
    for (const r of filtered) for (let i = 0; i < 12; i++) { billed[i] += r.billed[i]; paid[i] += r.paid[i] }
    return { billed, paid, billedSum: billed.reduce((a, b) => a + b, 0), paidSum: paid.reduce((a, b) => a + b, 0) }
  }, [filtered])

  function goYear(delta: number) {
    router.push(`/billing/annual?year=${parseInt(year, 10) + delta}`)
  }

  function exportXlsx() {
    let data: Record<string, unknown>[] = []
    if (tab === 'board') {
      data = filtered.map((r, i) => {
        const row: Record<string, unknown> = { 번호: i + 1, 대상물: r.name, 구분: r.type, 과금: r.feeKind }
        for (const m of MONTHS) {
          row[`${m}월청구`] = r.billed[m - 1] || ''
          row[`${m}월입금`] = r.paid[m - 1] || ''
        }
        row['미수'] = r.billed.reduce((a, b) => a + b, 0) - r.paid.reduce((a, b) => a + b, 0)
        return row
      })
    } else if (tab === 'biz') {
      data = filtered.map((r, i) => ({ 번호: i + 1, 대상물: r.name, 사업자번호: r.bizNo, 상호: r.bizName, 계산서이메일: r.taxEmail }))
    } else if (tab === 'autopay') {
      data = filtered.map((r, i) => ({ 번호: i + 1, 대상물: r.name, 은행: r.bank, 예금주: r.holder, 계좌: r.last4 ? `****${r.last4}` : '', 이체일: r.withdrawDay ?? '' }))
    } else {
      data = stations.map((s, i) => ({ 번호: i + 1, 지역: s.region, 시군: s.regionSi, 관할소방서: s.fireStation }))
    }
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `안전관리_${year}`)
    XLSX.writeFile(wb, `안전관리대장_${year}_${tab}.xlsx`)
  }

  function custRow(r: CollectionRow) {
    const unpaid = r.billed.reduce((a, b) => a + b, 0) - r.paid.reduce((a, b) => a + b, 0)
    return (
      <tr key={r.id} className="hover:bg-paper">
        <td className="px-2 py-1.5 sticky left-0 bg-surface">
          <Link href={`/customers/${r.id}`} className="font-medium text-ink hover:text-brand">{r.name}</Link>
        </td>
        <td className="px-1.5 py-1.5 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.feeKind === '정액' ? 'bg-brand-tint text-brand' : 'bg-gray-100 text-gray-600'}`}>{r.feeKind}</span></td>
        {MONTHS.map(m => {
          const b = r.billed[m - 1], p = r.paid[m - 1]
          return (
            <td key={m} className="px-1.5 py-1.5 text-right">
              {b > 0 ? <span className={p >= b ? 'text-green-600' : p > 0 ? 'text-amber-600' : 'text-red-500'}>{won(b)}</span> : <span className="text-[#e0ddf5]">·</span>}
            </td>
          )
        })}
        <td className={`px-2 py-1.5 text-right font-semibold ${unpaid > 0 ? 'text-red-500' : 'text-ink-faint'}`}>{unpaid > 0 ? won(unpaid) : '-'}</td>
      </tr>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-6 text-brand" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-ink">안전관리 대장</h1>
          <p className="text-xs text-ink-faint">월별 수금·사업자·자동이체·관할기관 관리</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => goYear(-1)} className="h-8 px-2 rounded-lg border border-brand-line text-sm text-ink-sub hover:bg-brand-tint">◀</button>
          <span className="text-sm font-semibold text-ink w-16 text-center">{year}년</span>
          <button onClick={() => goYear(1)} className="h-8 px-2 rounded-lg border border-brand-line text-sm text-ink-sub hover:bg-brand-tint">▶</button>
        </div>
        <button onClick={exportXlsx} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-brand-line text-sm text-brand hover:bg-brand-tint">
          <Download className="size-4" /> 엑셀
        </button>
      </div>

      {/* 탭 */}
      <div className="flex items-center gap-1 border-b border-brand-line-soft">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3 h-9 text-sm border-b-2 -mb-px transition-colors ${tab === t.key
              ? 'border-brand text-brand font-semibold' : 'border-transparent text-ink-sub hover:text-ink'}`}>
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* 필터 (기관 탭 제외) */}
      {tab !== 'agency' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="대상물 검색"
              className="h-9 w-52 rounded-lg border border-brand-line bg-surface pl-8 pr-3 text-sm outline-none focus:border-brand" />
          </div>
          <select value={kind} onChange={e => setKind(e.target.value)} className="h-9 rounded-lg border border-brand-line bg-surface px-2 text-sm outline-none focus:border-brand">
            <option value="">전체 과금</option>
            <option value="정액">정액</option>
            <option value="건별">건별</option>
          </select>
          {tab === 'board' && (
            <button onClick={() => setByOwner(v => !v)}
              className={`h-9 px-3 rounded-lg border text-sm transition-colors ${byOwner ? 'border-brand bg-brand-tint text-brand font-medium' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`}>
              소유자별 보기
            </button>
          )}
          <span className="text-xs text-ink-faint ml-auto">{filtered.length}곳{byOwner ? ` · ${ownerGroups.length}그룹` : ''}</span>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          {tab === 'board' && (
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="border-b border-line bg-paper text-ink-sub">
                  <th className="text-left px-2 py-2 font-semibold sticky left-0 bg-paper">대상물</th>
                  <th className="px-1.5 py-2 font-semibold">과금</th>
                  {MONTHS.map(m => <th key={m} className="px-1.5 py-2 font-semibold text-right">{m}월</th>)}
                  <th className="px-2 py-2 font-semibold text-right">미수</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line-soft">
                {byOwner
                  ? ownerGroups.flatMap(g => [
                      <tr key={`h-${g.key}`} className="bg-brand-tint">
                        <td className="px-2 py-1.5 sticky left-0 bg-brand-tint font-semibold text-brand">▸ {g.name} <span className="text-[10px] text-ink-faint">{g.count}곳</span></td>
                        <td colSpan={13}></td>
                        <td className={`px-2 py-1.5 text-right font-bold ${g.unpaid > 0 ? 'text-red-500' : 'text-ink-faint'}`}>{g.unpaid > 0 ? `통합 ${won(g.unpaid)}` : '-'}</td>
                      </tr>,
                      ...g.rows.map(r => custRow(r)),
                    ])
                  : filtered.map(r => custRow(r))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-paper font-semibold text-ink">
                  <td className="px-2 py-2 sticky left-0 bg-paper">합계 (청구)</td>
                  <td></td>
                  {totals.billed.map((v, i) => <td key={i} className="px-1.5 py-2 text-right">{v > 0 ? won(v) : '·'}</td>)}
                  <td className="px-2 py-2 text-right">{won(totals.billedSum - totals.paidSum)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {tab === 'biz' && (
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr className="border-b border-line bg-paper text-xs text-ink-sub">
                {['대상물', '사업자등록번호', '상호', '계산서 이메일', '상태'].map(h => <th key={h} className="text-left px-3 py-2.5 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-brand-line-soft">
                {filtered.map(r => {
                  const done = !!(r.bizNo && r.taxEmail)
                  return (
                    <tr key={r.id} className="hover:bg-paper">
                      <td className="px-3 py-2"><Link href={`/customers/${r.id}`} className="font-medium text-ink hover:text-brand">{r.name}</Link></td>
                      <td className="px-3 py-2 text-ink-strong">{r.bizNo || '-'}</td>
                      <td className="px-3 py-2 text-ink-sub">{r.bizName || '-'}</td>
                      <td className="px-3 py-2 text-ink-sub">{r.taxEmail || '-'}</td>
                      <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${done ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>{done ? '완비' : '미비'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {tab === 'autopay' && (
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr className="border-b border-line bg-paper text-xs text-ink-sub">
                {['대상물', '은행', '예금주', '계좌', '이체일', '상태'].map(h => <th key={h} className="text-left px-3 py-2.5 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-brand-line-soft">
                {filtered.map(r => {
                  const done = !!r.last4
                  return (
                    <tr key={r.id} className="hover:bg-paper">
                      <td className="px-3 py-2"><Link href={`/customers/${r.id}`} className="font-medium text-ink hover:text-brand">{r.name}</Link></td>
                      <td className="px-3 py-2 text-ink-sub">{r.bank || '-'}</td>
                      <td className="px-3 py-2 text-ink-sub">{r.holder || '-'}</td>
                      <td className="px-3 py-2 font-mono text-ink-strong">{r.last4 ? `****${r.last4}` : '-'}</td>
                      <td className="px-3 py-2 text-ink-sub">{r.withdrawDay ? `${r.withdrawDay}일` : '-'}</td>
                      <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${done ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>{done ? '등록' : '미등록'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {tab === 'agency' && (
            <table className="w-full text-sm whitespace-nowrap">
              <thead><tr className="border-b border-line bg-paper text-xs text-ink-sub">
                {['지역', '시·군', '관할 소방서'].map(h => <th key={h} className="text-left px-3 py-2.5 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-brand-line-soft">
                {stations.map(s => (
                  <tr key={s.region} className="hover:bg-paper">
                    <td className="px-3 py-2 font-medium text-ink">{s.region}</td>
                    <td className="px-3 py-2 text-ink-sub">{s.regionSi || '-'}</td>
                    <td className="px-3 py-2 text-ink-strong">{s.fireStation || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
