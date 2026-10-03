// C5 2차 조사 — 두 워크북 템플릿의 자사 정보 리터럴 전수 + 운영 DB 값 대조 (읽기 전용)
// 실행: npx tsx scripts/_probe-c5-company-cells.mts
import { readFileSync } from 'fs'
import JSZip from 'jszip'
const PAT = /승진|덕평|2020-01|772-3019|586-86|김흥준|양평읍|팩스|FAX|Fax/

async function scan(file: string) {
  const zip = await JSZip.loadAsync(readFileSync(file))
  const wb = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relT = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
  const shared: string[] = []
  const ss = zip.file('xl/sharedStrings.xml')
  if (ss) for (const si of (await ss.async('string')).match(/<si>[\s\S]*?<\/si>/g) ?? [])
    shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
  const out: string[] = []
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const path = 'xl/' + relT.get(m[2])!.replace(/^\/?xl\//, '')
    const xml = await zip.file(path)?.async('string'); if (!xml) continue
    for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const v = c[3].match(/<v>([\s\S]*?)<\/v>/)?.[1]; const isS = /t="s"/.test(c[2])
      const f = c[3].match(/<f>([\s\S]*?)<\/f>/)?.[1]
      const inl = c[3].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
      const text = isS && v != null ? shared[Number(v)] : (inl ?? v ?? '')
      if (PAT.test(text ?? '')) out.push(`${m[1]}!${c[1]}${f ? ` [수식 ${f.slice(0, 40)}]` : ''} = ${JSON.stringify((text ?? '').replace(/\s+/g, ' ').slice(0, 90))}`)
    }
  }
  return out
}
for (const f of ['templates/report-workbook-full.xlsx', 'templates/fire-plan-workbook.xlsx']) {
  try { const r = await scan(f); console.log(`\n=== ${f} — ${r.length}칸`); r.forEach(x => console.log('  ' + x)) }
  catch (e) { console.log(`\n=== ${f} — 읽기 실패 ${String(e).slice(0, 80)}`) }
}
