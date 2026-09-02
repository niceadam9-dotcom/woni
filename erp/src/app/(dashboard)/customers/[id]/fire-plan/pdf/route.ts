import { NextResponse, type NextRequest } from 'next/server'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { assembleFirePlan } from '@/lib/fire-plan-generate'
import { buildFirePlanHtml } from '@/lib/fire-plan-template'
import { convertHtmlToPdf } from '@/lib/pdf'

/** 소방계획서 즉석 PDF (2026-09-02 — 보관함 폐지)
 *
 *  누를 때마다 현재 입력값으로 조립 → HTML → Gotenberg PDF를 **저장 없이** 스트리밍한다.
 *  종전 [개정 발행]/[인쇄]가 하던 fire_plans 행·스토리지 파일 등록은 전부 폐지 — ERP는
 *  최신 데이터만 유지하고 파일 보관은 외부 폴더가 담당한다(사용자 확정).
 *  라우트 핸들러 = 공개 엔드포인트(소방계획서_17 교훈) — 세션·권한을 여기서 직접 검사한다. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'customer_manage')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })
  const download = req.nextUrl.searchParams.get('download') === '1'
  // 생성 연도 = 올해 자동 (2026-08-10 사용자 확정 — 커버 연도 표기는 '보고서 커버' 서식이 담당)
  const year = new Date(Date.now() + 9 * 3600_000).getFullYear()

  const admin = createAdminClient()
  try {
    const { data, images, assets } = await assembleFirePlan(admin, id, year)
    const html = buildFirePlanHtml(data, images)
    const pdf = await convertHtmlToPdf(html, assets, { marginMode: 'none', timeoutMs: 120_000 })
    const name = `${data.buildingName || '소방계획서'}_소방계획서_${year}.pdf`
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // 한글 저장명은 RFC 5987 filename*로 — ASCII 폴백을 함께 둔다
        'Content-Disposition':
          `${download ? 'attachment' : 'inline'}; filename="fire-plan-${year}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
