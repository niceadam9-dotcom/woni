import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      // SB_SERVICE_KEY(sb_secret, secrets set으로 등록) 우선 — legacy 키 비활성화 후에도 동작
      Deno.env.get('SB_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // JWT 검증 — 인증된 사용자만 허용
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: '인증 필요' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: '인증 실패' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const {
      plan_item_id,
      customer_id,
      assigned_employee_id,
      inspection_type,
      inspection_start_date,
      sequence_num,
    } = await req.json()

    if (!plan_item_id || !customer_id || !assigned_employee_id) {
      return new Response(
        JSON.stringify({ error: 'plan_item_id, customer_id, assigned_employee_id는 필수입니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 이미 해당 plan_item에 연결된 inspection이 있으면 반환
    const { data: existing } = await supabase
      .from('inspection_plan_items')
      .select('inspection_id')
      .eq('id', plan_item_id)
      .single()

    if (existing?.inspection_id) {
      return new Response(
        JSON.stringify({ inspection_id: existing.inspection_id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // inspection 생성 (service role → RLS 우회)
    const { data: inspection, error: insertErr } = await supabase
      .from('inspections')
      .insert({
        customer_id,
        assigned_employee_id,
        inspection_type,
        inspection_start_date,
        sequence_num: sequence_num ?? 1,
        status: 'in_progress',
        created_by: assigned_employee_id,
      })
      .select('id')
      .single()

    if (insertErr || !inspection) {
      throw insertErr ?? new Error('inspection 생성 실패')
    }

    // plan_item에 inspection_id 연결 및 status 업데이트
    await supabase
      .from('inspection_plan_items')
      .update({ inspection_id: inspection.id, status: 'confirmed' })
      .eq('id', plan_item_id)

    return new Response(
      JSON.stringify({ inspection_id: inspection.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[create-inspection]', err)
    const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
