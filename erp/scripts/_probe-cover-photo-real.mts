/** 표지 사진 치우침 — **제품 코드를 그대로 돌려** 산출물 좌표로 판정한다(일회용).
 *
 *  스크린샷으로는 결론이 안 났다: image-27은 오른쪽이 잘려 내용 폭의 오른쪽 끝을 모른다.
 *  ①(글자 기준)·②(표 기준) 둘 다 기준자를 못 세웠다. 그래서 **추측을 그만두고 실제로 만든다** —
 *  `embedFirePlanImages`(운영 라우트가 쓰는 바로 그 함수)로 그림을 앉히고, 나온 drawing XML의
 *  `from.col/colOff` + `ext.cx`를 읽어 상자 안에서의 좌우 여백을 센다.
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-cover-photo-real.mts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import { embedFirePlanImages } from '../src/lib/fire-plan-xlsx-images.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const EMU = 9525

const tpl = readFileSync(resolve(ROOT, 'templates/fire-plan-workbook.xlsx'))

/* 상자 기하를 템플릿에서 읽는다(제품 `readGeometry`와 같은 산식) */
const z0 = await JSZip.loadAsync(tpl)
const sheet1 = await z0.file('xl/worksheets/sheet1.xml')!.async('string')
const colPx = (w: number) => Math.floor((Math.floor(256 * w + Math.floor(128 / 7)) / 256) * 7)
const colW = new Map<number, number>()
for (const m of sheet1.matchAll(/<col min="(\d+)" max="(\d+)" width="([\d.]+)"/g))
  for (let c = Number(m[1]); c <= Number(m[2]); c++) colW.set(c, Number(m[3]))
const colSizes: number[] = []
for (let c = 1; c <= 60; c++) colSizes.push(colPx(colW.get(c) ?? 8.43))
const boxW = colSizes.reduce((a, b) => a + b, 0)

const CASES: Array<[string, number, number]> = [
  ['4:3 위성사진', 1600, 1200], ['3:2', 1800, 1200], ['16:9', 1920, 1080], ['세로 3:4', 1200, 1600],
]

console.log(`표지 사진 상자 폭 = ${boxW}px (60열)\n`)
let bad = 0
for (const [name, iw, ih] of CASES) {
  // 단색이면 sharp가 극단 최적화를 할 수 있어 **잡음을 넣은** 실사에 가까운 이미지를 만든다
  const noise = Buffer.alloc(iw * ih * 3)
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 251
  const png = await sharp(noise, { raw: { width: iw, height: ih, channels: 3 } }).png().toBuffer()

  const out = await embedFirePlanImages(new Uint8Array(tpl), [{
    sheet: '표지', cell: 'A5', descr: `테스트 ${name}`, data: new Uint8Array(png),
  }])
  const z = await JSZip.loadAsync(out.bytes)
  const dname = Object.keys(z.files).find(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n))
  if (!dname) { console.log(`${name}: drawing 파트가 없다 (placed=${out.placed}, ${out.notes.join('; ')})`); bad++; continue }
  const dxml = await z.file(dname)!.async('string')
  const from = /<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(\d+)<\/xdr:colOff>/.exec(dxml)
  const ext = /<xdr:ext cx="(\d+)" cy="(\d+)"\/>/.exec(dxml)
  if (!from || !ext) { console.log(`${name}: 앵커를 못 읽었다`); bad++; continue }

  const fromCol = Number(from[1])          // 0-based
  const colOff = Number(from[2]) / EMU
  const cx = Number(ext[1]) / EMU
  let left = 0
  for (let k = 0; k < fromCol; k++) left += colSizes[k]
  left += colOff
  const right = boxW - left - cx
  const diff = Math.round(right - left)
  if (Math.abs(diff) > 1) bad++
  console.log(`${name.padEnd(12)} 그림 ${cx.toFixed(0).padStart(4)}px · from col ${String(fromCol).padStart(2)} +${colOff.toFixed(0)}px`
    + ` → 왼 ${left.toFixed(0).padStart(3)} / 오 ${right.toFixed(0).padStart(3)} · 차 ${diff > 0 ? '+' : ''}${diff}px`
    + ` ${Math.abs(diff) <= 1 ? '✔' : '✘ 치우침'}`)
}
console.log(`\n${bad ? `❌ ${bad}건 문제` : '✅ 산출물에서도 전건 대칭'}`)
