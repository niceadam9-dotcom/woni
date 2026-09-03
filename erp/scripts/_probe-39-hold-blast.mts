/** 39 S3-3 — 완료 보류 blast-radius 실측 (가드 영향 범위 규칙: 켠 직후 막히는 건수를 세라).
 *  진행중·예정 자체점검 회차 중 '설치 시트에 범위 내 무응답 항목'이 남은 건수 = 보류에 걸릴 건수.
 *  이미 completed인 건은 소급하지 않으므로(설계) 제외 — 참고로 따로 센다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-39-hold-blast.mts */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { countInstalledRequiredBlanks } from '../src/lib/sheet-overview.ts'

const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2]
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!) as never

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
