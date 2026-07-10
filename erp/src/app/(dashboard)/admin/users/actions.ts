'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

export type CreateUserInput = {
  email: string
  password: string
  name: string
  employee_id: string
  role: 'employee' | 'manager' | 'admin'
  department_id?: string
  position?: string
  hire_date?: string
}

export type UpdateUserInput = {
  name: string
  employee_id: string
  role: 'employee' | 'manager' | 'admin'
  department_id?: string
  position?: string
  hire_date?: string
  is_active: boolean
}

export async function createUserAction(input: CreateUserInput): Promise<{ error?: string }> {
  await requirePermission('user_manage')
  const admin = createAdminClient()

  // Supabase Auth 계정 생성
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  })

  if (authError || !authData?.user) {
    return { error: authError?.message ?? '계정 생성에 실패했습니다.' }
  }

  const userId = authData.user.id

  // upsert — profiles 자동 생성 트리거 유무와 무관하게 행을 보장
  // (update만 하면 트리거 미동작 시 0행 매치로 조용히 실패해 목록에 안 보임)
  const { error: profileError } = await admin
    .from('profiles')
    .upsert({
      id: userId,
      email: input.email.trim(),
      employee_id: input.employee_id.trim(),
      name: input.name.trim(),
      role: input.role,
      department_id: input.department_id || null,
      position: input.position || null,
      hire_date: input.hire_date || null,
      is_active: true,
    } as Record<string, unknown>, { onConflict: 'id' })

  if (profileError) {
    // 생성된 auth user 정리
    await admin.auth.admin.deleteUser(userId)
    return { error: '프로필 설정에 실패했습니다.' }
  }

  // 당해연도 연차 초기화
  const year = new Date().getFullYear()
  await admin.from('leave_balances').insert({
    employee_id: userId,
    year,
    total_days: 15,
    used_days: 0,
  } as Record<string, unknown>)

  revalidatePath('/admin/users')
  return {}
}

export async function updateUserAction(
  userId: string,
  input: UpdateUserInput
): Promise<{ error?: string }> {
  await requirePermission('user_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('profiles')
    .update({
      employee_id: input.employee_id,
      name: input.name,
      role: input.role,
      department_id: input.department_id || null,
      position: input.position || null,
      hire_date: input.hire_date || null,
      is_active: input.is_active,
    } as Record<string, unknown>)
    .eq('id', userId)

  if (error) return { error: '정보 수정에 실패했습니다.' }

  revalidatePath('/admin/users')
  return {}
}

/** 특정 직원이 담당한 활성 고객 수 (퇴사 인수인계 안내용) */
export async function getEmployeeAssignmentCountAction(
  employeeId: string
): Promise<{ count: number }> {
  await requirePermission('user_manage')
  const admin = createAdminClient()
  const { count } = await admin
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_employee_id', employeeId)
    .eq('is_active', true)
  return { count: count ?? 0 }
}

/** 담당 인수인계 — fromEmployee의 모든 담당 고객을 toEmployee로 이관 (담당자 변경 전파·이력 포함) */
export async function handoverAssignmentsAction(
  fromEmployeeId: string,
  toEmployeeId: string,
): Promise<{ error?: string; movedCount?: number }> {
  await requirePermission('user_manage')
  if (fromEmployeeId === toEmployeeId) return { error: '같은 직원으로는 인수인계할 수 없습니다.' }
  const admin = createAdminClient()

  const { data: rows } = await admin
    .from('customers')
    .select('id')
    .eq('assigned_employee_id', fromEmployeeId)
    .eq('is_active', true)
  const ids = ((rows ?? []) as { id: string }[]).map(r => r.id)
  if (ids.length === 0) return { movedCount: 0 }

  // 고객관리 액션 재사용 — 이력 기록 + 계획/점검 담당자 전파 포함
  const { bulkAssignEmployeeAction } = await import('@/app/(dashboard)/customers/actions')
  const res = await bulkAssignEmployeeAction(ids, toEmployeeId)
  if (res.error) return { error: res.error }

  revalidatePath('/admin/users')
  revalidatePath('/customers')
  revalidatePath('/customers/regional-assign')
  return { movedCount: res.updatedCount ?? ids.length }
}

// ── 계정 삭제 (수정사항리스트 5번·4-1) ─────────────────────────
// 원칙: 퇴사 = 비활성 처리. 완전 삭제는 담당 고객·작성 이력이 전혀 없는
// 오등록 계정에만 허용 — 이력이 있는 직원을 지우면 결재·점검·휴가 기록이 파괴됨.

/** 삭제 가능 여부 검사 — 참조가 하나라도 있으면 사유 목록 반환 */
export async function getEmployeeDeleteEligibilityAction(
  userId: string
): Promise<{ deletable: boolean; reasons: string[] }> {
  await requirePermission('user_manage')
  const admin = createAdminClient()

  const cnt = async (table: string, col: string) => {
    const { count } = await admin.from(table)
      .select('id', { count: 'exact', head: true }).eq(col, userId)
    return count ?? 0
  }
  const checks: Array<[string, number]> = [
    ['담당 고객',        await cnt('customers', 'assigned_employee_id')],
    ['고객 등록 이력',   await cnt('customers', 'created_by')],
    ['기안서 작성',      await cnt('documents', 'author_id')],
    ['휴가 신청',        await cnt('leaves', 'user_id')],
    ['점검 담당',        await cnt('inspections', 'assigned_employee_id')],
    ['점검 등록 이력',   await cnt('inspections', 'created_by')],
    ['점검계획 담당',    await cnt('inspection_plan_items', 'assigned_employee_id')],
    ['활동 이력',        await cnt('activity_logs', 'actor_id')],
  ]
  const reasons = checks.filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}건`)
  return { deletable: reasons.length === 0, reasons }
}

/** 계정 완전 삭제 — 업무 이력 0건 계정 한정 (auth + 프로필 제거, 관리자 이력 기록) */
export async function deleteEmployeeAction(userId: string): Promise<{ error?: string }> {
  const actor = await requirePermission('user_manage')
  if (actor.id === userId) return { error: '본인 계정은 삭제할 수 없습니다.' }
  const admin = createAdminClient()

  const { data: targetRaw } = await admin
    .from('profiles').select('name, email, employee_id, is_system').eq('id', userId).single()
  const target = targetRaw as { name: string; email: string; employee_id: string; is_system: boolean } | null
  if (!target) return { error: '직원을 찾을 수 없습니다.' }
  if (target.is_system) return { error: '시스템 계정은 삭제할 수 없습니다.' }

  // 서버 측 가드 재검사 — 담당 고객·작성 이력이 있으면 삭제 불가 (비활성 처리 안내)
  const { deletable, reasons } = await getEmployeeDeleteEligibilityAction(userId)
  if (!deletable) {
    return { error: `업무 이력이 있어 삭제할 수 없습니다 (${reasons.join(', ')}). 퇴사(비활성) 처리를 사용하세요.` }
  }

  // 삭제 이력을 먼저 기록 (삭제 대상 정보 보존)
  await admin.from('activity_logs').insert({
    actor_id: actor.id,
    action: 'employee_deleted',
    entity_type: 'profile',
    entity_id: userId,
    metadata: { name: target.name, email: target.email, employee_id: target.employee_id },
  } as Record<string, unknown>)

  const { error: pErr } = await admin.from('profiles').delete().eq('id', userId)
  if (pErr) return { error: `프로필 삭제에 실패했습니다: ${pErr.message}` }
  const { error: aErr } = await admin.auth.admin.deleteUser(userId)
  if (aErr) return { error: `로그인 계정 삭제에 실패했습니다: ${aErr.message}` }

  revalidatePath('/admin/users')
  return {}
}

export async function resetPasswordAction(
  userId: string,
  newPassword: string
): Promise<{ error?: string }> {
  await requirePermission('user_manage')
  if (newPassword.length < 6) return { error: '비밀번호는 6자 이상이어야 합니다.' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
  if (error) return { error: '비밀번호 초기화에 실패했습니다.' }
  return {}
}

export async function setLeaveBalanceAction(
  userId: string,
  year: number,
  totalDays: number
): Promise<{ error?: string }> {
  await requirePermission('user_manage')
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('leave_balances')
    .select('id')
    .eq('employee_id', userId)
    .eq('year', year)
    .single()

  if (existing) {
    await admin
      .from('leave_balances')
      .update({ total_days: totalDays } as Record<string, unknown>)
      .eq('employee_id', userId)
      .eq('year', year)
  } else {
    await admin.from('leave_balances').insert({
      employee_id: userId,
      year,
      total_days: totalDays,
      used_days: 0,
    } as Record<string, unknown>)
  }

  revalidatePath('/admin/users')
  return {}
}

// ─── 부서 관리 ───────────────────────────────────────────────────

export type DeptInput = {
  name: string
  manager_id?: string
}

export async function createDeptAction(input: DeptInput): Promise<{ error?: string }> {
  await requirePermission('user_manage')
  const admin = createAdminClient()

  const { error } = await admin.from('departments').insert({
    name: input.name,
    manager_id: input.manager_id || null,
  } as Record<string, unknown>)

  if (error) return { error: '부서 생성에 실패했습니다.' }
  revalidatePath('/admin/departments')
  return {}
}

export async function updateDeptAction(
  deptId: string,
  input: DeptInput
): Promise<{ error?: string }> {
  await requirePermission('user_manage')
  const admin = createAdminClient()

  const { error } = await admin
    .from('departments')
    .update({ name: input.name, manager_id: input.manager_id || null } as Record<string, unknown>)
    .eq('id', deptId)

  if (error) return { error: '부서 수정에 실패했습니다.' }
  revalidatePath('/admin/departments')
  return {}
}

export async function deleteDeptAction(deptId: string): Promise<{ error?: string }> {
  await requirePermission('user_manage')
  const admin = createAdminClient()

  const { data: membersRaw } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('department_id', deptId)
    .eq('is_active', true)

  if (((membersRaw as unknown as { count: number }) ?? { count: 0 }).count > 0) {
    return { error: '소속 직원이 있는 부서는 삭제할 수 없습니다.' }
  }

  const { error } = await admin.from('departments').delete().eq('id', deptId)
  if (error) return { error: '부서 삭제에 실패했습니다.' }
  revalidatePath('/admin/departments')
  return {}
}
