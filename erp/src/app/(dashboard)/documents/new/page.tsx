import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileText, Briefcase, ShoppingCart, Receipt } from 'lucide-react'
import { requireAuth, getProfile } from '@/lib/auth'
import { DocumentForm } from '@/components/documents/document-form'

const TEMPLATES = [
  { value: 'general',          label: '일반 기안서',  desc: '일반적인 업무 요청 및 보고',  Icon: FileText },
  { value: 'business_trip',    label: '출장 신청서',  desc: '국내/해외 출장 신청',         Icon: Briefcase },
  { value: 'purchase_request', label: '구매 요청서',  desc: '물품 및 서비스 구매 요청',     Icon: ShoppingCart },
  { value: 'expense_report',   label: '비용 정산서',  desc: '업무 관련 비용 정산',          Icon: Receipt },
]

interface Props {
  searchParams: Promise<{ template?: string }>
}

export default async function NewDocumentPage({ searchParams }: Props) {
  await requireAuth()
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { template } = await searchParams

  if (!template) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-ink">기안서 작성</h1>
          <p className="text-sm text-ink-sub mt-1">사용할 양식을 선택하세요</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TEMPLATES.map(({ value, label, desc, Icon }) => (
            <Link
              key={value}
              href={`/documents/new?template=${value}`}
              className="bg-surface rounded-xl border border-line p-6 hover:border-brand hover:shadow-[0_4px_16px_rgba(123,104,238,0.12)] transition-all group"
            >
              <div className="size-10 rounded-lg bg-brand-tint flex items-center justify-center mb-3 group-hover:bg-brand/10 transition-colors">
                <Icon className="size-5 text-brand" />
              </div>
              <p className="font-semibold text-ink">{label}</p>
              <p className="text-sm text-ink-sub mt-1">{desc}</p>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  const validTemplate = TEMPLATES.find(t => t.value === template)
  if (!validTemplate) redirect('/documents/new')

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">기안서 작성</h1>
          <p className="text-sm text-ink-sub mt-1">작성 후 상신하면 결재가 시작됩니다</p>
        </div>
        <Link
          href="/documents/new"
          className="text-sm text-brand hover:underline"
        >
          양식 변경
        </Link>
      </div>
      <DocumentForm templateType={template} profile={profile} />
    </div>
  )
}
