import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { getCompanyProfile } from '@/lib/company-profile'
import { formatTel } from '@/lib/format-contact'
import { loadPhotoAlbumItems, prepareAlbumPhotos } from '@/lib/photo-album'
import { renderPhotoAlbumHwpx } from '@/lib/photo-album-hwpx'

/** 공사 완료 사진첩 한글파일(HWPX) 즉석 생성 (2026-10-06 사용자 요청 — 본보기 `공사 완료 사진첩.hwp`).
 *
 *  목록·사진은 엑셀 「사진첩」 시트·PDF 사진첩과 같은 한 벌(lib/photo-album)이다. 저장하지 않는다 —
 *  보고서 엑셀·소민터 한글파일과 같은 축(D-5): 받을 때마다 지금 사진으로 다시 만든다.
 *  골격은 소민터 한글파일과 같은 템플릿(글꼴·A4 여백)을 빌린다 — next.config outputFileTracingIncludes.
 *  라우트 핸들러 = 공개 엔드포인트 — 세션·권한을 여기서 직접 검사한다. */

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
  const { data: insp, error } = await admin.from('inspections')
    .select('year, customer:customers(customer_name)').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: `점검 조회 실패: ${error.message}` }, { status: 500 })
  if (!insp) return NextResponse.json({ error: '점검 건을 찾을 수 없습니다.' }, { status: 404 })
  const row = insp as unknown as { year: number; customer: { customer_name: string } | null }
  const buildingName = row.customer?.customer_name ?? ''

  try {
    const items = await loadPhotoAlbumItems(admin, id)
    if (items.length === 0) {
      return NextResponse.json({ error: '불량이 없어 사진첩에 실을 건이 없습니다.' }, { status: 404 })
    }
    const [album, company] = await Promise.all([prepareAlbumPhotos(admin, items), getCompanyProfile()])
    if (album.notes.length) console.warn('[photo-album-hwpx]', album.notes.join(' · '))
    const bytes = await renderPhotoAlbumHwpx(new Uint8Array(readFileSync(TEMPLATE_PATH)), {
      buildingName,
      company: {
        name: company?.company_name ?? '',
        phone: formatTel(company?.phone), fax: formatTel(company?.fax), email: company?.email ?? '',
      },
      album,
    })
    const name = `${buildingName || '점검'}_공사완료사진첩_${row.year}.hwpx`
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/hwp+zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: `사진첩 한글파일 생성 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
