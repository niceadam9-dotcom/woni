/** zones의 `zone` 값 모양 실측 — 「동」이 섞여 있나 (2026-09-18)
 *  1.2.1 A열(동)·3.3 A열(동)이 미배선인데, 3.5의 `splitAreaDongFloor` 전례처럼
 *  쪼갤 수 있는지 **실데이터로** 본다(추측 금지).
 *  실행: npx tsx scripts/_probe-zone-shape.mts */
import { raw } from './_e2e-helpers.mjs'
import { splitAreaDongFloor } from '../src/lib/fire-plan-xlsx-values.ts'

const { data } = await raw.from('fire_plan_forms').select('customer_id, sections')
const rows = (data ?? []) as Array<{ customer_id: string; sections: Record<string, unknown> }>
let total = 0, splittable = 0
const samples: string[] = []
for (const r of rows) {
  const zs = r.sections?.zones as Array<Record<string, string>> | undefined
  if (!Array.isArray(zs)) continue
  for (const z of zs) {
    const v = (z?.zone ?? '').trim()
    if (!v) continue
    total++
    const sp = splitAreaDongFloor(v)
    /* 🚨 쪼개지는 것만으로는 부족하다 — **동이 실제로 있어야** A열을 채울 근거가 된다.
     *   첫 판본은 `if (sp)`만 봐서 `동=''`인 값을 「쪼개진다」로 세고 잘못된 결론을 냈다. */
    if (sp && sp.dong.trim()) splittable++
    if (samples.length < 12) samples.push(`${JSON.stringify(v)}${sp ? ` → 동='${sp.dong}' 층='${sp.floor}'` : ' → (못 쪼갬)'}`)
  }
}
console.log(`zone 값 ${total}건 · **동이 실제로 있는 것** ${splittable}건 (${total ? (splittable / total * 100).toFixed(0) : 0}%)`)
for (const s of samples) console.log(`  ${s}`)
console.log(total === 0
  ? '\n⚠ 표본이 0 — 스테이징에 구역 데이터가 없다(판단 근거 없음)'
  : splittable === 0
    ? '\n✅ 하나도 안 쪼개진다 — A열(동)은 채울 근거가 없다(기존 판단 유지)'
    : '\n🎯 쪼개지는 값이 있다 — A열 배선을 검토할 수 있다')
