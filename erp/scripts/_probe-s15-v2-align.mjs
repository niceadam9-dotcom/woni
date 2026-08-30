// §15 V-2 배선 선행 — 현2의 라벨(B열)과 내용(C열)이 행으로 맞는지. 병합 범위로 판정한다.
// 왜: 덤프에서 B44=분말 인데 C44는 할론 약제 목록으로 보였다. 라벨-내용이 어긋난 채로 배선하면
// 남의 설비 값을 엉뚱한 칸에 찍는다(C-1과 같은 부류). 배선 전에 반드시 풀 것.
import { readFileSync } from 'fs'
import JSZip from 'jszip'

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync('templates/report-workbook-full.xlsx')))
const wbx = await zip.file('xl/workbook.xml').async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const tgt = new Map()
for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
const partOf = new Map()
for (const m of wbx.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = tgt.get(m[2]); if (t) partOf.set(m[1], `xl/${t.replace(/^\/?xl\//, '')}`)
}
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, ' ').replace(/&amp;/g, '&')
const sstXml = await zip.file('xl/sharedStrings.xml').async('string')
const SST = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unesc(x[1])).join(''))

for (const sheet of ['현2', '현3']) {
  const x = await zip.file(partOf.get(sheet)).async('string')
  const merges = [...x.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1])
  const val = new Map()
  for (const c of x.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const inline = [...c[3].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('')
    let t = inline
    if (!t && /\bt="s"/.test(c[2])) { const i = /<v>(\d+)<\/v>/.exec(c[3]); if (i) t = SST[Number(i[1])] ?? '' }
    if (t.trim()) val.set(c[1], t.trim())
  }
  // B열 라벨이 세로 병합으로 몇 행을 덮는지 → 그 구간의 C열이 그 라벨의 내용이다
  const bMerge = merges.filter(r => /^B\d+:B\d+$/.test(r))
    .map(r => { const m = /^B(\d+):B(\d+)$/.exec(r); return { from: +m[1], to: +m[2] } })
    .sort((a, b) => a.from - b.from)
  console.log(`\n══ ${sheet} — B열 세로 병합 ${bMerge.length}구간 (라벨이 덮는 행 범위) ══`)
  for (const g of bMerge) {
    const label = val.get(`B${g.from}`) ?? '(라벨 없음)'
    const cs = []
    for (let r = g.from; r <= g.to; r++) if (val.has(`C${r}`)) cs.push(`C${r}`)
    console.log(`  B${g.from}:B${g.to}  「${label}」  → 내용칸 ${cs.join(',') || '(없음)'}`)
    for (const c of cs) console.log(`        ${c} ${val.get(c).slice(0, 84)}`)
  }
  const solo = [...val.keys()].filter(k => /^B\d+$/.test(k) && !bMerge.some(g => +k.slice(1) >= g.from && +k.slice(1) <= g.to))
  if (solo.length) {
    console.log(`  [병합 안 된 B열 라벨 ${solo.length}개 — C{같은행}이 그 라벨의 내용인가?]`)
    for (const b of solo.sort((a, b) => +a.slice(1) - +b.slice(1))) {
      const r = b.slice(1)
      console.log(`     ${b} 「${val.get(b)}」 → C${r} ${(val.get('C' + r) ?? '(없음)').slice(0, 84)}`)
    }
  }
}
