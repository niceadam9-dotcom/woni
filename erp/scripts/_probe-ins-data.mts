/** 화재보험 가입금액 기존 데이터 실측 — 단위 라벨을 천만원→만원으로 바꾸면 **기존 입력값의
 *  의미가 달라진다**. 몇 건이 영향을 받는지 먼저 센다([[feedback_guard_blast_radius]]).
 *  읽기 전용 SELECT만. data와 **error를 함께** 본다([[feedback_supabase_check_error]]). */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

// env 파일을 인자로 받는다 — 운영 진단 시 `npx tsx scripts/_probe-ins-data.mts .env.production`
const ENV_FILE = process.argv[2] || '.env.local'
for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(url, key, { auth: { persistSession: false } })

const out: string[] = [`### 대상 DB: ${url}`]
const { data, error } = await db.from('customers')
  .select('id, customer_name, insurance_joined, insurance_amount_person, insurance_amount_property')
  .order('id')
if (error) { out.push(`SELECT 실패: [${error.code}] ${error.message}`) }
else {
  const rows = data ?? []
  const has = (v: unknown) => String(v ?? '').trim() !== ''
  const withAmount = rows.filter(r => has(r.insurance_amount_person) || has(r.insurance_amount_property))
  out.push(`전체 고객 ${rows.length}건`)
  out.push(`가입금액 입력 있는 고객 **${withAmount.length}건**`)
  out.push(`insurance_joined=true ${rows.filter(r => r.insurance_joined === true).length}건`)
  for (const r of withAmount) {
    out.push(`  ${r.customer_name}  대인=${JSON.stringify(r.insurance_amount_person)} 대물=${JSON.stringify(r.insurance_amount_property)}`)
  }
}
writeFileSync('scripts/_probe-ins-data.txt', out.join('\n'), 'utf8')
console.log(out.slice(0, 4).join(' | '))
