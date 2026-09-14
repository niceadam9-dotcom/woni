/** 컨트롤이 원래 상자 자리에서 **얼마나 밀렸는가**를 픽셀로 잰다.
 *
 *  컨트롤은 칸 왼쪽 끝에 서는데 글자는 `indent=1`만큼 안쪽에서 시작한다(적격 599칸 전부 동일).
 *  그 차이를 눈대중으로 고치면 또 눈대중이 된다 — 같은 행을 **적용본·대조군**에서 각각 굽고,
 *  잉크가 있는 x 구간을 세어 **첫 잉크 덩어리의 왼쪽 끝**을 비교한다.
 *
 *  실행: npx tsx scripts/_probe-cb-xshift.mts <적용.png> <대조군.png> <yFrac> <hFrac> <xFrom>
 */
import sharp from 'sharp'

const [a, b, yf, hf, xf] = process.argv.slice(2)
const yFrac = Number(yf), hFrac = Number(hf), xFrom = Number(xf ?? 0)

/** 잉크가 있는 x 구간(런)을 왼쪽부터 나열 */
async function runs(src: string): Promise<{ w: number; pageW: number; list: [number, number][] }> {
  const m = await sharp(src).metadata()
  const top = Math.round(m.height! * yFrac)
  const h = Math.max(6, Math.round(m.height! * hFrac))
  const left = Math.round(m.width! * xFrom)
  const w = m.width! - left
  const { data } = await sharp(src).extract({ left, top, width: w, height: h })
    .greyscale().raw().toBuffer({ resolveWithObject: true })
  const dark: boolean[] = []
  for (let x = 0; x < w; x++) {
    let n = 0
    for (let y = 0; y < h; y++) if (data[y * w + x] < 140) n++
    dark.push(n > 0)
  }
  const list: [number, number][] = []
  let s = -1
  for (let x = 0; x <= w; x++) {
    if (x < w && dark[x]) { if (s < 0) s = x }
    else if (s >= 0) { if (x - s >= 2) list.push([s + left, x + left]); s = -1 }
  }
  return { w, pageW: m.width!, list }
}

const A = await runs(a), B = await runs(b)
console.log(`적용본  잉크 런 ${A.list.length}개: ${A.list.slice(0, 6).map(([s, e]) => `${s}~${e}`).join(' ')}`)
console.log(`대조군  잉크 런 ${B.list.length}개: ${B.list.slice(0, 6).map(([s, e]) => `${s}~${e}`).join(' ')}`)
if (A.list.length && B.list.length) {
  const pxPerPt = A.pageW / 595.3          // A4 세로 폭 595.3pt
  const d = A.list[0][0] - B.list[0][0]
  console.log(`\n첫 상자 왼쪽 끝: 적용 ${A.list[0][0]}px · 대조군 ${B.list[0][0]}px`)
  console.log(`→ 어긋남 ${d}px(렌더) = ${(d / pxPerPt).toFixed(2)}pt = ${(d / pxPerPt / 0.75).toFixed(2)}px(엑셀 96dpi)`)
}
