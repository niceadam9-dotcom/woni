import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Handshake, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PartnerFormClient } from '@/components/partners/partner-form-client'
import { formatTel } from '@/lib/format-contact'

const TYPE_LABELS: Record<string, string> = {
  supplier: '공급업체', subcontractor: '협력업체', client: '고객사', other: '기타',
}

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const admin = createAdminClient()

  const { data: partner } = await admin.from('partners').select('*').eq('id', id).single()
  if (!partner) notFound()

  type PartnerRow = {
    id: string; partner_name: string; partner_type: string
    business_number: string | null; representative: string | null
    phone: string | null; email: string | null; address: string | null
    notes: string | null; is_active: boolean; created_at: string
  }

  const p = partner as PartnerRow
  const canEdit = profile.role === 'manager' || profile.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-ink-sub">
        <Link href="/partners" className="hover:text-brand flex items-center gap-1">
          <Handshake className="size-3.5" />거래처 관리
        </Link>
        <ChevronRight className="size-3.5 text-ink-faint" />
        <span className="text-ink font-medium">{p.partner_name}</span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-ink">{p.partner_name}</h1>
        <p className="text-sm text-ink-sub mt-0.5">{TYPE_LABELS[p.partner_type] ?? p.partner_type}</p>
      </div>
      {canEdit ? (
        <PartnerFormClient existing={p} />
      ) : (
        <div className="max-w-2xl bg-surface rounded-xl border border-line p-6">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-xs text-ink-sub">사업자번호</dt><dd className="mt-1">{p.business_number ?? '-'}</dd></div>
            <div><dt className="text-xs text-ink-sub">대표자</dt><dd className="mt-1">{p.representative ?? '-'}</dd></div>
            <div><dt className="text-xs text-ink-sub">연락처</dt><dd className="mt-1">{p.phone ? formatTel(p.phone) : '-'}</dd></div>
            <div><dt className="text-xs text-ink-sub">이메일</dt><dd className="mt-1">{p.email ?? '-'}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-ink-sub">주소</dt><dd className="mt-1">{p.address ?? '-'}</dd></div>
          </dl>
        </div>
      )}
    </div>
  )
}
