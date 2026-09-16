'use server'

/** 빈칸 보고 서버 액션 — 「엑셀을 받으면 어디가 비나」를 **받기 전에** 답한다.
 *
 *  ⚠ `'use server'` 파일에서 **타입을 재수출하지 않는다**. 이 저장소는 그걸로 화면을 두 번
 *    500으로 만들었다(tsc는 통과하는데 런타임이 죽는다). 타입이 필요하면 `lib`에서 직접 가져간다.
 *
 *  ⭐ 조립(`assembleFirePlan`)은 7쿼리 + 스토리지라 **누를 때만** 돈다. 화면에 늘 띄우는
 *    「미배선 N칸」 요약은 고객 축이 없어 DB 왕복이 0이다 — 두 축을 일부러 갈라 놓았다.
 */
import { requirePermission } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { assembleFirePlan } from '@/lib/fire-plan-generate'
import { buildFirePlanValues } from '@/lib/fire-plan-xlsx-values'
import { blankReport, type SheetBlankReport } from '@/lib/fire-plan-blanks'

/** 이 고객의 빈칸 보고.
 *
 *  🚨 권한은 엑셀 내려받기와 **같은 관문**을 쓴다. 빈칸 목록은 문서 내용의 일부를 드러내므로
 *    더 느슨하면 안 된다.
 */
export async function firePlanBlanksAction(
  customerId: string, sheets: string[],
): Promise<{ reports?: SheetBlankReport[]; error?: string }> {
  try {
    await requirePermission('customer_manage')
    if (!/^[0-9a-f-]{36}$/i.test(customerId)) return { error: '잘못된 경로입니다.' }
    if (!sheets.length) return { reports: [] }

    const admin = createAdminClient()
    const year = new Date(Date.now() + 9 * 3600_000).getFullYear()
    const { data } = await assembleFirePlan(admin, customerId, year)

    // 「값이 있다」 = 엑셀에 실제로 글자가 들어간다. 빈 문자열·null은 **없는 것**이다 —
    // 그 칸은 받는 사람 눈에 빈칸으로 보이고, 그게 이 보고가 답해야 할 바로 그것이다.
    const values = buildFirePlanValues(data)
    const filled = new Set<string>()
    for (const [field, v] of values) {
      if (v !== null && v !== '' && String(v).trim() !== '') filled.add(field)
    }

    return { reports: await blankReport(sheets, filled) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
