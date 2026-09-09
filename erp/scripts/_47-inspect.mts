/** 50시트 자동 점검 — 눈으로 다 볼 수 없으니 기계가 의심 자리를 짚는다.
 *
 *  본다: ①글자가 칸 폭에 비해 너무 김(줄바꿈·잘림 위험) ②세로로 눌리는 라벨 ③빈 시트
 *  ④체크 글리프가 좌정렬 서식을 못 받은 칸 ⑤시트별 인쇄 방향(manifest 기대와 대조)
 *  ⑥행높이 합 기반 쪽수 근사
 *
 *  ⚠ 이 파일은 **하드코딩으로 두 번 데였다** — 판정 재료는 산출물·manifest에서 **스스로 읽는다**.
 *    · 스타일 번호(`s="3"`) 하드코딩 → 테두리 축이 늘자 멀쩡한 산출물을 645건 오보
 *    · COL_W=2.2 하드코딩 → 제품이 1.8로 바뀐 뒤 ①축이 51로 과소(실폭 기준 80) — B-11 부수 결함
 *  실행: npx tsx scripts/_47-inspect.mts <xlsx>
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = process.argv[2] ?? 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서_v2.xlsx'
const CHECK = /^\s*[□☐■▣☑☒✓✔]/

const wb = XLSX.read(readFileSync(SRC), { sheetStubs: true })
const zip = await JSZip.loadAsync(readFileSync(SRC))

/* 좌정렬 칸을 센다.
 * ⚠ **스타일 번호를 박지 말 것.** 1차엔 `s="3"`을 좌정렬로 하드코딩했는데, 테두리 축이 늘어
 *   번호 체계가 바뀌자 멀쩡한 산출물을 「좌정렬 아님 645건」으로 오보했다.
 *   styles.xml에서 xf → horizontal을 **읽어서** 판정한다(자기정의). */
const styles = await zip.file('xl/styles.xml')!.async('string')
const xfBlock = styles.match(/<cellXfs[^>]*>[\s\S]*?<\/cellXfs>/)?.[0] ?? ''
const xfAlign = [...xfBlock.matchAll(/<xf[\s\S]*?(?:\/>|<\/xf>)/g)]
  .map(m => /horizontal="([a-z]+)"/.exec(m[0])?.[1] ?? '')

/* 시트 xml에서 판정 재료를 전부 읽는다 — 좌정렬 칸·열 폭·방향·행높이. */
interface SInfo { left: Set<string>; colW: number; orientation: string; fitToHeight: number; heightPt: number }
const info = new Map<string, SInfo>()
for (const [i, name] of wb.SheetNames.entries()) {
  const xml = await zip.file(`xl/worksheets/sheet${i + 1}.xml`)!.async('string')
  const left = new Set<string>()
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*s="(\d+)"/g)) {
    if (xfAlign[Number(m[2])] === 'left') left.add(m[1])
  }
  /* 열 폭 — 산출물 <col width="…">에서 읽는다(하드코딩 금지). 여러 정의면 최빈이 아니라 폭 가중이
   * 옳지만, 이 산출물은 전 열 단일 정의라 첫 값이면 된다. 없으면 엑셀 기본 8.43. */
  const colW = Number(/<col [^>]*width="([\d.]+)"/.exec(xml)?.[1] ?? 8.43)
  const orientation = /orientation="(\w+)"/.exec(xml)?.[1] ?? 'portrait'
  const fitToHeight = Number(/fitToHeight="(\d+)"/.exec(xml)?.[1] ?? 1)
  /* 행높이 합(pt) — ht 명시 행은 그 값, 나머지는 defaultRowHeight */
  const defH = Number(/defaultRowHeight="([\d.]+)"/.exec(xml)?.[1] ?? 13.5)
  const rowNos = [...xml.matchAll(/<row r="(\d+)"/g)].map(m => Number(m[1]))
  const maxRow = rowNos.length ? Math.max(...rowNos) : 0
  const htSum = [...xml.matchAll(/<row r="\d+" ht="([\d.]+)"/g)].reduce((a, m) => a + Number(m[1]), 0)
  const htCount = [...xml.matchAll(/<row r="\d+" ht="/g)].length
  const heightPt = htSum + Math.max(0, maxRow - htCount) * defH
  info.set(name, { left, colW, orientation, fitToHeight, heightPt })
}

/* ⑤ 방향 기대 — manifest gridTops[].cols(표별 열 경계)에서 표 열 수를 역산, 최대 ≥14면 가로.
 * 생성기(_gs-book50.mts B-11 수리)와 같은 축이되 **재료는 manifest에서 따로 읽는다**. */
interface GT { table: number; top: number; rows: number; cols?: number[] }
const manifest = JSON.parse(readFileSync(resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json'), 'utf8')) as { sheets: { name: string; gridTops: GT[] }[] }
const expectWide = manifest.sheets.map(s => {
  const counts = (s.gridTops ?? []).map(g => (g.cols ?? [0]).length - 1)
  return counts.length ? Math.max(...counts) >= 14 : false
})

let tooLong = 0, tallLabel = 0, empty = 0, checkNotLeft = 0, orientBad = 0, checkTotal = 0
const report: string[] = []

for (const [si, name] of wb.SheetNames.entries()) {
  const ws = wb.Sheets[name]
  const inf = info.get(name)!
  if (!ws['!ref']) { empty++; report.push(`빈 시트: ${name}`); continue }
  /* ⑤ 방향 대조 — 시트 순서는 manifest 순서와 같다(생성기가 전건 아니면 쓰지 않는다) */
  if (manifest.sheets.length === wb.SheetNames.length) {
    const want = expectWide[si] ? 'landscape' : 'portrait'
    if (inf.orientation !== want) {
      orientBad++
      report.push(`${name} 방향 ${inf.orientation} — manifest 기대 ${want}`)
    }
  }
  const CH_PER_COL = inf.colW / 1.6       // 한 열에 들어가는 한글 글자 수 어림(실폭에서)
  const r = XLSX.utils.decode_range(ws['!ref'])
  const merges = ws['!merges'] ?? []
  const spanOf = (R: number, C: number) => {
    const m = merges.find(x => x.s.r === R && x.s.c === C)
    return m ? { cols: m.e.c - m.s.c + 1, rows: m.e.r - m.s.r + 1 } : { cols: 1, rows: 1 }
  }
  const left = inf.left
  for (let R = r.s.r; R <= r.e.r; R++) for (let C = r.s.c; C <= r.e.c; C++) {
    const a = XLSX.utils.encode_cell({ r: R, c: C })
    const cell = ws[a]
    const v = cell && cell.v !== undefined ? String(cell.v).trim() : ''
    if (!v) continue
    const { cols, rows } = spanOf(R, C)
    const cap = Math.max(1, Math.floor(cols * CH_PER_COL))   // 한 줄에 들어갈 글자 수
    const lines = Math.ceil(v.length / cap)
    if (lines > rows && lines >= 2 && v.length > 6) {
      tooLong++
      if (report.length < 400) report.push(`${name} ${a} ${cols}열×${rows}행에 ${v.length}자 → 약 ${lines}줄  «${v.slice(0, 24)}»`)
    }
    if (cols <= 2 && v.length >= 4 && rows >= 2) {
      tallLabel++
      if (report.length < 400) report.push(`${name} ${a} 세로 라벨 ${cols}열 ${v.length}자 → 줄바꿈  «${v.slice(0, 12)}»`)
    }
    if (CHECK.test(v)) {
      checkTotal++
      if (!left.has(a)) {
        checkNotLeft++
        if (report.length < 400) report.push(`${name} ${a} 체크 칸인데 좌정렬 아님  «${v.slice(0, 18)}»`)
      }
    }
  }
}

/* ⑥ 쪽수 근사 — fitToHeight=1 시트는 정의상 1쪽. fitToHeight=0(자연 흘림)만 행높이 합을
 * 인쇄 가능 높이로 나눈다. 폭 축소(fitToWidth)는 1.8 폭에서 축소 없음이 실측이라 1로 본다. */
const MARGIN_PT = 0.45 * 72 * 2
let pagesEst = 0
const flowNote: string[] = []
for (const name of wb.SheetNames) {
  const inf = info.get(name)!
  if (inf.fitToHeight !== 0) { pagesEst += 1; continue }
  const pageH = (inf.orientation === 'landscape' ? 595 : 842) - MARGIN_PT
  const p = Math.max(1, Math.ceil(inf.heightPt / pageH))
  pagesEst += p
  flowNote.push(`${name} ${inf.heightPt.toFixed(0)}pt → 약 ${p}쪽`)
}

const colWs = [...new Set([...info.values()].map(x => x.colW))]
const landN = [...info.values()].filter(x => x.orientation === 'landscape').length
console.log(`시트 ${wb.SheetNames.length}개 점검 (열 폭 실측 ${colWs.join(', ')})\n`)
console.log(`① 칸보다 글자가 긴 곳       ${tooLong}`)
console.log(`② 좁은 칸 세로 라벨(줄바꿈)  ${tallLabel}`)
console.log(`③ 빈 시트                 ${empty}`)
console.log(`④ 체크 칸인데 좌정렬 아님    ${checkNotLeft} (체크 글리프 칸 ${checkTotal})`)
console.log(`⑤ 방향 — 가로 ${landN} · 세로 ${wb.SheetNames.length - landN} · manifest 기대와 불일치 ${orientBad}${manifest.sheets.length !== wb.SheetNames.length ? ` (⚠ 시트 수 ${wb.SheetNames.length} ≠ manifest ${manifest.sheets.length} — 방향 대조 생략)` : ''}`)
console.log(`⑥ 쪽수 근사(행높이 합)      ${pagesEst}쪽${flowNote.length ? ` — 흘림 시트: ${flowNote.join(' · ')}` : ''}`)
console.log(`\n── 상세(앞 40건) ──`)
for (const l of report.slice(0, 40)) console.log('  ' + l)
if (report.length > 40) console.log(`  … 외 ${report.length - 40}건`)

/* ①②는 어림 경보(0이 정상 상태가 아니다) — 실패 축은 ③④⑤다. */
if (empty > 0 || checkNotLeft > 0 || orientBad > 0) {
  console.log(`\n❌ 실패 축: 빈 시트 ${empty} · 체크 좌정렬 위반 ${checkNotLeft} · 방향 불일치 ${orientBad}`)
  process.exitCode = 1
} else {
  console.log('\n✅ 실패 축(③④⑤) 전건 그린')
}
