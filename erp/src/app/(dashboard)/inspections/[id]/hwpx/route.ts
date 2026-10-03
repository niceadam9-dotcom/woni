import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { assembleReport9 } from '@/lib/report9-assemble'
import { renderReport9Hwpx } from '@/lib/report9-hwpx'

/** 소민터(소방민원센터) 업로드용 별지 9호 한글파일(HWPX) 즉석 생성 — 통합계획 B4 1단계(2026-10-03).
 *
 *  소민터는 법령 서식 한글파일을 올리면 칸을 자동 입력한다. 2026-10-03 운영 데이터로 만든 HWPX 1건의
 *  실업로드가 통과해(HWPX 수용 확인) 그 렌더러(`report9-hwpx`)를 ④ 칸 버튼으로 연다.
 *  값의 원천은 별지 9호 PDF와 **같은 조립본**(`assembleReport9`)이다 — 두 산출물이 갈라지지 않는다(D-7).
 *
 *  저장하지 않는다 — 갑지 엑셀(workbook/route.ts)과 같은 축(D-5). 받을 때마다 지금 값으로 다시 만든다.
 *  라우트 핸들러 = 공개 엔드포인트 — 세션·권한을 여기서 직접 검사한다. */

// standalone은 파일 추적 기반이라 fs로만 읽는 바이너리가 번들에서 빠진다 — next.config
// outputFileTracingIncludes에 이 라우트를 함께 적었다. 원본은 erp_goal/_form/별지9호-placeholder.hwpx와
// 바이트 동일(test-report9-hwpx가 문다) — 서식 개정 시 두 곳을 같이 바꾼다.
const TEMPLATE_PATH = join(process.cwd(), 'templates', 'report9-placeholder.hwpx')

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'inspection_register')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: insp, error } = await admin.from('inspections').select('customer_id, year').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: `점검 조회 실패: ${error.message}` }, { status: 500 })
  if (!insp) return NextResponse.json({ error: '점검 건을 찾을 수 없습니다.' }, { status: 404 })
  const row = insp as { customer_id: string; year: number }

  try {
    const { data, missing } = await assembleReport9(admin, row.customer_id, id)
    const { bytes, stats } = await renderReport9Hwpx(readFileSync(TEMPLATE_PATH), data)
    if (stats.extra.missed.length) {
      // 템플릿에서 칸을 못 찾음 = 서식 개정 등으로 앵커가 어긋남 — 산출은 하되 서버 로그에 남긴다
      console.warn('[hwpx] 템플릿 앵커 미발견', stats.extra.missed)
    }
    const name = `${data.customerName || '점검'}_별지9호_소민터_${row.year}.hwpx`
    // 고지 — 소민터 업로드 실패의 첫 원인(명칭·소재지 불일치)을 맨 앞에. 헤더 한도 보호로 600자에서 자른다
    const notice = (() => {
      const parts = [
        '소민터에 등록된 대상물 명칭·소재지와 한 글자라도 다르면 업로드가 거부됩니다',
        ...stats.unfilled.map(u => `${u}은 빈 서식 — 소민터 화면에서 입력`),
        ...stats.warnings, ...missing,
      ]
      const s = parts.join(' · ')
      return s.length > 600 ? `${s.slice(0, 600)}…(${s.length - 600}자 생략)` : s
    })()
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/hwp+zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'X-Hwpx-Notice': encodeURIComponent(notice),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[hwpx] 생성 실패', e)
    return NextResponse.json({ error: `한글파일 생성 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
