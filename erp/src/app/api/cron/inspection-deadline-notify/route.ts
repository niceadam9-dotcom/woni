import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Vercel Cron 또는 외부 스케줄러에서 매일 09:00 호출
// Authorization: Bearer {CRON_SECRET} 헤더 필수
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  function shiftDate(base: string, days: number): string {
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  type Rule = {
    dueDate: string
    type: 'inspection_step_due' | 'inspection_step_overdue'
    titleFn: (customerName: string, stepName: string) => string
    messageFn: (customerName: string, stepName: string) => string
  }

  const rules: Rule[] = [
    {
      dueDate: shiftDate(todayStr, 3),
      type: 'inspection_step_due',
      titleFn: (c, s) => `[D-3] ${c} ${s} 마감 3일 전`,
      messageFn: (c, s) => `${c} — ${s} 마감이 3일 남았습니다.`,
    },
    {
      dueDate: shiftDate(todayStr, 1),
      type: 'inspection_step_due',
      titleFn: (c, s) => `[D-1] ${c} ${s} 내일 마감`,
      messageFn: (c, s) => `${c} — ${s} 마감이 내일입니다.`,
    },
    {
      dueDate: todayStr,
      type: 'inspection_step_due',
      titleFn: (c, s) => `[오늘 마감] ${c} ${s}`,
      messageFn: (c, s) => `${c} — ${s} 오늘이 마감입니다.`,
    },
    {
      dueDate: shiftDate(todayStr, -1),
      type: 'inspection_step_overdue',
      titleFn: (c, s) => `[지연] ${c} ${s} 기한 초과`,
      messageFn: (c, s) => `${c} — ${s} 마감이 초과되었습니다. 즉시 처리해 주세요.`,
    },
  ]

  // 알림 대상: manager/admin 전원
  const { data: managersRaw } = await admin
    .from('profiles')
    .select('id, role')
    .in('role', ['manager', 'admin'])
    .eq('is_active', true)

  const managerIds = ((managersRaw ?? []) as Array<{ id: string; role: string }>).map(p => p.id)

  type StepWithJoin = {
    id: string
    name_ko: string
    inspection_id: string
    inspection: {
      assigned_employee_id: string | null
      customer: { customer_name: string } | null
    } | null
  }

  let totalSent = 0
  const results: Record<string, number> = {}

  for (const rule of rules) {
    const { data: stepsRaw } = await admin
      .from('inspection_steps')
      .select('id, name_ko, inspection_id, inspection:inspections(assigned_employee_id, customer:customers(customer_name))')
      .eq('due_date', rule.dueDate)
      .neq('status', 'completed')

    const steps = (stepsRaw ?? []) as unknown as StepWithJoin[]
    if (steps.length === 0) continue

    const stepIds = steps.map(s => s.id)

    // 오늘 이미 발송된 알림 제외
    const { data: existingRaw } = await admin
      .from('notifications')
      .select('reference_id')
      .in('reference_id', stepIds)
      .eq('type', rule.type)
      .gte('created_at', `${todayStr}T00:00:00`)

    const alreadyNotified = new Set(
      ((existingRaw ?? []) as Array<{ reference_id: string | null }>)
        .map(n => n.reference_id)
        .filter(Boolean) as string[]
    )

    const batch: Record<string, unknown>[] = []

    for (const step of steps) {
      if (alreadyNotified.has(step.id)) continue
      const insp = step.inspection
      if (!insp) continue

      const customerName = insp.customer?.customer_name ?? '—'
      const title = rule.titleFn(customerName, step.name_ko)
      const message = rule.messageFn(customerName, step.name_ko)

      // 담당자 + manager/admin 모두에게 발송
      const recipients = new Set<string>(managerIds)
      if (insp.assigned_employee_id) recipients.add(insp.assigned_employee_id)

      for (const recipientId of recipients) {
        batch.push({
          recipient_id: recipientId,
          title,
          message,
          type: rule.type,
          reference_id: step.id,
          reference_type: 'inspection',
        })
      }
    }

    if (batch.length > 0) {
      await admin.from('notifications').insert(batch as Record<string, unknown>[])
      totalSent += batch.length
    }

    results[rule.dueDate] = batch.length
  }

  return NextResponse.json({
    ok: true,
    date: todayStr,
    sent: totalSent,
    breakdown: results,
  })
}
