/** 표지 사진이 **정말 가운데인가** — 스크린샷 눈대중 말고 산출물 좌표로 답한다(일회용).
 *
 *  화면 실측(image-26)에서 사진 중심이 제목 중심보다 약 9.5px 왼쪽으로 나왔다. 그런데
 *  `fit()`의 `padX = (boxW - w) / 2`는 대칭이라 계산만 보면 어긋날 이유가 없다.
 *  **고치기 전에 진짜 어긋나는지** 제품 코드 그대로 돌려 좌우 여백을 직접 센다 —
 *  아닌 걸 고치면 멀쩡한 코드를 망가뜨린다.
 *
 *  재는 법: 실제 템플릿의 표지 사진 상자 기하를 읽고, 제품의 `colPx`·`fit`·`splitOffset`과
 *  **같은 산식**으로 앵커를 만든 뒤 → 앵커를 다시 px로 풀어 왼쪽 여백을 얻고,
 *  오른쪽 여백 = boxW - 왼쪽 - 그림폭. 둘이 다르면 그 차이가 곧 치우침이다.
 *
 *  실행: npx tsx scripts/_probe-cover-photo-center.mts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/* 제품과 같은 산식(fire-plan-xlsx-images.ts에서 그대로 옮긴다 — 다르면 이 프로브가 거짓말이 된다) */
const BOX_PAD = 4
const colPx = (w: number) => Math.floor((Math.floor(256 * w + Math.floor(128 / 7)) / 256) * 7)
const rowPx = (pt: number) => Math.round(pt * 96 / 72)
function fit(imgW: number, imgH: number, boxW: number, boxH: number) {
  const innerW = Math.max(1, boxW - BOX_PAD * 2)
  const innerH = Math.max(1, boxH - BOX_PAD * 2)
  const scale = Math.min(innerW / imgW, innerH / imgH)
  const w = Math.max(1, Math.round(imgW * scale))
  const h = Math.max(1, Math.round(imgH * scale))
  return { w, h, padX: Math.max(0, Math.floor((boxW - w) / 2)), padY: Math.max(0, Math.floor((boxH - h) / 2)) }
}
function splitOffset(sizes: number[], pad: number): { i: number; off: number } {
  let i = 0, rest = pad
  while (i < sizes.length - 1 && rest >= sizes[i]) { rest -= sizes[i]; i++ }
  return { i, off: Math.max(0, Math.round(rest)) }
}

/* ── 템플릿에서 표지 사진 상자의 실제 기하를 읽는다 ── */
const zip = await JSZip.loadAsync(readFileSync(resolve(ROOT, 'templates/fire-plan-workbook.xlsx')))
const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')

const colW = new Map<number, number>()
for (const m of sheet.matchAll(/<col min="(\d+)" max="(\d+)" width="([\d.]+)"/g)) {
  for (let c = Number(m[1]); c <= Number(m[2]); c++) colW.set(c, Number(m[3]))
}
/* 🚨 `ht="` 앞에 **공백을 반드시** 둔다 — 안 두면 탐욕 매칭이 `customHeight="1"` 안의
 *   `ht="1"`을 물어 **행 높이가 전부 1로 읽힌다**(이 프로브 첫 판에서 실제로 그랬다). */
const rowH = new Map<number, number>()
for (const m of sheet.matchAll(/<row r="(\d+)"[^>]*\sht="([\d.]+)"/g)) rowH.set(Number(m[1]), Number(m[2]))

/* 사진 상자 = 「[대상물 전경 위성사진]」 안내가 앉은 칸의 병합 범위.
 * ⚠ 칸 하나만 보게 `<c …>…</c>` 안으로 가둔다 — 안 가두면 앞 칸에서 시작해 뒤 칸의 <t>를 물어
 *   엉뚱한 좌표가 나온다(첫 판이 N2를 집었다). */
const PHOTO_LABEL = '[대상물 전경 위성사진]'
const cellRe = /<c r="([A-Z]+)(\d+)"[^>]*?>((?:(?!<c )[\s\S])*?)<\/c>/g
let photoRef = ''
for (const m of sheet.matchAll(cellRe)) {
  const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(m[3])?.[1]
  if (t === PHOTO_LABEL) photoRef = `${m[1]}${m[2]}`
}
if (!photoRef) { console.log('사진 상자 안내 글자를 못 찾았다 — 템플릿이 바뀌었나'); process.exit(1) }
const merge = [...sheet.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)]
  .find(m => m[1] === photoRef)
if (!merge) { console.log(`${photoRef} 병합 범위를 못 찾았다`); process.exit(1) }

const colNum = (s: string) => [...s].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0)
const c1 = colNum(/^[A-Z]+/.exec(merge[1])![0]), c2 = colNum(/^[A-Z]+/.exec(merge[2])![0])
const r1 = Number(/\d+$/.exec(merge[1])![0]), r2 = Number(/\d+$/.exec(merge[2])![0])

const colSizes: number[] = []
for (let c = c1; c <= c2; c++) colSizes.push(colPx(colW.get(c) ?? 8.43))
const rowSizes: number[] = []
for (let r = r1; r <= r2; r++) rowSizes.push(rowPx(rowH.get(r) ?? 15))
const boxW = colSizes.reduce((a, b) => a + b, 0)
const boxH = rowSizes.reduce((a, b) => a + b, 0)
console.log(`사진 상자 ${merge[1]}:${merge[2]} — ${colSizes.length}열 × ${rowSizes.length}행 = ${boxW}×${boxH}px`)
console.log(`  열 폭 ${[...new Set(colSizes)].join('/')}px · 행 높이 ${rowSizes.join('/')}px\n`)

/* ── 여러 화면비로 좌우 여백을 잰다 ── */
const CASES: Array<[string, number, number]> = [
  ['4:3 위성사진', 1600, 1200],
  ['3:2', 1800, 1200],
  ['16:9', 1920, 1080],
  ['1:1', 1200, 1200],
  ['세로 3:4', 1200, 1600],
]
let bad = 0
for (const [name, iw, ih] of CASES) {
  const g = fit(iw, ih, boxW, boxH)
  const cx = splitOffset(colSizes, g.padX)
  // 앵커를 **다시 px로 푼다** — 이게 엑셀이 실제로 그리는 자리다
  let left = 0
  for (let k = 0; k < cx.i; k++) left += colSizes[k]
  left += cx.off
  const right = boxW - left - g.w
  const diff = right - left
  if (Math.abs(diff) > 1) bad++
  console.log(`${name.padEnd(12)} 그림 ${String(g.w).padStart(4)}×${String(g.h).padStart(3)}px`
    + ` · 왼 ${String(left).padStart(3)} / 오 ${String(right).padStart(3)}`
    + ` · 차 ${diff > 0 ? '+' : ''}${diff}px ${Math.abs(diff) <= 1 ? '✔ 가운데' : '✘ 치우침'}`)
}
console.log(`\n${bad ? `❌ ${bad}건 치우침 — 코드 결함` : '✅ 전건 대칭 — 계산은 가운데가 맞다'}`)
