import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveShareToken, logShareEvent, clientMeta, ROUND_DOC_KINDS, type RoundDocKind } from '@/lib/share-links'
import { ensureQuotePdf, QUOTE_PDF_COLS, type QuoteRow } from '@/lib/quote-doc-server'

/** 링크 문서 내려받기 — 토큰 확인 → 300초 서명 URL로 보낸다(파일을 앱이 중계하지 않는다).
 *  🔒 service role만. 위조·만료·철회·파일 없음은 같은 404. 견적 PDF는 보관본이 없으면 만들어 보관한다. */
export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse('문서를 찾을 수 없습니다.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const admin = createAdminClient()
  const link = await resolveShareToken(admin, token)
  if (!link) return notFound()

  let path: string | null = null
  if (link.kind === 'quote') {
    const { data: q } = await admin.from('quotes').select(QUOTE_PDF_COLS).eq('id', link.quote_id!).maybeSingle()
    if (!q) return notFound()
    const r = await ensureQuotePdf(admin, q as unknown as QuoteRow)
    if (r.error || !r.path) { console.error('[share-file] 견적 PDF 실패:', r.error); return new NextResponse('문서를 준비하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }) }
    path = r.path
  } else if (link.kind === 'billing') {
    return notFound()  // 청구 이력은 화면만 — 내려받을 파일이 없다
  } else {
    // round는 ?doc=report9|report10|report11 로 고른다(허용목록 밖은 404). 단일 별지 링크는 자기 종류만
    const docParam = req.nextUrl.searchParams.get('doc') ?? ''
    const doc: RoundDocKind | null = link.kind === 'round'
      ? ((ROUND_DOC_KINDS as readonly string[]).includes(docParam) ? docParam as RoundDocKind : null)
      : link.kind as RoundDocKind
    if (!doc) return notFound()
    const prefix = `${link.customer_id}/inspections/${link.inspection_id}`
    const { data: objects } = await admin.storage.from('fire-plans').list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
    const re = new RegExp(`^${doc}_\\d+\\.pdf$`)
    const name = (objects ?? []).map(o => o.name).filter(n => re.test(n)).sort().reverse()[0]
    if (!name) return notFound()
    path = `${prefix}/${name}`
  }
  const { data: signed } = await admin.storage.from('fire-plans').createSignedUrl(path, 300)
  if (!signed?.signedUrl) return notFound()
  await logShareEvent(admin, link.id, 'downloaded', clientMeta(req.headers))
  return NextResponse.redirect(signed.signedUrl, 302)
}
