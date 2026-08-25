/** ④f 제거로 되살아나야 할 19칸이 실제로 값을 갖는가 (2026-08-25 실측 근거) */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { sheetFileMap } from '../src/lib/xlsx-inject.ts'

const CELLS = [
  '세3!C17', '세3!C18', '세3!C19', '세3!C21', '세4!E12', '세4!E13', '위임장!D2',
  '대상물!B10', '대상물!C11', '대상물!I17', '대상물!B32', '대상물!I32',
  '현1!C3', '현3!A8', '현3!A34', '세1!B5', '세1!C4', '세3!A17', '세4!A12',
]
/** ④f가 덮어 줘야 했던 8칸 — 이제 ④g·④g-b가 정확히 겨눈다. 기대 상태는 둘로 갈린다:
 *   · 현황 4칸(판정 원본)   → 판정 수식이 사라지고 `=""`만 남는다(캐시 없음)
 *   · 대상물 4칸(복제칸)     → **수식은 보존**하고 캐시만 비운다. 수식을 지우면 폐포 간선이
 *                              끊겨 런타임 주입이 닿지 않고, 그 칸은 영구 공란이 된다 */
const WAS_F_ONLY: Array<[ref: string, wantF: string]> = [
  ['현황!S7', '""'], ['현황!AO13', '""'], ['현황!S28', '""'], ['현황!AO28', '""'],
  ['대상물!G11', '현황!S7'], ['대상물!N17', '현황!AO13'],
  ['대상물!G32', '현황!S28'], ['대상물!N32', '현황!AO28'],
]

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(process.argv[2] ?? 'templates/report-workbook.xlsx')))
const files = await sheetFileMap(zip)
const cache = new Map<string, string>()
const read = async (sheet: string) => {
  if (!cache.has(sheet)) cache.set(sheet, await zip.file(files.get(sheet)!)!.async('string'))
  return cache.get(sheet)!
}
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const cellOf = async (ref: string) => {
  const [s, c] = ref.split('!')
  const xml = await read(s)
  const m = new RegExp(`<c r="${c}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(xml)
  const inner = m?.[1] ?? ''
  const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
  const is = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')
  const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]
  return { has: v !== undefined || /<is>/.test(inner), text: unesc(is || v || ''), f: f ? unesc(f) : null }
}

let dead = 0
console.log('[1] ④f가 과잉 삭제하던 19칸 — 값이 살아 있어야 한다')
for (const ref of CELLS) {
  const c = await cellOf(ref)
  if (!c.has) dead++
  console.log(`  ${c.has ? '✅' : '❌'} ${ref}\t${c.f ? `{${c.f}} ` : ''}${JSON.stringify(c.text.slice(0, 44))}`)
}
console.log(`  → 살아난 칸 ${CELLS.length - dead}/${CELLS.length}`)

let bad = 0
console.log('\n[2] ④f가 필요했던 8칸 — 원본은 =""·복제칸은 수식 보존, 양쪽 다 캐시 0')
for (const [ref, wantF] of WAS_F_ONLY) {
  const c = await cellOf(ref)
  const ok = c.f === wantF && !c.has
  if (!ok) bad++
  console.log(`  ${ok ? '✅' : '❌'} ${ref}\t{${c.f ?? '(수식없음)'}} 캐시=${c.has ? JSON.stringify(c.text.slice(0, 24)) : '없음'}  (기대 {${wantF}}·캐시없음)`)
}
process.exit(dead === 0 && bad === 0 ? 0 : 1)
