'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

/** 관계인 탭 [소방안전관리] 구역 저장 (2026-08-20 사용자 확정).
 *
 *  별지 9호 2쪽 '소방안전정보' 한 블록을 채우려면 종전엔 세 화면을 돌아야 했다
 *  (관계인 탭 → 계획서 1.1 ② 운영현황 → 계획서 1.7 선임현황). 그 결과 활성 고객 320곳 중
 *  블록이 다 채워진 곳이 **1곳**이었다(2026-08-20 실측). 그래서 사람 축 입력을 관계인 탭 한 자리로 모은다.
 *
 *  ⚠ 새 저장소를 만들지 않는다 — 전부 기존 customers 컬럼에 그대로 쓴다.
 *     특히 급수(building_grade)는 **대상물** 속성이라 계획서 1.1에도 그대로 남아 있고,
 *     여기서 고치든 거기서 고치든 같은 칸이다(창구가 둘, 저장소는 하나).
 */

const GRADES = ['특급', '1급', '2급', '3급']
const REP_ROLES = ['소유자', '관리자', '점유자']
const APPOINT_TYPES = ['소방기술자격', '소방안전관리자수첩', '업무대행감독', '겸직', '기타']

export type FireSafetyManagerInput = {
  /** 소방안전관리자로 지목한 관계인 id — '' 이면 지정 해제 */
  managerContactId: string
  /** 사람의 자격구분 (대상물 급수와 별개) */
  managerLicenseGrade: string
  managerSelectedAt: string
  managerEduDate: string
  managerAppointType: string
  repRole: string
  /** 대상물 급수 = 별지 9호 '소방안전관리등급' (별표4) */
  buildingGrade: string
}

export async function saveFireSafetyManagerAction(
  customerId: string, input: FireSafetyManagerInput,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  if (input.repRole && !REP_ROLES.includes(input.repRole)) return { error: '대표자 구분 값을 확인해주세요.' }
  if (input.managerLicenseGrade && !GRADES.includes(input.managerLicenseGrade)) return { error: '자격구분 값을 확인해주세요.' }
  if (input.buildingGrade && !GRADES.includes(input.buildingGrade)) return { error: '소방안전관리등급 값을 확인해주세요.' }
  if (input.managerAppointType && !APPOINT_TYPES.includes(input.managerAppointType)) return { error: '선임 형태 값을 확인해주세요.' }

  // 지목 대상은 **이 고객의 관계인**이어야 한다 — 남의 고객 관계인 id를 넣어 이름·전화를 끌어오지 못하게.
  if (input.managerContactId) {
    const { data: ok } = await admin.from('customer_contacts')
      .select('id').eq('id', input.managerContactId).eq('customer_id', customerId).maybeSingle()
    if (!ok) return { error: '이 고객의 관계인이 아닙니다 — 목록에서 다시 선택해주세요.' }
  }

  const { error } = await admin.from('customers').update({
    manager_contact_id: input.managerContactId || null,
    manager_license_grade: input.managerLicenseGrade || null,
    manager_selected_at: input.managerSelectedAt || null,
    manager_edu_date: input.managerEduDate || null,
    manager_appointment_type: input.managerAppointType || null,
    rep_role: input.repRole || null,
    building_grade: input.buildingGrade || null,
  } as Record<string, unknown>).eq('id', customerId)
  if (error) return { error: `저장 실패: ${error.message}` }

  revalidatePath(`/customers/${customerId}`)
  return {}
}
