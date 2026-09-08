/** 새 워크북에 대해 **런타임과 같은 게이트**를 돌린다 — 라우트가 쓰는 `validateAnchors` 그대로.
 *  여기서 초록이 아니면 「엑셀 받기」가 500으로 끊긴다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const bytes = new Uint8Array(readFileSync(resolve(HERE, '../templates/fire-plan-workbook.xlsx')))
console.log(`앵커 ${FIRE_PLAN_ANCHORS.length}개 · 워크북 ${bytes.length}바이트`)

const r = validateAnchors(bytes, FIRE_PLAN_ANCHORS)
console.log(`\n판정: ${r.ok ? '✅ 통과' : `🚨 실패 ${r.failures.length}건`}`)
if (!r.ok) {
  for (const f of r.failures.slice(0, 25)) console.log('   ' + (typeof f === 'string' ? f : JSON.stringify(f)))
  process.exit(1)
}
