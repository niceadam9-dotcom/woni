'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth'

export type LeaveFormInput = {
  leave_type: 'annual' | 'half_am' | 'half_pm' | 'sick' | 'special'
  start_date: string
  end_date: string
  reason?: string
}

function calcDays(type: string, start: string, end: string): number {
  if (type === 'half_am' || type === 'half_pm') return 0.5
  const diff = Math.floor(
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
  ) + 1
  return Math.max(1, diff)
}

export async function applyLeaveAction(input: LeaveFormInput): Promise<{ error?: string }> {
  const user = await requireAuth()
  const admin = createAdminClient()
  const supabase = await createClient()

  const daysCount = calcDays(input.leave_type, input.start_date, input.end_date)
  const year = new Date(input.start_date).getFullYear()

  // 중복 신청 방지
  const { data: overlapRaw } = await supabase
    .from('leaves')
    .select('id')
    .eq('employee_id', user.id)
    .not('status', 'in', '("rejected")')
    .lte('start_date', input.end_date)
    .gte('end_date', input.start_date)

  if ((overlapRaw ?? []).length > 0) {
    return { error: '해당 기간에 이미 신청된 휴가가 있습니다.' }
  }

  // 연차 잔여일수 확인
  if (['annual', 'half_am', 'half_pm'].includes(input.leave_type)) {
    const { data: existBal } = await admin
      .from('leave_balances')
      .select('id')
      .eq('employee_id', user.id)
      .eq('year', year)
      .single()

    if (!existBal) {
      await admin.from('leave_balances').insert({
        employee_id: user.id,
        year,
        total_days: 15,
        used_days: 0,
      } as Record<string, unknown>)
    }

    const { data: balRaw } = await admin
      .from('leave_balances')
      .select('total_days, used_days')
      .eq('employee_id', user.id)
      .eq('year', year)
      .single()

    const bal = balRaw as { total_days: number; used_days: number } | null
    if (bal) {
      const remaining = bal.total_days - bal.used_days
      if (daysCount > remaining) {
        return { error: `잔여 연차가 부족합니다. (잔여: ${remaining}일, 신청: ${daysCount}일)` }
      }
    }
  }

  // 휴가 신청 생성
  const { data: leaveRaw, error } = await admin
    .from('leaves')
    .insert({
      employee_id: user.id,
      leave_type: input.leave_type,
      start_date: input.start_date,
      end_date: input.end_date,
      days_count: daysCount,
      reason: input.reason || null,
      status: 'pending',
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error || !leaveRaw) return { error: '휴가 신청에 실패했습니다.' }
  const leaveId = (leaveRaw as { id: string }).id

  // 팀장에게 알림
  const { data: managersRaw } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'manager')
    .eq('is_active', true)

  const managers = (managersRaw ?? []) as Array<{ id: string }>
  if (managers.length > 0) {
    await admin.from('notifications').insert(
      managers.map(m => ({
        recipient_id: m.id,
        title: '휴가 신청',
        message: '새로운 휴가 신청이 접수되었습니다.',
        type: 'leave_request',
        reference_id: leaveId,
        reference_type: 'leave',
      })) as Record<string, unknown>[]
    )
  }

  await admin.from('activity_logs').insert({
    actor_id: user.id,
    action: 'leave_applied',
    entity_type: 'leave',
    entity_id: leaveId,
  } as Record<string, unknown>)

  revalidatePath('/leaves')
  return {}
}

export async function approveLeaveAction(leaveId: string): Promise<{ error?: string }> {
  const user = await requireAuth()
  const admin = createAdminClient()
  const supabase = await createClient()

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const profile = profileRaw as { role: string } | null
  if (!profile || !['manager', 'admin'].includes(profile.role)) {
    return { error: '권한이 없습니다.' }
  }

  const { data: leaveRaw } = await admin
    .from('leaves')
    .select('id, employee_id, leave_type, days_count, start_date, status')
    .eq('id', leaveId)
    .single()
  const leave = leaveRaw as {
    id: string; employee_id: string; leave_type: string
    days_count: number; start_date: string; status: string
  } | null
  if (!leave) return { error: '휴가 신청을 찾을 수 없습니다.' }

  if (profile.role === 'manager') {
    if (leave.status !== 'pending') return { error: '처리할 수 없는 상태입니다.' }

    await admin.from('leaves').update({
      status: 'manager_approved',
      manager_id: user.id,
    } as Record<string, unknown>).eq('id', leaveId)

    // 관리자에게 알림
    const { data: adminsRaw } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .eq('is_active', true)
    const admins = (adminsRaw ?? []) as Array<{ id: string }>
    if (admins.length > 0) {
      await admin.from('notifications').insert(
        admins.map(a => ({
          recipient_id: a.id,
          title: '휴가 최종 승인 요청',
          message: '팀장 승인된 휴가 신청이 있습니다. 최종 승인이 필요합니다.',
          type: 'leave_request',
          reference_id: leaveId,
          reference_type: 'leave',
        })) as Record<string, unknown>[]
      )
    }
  } else {
    if (leave.status !== 'manager_approved') return { error: '팀장 승인 후 최종 승인 가능합니다.' }

    await admin.from('leaves').update({
      status: 'approved',
      admin_id: user.id,
    } as Record<string, unknown>).eq('id', leaveId)

    // 연차 차감
    if (['annual', 'half_am', 'half_pm'].includes(leave.leave_type)) {
      const year = new Date(leave.start_date).getFullYear()
      const { data: balRaw } = await admin
        .from('leave_balances')
        .select('used_days')
        .eq('employee_id', leave.employee_id)
        .eq('year', year)
        .single()
      const bal = balRaw as { used_days: number } | null
      if (bal) {
        await admin.from('leave_balances')
          .update({ used_days: bal.used_days + leave.days_count } as Record<string, unknown>)
          .eq('employee_id', leave.employee_id)
          .eq('year', year)
      }
    }

    // 신청자에게 알림
    await admin.from('notifications').insert({
      recipient_id: leave.employee_id,
      title: '휴가 승인',
      message: '휴가 신청이 최종 승인되었습니다.',
      type: 'leave_approved',
      reference_id: leaveId,
      reference_type: 'leave',
    } as Record<string, unknown>)
  }

  await admin.from('activity_logs').insert({
    actor_id: user.id,
    action: 'leave_approved',
    entity_type: 'leave',
    entity_id: leaveId,
  } as Record<string, unknown>)

  revalidatePath('/leaves')
  revalidatePath('/leaves/manage')
  return {}
}

export async function rejectLeaveAction(leaveId: string, comment: string): Promise<{ error?: string }> {
  const user = await requireAuth()
  const admin = createAdminClient()
  const supabase = await createClient()

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const profile = profileRaw as { role: string } | null
  if (!profile || !['manager', 'admin'].includes(profile.role)) {
    return { error: '권한이 없습니다.' }
  }

  const { data: leaveRaw } = await admin
    .from('leaves')
    .select('employee_id, status')
    .eq('id', leaveId)
    .single()
  const leave = leaveRaw as { employee_id: string; status: string } | null
  if (!leave) return { error: '휴가 신청을 찾을 수 없습니다.' }

  const validStatuses = profile.role === 'manager'
    ? ['pending']
    : ['pending', 'manager_approved']
  if (!validStatuses.includes(leave.status)) return { error: '처리할 수 없는 상태입니다.' }

  const updates: Record<string, unknown> = { status: 'rejected' }
  if (profile.role === 'manager') {
    updates.manager_id = user.id
    updates.manager_comment = comment
  } else {
    updates.admin_id = user.id
    updates.admin_comment = comment
  }

  await admin.from('leaves').update(updates).eq('id', leaveId)

  await admin.from('notifications').insert({
    recipient_id: leave.employee_id,
    title: '휴가 반려',
    message: `휴가 신청이 반려되었습니다. 사유: ${comment}`,
    type: 'leave_rejected',
    reference_id: leaveId,
    reference_type: 'leave',
  } as Record<string, unknown>)

  await admin.from('activity_logs').insert({
    actor_id: user.id,
    action: 'leave_rejected',
    entity_type: 'leave',
    entity_id: leaveId,
    metadata: { comment },
  } as Record<string, unknown>)

  revalidatePath('/leaves')
  revalidatePath('/leaves/manage')
  return {}
}
