import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse, type NextRequest } from 'next/server'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { assembleFirePlan } from '@/lib/fire-plan-generate'
import { buildFirePlanValues, missingValueFields } from '@/lib/fire-plan-xlsx-values'
import { FIRE_PLAN_MANIFEST } from '@/lib/fire-plan-xlsx-manifest'
import { fillFirePlanHwpx } from '@/lib/fire-plan-hwpx'
import { firePlanWorkbookRules } from '@/lib/company-literals'
import { getCompanyProfile } from '@/lib/company-profile'
import { planFirePlanImages } from '@/lib/fire-plan-xlsx-images'
import { FIRE_PLAN_IMAGE_ANCHORS } from '@/lib/fire-plan-anchors'

/** 소방계획서 한글파일(HWPX) — 2026-10-06 사용자 요청 「소방계획서를 hwp로」.
 *
 *  .hwp(바이너리)는 서버(리눅스 도커)에서 쓸 수 없어 **HWPX**로 낸다 — 한글 2014 이상·한컴 뷰어가 연다.
 *  값은 엑셀 라우트와 **같은 `assembleFirePlan` → `buildFirePlanValues`** 를 먹는다(PDF·엑셀·한글 D-7).
 *  칸 위치는 엑셀 앵커를 manifest `gridTops`로 HWPX 칸에 되돌린다(`lib/fire-plan-hwpx` 머리말).
 *  서식은 `templates/fire-plan-form.hwpx` — 사용자 제공 양식에서 이전 작성분 흔적을 지운 것
 *  (`scripts/build-fire-plan-hwpx-template.mts`).
 *
 *  🚨 조용한 오적용 금지(엑셀 라우트와 같은 축) — 값 맵 구멍·칸 없음·중첩 건너뜀은 500으로 끊는다.
 *  회사정보 문구는 엑셀 C5와 같은 규칙(`firePlanWorkbookRules`)으로 바꾸고, 사진·도면은 엑셀과 같은 배정
 *  (`planFirePlanImages`)으로 앉힌다. 표지 사진은 엑셀 전용 사진 표지라 한글 양식에 자리가 없다(고지).
 *  라우트 핸들러 = 공개 엔드포인트 — 세션·권한을 여기서 직접 검사한다. */
export const runtime = 'nodejs'

const TEMPLATE_PATH = join(process.cwd(), 'templates', 'fire-plan-form.hwpx')

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'customer_manage')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })
  // 생성 연도 = 올해 자동 — 엑셀·PDF 라우트와 같은 축(KST 보정)
  const year = new Date(Date.now() + 9 * 3600_000).getFullYear()

  try {
    const admin = createAdminClient()
    const { data, images, assets, missing } = await assembleFirePlan(admin, id, year)
    const values = buildFirePlanValues(data)
    const gaps = missingValueFields(values)
    if (gaps.length) {
      return NextResponse.json(
        { error: `소방계획서 값 매핑이 불완전합니다(${gaps.length}칸).`, detail: gaps.slice(0, 12) }, { status: 500 })
    }
    // 회사정보 문구(1.8 업무대행·1.15 피해복구·2.4 임무카드·1.11.2 교보재) — 엑셀 C5와 같은 규칙. 회사정보가 없으면 서식 그대로
    const company = await getCompanyProfile()
    // 사진·도면 — 엑셀과 **같은 배정**(상자·우선순위·넘침 고지). 상자 좌표는 같은 사상으로 한글 칸에 되돌린다
    const imgPlan = planFirePlanImages(images, assets, FIRE_PLAN_IMAGE_ANCHORS)
    const { bytes, stats } = await fillFirePlanHwpx(readFileSync(TEMPLATE_PATH), values,
      FIRE_PLAN_MANIFEST.sheets.map(s => s.name),
      { literals: company ? firePlanWorkbookRules(company) : [], images: imgPlan.targets })
    if (stats.missingCell.length || stats.skippedNested.length) {
      return NextResponse.json(
        { error: `소방계획서 한글 서식 칸이 어긋났습니다(${stats.missingCell.length + stats.skippedNested.length}칸). 관리자에게 알려 주세요.`,
          detail: [...stats.missingCell, ...stats.skippedNested].slice(0, 12) }, { status: 500 })
    }

    const name = `${data.buildingName || '소방계획서'}_소방계획서_${year}.hwpx`
    const notice = (() => {
      const parts = [...imgPlan.notes, ...stats.imageNotes, ...missing]
      const s = parts.join(' · ')
      return s.length > 600 ? `${s.slice(0, 600)}…(${s.length - 600}자 생략)` : s
    })()
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/hwp+zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        // 엑셀 라우트와 같은 헤더 이름 — 받는 버튼(FirePlanXlsxButton format='hwpx')이 한 벌이다
        'X-FirePlan-Missing': encodeURIComponent(notice),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[fire-plan hwpx] 생성 실패', e)
    return NextResponse.json({ error: `한글파일 생성 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
