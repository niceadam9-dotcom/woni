// V-2 선행 — 원천 현1의 G열 상세 줄(G16~G26)이 **빌드된 자산**에도 있는가.
// 원천에는 있는데 자산에 없다면 배선 대상 자체가 없는 것이고, 있다면 내 앞선 덤프가 놓친 것이다.
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-s15-v2-gcol.mjs
import { readFileSync } from 'fs'
import JSZip from 'jszip'
import XLSX from 'xlsx'

const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const ASSET = 'templates/report-workbook-full.xlsx'

// ── 원천
const sw = XLSX.read(readFileSync(SRC), { cellStyles: true }).Sheets['현1']
const sv = (ref) => { const c = sw[ref]; return c ? { v: String(c.v ?? '').replace(/\s+/g, ' ').trim(), f: c.f ?? null, t: c.t } : null }

// ── 자산(빌드 산출)
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(ASSET)))
const wbx = await zip.file('xl/workbook.xml').async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const tgt = new Map()
for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
let part = null
for (const m of wbx.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  if (m[1] === '현1') part = `xl/${tgt.get(m[2]).replace(/^\/?xl\//, '')}`
}
const x = await zip.file(part).async('string')
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const sst = [...(await zip.file('xl/sharedStrings.xml').async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(y => unesc(y[1])).join(''))
const cellXml = new Map()
for (const c of x.matchAll(/<c r="([A-Z]+\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) cellXml.set(c[1], { attrs: c[2], inner: c[3] ?? '' })
const av = (ref) => {
  const c = cellXml.get(ref)
  if (!c) return null
  const inline = [...c.inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('')
  let text = inline
  if (!text && /\bt="s"/.test(c.attrs)) { const i = /<v>(\d+)<\/v>/.exec(c.inner); if (i) text = sst[Number(i[1])] ?? '' }
  const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(c.inner)
  return { text, formula: f ? unesc(f[1]) : null, raw: c.inner.slice(0, 60) }
}

console.log('ref    | 원천                                             | 자산')
console.log('-------+--------------------------------------------------+---------------------------')
for (const r of [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]) {
  for (const col of ['B', 'G']) {
    const ref = `${col}${r}`
    const s = sv(ref), a = av(ref)
    if (!s && !a) continue
    const sTxt = s ? (s.f ? `=${s.f}` : s.v).slice(0, 48) : '(없음)'
    const aTxt = a ? (a.formula ? `=${a.formula}` : (a.text || '(빈 셀)')).slice(0, 40) : '(셀 자체 없음)'
    console.log(`${ref.padEnd(6)} | ${sTxt.padEnd(48)} | ${aTxt}`)
  }
}
console.log('\n※ 원천에 글자가 있는데 자산이 "빈 셀"이면 빌드가 비운 것이고, "셀 자체 없음"이면 이식에서 빠진 것이다.')
