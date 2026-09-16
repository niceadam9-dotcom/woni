/** 칸이 **좁아서 줄이 접히는가** — 빌드 게이트가 쓰는 것과 **같은 자**(`measureLines`)로 잰다.
 *
 *  ⚠ 자를 새로 만들지 않는다. 행 높이 확장·「한 줄」 단언이 이미 이 추정기를 쓰고 있고,
 *    여기서 다른 자를 쓰면 프로브가 초록인데 게이트가 빨강(또는 그 반대)이 된다.
 *
 *  🚨 **열 경계를 밀면 형제가 좁아진다.** 넓힌 칸만 보면 한 수리가 만든 다음 결함을 못 본다
 *    (서식 2.1에서 실제로 「□ 휴일」이 두 줄이 됐다). 그래서 이 프로브는 **상자 칸이 아니라
 *    전 칸**을 재고, 조정 전 판을 저장해 두었다가 조정 후와 **대조**한다.
 *
 *  실행:
 *    npx tsx scripts/_probe-cb-wrapfit.mts                 — 지금 접힌 칸만 본다
 *    npx tsx scripts/_probe-cb-wrapfit.mts --save <경로>   — 전 칸 줄 수를 대조군으로 저장
 *    npx tsx scripts/_probe-cb-wrapfit.mts --diff <경로>   — 저장본과 대조(줄이 늘어난 칸 = 부작용)
 */
import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { measureLines, colWidthToPx } from '../src/lib/xlsx-wrap-height.ts'

const HERE = import.meta.dirname
const mode = process.argv[2] ?? ''
const file = process.argv[3]
const TPL = path.join(HERE, '..', 'templates', 'fire-plan-workbook.xlsx')

const colNum = (s: string) => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0)

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(TPL)))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const tgt = new Map<string, string>()
for (const m of relsXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
const sheetNames: string[] = []
const partOf = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const nm = m[1].replace(/&amp;/g, '&')
  sheetNames.push(nm)
  partOf.set(nm, 'xl/' + tgt.get(m[2])!.replace(/^\/?xl\//, ''))
}

/** 이 판의 **모든 글자 있는 칸** → 줄 수. 키는 「시트!글자」다 — **좌표가 아니다**.
 *  🚨 열 경계를 밀면 칸 주소가 통째로 밀린다(AS19 → AR19). 좌표로 키를 잡으면 조정 뒤
 *    전 칸이 「사라짐 + 새로 생김」으로 보여 대조가 아무것도 말해 주지 못한다.
 *    같은 시트 안에 같은 글자가 여럿이면 **가장 좁은 칸**을 대표로 쓴다(최악을 본다). */
type Rec = { lines: number; cols: number; ref: string }
const board = new Map<string, Rec>()

for (const name of sheetNames) {
  const xml = await zip.file(partOf.get(name)!)!.async('string')
  const colW = new Map<number, number>()
  for (const m of xml.matchAll(/<col min="(\d+)" max="(\d+)"([^>]*)\/>/g)) {
    const w = Number(/width="([\d.]+)"/.exec(m[3])?.[1] ?? 0)
    for (let c = Number(m[1]); c <= Number(m[2]); c++) colW.set(c, w)
  }
  const mergeEndCol = new Map<string, number>()
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+)\d+"\/>/g)) {
    mergeEndCol.set(m[1].split(':')[0], colNum(m[2]))
  }
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"((?:[^>/]|\/(?!>))*)>([\s\S]*?)<\/c>/g)) {
    const ref = m[1]
    const text = [...m[3].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    if (!text.trim()) continue
    const c0 = colNum(/^[A-Z]+/.exec(ref)![0])
    const cols = (mergeEndCol.get(ref) ?? c0) - c0 + 1
    const lines = measureLines(text, cols, colW.get(c0) ?? 1.8)
    const key = `${name}!${text}`
    const prev = board.get(key)
    if (!prev || cols < prev.cols) board.set(key, { lines, cols, ref })
  }
}

if (mode === '--save') {
  writeFileSync(file!, JSON.stringify([...board].map(([k, v]) => [k, v.lines, v.cols, v.ref])), 'utf8')
  console.log(`대조군 저장 ${board.size}칸 → ${file}`)
  process.exit(0)
}

if (mode === '--diff') {
  const old = new Map<string, { lines: number; cols: number; ref: string }>(
    (JSON.parse(readFileSync(file!, 'utf8')) as [string, number, number, string][])
      .map(([k, lines, cols, ref]) => [k, { lines, cols, ref }]))
  let worse = 0, better = 0, gone = 0
  for (const [k, now] of board) {
    const was = old.get(k)
    if (!was) continue
    const [sheet, text] = [k.slice(0, k.indexOf('!')), k.slice(k.indexOf('!') + 1)]
    if (now.lines > was.lines) {
      worse++
      console.log(`🚨 더 접혔다  ${sheet} ${was.ref}→${now.ref}  ${was.cols}칸 ${was.lines}줄 → ${now.cols}칸 ${now.lines}줄  ${JSON.stringify(text.slice(0, 40))}`)
    } else if (now.lines < was.lines) {
      better++
      console.log(`✅ 펴졌다    ${sheet} ${was.ref}→${now.ref}  ${was.cols}칸 ${was.lines}줄 → ${now.cols}칸 ${now.lines}줄  ${JSON.stringify(text.slice(0, 40))}`)
    }
  }
  for (const k of old.keys()) if (!board.has(k)) gone++
  console.log(`\n대조 ${old.size}칸 → ${board.size}칸 · 사라진 글자 ${gone} · **더 접힌 칸 ${worse}** · 펴진 칸 ${better}`)
  process.exit(worse ? 1 : 0)
}

// 기본: 지금 「원문 줄 수보다 더 접힌」 칸 전부
let folded = 0
for (const [k, v] of board) {
  const [sheet, text] = [k.slice(0, k.indexOf('!')), k.slice(k.indexOf('!') + 1)]
  const hard = text.split('\n').length
  if (v.lines <= hard) continue
  folded++
  console.log(`  ${sheet.padEnd(24)} ${v.ref.padEnd(6)} ${String(v.cols).padStart(2)}칸(${v.cols * colWidthToPx(1.8)}px)  `
    + `원문 ${hard}줄 → ${v.lines}줄   ${JSON.stringify(text.slice(0, 50))}`)
}
console.log(`\n글자 있는 칸 ${board.size} · **원문보다 더 접힌 칸 ${folded}**`)
