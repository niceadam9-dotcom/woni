/** 템플릿 캐시 이득 실측 — 「요청마다 110ms를 태우고 있었다」는 **주장을 검증**한다.
 *
 *  주석에 수치를 적어 놓고 안 재면 그건 그냥 이야기다. 캐시 도입의 근거가 실제로 성립하는지
 *  같은 자로 두 번 잰다.
 *
 *  실행: npx tsx scripts/_probe-template-cache-perf.mts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { FIRE_PLAN_ANCHORS, FIRE_PLAN_IMAGE_ANCHORS } from '../src/lib/fire-plan-anchors.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

const ms = (f: () => void, n = 5) => {
  f()                                   // 예열 — 첫 회는 JIT·페이지캐시가 섞인다
  const t0 = performance.now()
  for (let i = 0; i < n; i++) f()
  return (performance.now() - t0) / n
}

let bytes!: Uint8Array
const tRead = ms(() => { bytes = new Uint8Array(readFileSync(PATH)) })
const tValue = ms(() => { validateAnchors(bytes, FIRE_PLAN_ANCHORS) })
const tImage = ms(() => { validateAnchors(bytes, FIRE_PLAN_IMAGE_ANCHORS) })

console.log(`템플릿 ${(bytes.byteLength / 1024 / 1024).toFixed(2)}MB · 앵커 ${FIRE_PLAN_ANCHORS.length} + 사진상자 ${FIRE_PLAN_IMAGE_ANCHORS.length}`)
console.log(`  readFile          ${tRead.toFixed(1)} ms`)
console.log(`  validateAnchors(값)   ${tValue.toFixed(1)} ms`)
console.log(`  validateAnchors(사진) ${tImage.toFixed(1)} ms`)
console.log(`  ── 요청마다 태우던 합계: ${(tRead + tValue + tImage).toFixed(1)} ms → 캐시 후 0 ms(2회차부터)`)
