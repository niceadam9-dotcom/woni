// 현황 dv가 XML에 실제로 어떤 모양으로 들어 있는지 — ④c 정규식이 0건을 잡은 원인 규명.
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-dv-shape.mjs
import { readFileSync } from 'fs'
import JSZip from 'jszip'

const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wb = await zip.file('xl/workbook.xml').async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const target = new Map()
for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target.set(m[1], m[2])
const nameByPart = new Map()
for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = target.get(m[2]); if (t) nameByPart.set(`xl/${t.replace(/^\/?xl\//, '')}`, m[1])
}

const parts = Object.keys(zip.files).filter(p => /^xl\/worksheets\/[^/]+\.xml$/.test(p))
console.log(`워크시트 파트 ${parts.length}개`)

let total = 0
for (const p of parts) {
  const x = await zip.file(p).async('string')
  const name = nameByPart.get(p) ?? p
  const dvs = [...x.matchAll(/<dataValidation\b[\s\S]*?<\/dataValidation>|<dataValidation\b[^>]*\/>/g)]
  if (!dvs.length) continue
  total += dvs.length
  // 판정 어휘를 품은 것만 덤프
  const hit = dvs.filter(m => m[0].includes('○'))
  if (!hit.length) continue
  console.log(`\n── ${name} (${p}) — dv ${dvs.length}건, ○ 포함 ${hit.length}건`)
  for (const m of hit.slice(0, 2)) console.log(`   ${m[0].slice(0, 320).replace(/\n/g, ' ')}`)
}
console.log(`\ndv 총 ${total}건`)

// 내 ④c 정규식이 무엇을 잡는지 직접 대조
let mine = 0
for (const p of parts) {
  const x = await zip.file(p).async('string')
  mine += [...x.matchAll(/(<dataValidation\b[^>]*>[\s\S]*?<formula1>)"([^"]*)"(<\/formula1>)/g)].length
}
console.log(`④c 정규식이 잡는 건수: ${mine}`)
