/** 한 칸만 크게 — 적용본 위, 대조군 아래. 픽셀 수치를 믿기 전에 **무엇을 재고 있는지** 본다. */
import sharp from 'sharp'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const [a, b, yf, hf, xf, wf, zs] = process.argv.slice(2)
const z = Number(zs ?? 4)

const strip = async (src: string) => {
  const m = await sharp(src).metadata()
  return sharp(src).extract({
    left: Math.round(m.width! * Number(xf)), top: Math.round(m.height! * Number(yf)),
    width: Math.round(m.width! * Number(wf)), height: Math.round(m.height! * Number(hf)),
  }).resize({ width: Math.round(m.width! * Number(wf) * z), kernel: 'nearest' }).png().toBuffer()
}
const [A, B] = [await strip(a), await strip(b)]
const ma = await sharp(A).metadata(), mb = await sharp(B).metadata()
const out = resolve(HERE, '../.test-shots/checkbox-mb/_zoom2.png')
await sharp({ create: { width: Math.max(ma.width!, mb.width!), height: ma.height! + mb.height! + 10, channels: 3, background: '#dddddd' } })
  .composite([{ input: A, top: 0, left: 0 }, { input: B, top: ma.height! + 10, left: 0 }]).png().toFile(out)
console.log(`→ ${out}  (위=적용 · 아래=대조군)`)
