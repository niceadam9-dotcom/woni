// §15 V-2 규모 측정 — 세부제원 8시트에 앵커를 배선한다면 몇 칸이고, PDF는 그 값을 어디서 찍는가.
// 결정(배선 vs 의도 확정) 어느 쪽이든 필요한 수치다. 읽기 전용.
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-s15-v2-scope.mjs
import { readFileSync } from 'fs'
import JSZip from 'jszip'

const ASSET = 'templates/report-workbook-full.xlsx'
const SHEETS = ['현1', '현2', '현3', '현4', '현5', '세1', '세2', '세3', '세4', '세5']

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(ASSET)))
const wb = await zip.file('xl/workbook.xml').async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const target = new Map()
for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target.set(m[1], m[2])
const partOf = new Map()
for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = target.get(m[2]); if (t) partOf.set(m[1], `xl/${t.replace(/^\/?xl\//, '')}`)
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, ' ').replace(/&amp;/g, '&')

// ⚠ 셀 텍스트는 3형이다 — inlineStr(<is><t>) · sharedStrings 참조(t="s" + <v>idx</v>) · 그냥 <v>.
//   인라인만 읽으면 기반 시트 텍스트를 통째로 놓친다(내 첫 판이 그래서 세1~세5를 '0칸'이라 보고했다).
const sstXml = zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml').async('string') : ''
const SST = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unesc(x[1])).join(''))
console.log(`sharedStrings ${SST.length}건 적재\n`)

console.log('시트   셀수  글자있는칸  입력자리(괄호·대괄호 포함 칸)   표본')
for (const s of SHEETS) {
  const p = partOf.get(s)
  if (!p) { console.log(`${s.padEnd(5)} (시트 없음)`); continue }
  const x = await zip.file(p).async('string')
  const cells = [...x.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)]
  let withText = 0, inputs = 0
  const samples = []
  for (const c of cells) {
    const inline = [...c[3].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('')
    let t = inline
    if (!t && /\bt="s"/.test(c[2])) {
      const idx = /<v>(\d+)<\/v>/.exec(c[3])
      if (idx) t = SST[Number(idx[1])] ?? ''
    }
    if (!t.trim()) continue
    withText++
    // 사용자가 손으로 채우게 돼 있는 자리 — [  ] 체크칸이나 (    ) 괄호칸
    if (/\[\s*\]|\(\s{2,}\)|\(\s*\)/.test(t)) {
      inputs++
      if (samples.length < 1) samples.push(`${c[1]}=${t.slice(0, 58)}`)
    }
  }
  console.log(`${s.padEnd(5)} ${String(cells.length).padStart(5)} ${String(withText).padStart(10)} ${String(inputs).padStart(14)}   ${samples[0] ?? ''}`)
}

console.log('\n※ PDF 쪽 원천: src/lib/doc-templates/spec-sections.ts (customer_facility_specs를 읽어 인쇄)')
console.log('※ 엑셀 쪽: 이 8시트에 ANCHORS 0칸 — 값이 갈 자리가 코드에 정의돼 있지 않다')
