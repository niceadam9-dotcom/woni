/** 공휴일 교정 결과 검증 (소방계획서_25 S-8) — 읽기 전용.
 *  실행: npx tsx scripts/_probe-holiday-verify.mts [--prod]
 *  DB에 저장된 값을 **특일정보 API 확정본과 직접 대조**한다(코드가 아니라 결과를 본다).
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { fetchHolidaysFromOpenApi } from '../src/lib/holidays'

const useProd = process.argv.includes('--prod')
config({ path: useProd ? '.env.local.prod-backup' : '.env.local', quiet: true })
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})
console.log(`대상: ${useProd ? '운영' : '스테이징'} ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`)

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }

const { data } = await admin.from('holidays').select('date, name, source').order('date')
const rows = (data ?? []) as Array<{ date: string; name: string; source: string }>
const years = [...new Set(rows.map(r => Number(r.date.slice(0, 4))))].sort()

for (const year of years) {
  const api = await fetchHolidaysFromOpenApi(year)
  if (!api.ok) { console.log(`  ⏭ ${year} API 조회 불가 — 건너뜀`); continue }
  const want = new Set(api.holidays.map(h => h.date))
  const gotAuto = new Set(rows.filter(r => r.date.startsWith(String(year)) && r.source !== 'manual').map(r => r.date))
  const extra = [...gotAuto].filter(d => !want.has(d)).sort()
  const missing = [...want].filter(d => !gotAuto.has(d)).sort()
  check(`${year} DB가 API 확정본과 일치 (자동분 ${gotAuto.size}건)`,
    extra.length === 0 && missing.length === 0,
    `과다 ${extra.join(' ')} / 누락 ${missing.join(' ')}`)
}

// 이번 차수가 고치려던 개별 건
const set = new Set(rows.map(r => r.date))
check('2026-06-03 지방선거일 있음', set.has('2026-06-03'), '없음')
check('2026-05-01 노동절 있음', set.has('2026-05-01'), '없음')
check('2026-06-08 현충일 대체 없음', !set.has('2026-06-08'), '남아 있음')
check('2026-09-28 추석 대체 없음', !set.has('2026-09-28'), '남아 있음')
check('2025-05-06 대체공휴일 있음', set.has('2025-05-06'), '없음')
check('2025-01-27 임시공휴일 있음', set.has('2025-01-27'), '없음')
check('2027-05-03 노동절 대체 있음', set.has('2027-05-03'), '없음')

const bad = rows.filter(r => !['api', 'library', 'manual'].includes(r.source))
check('source 값이 전부 유효', bad.length === 0, bad.map(r => `${r.date}=${r.source}`).join(' '))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
