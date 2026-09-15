// 읽기 전용 — 「이행조치 일자」가 46299(시리얼 원값)로 인쇄되는 이유 추적.
// 값은 `isoToSerial()`이 만든 **숫자**다. 숫자가 날짜로 보이려면 그 칸에 날짜 numFmt가 있어야 한다.
// 주입기는 스타일 인덱스(s=)를 보존하므로, 보존된 그 스타일에 날짜 서식이 있는지를 템플릿에서 본다.
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const tpl = process.argv[2] ?? 'templates/report-workbook-full.xlsx'
const zip = await JSZip.loadAsync(readFileSync(tpl))
const wb = await zip.file('xl/workbook.xml').async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const styles = await zip.file('xl/styles.xml').async('string')
console.log(`템플릿: ${tpl}`)

// 시트명 → 파일 경로
const sheets = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(m => ({ name: m[1], rid: m[2] }))
const relMap = new Map([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))

// numFmtId → 코드 (내장 14~22·45~47은 날짜/시간)
const customFmt = new Map([...styles.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map(m => [+m[1], m[2]]))
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
// cellXfs 순서 = s 인덱스
const xfsBlock = styles.slice(styles.indexOf('<cellXfs'), styles.indexOf('</cellXfs>'))
const xfs = [...xfsBlock.matchAll(/<xf[^>]*numFmtId="(\d+)"[^>]*\/?>/g)].map(m => +m[1])
console.log(`cellXfs ${xfs.length}개 · 커스텀 numFmt ${customFmt.size}개`)

const isDateFmt = (id) => BUILTIN_DATE.has(id) || /[ymd]/i.test(customFmt.get(id) ?? '')

async function look(sheetName, cells) {
  const s = sheets.find(x => x.name === sheetName)
  if (!s) { console.log(`\n[${sheetName}] 시트 없음`); return }
  const path = 'xl/' + relMap.get(s.rid).replace(/^\/?xl\//, '')
  const xml = await zip.file(path).async('string')
  console.log(`\n[${sheetName}] ${path}`)
  for (const ref of cells) {
    const m = xml.match(new RegExp(`<c r="${ref}"([^>]*)>([\\s\\S]*?)</c>|<c r="${ref}"([^>]*)/>`))
    if (!m) { console.log(`  ${ref}: (칸 없음)`) ; continue }
    const attrs = (m[1] ?? m[3] ?? '')
    const inner = m[2] ?? ''
    const sIdx = /s="(\d+)"/.exec(attrs)?.[1]
    const t = /t="([^"]+)"/.exec(attrs)?.[1] ?? '(num)'
    const fmtId = sIdx != null ? xfs[+sIdx] : 0
    const code = customFmt.get(fmtId) ?? `(내장 ${fmtId})`
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
    console.log(`  ${ref}: s=${sIdx ?? '-'} numFmtId=${fmtId} ${isDateFmt(fmtId) ? '✅날짜서식' : '❌날짜서식아님'} t=${t}` +
      `${f ? ` f="${f.slice(0, 40)}"` : ''}${v ? ` v=${v.slice(0, 20)}` : ''} fmt=${String(code).slice(0, 24)}`)
  }
}

await look('완료보고서', ['B18', 'I18', 'I19', 'I20', 'I21', 'I22', 'G25'])
await look('개요', ['G9', 'I9', 'J9', 'G10'])
await look('계획서', ['B26', 'J26', 'P26'])
