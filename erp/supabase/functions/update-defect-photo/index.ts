// 모바일 불량 사진 경로 기록 — 그 불량이 속한 점검의 담당·참여자·관리자만 (A2 2026-10-02)
import { adminClient, canTouchInspection, corsHeaders, json, requireUser, UUID_RE } from '../_shared/edge.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'POST만 허용' }, 405)

  try {
    const supabase = adminClient()
    const auth = await requireUser(req, supabase)
    if ('response' in auth) return auth.response

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json(req, { error: '본문이 JSON이 아닙니다.' }, 400)
    const { defect_id, photo_url } = body

    if (typeof defect_id !== 'string' || !UUID_RE.test(defect_id) || typeof photo_url !== 'string' || !photo_url) {
      return json(req, { error: 'defect_id와 photo_url은 필수입니다.' }, 400)
    }
    // 사진 값은 (a) inspection-defects 버킷의 Supabase Storage URL 또는 (b) 그 버킷 안의 경로 `<inspId>/<defectId>/…`
    const isUrl = /^https?:\/\//.test(photo_url)
    const okUrl = isUrl && photo_url.includes('/storage/v1/object/') && photo_url.includes('/inspection-defects/')
    const okPath = !isUrl && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/\\]+$/i.test(photo_url)
    if (!okUrl && !okPath) {
      return json(req, { error: 'photo_url은 inspection-defects 버킷의 URL 또는 경로여야 합니다.' }, 400)
    }

    // 불량 → 점검 → 소유 검사
    const { data: defect } = await supabase
      .from('inspection_defects').select('id, inspection_id').eq('id', defect_id).maybeSingle()
    const inspectionId = (defect as { inspection_id?: string } | null)?.inspection_id
    if (!inspectionId || !(await canTouchInspection(supabase, inspectionId, auth.userId))) {
      return json(req, { error: '이 불량의 사진을 바꿀 권한이 없습니다.' }, 403)
    }

    const { error: updateErr } = await supabase
      .from('inspection_defects').update({ photo_url }).eq('id', defect_id)
    if (updateErr) throw updateErr

    return json(req, { success: true })
  } catch (err) {
    console.error('[update-defect-photo]', err)
    return json(req, { error: '사진 기록에 실패했습니다.' }, 500)
  }
})
