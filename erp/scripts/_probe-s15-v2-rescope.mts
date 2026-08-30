/* V-2 규모 **재**측정 — 검증된 리더로 다시 센다.
 *
 * ⚠앞선 측정(_probe-s15-v2-scope.mjs·_probe-s15-v2-cells.mjs·_probe-s15-v2-gcol.mjs)은 전부
 *   내가 새로 짠 정규식 `<c r="..."([^>]*)>` 를 썼는데, **탐욕 `[^>]*`가 자기닫힘 셀의 `/`를 먹어**
 *   뒤 셀들을 통째로 삼켰다. 그래서 현1 G열이 '셀 자체 없음'으로 보였다 — 실제로는 다 있다.
 *   이 저장소는 그 함정을 `xlsx-donor-itemmap-extract.ts:66-70`에 주석으로 못박아 뒀고
 *   `readCells`가 (a)속성 순서 무관 (b)자기닫힘 수용 (c)3형 전부를 지킨다. **새로 짜지 말고 그것을 쓴다.**
 *
 * 실행: cd F:\AI\ERP\erp; npx tsx scripts/_probe-s15-v2-rescope.mts
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { readCells } from '../src/lib/xlsx-donor-itemmap-extract.ts'

const ASSET = 'templates/report-workbook-full.xlsx'
const SHEETS = ['현1', '현2', '현3', '현4', '현5', '세1', '세2', '세3', '세4', '세5']

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(ASSET)))
const wbx = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const tgt = new Map<string, string>()
for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
const partOf = new Map<string, string>()
for (const m of wbx.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = tgt.get(m[2]); if (t) partOf.set(m[1], `xl/${t.replace(/^\/?xl\//, '')}`)
}
const sf = zip.file('xl/sharedStrings.xml')
const sst = sf ? [...(await sf.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')) : []
console.log(`sharedStrings ${sst.length}건\n`)

/** 사용자가 손으로 채우는 자리 — 체크칸 [ ] 또는 괄호칸 ( ) */
const INPUT = /\[\s*\]|\(\s+\)|\(\s*\)/
let grand = 0
const perSheet: Array<{ s: string; cells: number; text: number; input: number }> = []
for (const s of SHEETS) {
  const p = partOf.get(s)
  if (!p) { console.log(`${s}: 시트 없음`); continue }
  const { val, refs } = readCells(await zip.file(p)!.async('string'), sst)
  let text = 0, input = 0
  const samples: string[] = []
  for (const [ref, v] of val) {
    if (!v.trim()) continue
    text++
    if (INPUT.test(v)) { input++; if (samples.length < 2) samples.push(`${ref}=${v.slice(0, 56)}`) }
  }
  grand += input
  perSheet.push({ s, cells: refs.size, text, input })
  console.log(`${s.padEnd(4)} 셀 ${String(refs.size).padStart(4)} · 글자 ${String(text).padStart(3)} · 입력자리 ${String(input).padStart(3)}`)
  for (const x of samples) console.log(`        ${x}`)
}
console.log(`\n입력 자리 총 ${grand}칸`)
console.log('\n[종전 측정과 대조] 잘못된 정규식으로 잰 값: 현1:3 현2:13 현3:19 현4:1 세1:1 세2~5:0 (합 37)')
for (const r of perSheet) console.log(`   ${r.s.padEnd(4)} 재측정 ${r.input}`)
