/** 공휴일 적재 범위가 6단계 마감일 계산을 덮는가 (소방계획서_25 후속) — 읽기 전용.
 *  실행: npx tsx scripts/_probe-holiday-horizon.mts [--prod]
 *
 *  왜: 점검 6단계는 시작일에서 약 2개월 뒤까지 뻗는다. 연말 점검은 **다음 해 공휴일**이
 *  있어야 마감일이 맞는데, 그 해 공휴일이 아직 적재되지 않았으면 공휴일을 못 건너뛰어
 *  마감일이 실제보다 **앞당겨진다**(과소 계산). 적재 범위와 계산 범위의 간극을 본다.
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { previewInspectionSteps } from '../src/lib/step-dates'

const useProd = process.argv.includes('--prod')
config({ path: useProd ? '.env.local.prod-backup' : '.env.local', quiet: true })
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})
console.log(`대상: ${useProd ? '운영' : '스테이징'}\n`)

const { data } = await admin.from('holidays').select('date').order('date')
const rows = (data ?? []) as Array<{ date: string }>
const hs = new Set(rows.map(r => r.date))
const maxDate = rows[rows.length - 1]?.date ?? '(없음)'
console.log(`적재 범위: ${rows[0]?.date ?? '(없음)'} ~ ${maxDate} (${rows.length}건)`)

const lastYear = Number(maxDate.slice(0, 4))
console.log(`\n${lastYear}년 하반기 점검의 6단계 마감일이 어디까지 가는가:`)
for (const md of ['10-15', '11-15', '12-01', '12-20']) {
  const start = `${lastYear}-${md}`
  const steps = previewInspectionSteps({ startDate: start, endDate: null, useApprovalDate: null, holidays: hs })
  const last = steps[steps.length - 1].due_date
  const beyond = steps.filter(s => s.due_date > `${lastYear}-12-31`)
  const mark = beyond.length > 0 ? `  ⚠ 적재 범위 밖 ${beyond.length}단계 — ${beyond.map(b => `${b.name_ko} ${b.due_date}`).join(' / ')}` : ''
  console.log(`  점검 ${start} → ⑥ ${last}${mark}`)
}
// 마지막 적재 연도의 연말이 비는 것은 **없앨 수 없는 성질**이다 — 어디서 끊든 그 해 12월
// 점검은 다음 해로 넘어간다. 관건은 '지금'으로부터 얼마나 앞서 있느냐다.
const nowYear = new Date().getFullYear()
const runway = lastYear - nowYear
console.log(`\n※ 마지막 적재 연도(${lastYear})의 연말이 비는 것은 구조적 성질이다 — 어디서 끊어도 그 해 12월 점검은 다음 해로 넘어간다.`)
console.log(`  중요한 건 여유다: 현재 ${nowYear}년 기준 ${runway}년치가 앞서 있다.`)
console.log(runway >= 2
  ? `  ✅ 충분하다. ${lastYear}년 말 점검을 계산할 무렵이면 크론이 그 다음 해까지 채워 놓는다(올해·내년·내후년 3년 갱신).`
  : `  ⚠ 여유가 부족하다. 크론이 돌지 않는 상태라면 ${lastYear + 1}년을 수동 적재할 것 — npx tsx scripts/_sync-holidays-run.mts ${lastYear + 1} --prod`)
