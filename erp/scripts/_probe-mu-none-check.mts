/** 별지 9호 2쪽 '다중이용업소현황 → 해당없음' 체크 판정 실측. 읽기 전용(DB 기록 없음).
 *
 *  판정식이 세 곳에서 서로 다르다:
 *   A 별지 9호 2쪽   report9-actions.ts:563  muSection ? applicable === false : false
 *   B 별지 9·4호 MU  mu-std32-map.ts:57      !applicable            (섹션 부재도 비대상)
 *   C 소방계획서 1.10 fire-plan-template.ts    !!mu && !applicable    (섹션 있고 토글 미선택도 해당없음)
 *  → 같은 sections.multiUse를 놓고 A만 '섹션 부재'와 '토글 미선택'을 해당없음으로 안 본다.
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-mu-none-check.mts */
import { readFileSync } from 'node:fs'
import path from 'node:path'

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const adminMod = await import('../src/lib/supabase/admin.ts') as Record<string, unknown>
const createAdminClient = ((adminMod.default ?? adminMod) as typeof import('../src/lib/supabase/admin.ts')).createAdminClient
const admin = createAdminClient()

// 한글 술어는 조용히 0건을 주므로 ASCII 축으로만 조회한다
const { data, error } = await admin.from('fire_plan_forms').select('customer_id, sections')
if (error) { console.error(error.message); process.exit(1) }
const rows = (data ?? []) as Array<{ customer_id: string; sections: Record<string, unknown> | null }>

type Bucket = 'no_section' | 'applicable_undefined' | 'applicable_false' | 'applicable_true'
const buckets: Record<Bucket, string[]> = {
  no_section: [], applicable_undefined: [], applicable_false: [], applicable_true: [],
}
for (const r of rows) {
  const mu = (r.sections ?? {})['multiUse'] as { applicable?: boolean } | null | undefined
  if (!mu) buckets.no_section.push(r.customer_id)
  else if (mu.applicable === true) buckets.applicable_true.push(r.customer_id)
  else if (mu.applicable === false) buckets.applicable_false.push(r.customer_id)
  else buckets.applicable_undefined.push(r.customer_id)
}

// 세 판정식을 그대로 재현
const verdictA = (b: Bucket) => b === 'applicable_false'                       // 별지 9호 2쪽
const verdictB = (b: Bucket) => b !== 'applicable_true'                        // MU 16칸 → 전부 /
const verdictC = (b: Bucket) => b === 'applicable_false' || b === 'applicable_undefined' // 소방계획서

console.log(`fire_plan_forms ${rows.length}건\n`)
console.log('구분                     건수  9호2쪽 해당없음  MU16칸 전부/  소방계획서 해당없음  모순')
for (const b of Object.keys(buckets) as Bucket[]) {
  const n = buckets[b].length
  const a = verdictA(b), c = verdictB(b), d = verdictC(b)
  const clash = a !== c || a !== d
  console.log(
    `${b.padEnd(22)} ${String(n).padStart(5)}  ${(a ? 'YES' : 'no ').padStart(13)}  `
    + `${(c ? 'YES' : 'no ').padStart(11)}  ${(d ? 'YES' : 'no ').padStart(17)}  ${clash ? '<-- 어긋남' : ''}`)
}

const affected = buckets.no_section.length + buckets.applicable_undefined.length
console.log(`\n영향 건수 — 2쪽은 공란인데 3쪽은 '비대상(/)'으로 인쇄되는 고객: ${affected}건 / ${rows.length}건`)
if (affected) {
  const ids = [...buckets.no_section, ...buckets.applicable_undefined].slice(0, 5)
  const { data: names } = await admin.from('customers').select('id, customer_name').in('id', ids)
  console.log('예시:', ((names ?? []) as Array<{ customer_name: string }>).map(n => n.customer_name).join(', '))
}
