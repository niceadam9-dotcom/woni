'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { BookText, Download, Search } from 'lucide-react'

export type LedgerRow = {
  id: string; name: string; type: string; planDate: string | null
  region: string; area: number | null; useApproval: string | null
  contact: string; phone: string; fireStation: string
  fee: number | null; feeKind: string
}

const TYPE_STYLE: Record<string, string> = {
  '종합': 'bg-[#f5f4ff] text-[#7b68ee]', '작동': 'bg-blue-50 text-blue-600', '일반관리': 'bg-gray-100 text-gray-600',
}

export function LedgerClient({ rows, canManage }: { rows: LedgerRow[]; canManage: boolean }) {
  const [q, setQ] = useState('')
  const [region, setRegion] = useState('')
  const [type, setType] = useState('')

  const regions = useMemo(() => [...new Set(rows.map(r => r.region).filter(Boolean))].sort(), [rows])
  const filtered = useMemo(() => rows.filter(r =>
    (!q || r.name.includes(q) || r.contact.includes(q)) &&
    (!region || r.region === region) &&
    (!type || r.type === type)
  ), [rows, q, region, type])

  const totalFee = filtered.reduce((s, r) => s + (r.fee ?? 0), 0)

  function exportXlsx() {
    const data = filtered.map((r, i) => ({
      번호: i + 1, 대상물: r.name, 구분: r.type, 점검계획일: r.planDate ?? '',
      지역: r.region, 연면적: r.area ?? '', 사용승인일: r.useApproval ?? '',
      관계인: r.contact, 연락처: r.phone, 관할소방서: r.fireStation,
      계약료: r.fee ?? '', 과금: r.feeKind,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '점검대장')
    XLSX.writeFile(wb, `점검대장_2026.xlsx`)
  }

  const mmdd = (d: string | null) => d ? d.slice(5).replace('-', '/') : '-'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BookText className="size-6 text-[#7b68ee]" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#090c1d]">점검 대장 <span className="text-sm font-normal text-[#514b81]">2026</span></h1>
          <p className="text-xs text-[#b0acd6]">연간 점검 실적·계약 대장 ({filtered.length}곳 · 계약료 합계 {totalFee.toLocaleString()}원)</p>
        </div>
        <button onClick={exportXlsx} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#d0ccf5] text-sm text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors">
          <Download className="size-4" /> 엑셀
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="대상물·관계인 검색"
            className="h-9 w-56 rounded-lg border border-[#d0ccf5] bg-white pl-8 pr-3 text-sm outline-none focus:border-[#7b68ee]" />
        </div>
        <select value={region} onChange={e => setRegion(e.target.value)} className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-2 text-sm outline-none focus:border-[#7b68ee]">
          <option value="">전체 지역</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value)} className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-2 text-sm outline-none focus:border-[#7b68ee]">
          <option value="">전체 구분</option>
          {['종합', '작동', '일반관리'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-[#c8c4d0] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa] text-xs text-[#514b81]">
                {['#', '대상물', '구분', '점검계획일', '지역', '연면적', '사용승인일', '관계인', '연락처', '관할서', '계약료'].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0eefb]">
              {filtered.map((r, i) => (
                <tr key={r.id} className="hover:bg-[#fafafa]">
                  <td className="px-3 py-2 text-xs text-[#b0acd6]">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Link href={`/customers/${r.id}`} className="font-medium text-[#090c1d] hover:text-[#7b68ee]">{r.name}</Link>
                  </td>
                  <td className="px-3 py-2"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_STYLE[r.type] ?? ''}`}>{r.type}</span></td>
                  <td className="px-3 py-2 text-xs text-[#292d34]">{mmdd(r.planDate)}</td>
                  <td className="px-3 py-2 text-xs text-[#514b81]">{r.region || '-'}</td>
                  <td className="px-3 py-2 text-xs text-[#514b81]">{r.area != null ? `${r.area.toLocaleString()}㎡` : '-'}</td>
                  <td className="px-3 py-2 text-xs text-[#514b81]">{r.useApproval ?? '-'}</td>
                  <td className="px-3 py-2 text-xs text-[#292d34]">{r.contact || '-'}</td>
                  <td className="px-3 py-2 text-xs text-[#514b81]">{r.phone || '-'}</td>
                  <td className="px-3 py-2 text-xs text-[#514b81]">{r.fireStation || '-'}</td>
                  <td className="px-3 py-2 text-xs text-[#292d34]">{r.fee != null ? `${r.fee.toLocaleString()}` : '-'}<span className="text-[10px] text-[#b0acd6] ml-1">{r.feeKind}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
