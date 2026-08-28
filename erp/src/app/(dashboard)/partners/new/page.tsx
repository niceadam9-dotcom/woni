import Link from 'next/link'
import { Handshake, ChevronRight } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { PartnerFormClient } from '@/components/partners/partner-form-client'

export default async function PartnerNewPage() {
  await requireRole(['manager', 'admin'])
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-ink-sub">
        <Link href="/partners" className="hover:text-brand flex items-center gap-1">
          <Handshake className="size-3.5" />거래처 관리
        </Link>
        <ChevronRight className="size-3.5 text-ink-faint" />
        <span className="text-ink font-medium">거래처 등록</span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-ink">거래처 등록</h1>
        <p className="text-sm text-ink-sub mt-0.5">공급업체·협력업체 정보를 등록합니다</p>
      </div>
      <PartnerFormClient />
    </div>
  )
}
