/** 특정 시트의 칸별 **실제 정렬**을 찍는다 — 눈으로 짐작하지 않고 스타일 인덱스로 판정한다.
 *  사용: npx tsx scripts/_47-align-check.mts <xlsx> <시트인덱스> */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'

const SRC = process.argv[2] ?? 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서_v5.xlsx'
const IDX = Number(process.argv[3] ?? 10)

const zip = await JSZip.loadAsync(readFileSync(SRC))
/* styles.xml에서 xf → 정렬·색을 읽는다(상수를 다시 적지 않는다) */
const styles = await zip.file('xl/styles.xml')!.async('string')
/* ⚠ 자기닫힘 `<xf …/>`도 잡아야 한다 — 1차 정규식이 기본 xf를 놓쳐 **인덱스가 한 칸 밀렸고**
 *   멀쩡한 정렬을 「밀렸다」고 오독할 뻔했다. 측정 도구가 틀리면 제품을 잘못 고친다. */
const xfs = [...(styles.match(/<cellXfs[^>]*>[\s\S]*?<\/cellXfs>/)?.[0] ?? '').matchAll(/<xf[\s\S]*?(?:\/>|<\/xf>)/g)].map(m => m[0])
const fonts = [...(styles.match(/<fonts[\s\S]*?<\/fonts>/)?.[0] ?? '').matchAll(/<font>[\s\S]*?<\/font>/g)].map(m => m[0])
const alignOf = (s: number) => /horizontal="([a-z]+)"/.exec(xfs[s] ?? '')?.[1] ?? '(기본)'
const colorOf = (s: number) => {
  const fid = Number(/fontId="(\d+)"/.exec(xfs[s] ?? '')?.[1] ?? 0)
  return /rgb="FF([0-9A-F]{6})"/.exec(fonts[fid] ?? '')?.[1] ?? '000000'
}

const wb = XLSX.read(readFileSync(SRC), { sheetStubs: true })
const name = wb.SheetNames[IDX]
const xml = await zip.file(`xl/worksheets/sheet${IDX + 1}.xml`)!.async('string')
const sOf = new Map<string, number>()
for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*s="(\d+)"/g)) sOf.set(m[1], Number(m[2]))

const ws = wb.Sheets[name]
const r = XLSX.utils.decode_range(ws['!ref']!)
console.log(`[${IDX}] «${name}»\n`)
for (let R = r.s.r; R <= r.e.r; R++) {
  const out: string[] = []
  for (let C = r.s.c; C <= r.e.c; C++) {
    const a = XLSX.utils.encode_cell({ r: R, c: C })
    const cell = ws[a]
    if (!cell || cell.v === undefined || !String(cell.v).trim()) continue
    const s = sOf.get(a) ?? 0
    const col = colorOf(s)
    out.push(`${a}[${alignOf(s)}${col !== '000000' ? '/#' + col : ''}]=${String(cell.v).replace(/\s+/g, ' ').trim().slice(0, 20)}`)
  }
  if (out.length) console.log(` r${String(R + 1).padStart(2)} | ${out.join('  ')}`)
}
