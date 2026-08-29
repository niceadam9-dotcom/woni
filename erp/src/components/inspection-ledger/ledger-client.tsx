'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { BookText, Download, Search } from 'lucide-react'
import { TableScroll, STICKY_THEAD } from '@/components/ui/table-scroll'
import { formatTel } from '@/lib/format-contact'

export type LedgerRow = {
  id: string; name: string; type: string; planDate: string | null
  region: string; area: number | null; useApproval: string | null
  contact: string; phone: string; fireStation: string
  fee: number | null; feeKind: string
}

const TYPE_STYLE: Record<string, string> = {
  '종합': 'bg-brand-tint text-brand', '작동': 'bg-blue-50 text-blue-600', '일반관리': 'bg-gray-100 text-gray-600',
}

export function LedgerClient({ rows, canViewFee }: { rows: LedgerRow[]; canViewFee: boolean }) {
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
      관계인: r.contact, 연락처: formatTel(r.phone), 관할소방서: r.fireStation,
      ...(canViewFee ? { 계약료: r.fee ?? '', 과금: r.feeKind } : {}),
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
        <BookText className="size-6 text-brand" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-ink">점검 대장 <span className="text-sm font-normal text-ink-sub">2026</span></h1>
          <p className="text-xs text-ink-faint">연간 점검 실적·계약 대장 ({filtered.length}곳{canViewFee ? ` · 계약료 합계 ${totalFee.toLocaleString()}원` : ''})</p>
        </div>
        <button onClick={exportXlsx} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-brand-line text-sm text-brand hover:bg-brand-tint transition-colors">
          <Download className="size-4" /> 엑셀
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="대상물·관계인 검색"
            className="h-9 w-56 rounded-lg border border-brand-line bg-surface pl-8 pr-3 text-sm outline-none focus:border-brand" />
        </div>
        <select value={region} onChange={e => setRegion(e.target.value)} className="h-9 rounded-lg border border-brand-line bg-surface px-2 text-sm outline-none focus:border-brand">
          <option value="">전체 지역</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value)} className="h-9 rounded-lg border border-brand-line bg-surface px-2 text-sm outline-none focus:border-brand">
          <option value="">전체 구분</option>
          {['종합', '작동', '일반관리'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        {/* 가로 스크롤 없이 한 화면에 담는다 — 긴 텍스트(대상물·관계인·관할서)는 줄바꿈으로
            흡수하고, 날짜·연락처처럼 중간에 끊기면 안 되는 값만 nowrap. 연락처는 폭 절약을 위해 한 단계 작게 */}
        <TableScroll offset={300}>
          <table className="w-full text-sm">
            <thead className={STICKY_THEAD}>
              <tr className="border-b border-line bg-paper text-xs text-ink-sub">
                {['#', '대상물', '구분', '점검계획일', '지역', '연면적', '사용승인일', '관계인', '연락처', '관할서', ...(canViewFee ? ['계약료'] : [])].map(h => (
                  <th key={h} className="text-left px-2 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-line-soft">
              {filtered.map((r, i) => (
                <tr key={r.id} className="hover:bg-paper">
                  <td className="px-2 py-2 text-xs text-ink-faint">{i + 1}</td>
                  <td className="px-2 py-2">
                    <Link href={`/customers/${r.id}`} className="font-medium text-ink hover:text-brand">{r.name}</Link>
                    {/* R15-c: 문서 현황 딥링크 → 별지서식 탭(소방계획서_8 Phase B → _34로 탭 승격) */}
                    <Link href={`/customers/${r.id}?tab=annex`} title="별지서식 탭 · 회차별 문서 현황" className="block text-[10px] text-brand hover:underline mt-0.5 whitespace-nowrap">문서 현황 →</Link>
                  </td>
                  <td className="px-2 py-2"><span className={`text-xs font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${TYPE_STYLE[r.type] ?? ''}`}>{r.type}</span></td>
                  <td className="px-2 py-2 text-xs text-ink-strong whitespace-nowrap">{mmdd(r.planDate)}</td>
                  <td className="px-2 py-2 text-xs text-ink-sub">{r.region || '-'}</td>
                  <td className="px-2 py-2 text-xs text-ink-sub whitespace-nowrap">{r.area != null ? `${r.area.toLocaleString()}㎡` : '-'}</td>
                  <td className="px-2 py-2 text-xs text-ink-sub whitespace-nowrap">{r.useApproval ?? '-'}</td>
                  <td className="px-2 py-2 text-xs text-ink-strong">{r.contact || '-'}</td>
                  <td className="px-2 py-2 text-[11px] tracking-tight text-ink-sub whitespace-nowrap">{formatTel(r.phone) || '-'}</td>
                  <td className="px-2 py-2 text-xs text-ink-sub">{r.fireStation || '-'}</td>
                  {canViewFee && (
                    <td className="px-2 py-2 text-xs text-ink-strong whitespace-nowrap">{r.fee != null ? `${r.fee.toLocaleString()}` : '-'}<span className="text-[10px] text-ink-faint ml-1">{r.feeKind}</span></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </div>
  )
}
