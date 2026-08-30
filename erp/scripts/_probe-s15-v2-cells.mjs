// §15 V-2 배선 대상 실물 덤프 — 현1~현4의 글자 있는 칸 전량(좌표+원문).
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-s15-v2-cells.mjs > ../_v2-cells.txt
import { readFileSync } from 'fs'
import JSZip from 'jszip'

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync('templates/report-workbook-full.xlsx')))
const wb = await zip.file('xl/workbook.xml').async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const target = new Map()
for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target.set(m[1], m[2])
const partOf = new Map()
for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = target.get(m[2]); if (t) partOf.set(m[1], `xl/${t.replace(/^\/?xl\//, '')}`)
}
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, ' ⏎ ').replace(/&amp;/g, '&')
const sstXml = await zip.file('xl/sharedStrings.xml').async('string')
const SST = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unesc(x[1])).join(''))

const key = (r) => { const m = /^([A-Z]+)(\d+)$/.exec(r); return [Number(m[2]), m[1].padStart(3)] }

for (const s of ['현1', '현2', '현3', '현4']) {
  const x = await zip.file(partOf.get(s)).async('string')
  const rows = []
  for (const c of x.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const inline = [...c[3].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('')
    let t = inline
    if (!t && /\bt="s"/.test(c[2])) {
      const i = /<v>(\d+)<\/v>/.exec(c[3]); if (i) t = SST[Number(i[1])] ?? ''
    }
    if (t.trim()) rows.push({ ref: c[1], t: t.trim() })
  }
  rows.sort((a, b) => { const [ra, ca] = key(a.ref), [rb, cb] = key(b.ref); return ra - rb || ca.localeCompare(cb) })
  console.log(`\n══════ ${s} (글자칸 ${rows.length}) ══════`)
  for (const r of rows) {
    const isInput = /\[\s*\]|\(\s{2,}\)|\(\s*\)/.test(r.t)
    console.log(`${isInput ? '▶' : ' '} ${r.ref.padEnd(5)} ${r.t}`)
  }
}
