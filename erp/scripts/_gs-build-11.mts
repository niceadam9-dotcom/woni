/** 강순기 소방계획서 「서식 1.1 건축물 일반현황」을 **두 형식으로** 만든다 (형식 비교용 표본).
 *
 *  A안 = sj_계획서.xlsx 미세 격자(71열×54행) · B안 = templates/fire-plan-workbook.xlsx(10열×27행)
 *
 *  방식: 원본 xlsx를 **바이트 패치**한다(JSZip). 값 칸이 이미 `<c r="I6" s="54"/>`로 스타일과 함께
 *  실재하므로, self-closing을 inlineStr로 바꿔 넣으면 테두리·글꼴·병합이 그대로 남는다.
 *  sharedStrings는 새로 만들지 않는다 — 고아 문자열이 산출물에 실려 나가는 사고를 원천 차단(소방계획서_27).
 *
 *  ⭐ 자리 맞추기는 **손으로 박지 않는다**: 시트의 '행별 논리 셀'을 열 순으로 늘어놓으면 hwp 표의
 *     '행별 셀'과 1:1로 대응한다. 그래서 95개 표로 확장할 수 있다.
 *  🚨 **모양이 어긋나면 쓰지 않고 실패한다** — 개수가 안 맞는데 밀어 넣으면 값이 한 칸씩 밀려
 *     들어가고, 그건 육안으로 잘 안 보인다.
 *  🚨 강순기는 실고객 문서다(소방계획서_42 R-2) — 산출물을 저장소 안에 쓰지 않는다.
 *
 *  실행: npx tsx scripts/_gs-build-11.mts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset, type Hwp5Table } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWP = resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')
const SJ = resolve(HERE, '../../erp_goal/_doc01/sj_계획서.xlsx')
const TPL = resolve(HERE, '../templates/fire-plan-workbook.xlsx')
const OUT_DIR = 'F:\\AI\\sjfire\\_강순기_형식비교'   // 저장소 **밖** (실고객 문서)

/* ══════════ 1. 강순기에서 서식 1.1 표 뽑기 ══════════ */
const { bytes } = readSectionStream(readFileSync(HWP))
const records = walkRecords(bytes)
const zipForm = await JSZip.loadAsync(readFileSync(HWPX))
const truth = parseTables(await zipForm.file('Contents/section0.xml')!.async('string'))
  .map(t => t.cells.map(c => ({ row: c.row, col: c.col })))
const cal = calibrateCellOffset(records, truth)
if (!cal || cal.hitRate < 0.95) throw new Error(`좌표 보정 실패 — 값 자리를 믿을 수 없다 (${cal ? cal.hitRate : 'null'})`)
const tables = extractTables(records, cal.offset)
console.log(`강순기: 표 ${tables.length}개 · 좌표 일치율 ${(cal.hitRate * 100).toFixed(1)}%`)

const KEYS = ['명칭', '도로명주소', '수신기위치', '대상물급수']
const norm = (s: string) => s.replace(/\s/g, '')
const t11 = tables
  .map(t => ({ t, score: KEYS.filter(k => t.cells.some(c => norm(c.text).includes(k))).length }))
  .sort((a, b) => b.score - a.score)[0]
if (!t11 || t11.score < 3) throw new Error('서식 1.1 표를 못 찾았다')
const T: Hwp5Table = t11.t
console.log(`서식 1.1 = 표#${T.index} (${T.rowCnt}행×${T.colCnt}열 · 셀 ${T.cells.length})`)

/** hwp 표를 '행별 셀(열 순)'로 */
function hwpRows(t: Hwp5Table): string[][] {
  const by = new Map<number, { col: number; text: string }[]>()
  for (const c of t.cells) {
    if (c.row === null || c.col === null) throw new Error('좌표 없는 셀 — 자리 맞추기 불가')
    if (!by.has(c.row)) by.set(c.row, [])
    // ⚠ 공백을 **지우지 않는다**(대조용 정규화를 출력에 쓰면 건물명·주소의 띄어쓰기가 사라진다).
    //   여기 원래 있던 `replace(/ /g,'')`는 공백 자리에 NUL이 박혀 git이 이 파일을 바이너리로 잡았다.
    by.get(c.row)!.push({ col: c.col, text: c.text.replace(/\s+/g, ' ').trim() })
  }
  return [...by.keys()].sort((a, b) => a - b)
    .map(r => by.get(r)!.sort((a, b) => a.col - b.col).map(x => x.text))
}

/* ══════════ 2. 대상 시트의 '행별 논리 셀' ══════════ */
function gridRows(path: string, sheetName: string, hwpColCnt: number): { row: number; addrs: string[] }[] {
  const wb = XLSX.read(readFileSync(path), { sheetStubs: true })
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`시트 없음: ${sheetName} (있는 것: ${wb.SheetNames.join(', ')})`)
  const merges = ws['!merges'] ?? []
  const range = XLSX.utils.decode_range(ws['!ref']!)
  const width = range.e.c - range.s.c + 1
  /* ⭐ 두 격자의 성격이 다르다 — 열 수로 가른다.
   *  · 직접 격자(리포: 10열 = hwp 10열): 논리 셀이 곧 시트 셀이다. **아무것도 털지 않는다** —
   *    꼬리를 털면 `J9`(사용승인일 값) 같은 **진짜 빈 값 칸**이 사라져 값이 밀린다(실제로 그 버그를 냈다).
   *  · 미세 격자(sj: 71열): 값 칸이 전부 병합이고 A열·AO~BS열은 **표 바깥 여백**이다 → 병합만 센다. */
  const fineGrid = width > hwpColCnt * 2
  console.log(`  격자 판정: 시트 ${width}열 vs hwp ${hwpColCnt}열 → ${fineGrid ? '미세 격자(병합만)' : '직접 격자(전 셀)'}`)

  const topLeft = new Set(merges.map(m => `${m.s.r},${m.s.c}`))
  const coveredNotTop = (R: number, C: number) =>
    merges.some(m => R >= m.s.r && R <= m.e.r && C >= m.s.c && C <= m.e.c && !(m.s.r === R && m.s.c === C))

  const out: { row: number; addrs: string[] }[] = []
  for (let R = range.s.r; R <= range.e.r; R++) {
    const cells: { a: string; isMerge: boolean }[] = []
    for (let C = range.s.c; C <= range.e.c; C++) {
      if (coveredNotTop(R, C)) continue
      cells.push({ a: XLSX.utils.encode_cell({ r: R, c: C }), isMerge: topLeft.has(`${R},${C}`) })
    }
    const kept = fineGrid ? cells.filter(x => x.isMerge) : cells
    if (kept.length) out.push({ row: R, addrs: kept.map(x => x.a) })
  }
  return out
}

/** hwp 행들과 격자 행들을 짝짓는다. 개수가 안 맞으면 **던진다**(밀려 쓰지 않는다). */
function align(hwp: string[][], grid: { row: number; addrs: string[] }[], label: string) {
  // 격자 앞쪽에 hwp 표에 없는 '제목 행'이 있을 수 있다 — 뒤에서부터 맞춘다
  if (grid.length < hwp.length) throw new Error(`${label}: 격자 행 ${grid.length} < hwp 행 ${hwp.length}`)
  const g = grid.slice(grid.length - hwp.length)
  const pairs: { addr: string; text: string }[] = []
  const bad: string[] = []
  for (let i = 0; i < hwp.length; i++) {
    if (hwp[i].length !== g[i].addrs.length) {
      bad.push(`  행${i}: hwp 셀 ${hwp[i].length}개 vs 격자 ${g[i].addrs.length}개 (격자행 ${g[i].row + 1})`)
      continue
    }
    for (let j = 0; j < hwp[i].length; j++) pairs.push({ addr: g[i].addrs[j], text: hwp[i][j] })
  }
  if (bad.length) throw new Error(`${label}: 셀 수 불일치 ${bad.length}행 — 값이 밀려 들어간다\n${bad.join('\n')}`)
  return pairs
}

/* ══════════ 3. 바이트 패치 ══════════ */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function patch(srcPath: string, sheetXmlName: string, pairs: { addr: string; text: string }[], outPath: string) {
  const zip = await JSZip.loadAsync(readFileSync(srcPath))
  let xml = await zip.file(sheetXmlName)!.async('string')
  const ssFile = zip.file('xl/sharedStrings.xml')
  const shared = ssFile
    ? [...(await ssFile.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))
    : []
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const noSp = (s: string) => s.replace(/\s/g, '')

  let hit = 0, same = 0
  const miss: string[] = []
  for (const { addr, text } of pairs) {
    if (!text) continue
    const whole = new RegExp(`<c r="${addr}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`)
    const m = xml.match(whole)
    if (!m) { miss.push(addr); continue }
    const attrs = m[1].replace(/\s*t="[^"]*"/, '')      // 타입 속성만 버린다(s= 스타일은 지킨다)
    const body = m[2] ?? ''
    /* 지금 그 칸에 뭐가 찍혀 있나 — 공유문자열이면 풀어서 본다 */
    let cur = ''
    if (/t="s"/.test(m[1])) {
      const vi = body.match(/<v>(\d+)<\/v>/)
      cur = vi ? unesc(shared[+vi[1]] ?? '') : ''
    } else {
      const t = body.match(/<t[^>]*>([\s\S]*?)<\/t>/) ?? body.match(/<v>([\s\S]*?)<\/v>/)
      cur = t ? unesc(t[1]) : ''
    }
    /* ⭐ 규칙: 비었으면 넣고, 뜻이 **다르면** 덮는다(체크 ☐→■ · 단위 「급」→「3급」).
       공백만 다른 건 그대로 둔다 — 「명 칭」 같은 자간 표기는 서식 작성자의 선택이다. */
    if (cur && noSp(cur) === noSp(text)) { same++; continue }
    xml = xml.replace(whole, `<c r="${addr}"${attrs} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`)
    hit++
  }
  if (miss.length) throw new Error(`XML에 없는 칸 ${miss.length}개: ${miss.slice(0, 8).join(',')}`)
  zip.file(sheetXmlName, xml)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return { hit, same }
}

/** 시트 이름 → xl/worksheets/sheetN.xml */
async function sheetXmlOf(src: string, sheet: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(src))
  const wbx = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const sm = [...wbx.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)].find(m => m[1] === sheet)
  if (!sm) throw new Error(`workbook.xml에서 시트를 못 찾음: ${sheet}`)
  const rm = [...rels.matchAll(/Id="([^"]*)"[^>]*Target="([^"]*)"/g)].find(m => m[1] === sm[2])
  if (!rm) throw new Error('rels에서 대상을 못 찾음')
  return 'xl/' + rm[2].replace(/^\/?xl\//, '')
}

/* ══════════ 실행 ══════════ */
const rows = hwpRows(T)
console.log(`hwp 행 ${rows.length}개 · 셀 합 ${rows.reduce((a, r) => a + r.length, 0)}\n`)

const jobs = [
  { label: 'A안(sj 미세 격자)', src: SJ, sheet: '소방안전관리계획 (3)', out: join(OUT_DIR, 'A_sj격자_강순기_서식1.1.xlsx') },
  { label: 'B안(리포 기존)', src: TPL, sheet: '1.1 건축물 일반현황', out: join(OUT_DIR, 'B_리포형식_강순기_서식1.1.xlsx') },
]

for (const j of jobs) {
  console.log(j.label)
  try {
    if (!existsSync(j.src)) { console.log('  원본 없음 — 건너뜀\n'); continue }
    const grid = gridRows(j.src, j.sheet, T.colCnt)
    const pairs = align(rows, grid, j.label)
    const xmlName = await sheetXmlOf(j.src, j.sheet)
    const { hit, same } = await patch(j.src, xmlName, pairs, j.out)
    console.log(`  ✅ 기록 ${hit}칸 · 이미 같아서 유지 ${same}칸 → ${j.out}\n`)
  } catch (e) {
    console.log(`  ❌ ${(e as Error).message}\n`)
  }
}
