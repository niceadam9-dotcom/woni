// 모바일 불량 등록 — 담당·참여자·관리자만, 허용 Origin만 (A2 2026-10-02: 종전 CORS * · 소유 검사 0)
import { adminClient, canTouchInspection, corsHeaders, json, requireUser, UUID_RE } from '../_shared/edge.ts'

const SEVERITIES = new Set(['경미', '보통', '중대'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'POST만 허용' }, 405)

  try {
    const supabase = adminClient()
    const auth = await requireUser(req, supabase)
    if ('response' in auth) return auth.response

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json(req, { error: '본문이 JSON이 아닙니다.' }, 400)
    const { inspection_id, defect_code, defect_name, defect_detail, severity, photo_url } = body

    if (typeof inspection_id !== 'string' || !UUID_RE.test(inspection_id) || typeof defect_name !== 'string' || !defect_name.trim()) {
      return json(req, { error: 'inspection_id와 defect_name은 필수입니다.' }, 400)
    }
    if (severity !== undefined && severity !== null && !SEVERITIES.has(String(severity))) {
      return json(req, { error: 'severity는 경미·보통·중대 중 하나입니다.' }, 400)
    }

    // 소유 검사 — 유효한 JWT라도 남의 점검에는 넣을 수 없다
    if (!(await canTouchInspection(supabase, inspection_id, auth.userId))) {
      return json(req, { error: '이 점검에 불량을 등록할 권한이 없습니다.' }, 403)
    }

    const { data: defect, error: insertErr } = await supabase
      .from('inspection_defects')
      .insert({
        inspection_id,
        defect_code: typeof defect_code === 'string' ? defect_code : null,
        defect_name: defect_name.trim(),
        defect_detail: typeof defect_detail === 'string' && defect_detail.trim() ? defect_detail.trim() : null,
        severity: severity ? String(severity) : '보통',
        photo_url: typeof photo_url === 'string' ? photo_url : null,
      })
      .select('id')
      .single()

    if (insertErr || !defect) throw insertErr ?? new Error('불량 등록 실패')
    return json(req, { defect_id: defect.id })
  } catch (err) {
    // 내부 오류 문구는 로그에만 — 클라이언트에는 일반 메시지 (종전 String(err) 노출 제거)
    console.error('[add-defect]', err)
    return json(req, { error: '불량 등록에 실패했습니다.' }, 500)
  }
})
