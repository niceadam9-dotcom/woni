/** 판정자 D — D2 축: 결과열(C/J) · dv 실재 · 시트 목록을 **독립 구현**으로 재측정.
 *  읽기 전용. 구현자의 xlsx-donor-itemmap-extract.ts를 import 하지 않는다(같은 버그를 물려받지 않기 위해). */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import JSZip from 'jszip'

const ASSET = path.resolve(process.cwd(), 'templates/report-workbook-full.xlsx')
const OUT = path.resolve(process.cwd(), 'scripts/_out/_judgeD-D2.txt')
const lines: string[] = []
const say = (s: string) => { lines.push(s) }

const buf = fs.readFileSync(ASSET)
say(`ASSET ${ASSET}`)
say(`sha256 ${crypto.createHash('sha256').update(buf).digest('hex')}`)
say(`bytes ${buf.length}`)

const zip = await JSZip.loadAsync(buf)

// ── 공유문자열
const sstXml = await zip.file('xl/sharedStrings.xml')?.async('string') ?? ''
const sst: string[] = []
for (const si of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
  sst.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
}
say(`sharedStrings ${sst.length}`)

// ── 시트 목록 (workbook.xml + rels)
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rel = new Map<string, string>()
for (const m of relsXml.matchAll(/<Relationship\s([^>]*)\/>/g)) {
  const id = /Id="([^"]+)"/.exec(m[1])?.[1]
  const tgt = /Target="([^"]+)"/.exec(m[1])?.[1]
  if (id && tgt) rel.set(id, tgt.replace(/^\/?xl\//, '').replace(/^\.\.\//, ''))
}
type Sheet = { name: string; file: string }
const sheets: Sheet[] = []
for (const m of wbXml.matchAll(/<sheet\s([^>]*?)\/>/g)) {
  const a = m[1]
  const name = /name="([^"]*)"/.exec(a)?.[1] ?? ''
  const rid = /r:id="([^"]+)"/.exec(a)?.[1] ?? ''
  const tgt = rel.get(rid) ?? ''
  sheets.push({ name: decodeXml(name), file: 'xl/' + tgt })
}
say(`sheets ${sheets.length}`)
say('SHEETNAMES ' + sheets.map(s => s.name).join(' | '))

function decodeXml(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&#13;/g, '\r').replace(/&amp;/g, '&')
}
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
const colName = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26 } return s }

/** 독립 셀 리더 — <c ...> ... </c> 및 자기닫힘 */
function readCells(xml: string) {
  const val = new Map<string, string>()
  const refs = new Set<string>()
  const re = /<c(\s[^>]*?)?(\/>|>)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const attrs = m[1] ?? ''
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]
    const selfClose = m[2] === '/>'
    let body = ''
    if (!selfClose) {
      const end = xml.indexOf('</c>', re.lastIndex)
      if (end < 0) break
      body = xml.slice(re.lastIndex, end)
      re.lastIndex = end + 4
    }
    if (!ref) continue
    refs.add(ref)
    if (!body) continue
    let v: string | null = null
    if (/t="inlineStr"/.test(attrs)) {
      v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
    } else {
      const vm = /<v>([\s\S]*?)<\/v>/.exec(body)
      if (vm) v = /t="s"/.test(attrs) ? (sst[+vm[1]] ?? '') : vm[1]
    }
    if (v !== null) val.set(ref, decodeXml(v))
  }
  return { val, refs }
}

function expandSqref(sq: string): Set<string> {
  const out = new Set<string>()
  for (const part of sq.trim().split(/\s+/)) {
    const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(part)
    if (!m) continue
    if (!m[3]) { out.add(`${m[1]}${m[2]}`); continue }
    for (let c = colNum(m[1]); c <= colNum(m[3]); c++) for (let r = +m[2]; r <= +m[4]; r++) out.add(`${colName(c)}${r}`)
  }
  return out
}

const CODE_RE = /^\d{1,2}-[A-Z]-\d{3}$/
type DV = { sqref: string; type: string; formula1: string; showError: string; errorStyle: string; raw: string }

const perSheet: Array<{
  name: string; codes: number; heads: string[]; rcol: string; dvs: DV[];
  dvOnResult: number; codeCellsWithDv: number; codeCellsNoDv: string[]; sampleCodeCells: string[];
  legend: string[]; legendVals: string[];
}> = []

let totalCodes = 0
const codeToCell = new Map<string, string>()
const dupCodes: string[] = []
const allLegendX: string[] = []
const allLegendMul: string[] = []
const dvWithMarkList: DV[] = []
const dvWithMarkWhere: string[] = []

for (const sh of sheets) {
  const f = zip.file(sh.file)
  if (!f) { say(`!! MISSING FILE ${sh.name} ${sh.file}`); continue }
  const xml = await f.async('string')
  const { val, refs } = readCells(xml)

  // A열 코드
  const codes: Array<{ row: number; code: string }> = []
  for (const [ref, v] of val) {
    if (!/^A\d+$/.test(ref)) continue
    const t = v.trim()
    if (CODE_RE.test(t)) codes.push({ row: +ref.slice(1), code: t })
  }
  codes.sort((a, b) => a.row - b.row)

  // 「점검결과」 헤더
  const heads = [...val].filter(([, v]) => v.trim() === '점검결과').map(([r]) => r)

  // dv 전수 (속성 순서 무관)
  const dvs: DV[] = []
  for (const d of xml.matchAll(/<dataValidation\s([^>]*?)(\/>|>([\s\S]*?)<\/dataValidation>)/g)) {
    const a = d[1]
    const body = d[3] ?? ''
    dvs.push({
      sqref: /sqref="([^"]*)"/.exec(a)?.[1] ?? '',
      type: /\btype="([^"]*)"/.exec(a)?.[1] ?? '',
      formula1: decodeXml(/<formula1>([\s\S]*?)<\/formula1>/.exec(body)?.[1] ?? (/formula1="([^"]*)"/.exec(a)?.[1] ?? '')),
      showError: /showErrorMessage="([^"]*)"/.exec(a)?.[1] ?? '(none)',
      errorStyle: /errorStyle="([^"]*)"/.exec(a)?.[1] ?? '(none)',
      raw: a.slice(0, 300),
    })
  }

  const rcol = heads.length === 1 ? /^([A-Z]+)/.exec(heads[0])![1] : ''
  const dvCells = new Set<string>()
  for (const d of dvs) {
    if (d.type !== 'list') continue
    if (d.formula1.includes('#REF!')) continue
    for (const c of expandSqref(d.sqref)) dvCells.add(c)
  }
  const codeCellsNoDv: string[] = []
  let withDv = 0
  if (rcol) for (const c of codes) {
    const cell = `${rcol}${c.row}`
    if (dvCells.has(cell)) withDv++; else codeCellsNoDv.push(`${cell}(${c.code})`)
  }

  // 범례 후보: 세로 3연속 ○ / X-or-× (구현자 규칙 재현)
  const MARKV = /^[○×X/／]$/
  const legend: string[] = []
  const legendVals: string[] = []
  for (const [ref, v] of val) {
    if (v.trim() !== '○') continue
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!
    const c = m[1], r = +m[2]
    const v2 = (val.get(`${c}${r + 1}`) ?? '').trim()
    const v3 = (val.get(`${c}${r + 2}`) ?? '').trim()
    if (MARKV.test(v2) && MARKV.test(v3)) { legend.push(ref, `${c}${r + 1}`, `${c}${r + 2}`); legendVals.push('○', v2, v3) }
  }
  if (legendVals.filter((_, i) => i % 3 === 2).some(v => v === 'X')) allLegendX.push(sh.name)
  if (legend.length > 3) allLegendMul.push(`${sh.name}(${legend.length / 3})`)

  // dv formula1에 마크 리터럴이 직접 든 것
  for (const d of dvs) if (/[○×X/／]/.test(d.formula1) && d.type === 'list') { dvWithMarkList.push(d); dvWithMarkWhere.push(`${sh.name}:${d.sqref}`) }

  totalCodes += codes.length
  for (const c of codes) {
    if (codeToCell.has(c.code)) dupCodes.push(`${c.code} ${codeToCell.get(c.code)} <-> ${sh.name}!${rcol}${c.row}`)
    else codeToCell.set(c.code, `${sh.name}!${rcol}${c.row}`)
  }

  perSheet.push({
    name: sh.name, codes: codes.length, heads, rcol, dvs,
    dvOnResult: rcol ? [...dvCells].filter(c => new RegExp(`^${rcol}\\d+$`).test(c)).length : 0,
    codeCellsWithDv: withDv, codeCellsNoDv,
    sampleCodeCells: codes.slice(0, 2).map(c => `${rcol}${c.row}=${c.code}`),
    legend, legendVals,
  })
}

say('')
say('=== PER SHEET (codes>0 only) ===')
say('sheet\tcodes\trcol\theads\tdvTotal\tdvListValid_onRcol\tcodeCellsWithDv\tnoDv')
for (const p of perSheet) {
  if (!p.codes) continue
  say(`${p.name}\t${p.codes}\t${p.rcol || '??'}\t${p.heads.join(',')}\t${p.dvs.length}\t${p.dvOnResult}\t${p.codeCellsWithDv}\t${p.codeCellsNoDv.length ? p.codeCellsNoDv.join(' ') : '-'}`)
}

say('')
say('=== SHEETS WITH NO CODE ROWS ===')
for (const p of perSheet) if (!p.codes) say(`${p.name}\theads=${p.heads.join(',') || '-'}\tdv=${p.dvs.length}\tlegend=${p.legend.length / 3}`)

say('')
const colC = perSheet.filter(p => p.codes && p.rcol === 'C').map(p => p.name)
const colJ = perSheet.filter(p => p.codes && p.rcol === 'J').map(p => p.name)
const colOther = perSheet.filter(p => p.codes && p.rcol !== 'C' && p.rcol !== 'J').map(p => `${p.name}=${p.rcol}`)
say(`RESULTCOL C ${colC.length}: ${colC.join(' ')}`)
say(`RESULTCOL J ${colJ.length}: ${colJ.join(' ')}`)
say(`RESULTCOL OTHER ${colOther.length}: ${colOther.join(' ')}`)
say(`TOTAL CODE ROWS ${totalCodes} · unique ${codeToCell.size} · dup ${dupCodes.length} ${dupCodes.join(' ; ')}`)

say('')
say('=== DV DETAIL for the 4 wide sheets (and any J sheet) ===')
for (const p of perSheet) {
  if (p.rcol !== 'J') continue
  say(`-- ${p.name} (rcol=${p.rcol})`)
  for (const d of p.dvs) say(`   type=${d.type} sqref="${d.sqref}" f1=${JSON.stringify(d.formula1)} showError=${d.showError} errorStyle=${d.errorStyle}`)
}

say('')
say('=== LEGEND (3-vertical ○ / mark) ===')
let legendCount = 0, legendXcount = 0, legendMulCount = 0
for (const p of perSheet) {
  if (!p.legend.length) continue
  legendCount += p.legend.length / 3
  const third = p.legendVals.filter((_, i) => i % 3 === 2)
  const thirdCells = p.legend.filter((_, i) => i % 3 === 2)
  for (let i = 0; i < third.length; i++) {
    const cp = [...third[i]].map(ch => 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(',')
    say(`${p.name}\t${thirdCells[i]}\t${JSON.stringify(third[i])}\t${cp}`)
    if (third[i] === 'X') legendXcount++
  }
  if (p.legend.length > 3) legendMulCount++
}
say(`LEGEND blocks total ${legendCount} · sheets with legend ${perSheet.filter(p => p.legend.length).length} · third-cell=='X' ${legendXcount} · sheets with >1 legend ${legendMulCount} ${allLegendMul.join(' ')}`)

say('')
say('=== DV list whose formula1 embeds marks (inline list) ===')
say(`count ${dvWithMarkList.length}`)
const showErrTally = new Map<string, number>()
for (let i = 0; i < dvWithMarkList.length; i++) {
  const d = dvWithMarkList[i]
  const k = `showError=${d.showError} errorStyle=${d.errorStyle}`
  showErrTally.set(k, (showErrTally.get(k) ?? 0) + 1)
  say(`${dvWithMarkWhere[i]}\tf1=${JSON.stringify(d.formula1)}\t${k}`)
}
for (const [k, v] of showErrTally) say(`TALLY ${k} = ${v}`)

say('')
say('=== ALL list-type DV attribute tally (whole workbook) ===')
const allTally = new Map<string, number>()
let listDv = 0
for (const p of perSheet) for (const d of p.dvs) {
  if (d.type !== 'list') continue
  listDv++
  const k = `showError=${d.showError} errorStyle=${d.errorStyle} refFormula=${/^\$?[A-Z]+\$?\d+/.test(d.formula1) ? 'range' : 'inline'} ref=${d.formula1.includes('#REF!')}`
  allTally.set(k, (allTally.get(k) ?? 0) + 1)
}
say(`list dv total ${listDv}`)
for (const [k, v] of allTally) say(`TALLY ${k} = ${v}`)

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log('wrote ' + OUT + ' lines=' + lines.length)
