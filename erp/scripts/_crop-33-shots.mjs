// 별지 9호 상단(점검 구분 체크칸)만 잘라 확대 — 축소본으로는 두부/실글리프가 구별되지 않는다.
import sharp from 'sharp'
import { readdirSync } from 'fs'

const DIR = 'F:/AI/ERP/_shots33'
for (const f of readdirSync(DIR).filter(f => f.startsWith('report9') && f.endsWith('.png'))) {
  const src = `${DIR}/${f}`
  const meta = await sharp(src).metadata()
  const w = Math.min(meta.width, 1200)
  console.log(`${f}: ${meta.width}x${meta.height}`)
  await sharp(src)
    .extract({ left: 0, top: 30, width: w, height: 100 })
    .resize({ width: w * 2, kernel: 'nearest' })
    .toFile(`${DIR}/crop-${f}`)
  console.log(`  -> crop-${f}`)
}
