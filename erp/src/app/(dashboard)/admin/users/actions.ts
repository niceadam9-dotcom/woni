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

  // 트리거가 profile 행을 생성하므로 업데이트
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      employee_id: input.employee_id,
      name: input.name,
      role: input.role,
      department_id: input.department_id || null,
      position: input.position || null,
      hire_date: input.hire_date || null,
      is_active: true,
    } as Record<string, unknown>)
    .eq('id', userId)

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
