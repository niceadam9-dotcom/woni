import { redirect } from 'next/navigation'
import { BookUser } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { AddressBookClient } from '@/components/address-book/address-book-client'

export default async function AddressBookPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const { data: contacts } = await admin
    .from('address_contacts')
    .select('*')
    .eq('owner_id', profile.id)
    .order('name')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BookUser className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">주소록</h1>
          <p className="text-sm text-[#514b81] mt-0.5">고객사·협력업체 담당자 연락처를 관리합니다</p>
        </div>
      </div>
      <AddressBookClient contacts={(contacts ?? []) as Record<string, unknown>[]} />
    </div>
  )
}
