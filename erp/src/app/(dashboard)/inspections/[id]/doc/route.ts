import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { annexDownloadName } from '@/lib/annex-filename'

/** 별지 산출물 1건 내려주기 — **저장명을 우리가 정하려고** 있는 라우트다.
 *
 *  종전엔 Supabase 서명 URL을 그대로 열었는데, 그 방식은 저장명을 붙이려면 `download` 옵션밖에 없고
 *  그러면 응답이 `attachment`가 되어 **새 탭 열람이 사라진다**. PDF는 "바로 보기·인쇄"가 본 동선이라
 *  열람은 그대로 두고 이름만 고쳐야 했다 — `inline; filename*=`은 브라우저가 표시는 하면서
 *  저장 시 그 이름을 쓴다.
 *
 *  저장명은 클라이언트가 넘기지 않는다. 이름 규약이 점검 유형(작동/종합)에 걸려 있어서
 *  화면마다 유형을 들고 다니게 하면 어긋나기 딱 좋다 — 여기서 조회해 lib/annex-filename 한 곳으로 만든다.
 *
 *  HTML 미리보기는 여기로 보내지 않는다: 우리 출처에서 `inline`으로 내주면 그 문서가 세션 쿠키에
 *  접근할 수 있는 자리에 놓인다. HTML은 종전대로 Supabase 서명 URL(다른 출처)로 연다.
 *
 *  권한은 두 겹이다: proxy 게이트가 이 경로를 먼저 잡아 비로그인은 /login으로 돌리고, 여기서도
 *  세션·권한(inspection_register)을 다시 검사한다 — 라우트 핸들러는 게이트를 못 타는 배포에서
 *  그대로 공개 엔드포인트가 된다(소방계획서_17 교훈). */

const BUCKET = 'fire-plans'
/** Storage 파일명 규약 `{kind}_{timestamp}.{ext}` — 경로 조작을 막는 화이트리스트 역할도 겸한다 */
const FILE_RE = /^([a-z0-9_]+)_(\d+)\.(pdf|hwpx?)$/i
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  hwp: 'application/x-hwp',
  hwpx: 'application/haansofthwpx',
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'inspection_register')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })

  const file = req.nextUrl.searchParams.get('file')?.trim() ?? ''
  const m = FILE_RE.exec(file)
  if (!m) return NextResponse.json({ error: '알 수 없는 파일입니다.' }, { status: 400 })
  const kind = m[1].toLowerCase()
  const ext = m[3].toLowerCase()

  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('customer_id, inspection_type, plan_type, customers:customer_id (customer_name)')
    .eq('id', id).maybeSingle()
  if (!insp) return NextResponse.json({ error: '점검 건을 찾을 수 없습니다.' }, { status: 404 })
  const r = insp as unknown as {
    customer_id: string; inspection_type: string | null; plan_type: string | null
    customers: { customer_name: string } | null
  }

  const path = `${r.customer_id}/inspections/${id}/${file}`
  const { data: blob, error } = await admin.storage.from(BUCKET).download(path)
  if (error || !blob) return NextResponse.json({ error: '파일을 찾지 못했습니다.' }, { status: 404 })

  const name = annexDownloadName({
    kind, ext,
    customerName: r.customers?.customer_name ?? '',
    inspectionType: r.inspection_type,
    planType: r.plan_type,
    // 생성 시각은 Storage 파일명의 타임스탬프(ms)가 정본 — created_at보다 이 값이 곧 생성 회차다
    createdAt: new Date(Number(m[2])).toISOString(),
  })

  // PDF는 열람(inline), HWP는 편집용 원본이라 내려받기(attachment). `?dl=1`이면 PDF도 내려받기.
  const forceDownload = req.nextUrl.searchParams.get('dl') === '1'
  const disposition = ext === 'pdf' && !forceDownload ? 'inline' : 'attachment'
  return new NextResponse(Buffer.from(await blob.arrayBuffer()), {
    headers: {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
