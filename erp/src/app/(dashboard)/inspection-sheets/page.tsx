import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, Plus, Search } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SheetDeleteButton } from '@/components/inspection-sheets/sheet-delete-button'
import type { InspectionType } from '@/types'
import { inspectionTypeLabel } from '@/types'

const TYPE_COLORS: Record<string, string> = {
  '종합':   'bg-[#f5f4ff] text-[#7b68ee]',
  '작동':   'bg-blue-50 text-blue-600',
  '일반관리': 'bg-gray-100 text-gray-600',
}

export default async function InspectionSheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; active?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const q = params.q ?? ''
  const typeFilter = params.type ?? ''
  const activeFilter = params.active ?? 'active'

  const admin = createAdminClient()

  const { data: sheets } = await admin
    .from('inspection_sheets')
    .select(`
      *,
      item_count:inspection_sheet_items(count)
    `)
    .order('sheet_code')
    .order('version', { ascending: false })

  type SheetRow = {
    id: string
    sheet_code: string
    sheet_name: string
    version: string
    inspection_type: string | null
    description: string | null
    is_active: boolean
    created_at: string
    item_count: { count: number }[] | null
  }

  let rows = (sheets ?? []) as SheetRow[]

  if (q) {
    const lq = q.toLowerCase()
    rows = rows.filter(r =>
      r.sheet_name.toLowerCase().includes(lq) ||
      r.sheet_code.toLowerCase().includes(lq)
    )
  }
  if (typeFilter) rows = rows.filter(r => r.inspection_type === typeFilter)
  if (activeFilter === 'active') rows = rows.filter(r => r.is_active)
  if (activeFilter === 'inactive') rows = rows.filter(r => !r.is_active)

  const canCreate = profile.role === 'manager' || profile.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="size-6 text-[#7b68ee]" />
          <div>
            <h1 className="text-xl font-bold text-[#090c1d]">점검표 관리</h1>
            <p className="text-sm text-[#514b81] mt-0.5">소방시설별 점검 체크리스트 양식을 관리합니다</p>
          </div>
        </div>
        {canCreate && (
          <Link
            href="/inspection-sheets/new"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors"
          >
            <Plus className="size-4" />
            점검표 등록
          </Link>
        )}
      </div>

      <form method="GET" action="/inspection-sheets" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
          <input
            name="q"
            defaultValue={q}
            placeholder="점검표명·코드 검색"
            className="h-9 pl-8 pr-3 rounded-lg border border-[#d0ccf5] bg-white text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] focus:ring-2 focus:ring-[#7b68ee]/20 transition w-48"
          />
        </div>
        <select
          name="type"
          defaultValue={typeFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="">전체 점검유형</option>
          <option value="종합">종합</option>
          <option value="최초">최초</option>
          <option value="기타">기타</option>
        </select>
        <select
          name="active"
          defaultValue={activeFilter}
          className="h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition"
        >
          <option value="all">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
        <button type="submit" className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">
          검색
        </button>
        {(q || typeFilter || activeFilter !== 'active') && (
          <a href="/inspection-sheets" className="h-9 px-3 rounded-lg border border-[#c8c4d0] text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors flex items-center">
            초기화
          </a>
        )}
        <span className="text-xs text-[#514b81] ml-auto">총 {rows.length}개</span>
      </form>

      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px] overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#514b81]">등록된 점검표가 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#c8c4d0] bg-[#f8f9fa]">
                  {['점검표 코드', '점검표명', '점검유형', '버전', '항목 수', '상태', '등록일', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#514b81] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c8c4d0]">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-[#f8f9fa] transition-colors">
                    <td className="px-4 py-3 text-xs font-mono text-[#514b81]">{r.sheet_code}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#090c1d]">{r.sheet_name}</p>
                      {r.description && <p className="text-xs text-[#b0acd6] mt-0.5 truncate max-w-[180px]">{r.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {r.inspection_type ? (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[r.inspection_type] ?? 'bg-gray-100 text-gray-600'}`}>
                          {inspectionTypeLabel(r.inspection_type)}
                        </span>
                      ) : (
                        <span className="text-xs text-[#b0acd6]">공통</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">v{r.version}</td>
                    <td className="px-4 py-3 text-xs text-[#514b81]">
                      {r.item_count?.[0]?.count ?? 0}개
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#292d34]">{r.created_at.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link href={`/inspection-sheets/${r.id}`} className="text-xs text-[#7b68ee] hover:underline font-medium">
                          상세보기
                        </Link>
                        {canCreate && <SheetDeleteButton sheetId={r.id} sheetName={r.sheet_name} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
