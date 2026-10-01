import { NextResponse, type NextRequest } from 'next/server'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/** 고객 → 그 고객의 **가장 최근 점검 상세**로 넘기는 징검다리 (2026-08-18 사용자 확정).
 *
 *  왜 라우트인가: [최근 본 고객] 칩은 브라우저 localStorage에만 있어서 서버가 목록을 모른다.
 *  페이지를 그릴 때 고객→점검 링크를 미리 만들 수 없으므로, 누른 뒤 서버가 푼다.
 *  버튼+서버액션이 아니라 라우트로 두는 이유는 **평범한 링크를 유지**하기 위해서다(새 탭 열기).
 *
 *  규칙(사용자 확정): 대상 = 무조건 가장 최근 1건 / 점검이 없으면 고객 상세로 보낸다.
 *  '가장 최근'의 축은 점검 시작일 — 연도·차수는 정기와 자체점검이 의미가 달라 섞으면 어긋난다.
 *
 *  🎯 2026-10-01 — page.tsx(`redirect()`)에서 **Route Handler(307)**로 바꿨다. `(dashboard)/loading.tsx`
 *  (스트리밍) 아래에서 리다이렉트만 하는 페이지는 셸을 먼저 보낸 뒤 리다이렉트를 흘려 Next Router가
 *  훅 오류를 던졌고(실측), 레이아웃 조회(뱃지 등)까지 두 번 돌았다. 핸들러는 렌더 없이 바로 보낸다. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 307)
  const profile = await getProfile()
  if (!profile) return to('/login')

  // 잘못된 경로는 고객 목록으로 — 여기서 404를 띄우면 사용자가 할 수 있는 게 없다
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return to('/customers')

  const admin = createAdminClient()
  const { data } = await admin
    .from('inspections')
    .select('id')
    .eq('customer_id', customerId)
    .order('inspection_start_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const inspectionId = (data as { id: string } | null)?.id
  return to(inspectionId ? `/inspections/${inspectionId}` : `/customers/${customerId}`)
}
