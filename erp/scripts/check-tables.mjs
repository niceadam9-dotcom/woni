import { createClient } from '@supabase/supabase-js'

import { SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY } from './_env.mjs'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
})

// information_schema로 테이블 존재 여부 확인
const res = await fetch(
  `${SUPABASE_URL}/rest/v1/rpc/version`,
  { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
)

// 직접 SQL로 테이블 목록 확인
const sqlRes = await fetch(
  `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
  {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    })
  }
)

console.log('SQL exec status:', sqlRes.status)

// profiles는 접근 가능한지 확인
const { data, error } = await supabase.from('profiles').select('id').limit(1)
console.log('profiles 접근:', error ? `오류 - ${error.message}` : `성공 (${data?.length}개)`)

// customers 직접 접근
const { data: c, error: ce } = await supabase.from('customers').select('id').limit(1)
console.log('customers 접근:', ce ? `오류 - ${ce.message}` : `성공 (${c?.length}개)`)
