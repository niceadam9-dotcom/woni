/** 판정자 D — 마지막 축: ①ANCHORS 192칸이 병합 비앵커가 아닌가 ②정보!J20 = 개요!D21 수식 실재
 *  ③현1~현5·세1~세5(세부제원 서식)가 산출물에 남는가 & 배선 0인가 */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { ANCHORS } from '../src/lib/xlsx-anchors.ts'
import { allDonorSheets } from '../src/lib/xlsx-donors.ts'

const OUT = path.resolve(process.cwd(), 'scripts/_out/_judgeD-D10b.txt')
const L: string[] = []
const say = (s: string) => L.push(s)

const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve(process.cwd(), 'templates/report-workbook-full.xlsx')))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rel = new Map<string, string>()
for (const m of relsXml.matchAll(/<Relationship\s([^>]*)\/>/g)) {
  const id = /Id="([^"]+)"/.exec(m[1])?.[1]; const t = /Target="([^"]+)"/.exec(m[1])?.[1]
  if (id && t) rel.set(id, t.replace(/^\/?xl\//, '').replace(/^\.\.\//, ''))
}
const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const files = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet\s([^>]*?)\/>/g))
  files.set(dec(/name="([^"]*)"/.exec(m[1])?.[1] ?? ''), 'xl/' + (rel.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '') ?? ''))

const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
const colName = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26 } return s }

const xmls = new Map<string, string>()
for (const [n, f] of files) { const z = zip.file(f); if (z) xmls.set(n, await z.async('string')) }

// ① 앵커 병합 비앵커 검사
const nonAnchorOf = new Map<string, Map<string, string>>()
for (const [n, x] of xmls) {
  const m2 = new Map<string, string>()
  for (const mm of x.matchAll(/<mergeCell[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const a = /^([A-Z]+)(\d+)$/.exec(mm[1])!, b = /^([A-Z]+)(\d+)$/.exec(mm[2])!
    for (let c = colNum(a[1]); c <= colNum(b[1]); c++) for (let r = +a[2]; r <= +b[2]; r++) {
      const ref = `${colName(c)}${r}`; if (ref !== mm[1]) m2.set(ref, mm[1])
    }
  }
  nonAnchorOf.set(n, m2)
}
const bad = ANCHORS.filter(a => nonAnchorOf.get(a.sheet)?.has(a.cell))
say(`ANCHORS ${ANCHORS.length} · 병합 비앵커 ${bad.length}`)
for (const a of bad) say(`  ${a.field} ${a.sheet}!${a.cell} -> anchor ${nonAnchorOf.get(a.sheet)!.get(a.cell)}`)

// ② 정보!J20 수식
const info = xmls.get('정보')!
say('')
for (const ref of ['J20', 'I20', 'K20', 'J21']) {
  const re = new RegExp(`<c[^>]*\\br="${ref}"[^>]*>([\\s\\S]*?)</c>`)
  const m = re.exec(info)
  say(`정보!${ref} = ${m ? dec(m[1]).replace(/\s+/g, ' ').slice(0, 200) : '(자기닫힘 또는 없음)'}`)
}
// 개요 D21 셀
const hub = xmls.get('개요')!
for (const ref of ['D21', 'C21']) {
  const m = new RegExp(`<c[^>]*\\br="${ref}"[^>]*(?:/>|>([\\s\\S]*?)</c>)`).exec(hub)
  say(`개요!${ref} = ${m ? dec(m[1] ?? '(empty self-closing)').replace(/\s+/g, ' ').slice(0, 200) : '없음'}`)
}
// 정보 시트에서 개요!D21을 참조하는 수식 전수
say('')
say('정보 시트에서 개요!D21 참조 수식:')
for (const m of info.matchAll(/<c[^>]*\br="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g)) {
  const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2])?.[1]
  if (f && /D21/.test(dec(f))) say(`  정보!${m[1]} f=${dec(f)} v=${/<v>([\s\S]*?)<\/v>/.exec(m[2])?.[1] ?? '(캐시없음)'}`)
}

// ③ 도너 시트 목록 vs 세부제원 시트
const donors = new Set(allDonorSheets())
say('')
say(`allDonorSheets ${donors.size}: ${[...donors].join(' ')}`)
const specSheets = ['현1', '현2', '현3', '현4', '현5', '세1', '세2', '세3', '세4', '세5', '대상물', '대상물2', '다수동']
say('세부제원류 시트 — 도너인가(제거 대상인가) / 앵커 수:')
for (const s of specSheets) {
  const n = ANCHORS.filter(a => a.sheet === s).length
  say(`  ${s}: donor=${donors.has(s)} anchors=${n} 존재=${files.has(s)}`)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, L.join('\n'), 'utf8')
console.log('wrote ' + OUT + ' lines=' + L.length)
