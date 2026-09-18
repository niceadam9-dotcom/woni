/** 통합 실측 프로브가 남긴 오염을 되돌린다 (2026-09-18 긴급)
 *  `_probe-today-live`가 500을 만나 process.exit로 죽으며 finally(원상복구)를 건너뛰었다.
 *  실행: npx tsx scripts/_probe-restore-live.mts [--apply] */
import { raw } from './_e2e-helpers.mjs'

const APPLY = process.argv.includes('--apply')
const { data: cust } = await raw.from('customers').select('id, customer_name').eq('is_active', true).limit(1).single()
const customerId = (cust as { id: string }).id
const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
const s = (data?.sections ?? {}) as Record<string, unknown>

const json = JSON.stringify(s)
console.log(`고객: ${(cust as { customer_name: string }).customer_name} (${customerId})`)
console.log(`마커 __LIVE_ 포함: ${json.includes('__LIVE_') ? '🚨 있다(오염됨)' : '없다'}`)
for (const k of ['training', 'hazards', 'fireHistory']) {
  console.log(`  ${k} = ${JSON.stringify(s[k] ?? null)?.slice(0, 160)}`)
}

if (APPLY) {
  // 프로브가 덮은 세 키를 **지운다** — 원래 값을 모르므로 「미입력」으로 되돌린다.
  //   (이 고객은 1.14.1 프로브 때도 해당 축이 비어 있었다 — promoPlan '(없음)' 실측)
  const next = { ...s }
  delete next.training
  delete next.hazards
  delete next.fireHistory
  const { error } = await raw.from('fire_plan_forms').update({ sections: next }).eq('customer_id', customerId)
  console.log(error ? `🚨 복구 실패: ${error.message}` : '✅ 세 키 제거 완료')
  const { data: after } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle()
  console.log(`확인: __LIVE_ ${JSON.stringify(after?.sections ?? {}).includes('__LIVE_') ? '🚨 남아 있다' : '없다'}`)
} else {
  console.log('\n(읽기 전용 — 되돌리려면 --apply)')
}
