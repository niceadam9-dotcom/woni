import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { assembleOfficial, assembleDelegation } from '@/lib/annex-cover-official'
import { assembleReport9 } from '@/lib/report9-assemble'
import { groupReportGaps } from '@/lib/workbook-notice'
import { currentRoundOf, downloadableInspectionId, roundLabel } from '@/lib/customer-rounds'
import { getCustomerRoundsAction } from '@/app/(dashboard)/reports/docs-actions'

/** 보고서 준비도 — 이 고객의 [보고서 엑셀]에 **지금 받으면** 빌 칸을 탭별로 돌려준다 (2026-09-23).
 *
 *  고객 탭 뱃지·탭 상단 목록·달력 사이드바 한 줄이 이 하나를 읽는다.
 *  ⚠ 원천은 엑셀 라우트(`inspections/[id]/workbook`)와 **같은 조립 함수 셋**이다 — 여기서 빈칸을
 *    따로 판정하면 「탭은 다 찼다는데 엑셀은 비었다」가 생긴다. 엑셀 파일은 만들지 않는다(계산만).
 *  ⚠ 회차는 [보고서] 탭 머리줄과 **같은 판정**(`currentRoundOf`)으로 고른다 — 다른 회차를 보면
 *    뱃지와 그 탭에서 받은 엑셀이 서로 다른 말을 한다. `?inspection=`이 오면 그 회차를 쓴다
 *    (달력 사이드바는 보고 있는 회차가 정해져 있고, 탭 이동마다 회차 판정을 되풀이하지 않게).
 *  ⚠ 페이지 렌더에 넣지 않았다 — 고객 페이지는 「회차 조회는 회차·보고서 탭에서만」이라는 성능
 *    결정(2026-09-02)이 있다. 화면이 뜬 뒤 따로 부른다. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  // 엑셀 라우트와 같은 권한 — 받을 수 없는 사람에게 「받으면 빌 칸」을 말할 이유가 없다
  if (!can(profile.role as UserRole, 'inspection_register')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  const { id: customerId } = await ctx.params
  const uuid = /^[0-9a-f-]{36}$/i
  if (!uuid.test(customerId)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })

  const admin = createAdminClient()
  let inspectionId = req.nextUrl.searchParams.get('inspection')
  let label: string | null = null
  if (inspectionId) {
    if (!uuid.test(inspectionId)) return NextResponse.json({ error: '잘못된 회차입니다.' }, { status: 400 })
    // 🚨 남의 회차 id를 붙여 다른 고객 자료를 읽지 못하게 — 회차가 **이 고객 것**인지 확인한다
    const { data: own } = await admin.from('inspections').select('id')
      .eq('id', inspectionId).eq('customer_id', customerId).maybeSingle()
    if (!own) return NextResponse.json({ error: '이 고객의 회차가 아닙니다.' }, { status: 404 })
  } else {
    const rounds = await getCustomerRoundsAction(customerId).then(r => r.data?.rounds ?? []).catch(() => [])
    /* 현재 회차에 받을 엑셀이 없으면(예정만 된 회차 — 2026-09-23 실측 운주빌딩: 현재=3월 예정 1차 종합,
       실제 진행=완료된 2차 작동) **엑셀이 있는 가장 최근 회차**로 센다. 탭 뱃지가 묻는 빈칸(주소·관계인·
       송달 동의…)은 **고객 자료**라 어느 회차로 세도 같다 — 회차가 없다고 안내를 끄면 정작 입력할
       사람에게 아무것도 안 보인다. 어느 회차 기준인지는 `roundLabel`로 화면에 적는다.
       ⚠ rounds는 (연,차) 내림차순이라 `find`가 곧 최신이다(customer-rounds.ts currentRoundOf 주석). */
    const cur = currentRoundOf(rounds)
    const round = downloadableInspectionId(cur) ? cur : (rounds.find(r => downloadableInspectionId(r)) ?? null)
    inspectionId = downloadableInspectionId(round)
    label = round ? roundLabel(round) : null
  }
  // 시작한 회차가 없으면 받을 엑셀 자체가 없다 — 빈칸 0이 아니라 **판정 불가**다(0은 「다 찼다」로 읽힌다)
  if (!inspectionId) return NextResponse.json({ inspectionId: null, roundLabel: null, byTab: null })

  try {
    const [official, delegation, r9] = await Promise.all([
      assembleOfficial(admin, customerId, inspectionId),
      assembleDelegation(admin, customerId, inspectionId),
      assembleReport9(admin, customerId, inspectionId),
    ])
    const byTab = groupReportGaps([...official.missing, ...delegation.missing, ...r9.missing])
    return NextResponse.json({ inspectionId, roundLabel: label, byTab })
  } catch (e) {
    return NextResponse.json({ error: `보고서 빈칸 계산 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
