import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessageCircle, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InquiryNewClient } from '@/components/inquiries/inquiry-new-client'

export default async function InquiryNewPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const admin = createAdminClient()

  const { data: customers } = await admin
    .from('customers')
    .select(`
      id, customer_name, customer_code,
      zipcode, address, region_si, region_myeon, region_ri,
      assigned_employee:assigned_employee_id ( name ),
      customer_contacts ( role, name, phone )
    `)
    .eq('is_active', true)
    .order('customer_name')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/inquiries" className="hover:text-[#7b68ee] flex items-center gap-1">
          <MessageCircle className="size-3.5" />
          문의요청 관리
        </Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium">문의 등록</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">문의요청 등록</h1>
        <p className="text-sm text-[#514b81] mt-0.5">고객 문의·AS 요청을 접수합니다</p>
      </div>

      <InquiryNewClient
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        customers={(customers ?? []) as any}
        defaultCustomerId={params.customer_id}
      />
    </div>
  )
}
