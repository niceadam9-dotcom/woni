import { redirect } from 'next/navigation'
import { Award } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CertificatesClient } from '@/components/certificates/certificates-client'

export default async function CertificatesPage() {
  await requireRole(['manager', 'admin'])

  const admin = createAdminClient()
  const [{ data: certificates }, { data: employees }] = await Promise.all([
    admin
      .from('certificates')
      .select(`*, employee:employee_id (name, employee_id, position), issuer:issued_by (name)`)
      .order('issued_at', { ascending: false }),
    admin
      .from('profiles')
      .select('id, name, employee_id, position, department_id, hire_date')
      .eq('is_active', true)
      .order('name'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Award className="size-6 text-[#7b68ee]" />
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">증명서 발급</h1>
          <p className="text-sm text-[#514b81] mt-0.5">재직·경력·급여 증명서를 발급하고 이력을 관리합니다</p>
        </div>
      </div>
      <CertificatesClient
        certificates={(certificates ?? []) as Record<string, unknown>[]}
        employees={(employees ?? []) as unknown as { id: string; name: string; employee_id: string; position: string | null; department: string | null; hire_date: string | null }[]}
      />
    </div>
  )
}
