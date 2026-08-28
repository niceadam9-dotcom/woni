import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, ChevronRight } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { SheetNewClient } from '@/components/inspection-sheets/sheet-new-client'

export default async function InspectionSheetNewPage() {
  await requirePermission('inspection_sheet_manage')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-ink-sub">
        <Link href="/inspection-sheets" className="hover:text-brand flex items-center gap-1">
          <ClipboardList className="size-3.5" />
          점검표 관리
        </Link>
        <ChevronRight className="size-3.5 text-ink-faint" />
        <span className="text-ink font-medium">점검표 등록</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-ink">점검표 등록</h1>
        <p className="text-sm text-ink-sub mt-0.5">소방시설별 점검 체크리스트 양식을 등록합니다</p>
      </div>

      <SheetNewClient />
    </div>
  )
}
