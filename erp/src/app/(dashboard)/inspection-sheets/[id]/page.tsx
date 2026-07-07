import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SheetDetailClient } from '@/components/inspection-sheets/sheet-detail-client'

const TYPE_COLORS: Record<string, string> = {
  '종합':   'bg-[#f5f4ff] text-[#7b68ee]',
  '작동':   'bg-blue-50 text-blue-600',
  '일반관리': 'bg-gray-100 text-gray-600',
}

export default async function InspectionSheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const admin = createAdminClient()

  const [{ data: sheet }, { data: items }] = await Promise.all([
    admin.from('inspection_sheets').select('*').eq('id', id).single(),
    admin
      .from('inspection_sheet_items')
      .select('*')
      .eq('sheet_id', id)
      .eq('is_active', true)
      .order('order_num'),
  ])

  if (!sheet) notFound()

  type SheetRow = {
    id: string; sheet_code: string; sheet_name: string; version: string
    inspection_type: string | null; description: string | null; is_active: boolean; created_at: string
  }
  type ItemRow = {
    id: string; item_code: string; item_name: string; facility_type: string | null
    inspection_method: string | null; judgment_criteria: string | null; order_num: number
  }

  const s = sheet as SheetRow
  const its = (items ?? []) as ItemRow[]
  const canEdit = true // 전 직원 수정 가능

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/inspection-sheets" className="hover:text-[#7b68ee] flex items-center gap-1">
          <ClipboardList className="size-3.5" />
          점검표 관리
        </Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium">{s.sheet_name}</span>
      </div>

      <div className="flex items-start gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#090c1d]">{s.sheet_name}</h1>
            <span className="text-sm font-mono text-[#514b81] bg-[#f8f9fa] border border-[#c8c4d0] px-2 py-0.5 rounded">v{s.version}</span>
            {s.inspection_type && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[s.inspection_type] ?? 'bg-gray-100 text-gray-600'}`}>
                {s.inspection_type}
              </span>
            )}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {s.is_active ? '활성' : '비활성'}
            </span>
          </div>
          <p className="text-xs text-[#b0acd6] font-mono mt-1">{s.sheet_code} · 등록일 {s.created_at.slice(0, 10)}</p>
        </div>
      </div>

      {canEdit ? (
        <SheetDetailClient
          sheet={{ id: s.id, sheet_name: s.sheet_name, description: s.description, is_active: s.is_active }}
          items={its}
        />
      ) : (
        <div className="max-w-3xl bg-white rounded-xl border border-[#c8c4d0] p-6">
          <p className="text-sm text-[#514b81]">열람 전용 - 수정 권한이 없습니다.</p>
        </div>
      )}
    </div>
  )
}
