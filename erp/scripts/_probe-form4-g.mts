/** 현황 G/AC 열 등 '판정 마크를 산출하는 수식' 전수 — 형태별 실측(JSZip 축) */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { sheetFileMap } from '../src/lib/xlsx-inject.ts'

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(process.argv[2] ?? 'templates/report-workbook.xlsx')))
const files = await sheetFileMap(zip)
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const byShape = new Map<string, string[]>()
let total = 0
for (const [sheet, path] of files) {
  const xml = await zip.file(path)!.async('string')
  // ⚠ 자기닫힘(<c …/>)을 반드시 함께 받는다 — 안 받으면 [^>]*가 '/'까지 삼켜 다음 셀의 수식이
  //   **앞 빈 셀 좌표로 귀속**된다(xlsx-inject.ts:86 경고와 같은 부류. 실제로 S7이 G7로 나왔다)
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const raw = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2] ?? '')?.[1]
    if (!raw) continue
    if (!/&quot;[○×X\/／]&quot;|"[○×X\/／]"/.test(raw)) continue
    const f = unesc(raw)
    const shape = f.replace(/[A-Z]{1,3}\d{1,5}/g, '#')
    const arr = byShape.get(shape) ?? []
    arr.push(`${sheet}!${m[1]}`)
    byShape.set(shape, arr)
    total++
  }
}
console.log(`판정 마크 산출 수식 총 ${total}칸 · 형태 ${byShape.size}종`)
for (const [shape, cells] of byShape) {
  console.log(`\n[${cells.length}칸] ${shape}`)
  console.log(`   ${cells.slice(0, 10).join(', ')}${cells.length > 10 ? ' …' : ''}`)
}
