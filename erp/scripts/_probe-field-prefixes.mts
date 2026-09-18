/** 앵커 필드 접두 인벤토리 — CellOrigin 규칙표의 재료 (2026-09-18, 4단계)
 *  실행: npx tsx --conditions=react-server scripts/_probe-field-prefixes.mts */
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'

const bySheet = new Map<string, Map<string, number>>()
for (const a of FIRE_PLAN_ANCHORS) {
  const prefix = a.field.replace(/_\d+.*$|_m\d+$/, '').replace(/\d+_.*$/, m => m.split('_')[0])
  const p = a.field.match(/^([a-z]+\d*(?:_[a-z]+)?)/)?.[1] ?? a.field
  const m = bySheet.get(a.sheet) ?? new Map()
  m.set(p, (m.get(p) ?? 0) + 1)
  bySheet.set(a.sheet, m)
  void prefix
}
for (const [sheet, prefixes] of bySheet) {
  console.log(`${sheet}: ${[...prefixes.entries()].map(([p, n]) => `${p}×${n}`).join(' ')}`)
}
console.log(`\n총 앵커 ${FIRE_PLAN_ANCHORS.length}`)
