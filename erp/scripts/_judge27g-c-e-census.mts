/** 판정자 C — 마지막 축: 마크가 아닌 표본 값. 정보·다수동일때 **전 칸**을 덤프해
 *  앵커·라벨이 아닌 칸에 숫자·날짜·이름 같은 표본 데이터가 남아 있는지 눈으로 본다.
 *  (마크 덮개는 정의상 마크만 본다 — 숫자 칸은 그 축 밖이다) */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS } from '../src/lib/xlsx-anchors.ts'

const unesc = (s: string) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync('templates/report-workbook-full.xlsx')))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rels = new Map<string, string>()
for (const m of relXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g))
  rels.set(m[1], 'xl/' + m[2].replace(/^\/?xl\//, '').replace(/^\.\//, ''))
const sstXml = await zip.file('xl/sharedStrings.xml')!.async('string')
const si: string[] = []
for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
  let t = ''; for (const tm of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += unesc(tm[1]); si.push(t)
}
const OUT: string[] = []
for (const target of ['정보', '다수동일때']) {
  let path = ''
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/>/g))
    if (unesc(/name="([^"]*)"/.exec(m[1])?.[1] ?? '') === target) path = rels.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '') ?? ''
  const xml = await zip.file(path)!.async('string')
  const anch = new Set(ANCHORS.filter(a => a.sheet === target).map(a => a.cell))
  const lab = new Set(ANCHORS.filter(a => a.sheet === target).map(a => a.labelCell))
  OUT.push(`\n## ${target} — 값 보유 칸 전수(앵커 ${anch.size} · 라벨 ${lab.size})`)
  for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = c[1], b = c[2] ?? '', ref = /r="([A-Z]+\d+)"/.exec(a)?.[1] ?? '?'
    const t = /t="([^"]+)"/.exec(a)?.[1] ?? 'n'
    let text = ''
    if (t === 's') { const i = Number(/<v>([\s\S]*?)<\/v>/.exec(b)?.[1] ?? '-1'); if (i >= 0) text = si[i] ?? '' }
    else if (t === 'inlineStr') { for (const tm of b.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += unesc(tm[1]) }
    else text = unesc(/<v>([\s\S]*?)<\/v>/.exec(b)?.[1] ?? '')
    if (text === '') continue
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(b)?.[1]
    const kind = anch.has(ref) ? '앵커' : lab.has(ref) ? '라벨' : f ? `수식(${f.slice(0, 28)})` : '리터럴'
    if (kind === '앵커' || kind === '라벨') continue
    OUT.push(`  ${target}!${ref} [${kind}] ${JSON.stringify(text.slice(0, 80))}`)
  }
}
writeFileSync('scripts/_judge27g-c-e-census.txt', OUT.join('\n'), 'utf8')
console.log('written')
