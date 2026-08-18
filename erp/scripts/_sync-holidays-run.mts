/** 공휴일 동기화 실행 (소방계획서_25 S-8-2)
 *  실행: npx tsx scripts/_sync-holidays-run.mts 2025 2026 2027 [--prod]
 *
 *  크론·관리 화면과 **같은 함수**(syncHolidaysForYear)를 쓴다 — 별도 경로가 아니다.
 *  운영 대상이면 --prod. 결과(보존·정리 목록)를 그대로 출력해 무엇이 바뀌었는지 남긴다.
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { syncHolidaysForYear } from '../src/lib/holiday-sync'

const useProd = process.argv.includes('--prod')
const years = process.argv.slice(2).filter(a => /^\d{4}$/.test(a)).map(Number)
if (years.length === 0) { console.error('연도를 지정하세요 — 예: 2025 2026 2027'); process.exit(1) }

config({ path: useProd ? '.env.local.prod-backup' : '.env.local', quiet: true })
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
}) as unknown as Parameters<typeof syncHolidaysForYear>[0]

console.log(`대상 DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL} (${useProd ? '운영' : '스테이징'})`)
console.log(`대상 연도: ${years.join(', ')}\n`)

let failed = 0
for (const year of years) {
  const r = await syncHolidaysForYear(admin, year)
  if (r.error) { failed++; console.log(`❌ ${year}: ${r.error}`); continue }
  console.log(`✅ ${year}: ${r.upserted}건 반영 (${r.source})`)
  if (r.note) console.log(`   ⚠ ${r.note}`)
  if (r.skippedManual.length) console.log(`   수동 등록 보존: ${r.skippedManual.join(' ')}`)
  if (r.removedStale.length) console.log(`   자동 생성분 정리: ${r.removedStale.join(' ')}`)
}

const raw = admin as unknown as ReturnType<typeof createClient>
const { data } = await raw.from('holidays').select('date, name, source').order('date')
const rows = (data ?? []) as Array<{ date: string; name: string; source: string }>
const byYear = new Map<number, number>()
for (const r of rows) byYear.set(Number(r.date.slice(0, 4)), (byYear.get(Number(r.date.slice(0, 4))) ?? 0) + 1)
console.log('\n연도별 최종 건수:')
for (const [y, n] of [...byYear.entries()].sort()) console.log(`  ${y}: ${n}건`)

process.exit(failed > 0 ? 1 : 0)
