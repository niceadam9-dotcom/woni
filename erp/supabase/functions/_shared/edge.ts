// Edge Function 공용 — CORS 허용목록·인증·점검 소유 검사 (통합 실행계획 A2, 2026-10-02)
//
// 종전 세 함수는 CORS가 `*`였고, JWT가 유효하기만 하면 본문의 inspection_id·defect_id를
// 그대로 service role로 썼다. 직원 누구든 아무 점검에 불량을 넣고 아무 불량의 사진을 바꿀 수 있었다.
// 여기서 공통으로 (1) Origin을 허용목록과 대조하고 (2) 사용자가 그 점검의 담당·참여자·관리자인지 확인한다.
//
// 허용 Origin은 secrets의 ALLOWED_ORIGINS(쉼표 구분)로 바꿀 수 있다. 네이티브 앱(Expo)은 Origin 헤더를
// 보내지 않으므로 CORS와 무관하게 통과하고, 인증·소유 검사만 받는다.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEFAULT_ORIGINS = ['https://sjfire.co.kr', 'https://staging.sjfire.co.kr']
const allowedOrigins = new Set(
  (Deno.env.get('ALLOWED_ORIGINS') ?? DEFAULT_ORIGINS.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean),
)

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origin && allowedOrigins.has(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // SB_SERVICE_KEY(sb_secret, secrets set으로 등록) 우선 — legacy 키 비활성화 후에도 동작
    Deno.env.get('SB_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/** Authorization: Bearer <user JWT> 검증. 실패면 응답을 돌려준다. */
export async function requireUser(
  req: Request, supabase: SupabaseClient,
): Promise<{ userId: string } | { response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return { response: json(req, { error: '인증 필요' }, 401) }
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.slice('Bearer '.length))
  if (error || !user) return { response: json(req, { error: '인증 실패' }, 401) }
  return { userId: user.id }
}

/** profiles.role — employee/manager/admin. 행이 없으면 null(소속 없는 auth 사용자). */
export async function loadRole(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle()
  return (data as { role?: string } | null)?.role ?? null
}

/** 이 사용자가 이 점검을 건드릴 수 있는가 — 담당자(assigned_employee_id) 또는 참여자(inspection_participants)
 *  또는 manager/admin. 점검이 없으면 false. */
export async function canTouchInspection(
  supabase: SupabaseClient, inspectionId: string, userId: string,
): Promise<boolean> {
  const { data: insp } = await supabase
    .from('inspections').select('id, assigned_employee_id').eq('id', inspectionId).maybeSingle()
  if (!insp) return false
  if ((insp as { assigned_employee_id?: string }).assigned_employee_id === userId) return true
  const role = await loadRole(supabase, userId)
  if (role === 'manager' || role === 'admin') return true
  const { data: part } = await supabase
    .from('inspection_participants').select('id')
    .eq('inspection_id', inspectionId).eq('employee_id', userId).maybeSingle()
  return !!part
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
