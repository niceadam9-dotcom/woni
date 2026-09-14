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
 *
 *  ⚠ 2026-09-14: 급수(building_grade)는 **여기서 빠졌다**. 종전엔 "창구가 둘, 저장소는 하나라
 *     어긋나지 않는다"고 적혀 있었으나 그게 틀렸다 — 두 화면이 동시에 마운트된 채 살아 있어서
 *     (customer-tabs가 패널을 hidden으로 유지) 늦게 저장하는 쪽의 **낡은 상태**가 상대가 방금
 *     넣은 값을 덮어쓴다. 선임일이 실제로 그렇게 지워지고 있었다. 급수는 대상물 속성이므로
 *     계획서 1.1을 정본으로 두고 이 패널에서는 입력칸째 없앴다(사용자 확정).
 */

const GRADES = ['특급', '1급', '2급', '3급']
const APPOINT_TYPES = ['소방기술자격', '소방안전관리자수첩', '업무대행감독', '겸직', '기타']

export type FireSafetyManagerInput = {
  /** 소방안전관리자로 지목한 관계인 id — '' 이면 지정 해제 */
  managerContactId: string
  /** 사람의 자격구분 (대상물 급수와 별개) */
  managerLicenseGrade: string
  managerSelectedAt: string
  managerEduDate: string
  managerAppointType: string
  /** ⚠ `repRole`은 **여기 없다**(2026-09-14 제거). 대표자 구분은 관계인 카드와 같은 컬럼인데
   *  이 패널이 자기 state로 들고 있다가 [저장] 때 낡은 값으로 덮어썼다 — E2E로 재현했다
   *  (카드에서 「관리자」 → DB 저장됨 → 패널 저장 → rep_role=null).
   *  이제 그 값의 유일한 창구는 `setRepRoleAction`(클릭 즉시 저장)이고, 화면은 RepRoleProvider가
   *  공유한다. **여기에 필드를 되살리면 덮어쓰기가 같이 살아난다.** */
}

export async function saveFireSafetyManagerAction(
  customerId: string, input: FireSafetyManagerInput,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  if (input.managerLicenseGrade && !GRADES.includes(input.managerLicenseGrade)) return { error: '자격구분 값을 확인해주세요.' }
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
    // rep_role은 **의도적으로 없다** — 위 타입 주석 참조(2026-09-14 덮어쓰기 제거).
    // 급수(building_grade)는 여기서 쓰지 않는다 — **대상물** 속성이라 계획서 1.1이 정본이다
    // (2026-09-14 사용자 확정). 양쪽이 같은 컬럼을 쓰면 나중에 마운트된 화면의 낡은 상태가
    // 상대가 방금 저장한 값을 덮어쓴다 — 선임일에서 실제로 터진 사고와 같은 구조다.
  } as Record<string, unknown>).eq('id', customerId)
  if (error) return { error: `저장 실패: ${error.message}` }

  revalidatePath(`/customers/${customerId}`)
  return {}
}
