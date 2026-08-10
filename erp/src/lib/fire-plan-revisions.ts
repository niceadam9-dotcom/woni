import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

/** 개정이력 자동 기록 (마이그레이션 120 — 소방계획서_17 §2-2)
 *
 *  문서 생성·업로드 파이프라인이 실적 1건당 이력 1행을 남긴다.
 *  'use server' 액션이 아니라 평범한 서버 전용 함수인 것은 의도적이다 — 액션으로 두면
 *  권한 검사 없는 공개 엔드포인트가 되어 클라이언트가 임의 이력을 심을 수 있다.
 *  사용자 편집 경로는 fire-plan-revision-actions.ts(requirePermission 동반)를 쓴다. */

type Admin = SupabaseClient

const MAX_CONTENT = 200

/** seq는 서버가 max+1로 채번한다 — 유니크 인덱스 경합(23505)은 1회 재시도로 흡수.
 *  best-effort: 실패해도 호출자가 생성 자체를 되돌리지는 않는다(파일은 남는 편이 낫다). */
export async function appendGeneratedRevision(admin: Admin, opts: {
  customerId: string
  year: number
  firePlanId: string | null
  content: string
  source: 'generated' | 'uploaded'
  authorName?: string | null
  createdBy?: string | null
}): Promise<{ error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: top } = await admin.from('fire_plan_revisions')
      .select('seq').eq('customer_id', opts.customerId).eq('year', opts.year)
      .order('seq', { ascending: false }).limit(1).maybeSingle()
    const seq = ((top as { seq: number } | null)?.seq ?? 0) + 1
    const { error } = await admin.from('fire_plan_revisions').insert({
      customer_id: opts.customerId,
      year: opts.year,
      seq,
      revised_on: new Date().toISOString().slice(0, 10),
      content: opts.content.slice(0, MAX_CONTENT),
      author_name: (opts.authorName ?? '').trim() || null,
      source: opts.source,
      fire_plan_id: opts.firePlanId,
      created_by: opts.createdBy ?? null,
    } as Record<string, unknown>)
    if (!error) return {}
    if (error.code !== '23505') return { error: error.message }
  }
  return { error: 'seq 채번 경합' }
}
