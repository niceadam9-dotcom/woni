import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Building2, ChevronRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BuildingDetailClient } from '@/components/buildings/building-detail-client'

export default async function BuildingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const admin = createAdminClient()

  const { data: building } = await admin
    .from('buildings')
    .select(`
      *,
      customers:customer_id (id, customer_name, customer_code)
    `)
    .eq('id', id)
    .single()

  if (!building) notFound()

  type BuildingWithCustomer = {
    id: string
    customer_id: string
    building_name: string
    zipcode: string | null
    address: string | null
    total_area: number | null
    floors_above: number | null
    floors_below: number | null
    purpose: string | null
    year_built: number | null
    notes: string | null
    is_active: boolean
    customers: { id: string; customer_name: string; customer_code: string } | null
  }

  const b = building as BuildingWithCustomer
  const canEdit = profile.role === 'manager' || profile.role === 'admin'

  return (
    <div className="space-y-6">
      {/* 브레드크럼 */}
      <div className="flex items-center gap-1.5 text-sm text-[#514b81]">
        <Link href="/buildings" className="hover:text-[#7b68ee] flex items-center gap-1">
          <Building2 className="size-3.5" />
          건물 관리
        </Link>
        <ChevronRight className="size-3.5 text-[#b0acd6]" />
        <span className="text-[#090c1d] font-medium">{b.building_name}</span>
      </div>

      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#090c1d]">{b.building_name}</h1>
          {b.customers && (
            <p className="text-sm text-[#514b81] mt-0.5">
              {b.customers.customer_name}
              <span className="text-[#b0acd6] ml-1 font-mono text-xs">({b.customers.customer_code})</span>
            </p>
          )}
        </div>
        {b.customers && (
          <Link
            href={`/customers/${b.customers.id}`}
            className="h-8 px-3 rounded-lg border border-[#c8c4d0] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors flex items-center"
          >
            고객사 상세보기
          </Link>
        )}
      </div>

      {canEdit ? (
        <BuildingDetailClient
          building={{
            id: b.id,
            customer_id: b.customer_id,
            building_name: b.building_name,
            zipcode: b.zipcode,
            address: b.address,
            total_area: b.total_area,
            floors_above: b.floors_above,
            floors_below: b.floors_below,
            purpose: b.purpose,
            year_built: b.year_built,
            notes: b.notes,
            is_active: b.is_active,
          }}
        />
      ) : (
        /* 열람 전용 뷰 */
        <div className="max-w-2xl space-y-6">
          <section className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6">
            <dl className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <dt className="text-xs text-[#514b81]">주소</dt>
                <dd className="mt-1 text-sm text-[#090c1d]">{b.address ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#514b81]">용도</dt>
                <dd className="mt-1 text-sm text-[#090c1d]">{b.purpose ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#514b81]">준공연도</dt>
                <dd className="mt-1 text-sm text-[#090c1d]">{b.year_built ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#514b81]">연면적</dt>
                <dd className="mt-1 text-sm text-[#090c1d]">
                  {b.total_area != null ? `${b.total_area.toLocaleString()}㎡` : '-'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#514b81]">층수</dt>
                <dd className="mt-1 text-sm text-[#090c1d]">
                  {b.floors_above != null
                    ? `지상 ${b.floors_above}층${b.floors_below ? ` / 지하 ${b.floors_below}층` : ''}`
                    : '-'}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  )
}
