// 계획 항목에서 점검 생성 — 본인 배정 건 또는 manager/admin만, created_by는 호출자 (A2 2026-10-02)
// 종전에는 body의 assigned_employee_id를 created_by로 그대로 썼고 소유 검사가 없었다.
// 호출부는 현재 저장소에 없다(웹·모바일 grep 0) — 입구만 닫아 둔다.
import { adminClient, corsHeaders, json, loadRole, requireUser, UUID_RE } from '../_shared/edge.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'POST만 허용' }, 405)

  try {
    const supabase = adminClient()
    const auth = await requireUser(req, supabase)
    if ('response' in auth) return auth.response

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json(req, { error: '본문이 JSON이 아닙니다.' }, 400)
    const { plan_item_id, customer_id, assigned_employee_id, inspection_type, inspection_start_date, sequence_num } = body

    for (const [k, v] of [['plan_item_id', plan_item_id], ['customer_id', customer_id], ['assigned_employee_id', assigned_employee_id]] as const) {
      if (typeof v !== 'string' || !UUID_RE.test(v)) {
        return json(req, { error: `${k}는 필수(UUID)입니다.` }, 400)
      }
    }
    const employeeId = assigned_employee_id as string

    // 소유 검사 — 자기 배정 건이 아니면 manager/admin이어야 한다
    if (employeeId !== auth.userId) {
      const role = await loadRole(supabase, auth.userId)
      if (role !== 'manager' && role !== 'admin') {
        return json(req, { error: '다른 직원 배정 점검은 관리자만 생성할 수 있습니다.' }, 403)
      }
    }

    // 계획 항목이 그 고객의 것인지 + 이미 연결된 inspection이 있으면 그대로 반환
    const { data: item } = await supabase
      .from('inspection_plan_items').select('id, customer_id, inspection_id')
      .eq('id', plan_item_id as string).maybeSingle()
    const planItem = item as { customer_id?: string; inspection_id?: string | null } | null
    if (!planItem) return json(req, { error: '계획 항목이 없습니다.' }, 404)
    if (planItem.customer_id && planItem.customer_id !== customer_id) {
      return json(req, { error: '계획 항목과 고객이 일치하지 않습니다.' }, 400)
    }
    if (planItem.inspection_id) return json(req, { inspection_id: planItem.inspection_id })

    const { data: inspection, error: insertErr } = await supabase
      .from('inspections')
      .insert({
        customer_id,
        assigned_employee_id: employeeId,
        inspection_type: typeof inspection_type === 'string' ? inspection_type : null,
        inspection_start_date: typeof inspection_start_date === 'string' ? inspection_start_date : null,
        sequence_num: typeof sequence_num === 'number' ? sequence_num : 1,
        status: 'in_progress',
        created_by: auth.userId,
      })
      .select('id')
      .single()
    if (insertErr || !inspection) throw insertErr ?? new Error('inspection 생성 실패')

    await supabase
      .from('inspection_plan_items')
      .update({ inspection_id: inspection.id, status: 'confirmed' })
      .eq('id', plan_item_id as string)

    return json(req, { inspection_id: inspection.id })
  } catch (err) {
    console.error('[create-inspection]', err)
    return json(req, { error: '점검 생성에 실패했습니다.' }, 500)
  }
})
