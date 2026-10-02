/** 이미지 업로드 공용 가드 (통합 실행계획 A2, 2026-10-02)
 *
 *  종전엔 업로드 경로 셋이 각자 검사했다 — 고객 자산(asset-actions)·소방계획서 첨부(fire-plan-form-actions)는
 *  확장자 허용목록 + 10MB, 불량 사진(defect-actions)은 **검사 0**(클라이언트의 확장자·Content-Type을 그대로 저장).
 *  여기서 하나로 모은다: 확장자 허용목록 → 크기 상한 → **파일 머리 바이트(매직 넘버) 대조** → 서버가 정한 Content-Type.
 *  클라이언트가 보낸 file.type은 쓰지 않는다. `.exe`를 `.jpg`로 이름만 바꿔 올리면 머리 바이트에서 걸린다.
 *
 *  종류 둘:
 *   - 'document' — 문서 재료(표지·위치도·피난도): jpg/jpeg/png/webp. 종전 두 경로의 허용목록 그대로.
 *   - 'photo'    — 현장 촬영(불량 전·후): 위에 gif/heic/heif 추가. 휴대폰 카메라 원본을 거절하지 않기 위해서다. */

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024   // 10MB — next.config의 서버 액션 상한 20MB 안

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
}
export type ImageKind = 'document' | 'photo'
const KIND_EXTS: Record<ImageKind, readonly string[]> = {
  document: ['jpg', 'jpeg', 'png', 'webp'],
  photo: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'],
}

export type ImageCheck =
  | { ok: true; ext: string; contentType: string; buffer: Buffer }
  | { ok: false; error: string }

/** 머리 바이트로 실제 형식을 읽는다. 모르면 null. */
export function sniffImageFormat(head: Uint8Array): 'jpeg' | 'png' | 'webp' | 'gif' | 'heif' | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg'
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
    && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return 'png'
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to))
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (head.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif'
  if (head.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12)
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif'].includes(brand)) return 'heif'
  }
  return null
}

const FORMAT_OF_EXT: Record<string, ReturnType<typeof sniffImageFormat>> = {
  jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', heic: 'heif', heif: 'heif',
}

function allowedLabel(kind: ImageKind): string {
  return kind === 'photo' ? 'JPG/PNG/WebP/GIF/HEIC' : 'JPG/PNG/WebP'
}

/** 확장자·크기·머리 바이트를 검사하고, 통과하면 서버가 정한 Content-Type과 본문 버퍼를 돌려준다. */
export async function checkImageUpload(
  file: File, kind: ImageKind = 'document', maxBytes: number = IMAGE_MAX_BYTES,
): Promise<ImageCheck> {
  if (!file || file.size === 0) return { ok: false, error: '파일을 선택해주세요.' }
  if (file.size > maxBytes) return { ok: false, error: `이미지는 ${Math.round(maxBytes / 1048576)}MB 이하여야 합니다.` }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!KIND_EXTS[kind].includes(ext)) return { ok: false, error: `${allowedLabel(kind)} 이미지만 업로드할 수 있습니다.` }
  const buffer = Buffer.from(await file.arrayBuffer())
  const format = sniffImageFormat(buffer.subarray(0, 16))
  if (!format || format !== FORMAT_OF_EXT[ext]) {
    return { ok: false, error: '파일 내용이 이미지 형식과 다릅니다. 확장자를 바꾼 파일은 올릴 수 없습니다.' }
  }
  return { ok: true, ext, contentType: EXT_MIME[ext], buffer }
}
