import { NextResponse, type NextRequest } from 'next/server'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { convertHtmlToPdf } from '@/lib/pdf'
import { siteOrigin } from '@/lib/share-links'
import { getCompanyProfile } from '@/lib/company-profile'
import { assembleRecordCard, renderRecordCardHtml } from '@/lib/record-card'

/** 소방시설등 자체점검기록표(별표 5) PDF (통합 실행계획 C4 — QR 절 4단계, 2026-10-03)
 *
 *  작업대 ④ 칸의 「자체점검기록표」 링크가 연다 — 보고 후 10일 안에 출입구 게시용(30일 이상).
 *  라우트 핸들러 = 공개 엔드포인트라 세션·권한을 직접 검사한다(equipment-labels와 같은 거울).
 *   ?format=html  변환 없이 HTML(미리보기·시험)
 *  활성 건물 중 코드 없는 건물에는 QR 코드를 발급한다(재발급 없음 — 같은 건물은 늘 같은 QR). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'inspection_register')) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })
  const asHtml = req.nextUrl.searchParams.get('format') === 'html'

  const admin = createAdminClient()
  const company = await getCompanyProfile()
  const assembled = await assembleRecordCard(admin, id, company, { issueTags: true })
  if (!assembled) return NextResponse.json({ error: '점검을 찾을 수 없습니다.' }, { status: 404 })

  const html = await renderRecordCardHtml(assembled.data, siteOrigin(req.headers))
  const missing = encodeURIComponent(assembled.missing.join(' | '))
  if (asHtml) {
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Record-Card-Missing': missing },
    })
  }
  try {
    const pdf = await convertHtmlToPdf(html, [], { marginMode: 'none', timeoutMs: 120_000 })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="record-card.pdf"; filename*=UTF-8''${encodeURIComponent(`자체점검기록표_${assembled.data.customerName}.pdf`)}`,
        'Cache-Control': 'no-store',
        'X-Record-Card-Missing': missing,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
