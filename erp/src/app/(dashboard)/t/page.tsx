import { redirect } from 'next/navigation'
import Link from 'next/link'
import { QrCode } from 'lucide-react'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTagInput, tagHuman, MANUAL_PREFIX_LEN, TAG_LEN } from '@/lib/equipment-tag'
import { searchAssetsByTagPrefix } from '@/lib/equipment-tag-lookup'
import { CATEGORY_LABEL } from '@/lib/equipment-lifespan'
import { TagSearchForm } from '@/components/equipment/tag-search-form'

/** QR 수기 조회 — 라벨이 떨어지거나 스캔이 안 될 때 앞 6자로 같은 카드에 간다 (통합계획 C3 3단계, 2026-10-03) */
export default async function TagSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!can(profile.role as UserRole, 'inspection_register')) redirect('/dashboard')
  const { q } = await searchParams
  const code = normalizeTagInput(q)
  if (code && code.length === TAG_LEN) redirect(`/t/${code}`)
  const hits = code && code.length >= MANUAL_PREFIX_LEN ? await searchAssetsByTagPrefix(createAdminClient(), code) : []
  if (hits.length === 1) redirect(`/t/${hits[0].tag_code}`)
  return (
    <div className="mx-auto max-w-md space-y-3 p-4" data-testid="tag-search">
      <h1 className="flex items-center gap-2 text-lg font-bold text-ink"><QrCode className="size-5" /> 설비 코드 찾기</h1>
      <p className="text-sm text-ink-sub">라벨에 굵게 찍힌 앞 {MANUAL_PREFIX_LEN}자를 입력하세요.</p>
      <TagSearchForm initial={q ?? ''} />
      {q && !code && <p className="text-sm text-red-600" data-testid="tag-search-invalid">코드에 쓸 수 없는 글자가 있습니다.</p>}
      {code && code.length < MANUAL_PREFIX_LEN && <p className="text-sm text-ink-meta">{MANUAL_PREFIX_LEN}자 이상 입력하세요.</p>}
      {code && code.length >= MANUAL_PREFIX_LEN && hits.length === 0 && <p className="text-sm text-ink-meta" data-testid="tag-search-none">일치하는 코드가 없습니다.</p>}
      {hits.length > 1 && (
        <ul className="divide-y rounded-lg border text-sm" data-testid="tag-search-list">
          {hits.map(h => (
            <li key={h.id}><Link className="block px-3 py-2 hover:bg-paper" href={`/t/${h.tag_code}`}>
              <b>{tagHuman(h.tag_code)}</b> · {CATEGORY_LABEL[h.category]} · {h.customer?.customer_name ?? ''} {h.location ?? ''}
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  )
}
