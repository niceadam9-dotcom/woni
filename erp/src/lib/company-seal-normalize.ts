import 'server-only'
import sharp from 'sharp'
import type { SealImage } from '@/lib/company-seal'

/** 직인 업로드 정규화 (C5 마무리, 2026-10-03) — 직인은 대개 흰 종이에 찍어 스캔·촬영한 JPEG다.
 *  그대로 명의 위에 겹치면 **흰 사각형이 글자를 가린다** — 밝은 바탕을 투명으로 바꾼 PNG로 저장한다. */

/** 저장 장변(px). 인쇄 크기 약 2cm에 300dpi면 236px — 여유를 두고 600 */
const SEAL_LONG_EDGE = 600
/** 이 밝기(0~255, RGB 모두) 이상인 바탕 픽셀은 투명으로 */
const WHITE_CUTOFF = 225

/** 올린 원본(PNG·JPEG·WebP) → 바탕 투명·여백 제거·장변 600px PNG. 이미지가 아니면 throw */
export async function normalizeSeal(input: Uint8Array): Promise<SealImage> {
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = new Uint8Array(data.buffer, data.byteOffset, data.length)
  let visible = 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] >= WHITE_CUTOFF && px[i + 1] >= WHITE_CUTOFF && px[i + 2] >= WHITE_CUTOFF) px[i + 3] = 0
    else if (px[i + 3] > 0) visible++
  }
  if (visible === 0) throw new Error('직인 이미지에 보이는 부분이 없습니다(전부 흰 바탕).')
  const trimmed = await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png().toBuffer()
  const { data: out, info: oi } = await sharp(trimmed)
    .trim({ threshold: 1 })
    .resize(SEAL_LONG_EDGE, SEAL_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true })
  return { png: new Uint8Array(out), width: oi.width, height: oi.height }
}

