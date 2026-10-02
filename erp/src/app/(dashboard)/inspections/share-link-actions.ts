'use server'

/** 관계인 열람·승인 링크 — 직원 쪽 액션(발급·목록·철회) (불량 → 매출 2단계, 2026-10-02)
 *  링크를 여는 쪽(관계인)은 /p/[token] 공개 라우트다. 여기는 로그인한 직원만. */

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { issueShareLink, siteOrigin, type ShareKind } from '@/lib/share-links'

const REPORT_KINDS = new Set<ShareKind>(['report9', 'report10', 'report11'])

export type ShareLinkRow = {
  id: string
  kind: ShareKind
  label: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  views: number
  last_viewed_at: string | null
  approved_by: string | null
  approved_at: string | null
  downloads: number
}

/** 견적 링크 발급 — URL은 이때 한 번만 보인다(원문 토큰 미저장). 취소·만료 견적은 거절 */
export async function createQuoteShareLinkAction(quoteId: string): Promise<{ error?: string; url?: string; expiresAt?: string }> {
  const profile = await requirePermission('quote_create')
  const admin = createAdminClient()
  const { data: q } = await admin.from('quotes').select('id, customer_id, inspection_id, status').eq('id', quoteId).single()
  if (!q) return { error: '견적을 찾을 수 없습니다.' }
  const quote = q as { id: string; customer_id: string; inspection_id: string | null; status: string }
  if (['취소', '만료'].includes(quote.status)) return { error: `「${quote.status}」 견적은 링크를 만들 수 없습니다.` }
  const r = await issueShareLink(admin, { kind: 'quote', customerId: quote.customer_id, inspectionId: quote.inspection_id, quoteId: quote.id, createdBy: profile.id })
  if (r.error || !r.token) return { error: r.error ?? '링크를 만들지 못했습니다.' }
  if (quote.inspection_id) revalidatePath(`/inspections/${quote.inspection_id}/repair`)
  return { url: `${siteOrigin(await headers())}/p/${r.token}`, expiresAt: r.expiresAt }
}

/** 별지 9·10·11호 열람 링크 — 회차에 생성물(PDF)이 있어야 의미가 있다(없으면 링크 페이지가 「아직 없음」을 보인다) */
export async function createReportShareLinkAction(inspectionId: string, kind: ShareKind): Promise<{ error?: string; url?: string; expiresAt?: string }> {
  const profile = await requirePermission('inspection_register')
  if (!REPORT_KINDS.has(kind)) return { error: '지원하지 않는 문서 종류입니다.' }
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const r = await issueShareLink(admin, { kind, customerId: (insp as { customer_id: string }).customer_id, inspectionId, quoteId: null, createdBy: profile.id })
  if (r.error || !r.token) return { error: r.error ?? '링크를 만들지 못했습니다.' }
  revalidatePath(`/inspections/${inspectionId}/repair`)
  return { url: `${siteOrigin(await headers())}/p/${r.token}`, expiresAt: r.expiresAt }
}

const KIND_LABEL: Record<ShareKind, string> = { quote: '견적', report9: '별지 9호', report10: '별지 10호', report11: '별지 11호' }

/** 회차의 링크 목록 + 열람·내려받기·승인 집계 */
export async function listShareLinksAction(inspectionId: string): Promise<{ error?: string; links: ShareLinkRow[] }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data, error } = await admin.from('share_links')
    .select('id, kind, quote_id, created_at, expires_at, revoked_at, quote:quotes(quote_number)')
    .eq('inspection_id', inspectionId).order('created_at', { ascending: false })
  if (error) { console.error('[share-links] 목록 실패:', error.message); return { error: '링크 목록을 불러오지 못했습니다.', links: [] } }
  const rows = (data ?? []) as unknown as Array<{ id: string; kind: ShareKind; quote_id: string | null; created_at: string; expires_at: string; revoked_at: string | null; quote: { quote_number: string } | null }>
  const events = rows.length
    ? ((await admin.from('share_link_events').select('link_id, event, at, actor_name').in('link_id', rows.map(r => r.id)).order('at', { ascending: false })).data ?? [])
    : []
  const ev = events as Array<{ link_id: string; event: string; at: string; actor_name: string | null }>
  return {
    links: rows.map(r => {
      const mine = ev.filter(e => e.link_id === r.id)
      const viewed = mine.filter(e => e.event === 'viewed')
      const approved = mine.find(e => e.event === 'approved') ?? null
      return {
        id: r.id, kind: r.kind,
        label: r.kind === 'quote' ? `견적 ${r.quote?.quote_number ?? ''}` : KIND_LABEL[r.kind],
        created_at: r.created_at, expires_at: r.expires_at, revoked_at: r.revoked_at,
        views: viewed.length, last_viewed_at: viewed[0]?.at ?? null,
        approved_by: approved?.actor_name ?? null, approved_at: approved?.at ?? null,
        downloads: mine.filter(e => e.event === 'downloaded').length,
      }
    }),
  }
}

export async function revokeShareLinkAction(linkId: string): Promise<{ error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data, error } = await admin.from('share_links').update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId).is('revoked_at', null).select('inspection_id').maybeSingle()
  if (error) return { error: '철회에 실패했습니다.' }
  const insp = (data as { inspection_id: string | null } | null)?.inspection_id
  if (insp) revalidatePath(`/inspections/${insp}/repair`)
  return {}
}
