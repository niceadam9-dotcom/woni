/** 50시트 자동 점검 — 눈으로 다 볼 수 없으니 기계가 의심 자리를 짚는다.
 *
 *  본다: ①글자가 칸 폭에 비해 너무 김(줄바꿈·잘림 위험) ②세로로 눌리는 라벨 ③빈 시트
 *  ④병합 없는 외톨이 값 ⑤체크 글리프가 좌정렬 서식을 못 받은 칸
 *  실행: npx tsx scripts/_47-inspect.mts <xlsx>
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'

const SRC = process.argv[2] ?? 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서_v2.xlsx'
const CHECK = /^\s*[□☐■▣☑☒✓✔]/
const COL_W = 2.2                    // 미세 격자 열 폭(문자 단위)
const CH_PER_COL = COL_W / 1.6       // 한 열에 들어가는 한글 글자 수 어림

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
const styleOf = new Map<string, Set<string>>()
for (const [i, name] of wb.SheetNames.entries()) {
  const xml = await zip.file(`xl/worksheets/sheet${i + 1}.xml`)!.async('string')
  const set = new Set<string>()
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*s="(\d+)"/g)) {
    if (xfAlign[Number(m[2])] === 'left') set.add(m[1])
  }
  styleOf.set(name, set)
}

let tooLong = 0, tallLabel = 0, empty = 0, checkNotLeft = 0
const report: string[] = []

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  if (!ws['!ref']) { empty++; report.push(`빈 시트: ${name}`); continue }
  const r = XLSX.utils.decode_range(ws['!ref'])
  const merges = ws['!merges'] ?? []
  const spanOf = (R: number, C: number) => {
    const m = merges.find(x => x.s.r === R && x.s.c === C)
    return m ? { cols: m.e.c - m.s.c + 1, rows: m.e.r - m.s.r + 1 } : { cols: 1, rows: 1 }
  }
  const left = styleOf.get(name)!
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
    if (CHECK.test(v) && !left.has(a)) {
      checkNotLeft++
      if (report.length < 400) report.push(`${name} ${a} 체크 칸인데 좌정렬 아님  «${v.slice(0, 18)}»`)
    }
  }
}

console.log(`시트 ${wb.SheetNames.length}개 점검\n`)
console.log(`① 칸보다 글자가 긴 곳       ${tooLong}`)
console.log(`② 좁은 칸 세로 라벨(줄바꿈)  ${tallLabel}`)
console.log(`③ 빈 시트                 ${empty}`)
console.log(`④ 체크 칸인데 좌정렬 아님    ${checkNotLeft}`)
console.log(`\n── 상세(앞 40건) ──`)
for (const l of report.slice(0, 40)) console.log('  ' + l)
if (report.length > 40) console.log(`  … 외 ${report.length - 40}건`)
