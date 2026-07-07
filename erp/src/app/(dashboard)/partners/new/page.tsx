import Link from 'next/link'
import { Handshake, ChevronRight } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { PartnerFormClient } from '@/components/partners/partner-form-client'

export default async function PartnerNewPage() {
  await requireRole(['manager', 'admin'])
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/partners" className="hover:text-[#7b68ee] flex items-center gap-1">
          <Handshake className="size-3.5" />거래처 관리
        </Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium">거래처 등록</span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">거래처 등록</h1>
        <p className="text-sm text-[#514b81] mt-0.5">공급업체·협력업체 정보를 등록합니다</p>
      </div>
      <PartnerFormClient />
    </div>
  )
}
