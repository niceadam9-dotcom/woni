import 'server-only'

/** 관계인 열람·승인 링크 — 토큰 발급·해석·이벤트 (불량 → 매출 2단계, 2026-10-02)
 *
 *  원문 토큰은 32바이트 난수(base64url 43자)이고 DB에는 sha256 해시만 둔다(share_links.token_hash).
 *  해석은 형식 검사 → 해시 조회 → 철회·만료 검사 순서이고, 실패 사유를 바깥에 구분해 알리지 않는다
 *  (위조·만료·철회 모두 「없음」 — 토큰 존재 여부를 탐색하지 못하게).
 *  ⚠ 이 모듈은 service role 클라이언트만 받는다. /p 라우트는 anon·쿠키 클라이언트를 쓰지 않는다(정적 게이트). */
import { createHash, randomBytes } from 'node:crypto'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export const SHARE_LINK_DAYS = 90
export type ShareKind = 'quote' | 'report9' | 'report10' | 'report11'
export type ShareEvent = 'viewed' | 'downloaded' | 'approved'

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newShareToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashShareToken(token) }
}

export function isShareTokenShape(token: string): boolean {
  return TOKEN_RE.test(token)
}

export type ResolvedShareLink = {
  id: string
  kind: ShareKind
  customer_id: string
  inspection_id: string | null
  quote_id: string | null
  expires_at: string
}

/** 유효한 링크만 돌려준다. 형식 불일치·없음·철회·만료는 전부 null */
export async function resolveShareToken(admin: Admin, token: string, now = new Date()): Promise<ResolvedShareLink | null> {
  if (!isShareTokenShape(token)) return null
  const { data, error } = await admin.from('share_links')
    .select('id, kind, customer_id, inspection_id, quote_id, expires_at, revoked_at')
    .eq('token_hash', hashShareToken(token)).maybeSingle()
  if (error) { console.error('[share-links] 해석 실패:', error.message); return null }
  const row = data as (ResolvedShareLink & { revoked_at: string | null }) | null
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= now.getTime()) return null
  return { id: row.id, kind: row.kind, customer_id: row.customer_id, inspection_id: row.inspection_id, quote_id: row.quote_id, expires_at: row.expires_at }
}

/** 이벤트 기록 — 실패해도 열람을 막지 않는다(로그만) */
export async function logShareEvent(admin: Admin, linkId: string, event: ShareEvent, meta: { ip?: string | null; ua?: string | null; actorName?: string | null } = {}): Promise<void> {
  const { error } = await admin.from('share_link_events').insert({
    link_id: linkId, event, ip: meta.ip?.slice(0, 64) ?? null, ua: meta.ua?.slice(0, 300) ?? null, actor_name: meta.actorName?.slice(0, 60) ?? null,
  })
  if (error) console.error('[share-links] 이벤트 기록 실패:', event, error.message)
}

/** 링크 발급 — 원문 토큰은 반환값으로 한 번만 존재한다(저장하지 않는다) */
export async function issueShareLink(admin: Admin, input: {
  kind: ShareKind; customerId: string; inspectionId: string | null; quoteId: string | null; createdBy: string | null; days?: number
}): Promise<{ error?: string; token?: string; expiresAt?: string; id?: string }> {
  const { token, hash } = newShareToken()
  const expiresAt = new Date(Date.now() + (input.days ?? SHARE_LINK_DAYS) * 86_400_000).toISOString()
  const { data, error } = await admin.from('share_links').insert({
    token_hash: hash, kind: input.kind, customer_id: input.customerId,
    inspection_id: input.inspectionId, quote_id: input.quoteId, expires_at: expiresAt, created_by: input.createdBy,
  }).select('id').single()
  if (error) { console.error('[share-links] 발급 실패:', error.message); return { error: '링크를 만들지 못했습니다.' } }
  return { token, expiresAt, id: (data as { id: string }).id }
}

/** 요청 헤더로 공개 주소의 origin을 만든다 — PUBLIC_SITE_URL이 있으면 그것이 이긴다(Caddy가 X-Forwarded-* 를 싣는다) */
export function siteOrigin(h: Headers): string {
  const env = (process.env.PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '')
  if (env) return env
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export function clientMeta(h: Headers): { ip: string | null; ua: string | null } {
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null
  return { ip, ua: h.get('user-agent') }
}
