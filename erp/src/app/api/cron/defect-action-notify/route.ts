import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterNotifiableRecipients } from '@/lib/notify'

// 불량 이행기한 임박 알림 (소방계획서_4.md §9-7d — 과태료 방어)
// inspection_defects.action_end(이행 종료 예정일)가 임박/경과했는데 미완료(action_completed_at null)인 건을
// 담당 직원 + manager/admin에게 알림. VPS 크론 매일 호출 — Authorization: Bearer {CRON_SECRET}
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]

  function shiftDate(base: string, days: number): string {
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  type Rule = {
    endDate: string
    type: 'defect_action_due' | 'defect_action_overdue'
    label: string
    messageFn: (customerName: string, names: string, end: string) => string
  }
  const rules: Rule[] = [
    {
      endDate: shiftDate(todayStr, 7), type: 'defect_action_due', label: '[D-7] 이행기한 7일 전',
      messageFn: (c, n, e) => `${c} — 불량 이행기한(${e})이 7일 남았습니다. 미완료: ${n}`,
    },
    {
      endDate: shiftDate(todayStr, 3), type: 'defect_action_due', label: '[D-3] 이행기한 3일 전',
      messageFn: (c, n, e) => `${c} — 불량 이행기한(${e})이 3일 남았습니다. 미완료: ${n}`,
    },
    {
      endDate: todayStr, type: 'defect_action_due', label: '[오늘] 이행기한 당일',
      messageFn: (c, n, e) => `${c} — 불량 이행기한이 오늘(${e})입니다. 미완료: ${n}`,
    },
    {
      endDate: shiftDate(todayStr, -1), type: 'defect_action_overdue', label: '[경과] 이행기한 초과',
      messageFn: (c, n, e) => `${c} — 불량 이행기한(${e})이 지났습니다(과태료 위험). 미완료: ${n}. 완료 시 별지 11호 보고가 필요합니다.`,
    },
  ]

  const { data: managersRaw } = await admin.from('profiles')
    .select('id').in('role', ['manager', 'admin']).eq('is_active', true).eq('is_system', false)
  const managerIds = ((managersRaw ?? []) as Array<{ id: string }>).map(p => p.id)

  type DefectRow = {
    id: string; inspection_id: string; defect_name: string; action_end: string
    inspection: { id: string; customer_id: string; assigned_employee_id: string | null; customer: { customer_name: string } | null } | null
  }

  let totalSent = 0
  const breakdown: Record<string, number> = {}

  for (const rule of rules) {
    // 해당 기한의 미완료 불량 (이행계획이 입력된 건만 — action_end 존재)
    const { data: defectsRaw } = await admin.from('inspection_defects')
      .select('id, inspection_id, defect_name, action_end, inspection:inspections(id, customer_id, assigned_employee_id, customer:customers(customer_name))')
      .eq('action_end', rule.endDate)
      .is('action_completed_at', null)
    const defects = (defectsRaw ?? []) as unknown as DefectRow[]
    if (defects.length === 0) { breakdown[rule.label] = 0; continue }

    // 점검 건 단위 그룹화 (불량 여러 건 = 알림 1건)
    const byInspection = new Map<string, DefectRow[]>()
    for (const d of defects) {
      if (!d.inspection) continue
      const list = byInspection.get(d.inspection_id) ?? []
      list.push(d)
      byInspection.set(d.inspection_id, list)
    }

    // 오늘 이미 발송된 점검 건 제외 (멱등)
    const { data: existingRaw } = await admin.from('notifications')
      .select('reference_id')
      .in('reference_id', [...byInspection.keys()])
      .eq('type', rule.type)
      .gte('created_at', `${todayStr}T00:00:00+09:00`)
    const already = new Set(((existingRaw ?? []) as Array<{ reference_id: string | null }>)
      .map(n => n.reference_id).filter(Boolean) as string[])

    const assignees = [...byInspection.values()]
      .map(list => list[0].inspection?.assigned_employee_id).filter(Boolean) as string[]
    const notifiable = await filterNotifiableRecipients(admin, [...managerIds, ...assignees], 'deadline')

    const batch: Record<string, unknown>[] = []
    for (const [inspectionId, list] of byInspection) {
      if (already.has(inspectionId)) continue
      const insp = list[0].inspection!
      const customerName = insp.customer?.customer_name ?? '고객'
      const names = list.map(d => d.defect_name).slice(0, 3).join('·') + (list.length > 3 ? ` 외 ${list.length - 3}건` : '')
      const title = `${rule.label} ${customerName} 불량 ${list.length}건`
      const message = rule.messageFn(customerName, names, rule.endDate)

      const recipients = new Set<string>(managerIds)
      if (insp.assigned_employee_id) recipients.add(insp.assigned_employee_id)
      for (const recipientId of recipients) {
        if (!notifiable.has(recipientId)) continue
        batch.push({
          recipient_id: recipientId, title, message, type: rule.type,
          reference_id: inspectionId, reference_type: 'inspection',
        })
      }
    }

    if (batch.length > 0) {
      const { error } = await admin.from('notifications').insert(batch)
      if (error) {
        return NextResponse.json({ ok: false, date: todayStr, error: error.message, failedRule: rule.label }, { status: 500 })
      }
      totalSent += batch.length
    }
    breakdown[rule.label] = batch.length
  }

  // ── §9-8e·§9-9④: 별지 9호 15일 보고 기한 임박·경과 (제출일 기록 시 소멸) ──
  type InspRow = {
    id: string; customer_id: string; assigned_employee_id: string | null
    inspection_type: string; plan_type: string | null
    inspection_start_date: string | null; inspection_end_date: string | null
    report9_submitted_at: string | null
    customer: { customer_name: string } | null
  }
  const { data: inspRaw } = await admin.from('inspections')
    .select('id, customer_id, assigned_employee_id, inspection_type, plan_type, inspection_start_date, inspection_end_date, report9_submitted_at, customer:customers(customer_name)')
    .is('report9_submitted_at', null)
    .neq('inspection_type', '일반관리')
    .gte('inspection_start_date', shiftDate(todayStr, -45))
  const specials = ((inspRaw ?? []) as unknown as InspRow[])
    .filter(r => !r.plan_type || r.plan_type.startsWith('special')) // 정기·일반은 보고 의무 없음(§9-9a)
    .map(r => ({ ...r, deadline: r.inspection_end_date ?? r.inspection_start_date }))
    .filter(r => r.deadline)
    .map(r => ({ ...r, deadline: shiftDate(r.deadline!, 15) }))

  const submitRules = [
    { deadline: shiftDate(todayStr, 7), type: 'report_submit_due' as const, label: '[D-7] 별지 9호 보고기한' },
    { deadline: shiftDate(todayStr, 3), type: 'report_submit_due' as const, label: '[D-3] 별지 9호 보고기한' },
    { deadline: todayStr, type: 'report_submit_due' as const, label: '[오늘] 별지 9호 보고기한' },
    { deadline: shiftDate(todayStr, -1), type: 'report_submit_overdue' as const, label: '[경과] 별지 9호 보고기한' },
  ]
  for (const rule of submitRules) {
    const targets = specials.filter(r => r.deadline === rule.deadline)
    if (targets.length === 0) { breakdown[rule.label] = 0; continue }
    const { data: existingRaw } = await admin.from('notifications')
      .select('reference_id').in('reference_id', targets.map(t => t.id))
      .eq('type', rule.type).gte('created_at', `${todayStr}T00:00:00+09:00`)
    const already = new Set(((existingRaw ?? []) as Array<{ reference_id: string | null }>)
      .map(n => n.reference_id).filter(Boolean) as string[])
    const notifiable = await filterNotifiableRecipients(admin,
      [...managerIds, ...targets.map(t => t.assigned_employee_id).filter(Boolean) as string[]], 'deadline')

    const batch: Record<string, unknown>[] = []
    for (const t of targets) {
      if (already.has(t.id)) continue
      const name = t.customer?.customer_name ?? '고객'
      const title = `${rule.label} ${name}`
      const message = rule.type === 'report_submit_overdue'
        ? `${name} — 자체점검 결과 보고(별지 9호) 기한(${t.deadline})이 지났습니다(과태료 위험). 제출 후 점검 상세 타임라인에 제출일을 기록해주세요.`
        : `${name} — 자체점검 결과 보고(별지 9호) 기한이 ${t.deadline}입니다. 점검 상세 타임라인에서 생성·제출해주세요.`
      const recipients = new Set<string>(managerIds)
      if (t.assigned_employee_id) recipients.add(t.assigned_employee_id)
      for (const recipientId of recipients) {
        if (!notifiable.has(recipientId)) continue
        batch.push({ recipient_id: recipientId, title, message, type: rule.type, reference_id: t.id, reference_type: 'inspection' })
      }
    }
    if (batch.length > 0) {
      const { error } = await admin.from('notifications').insert(batch)
      if (error) {
        return NextResponse.json({ ok: false, date: todayStr, error: error.message, failedRule: rule.label }, { status: 500 })
      }
      totalSent += batch.length
    }
    breakdown[rule.label] = batch.length
  }

  return NextResponse.json({ ok: true, date: todayStr, sent: totalSent, breakdown })
}
