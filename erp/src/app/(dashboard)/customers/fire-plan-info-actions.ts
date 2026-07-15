'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

/** 소방계획서 정보(5+6차 필드) 저장 — 고객 상세 계획서 정보 패널 (설계: 소방계획서-필드확장-설계.md §4) */

export type BrigadeMemberInput = { team: string; name: string; duty: string; phone: string }

export type FirePlanInfoInput = {
  // 건물 개요 (buildings — 첫 활성 건물)
  receiverLocation: string
  structure: string
  roof: string
  // customers
  managerSelectedAt: string   // YYYY-MM-DD | ''
  grade: string               // 특급/1급/2급/3급 | ''
  insuranceJoined: boolean | null
  insuranceCompany: string
  insurancePeriod: string
  insuranceAmountPerson: string
  insuranceAmountProperty: string
  opHoursWeekday: string
  opHoursHoliday: string
  headcountWorker: string     // 숫자 문자열 | ''
  headcountResident: string
  headcountMax: string
  brigade: BrigadeMemberInput[]
}

const toInt = (s: string): number | null => {
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

export async function saveFirePlanInfoAction(
  customerId: string,
  input: FirePlanInfoInput,
): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  // customers 갱신
  const { error: cErr } = await admin.from('customers').update({
    manager_selected_at: input.managerSelectedAt || null,
    building_grade: input.grade || null,
    insurance_joined: input.insuranceJoined,
    insurance_company: input.insuranceCompany.trim() || null,
    insurance_period: input.insurancePeriod.trim() || null,
    insurance_amount_person: input.insuranceAmountPerson.trim() || null,
    insurance_amount_property: input.insuranceAmountProperty.trim() || null,
    op_hours_weekday: input.opHoursWeekday || null,
    op_hours_holiday: input.opHoursHoliday || null,
    headcount_worker: toInt(input.headcountWorker),
    headcount_resident: toInt(input.headcountResident),
    headcount_max: toInt(input.headcountMax),
  } as Record<string, unknown>).eq('id', customerId)
  if (cErr) return { error: `고객 정보 저장 실패: ${cErr.message}` }

  // 첫 활성 건물 갱신 (있을 때만)
  const { data: bld } = await admin.from('buildings')
    .select('id').eq('customer_id', customerId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (bld) {
    const { error: bErr } = await admin.from('buildings').update({
      receiver_location: input.receiverLocation.trim() || null,
      main_structure: input.structure.trim() || null,
      roof_structure: input.roof.trim() || null,
    } as Record<string, unknown>).eq('id', (bld as { id: string }).id)
    if (bErr) return { error: `건물 정보 저장 실패: ${bErr.message}` }
  }

  // 자위소방대 편성 전체 교체 (upsert 단순화)
  await admin.from('fire_brigade_members').delete().eq('customer_id', customerId)
  const rows = input.brigade
    .filter(m => m.name.trim())
    .map((m, i) => ({
      customer_id: customerId, team: m.team.trim() || '반원',
      name: m.name.trim(), duty: m.duty.trim() || null,
      phone: m.phone.trim() || null, sort_order: i,
    }))
  if (rows.length > 0) {
    const { error: mErr } = await admin.from('fire_brigade_members').insert(rows as Record<string, unknown>[])
    if (mErr) return { error: `자위소방대 저장 실패: ${mErr.message}` }
  }

  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'fire_plan_info_updated',
    entity_type: 'customer',
    entity_id: customerId,
    metadata: { grade: input.grade || null, brigade_count: rows.length },
  } as Record<string, unknown>)

  revalidatePath(`/customers/${customerId}`)
  return {}
}
