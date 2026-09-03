/** 39 S3-3 — 완료 보류 blast-radius 실측 (가드 영향 범위 규칙: 켠 직후 막히는 건수를 세라).
 *  진행중·예정 자체점검 회차 중 '설치 시트에 범위 내 무응답 항목'이 남은 건수 = 보류에 걸릴 건수.
 *  이미 completed인 건은 소급하지 않으므로(설계) 제외 — 참고로 따로 센다.
 *
 *  ⚠ 이 프로브는 한 번 **거짓 0을 보고했다**(2026-09-02). .env.local을 지역 객체로만 읽고
 *  process.env에 넣지 않아, countInstalledRequiredBlanks 안의 getSheets()→createAdminClient()가
 *  `supabaseUrl is required`로 죽고 그 예외를 sheet-overview의 catch가 삼켜 전 건이 0이 됐다.
 *  → ① `_env.mjs`가 process.env를 채운다 ② **카탈로그 생존을 선행 단언**한다(공허 0 차단).
 *  테스트는 환경의 결핍에 기대면 안 된다(feedback_test_hermetic_env).
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-39-hold-blast.mts
 *  운영 측정: 셸에 NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY를 넣으면 _env.mjs가
 *  덮지 않으므로(:17) 그 대상 DB를 잰다. */
import './_env.mjs'
import { createClient } from '@supabase/supabase-js'
import { countInstalledRequiredBlanks } from '../src/lib/sheet-overview.ts'
import { getSheets, getAllSheetItems } from '../src/lib/sheet-catalog.ts'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as never

// ── 선행 단언: 카탈로그가 살아 있어야 '0건'이 의미를 갖는다 ──────────────────
const [sheets, items] = await Promise.all([getSheets(), getAllSheetItems()])
if (sheets.length === 0 || items.length === 0) {
  console.error(`!! 점검표 카탈로그가 비었다 (시트 ${sheets.length} / 항목 ${items.length})`
    + ' — 이 상태의 측정치는 전부 0이다. 측정 중단.')
  process.exit(1)
}
console.log(`카탈로그 생존 확인 — 시트 ${sheets.length}종 / 항목 ${items.length}행`)
console.log(`대상 DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const { data } = await (admin as ReturnType<typeof createClient>)
  .from('inspections')
  .select('id, status, plan_type, customer:customers(customer_name)')
  .in('status', ['in_progress', 'scheduled'])
const rows = (data ?? []) as unknown as Array<{
  id: string; status: string; plan_type: string | null
  customer: { customer_name: string } | null
}>
const special = rows.filter(r => !r.plan_type || r.plan_type.startsWith('special'))
console.log(`진행중·예정 회차 ${rows.length}건 중 자체점검 ${special.length}건 검사`)

let held = 0
const detail: string[] = []
for (const r of special) {
  const { required, comp } = await countInstalledRequiredBlanks(admin, r.id)
  if (required > 0) {
    held++
    detail.push(`  ${r.customer?.customer_name ?? '?'} (${r.status}) — 필수 미입력 ${required}건 (● ${comp})`)
  }
}
console.log(`\n보류에 걸릴 건수: ${held}/${special.length}`)
for (const d of detail.slice(0, 30)) console.log(d)
if (detail.length > 30) console.log(`  …외 ${detail.length - 30}건`)

// 참고 — 이미 completed인 자체점검 중 같은 조건(소급 안 하지만 규모 인지용)
const { data: doneData } = await (admin as ReturnType<typeof createClient>)
  .from('inspections').select('id, plan_type').eq('status', 'completed')
const doneSpecial = ((doneData ?? []) as Array<{ id: string; plan_type: string | null }>)
  .filter(r => !r.plan_type || r.plan_type.startsWith('special'))
let doneHeld = 0
for (const r of doneSpecial) {
  const { required } = await countInstalledRequiredBlanks(admin, r.id)
  if (required > 0) doneHeld++
}
console.log(`\n(참고) 완료된 자체점검 ${doneSpecial.length}건 중 미입력 잔존 ${doneHeld}건 — 소급하지 않음(설계)`)
