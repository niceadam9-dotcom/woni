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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // JWT 검증
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
      inspection_id,
      defect_code,
      defect_name,
      defect_detail,
      severity,
      photo_url,
    } = await req.json()

    if (!inspection_id || !defect_name) {
      return new Response(JSON.stringify({ error: 'inspection_id와 defect_name은 필수입니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: defect, error: insertErr } = await supabase
      .from('inspection_defects')
      .insert({
        inspection_id,
        defect_code: defect_code ?? null,
        defect_name,
        defect_detail: defect_detail ?? null,
        severity: severity ?? '보통',
        photo_url: photo_url ?? null,
      })
      .select('id')
      .single()

    if (insertErr || !defect) {
      throw insertErr ?? new Error('불량 등록 실패')
    }

    return new Response(
      JSON.stringify({ defect_id: defect.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[add-defect]', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
