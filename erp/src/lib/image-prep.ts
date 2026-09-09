/** 업로드 전 클라이언트 이미지 준비 — EXIF 회전 보정 + 장변 제한 리사이즈(JPEG q0.85).
 *
 *  H-11(지도·사진 카드)에서 시작한 로직을 공용화(2026-09-05): 불량 전/후 사진 4경로가 휴대폰
 *  원본(5~12MB)을 그대로 올리다 inspection-defects 버킷의 file_size_limit 5MB에 거절당했다
 *  ("The object exceeded the maximum allowed size" — 6MB/4MB 대조 실측). 여기서 줄이면
 *  수백 KB가 되어 제한에 원천적으로 안 걸리고, 현장 LTE 업로드도 빨라진다.
 *
 *  ⚠ 클라이언트 전용(canvas·createImageBitmap) — 'use client' 컴포넌트에서만 부를 것.
 *  서버 sharp 의존을 두지 않기 위한 선택이다(H-11과 같은 이유). */

const MAX_EDGE = 1600

/** 작은 png/webp는 원본 유지, jpeg는 EXIF 회전 반영을 위해 크기와 무관하게 재인코딩.
 *  디코드 실패(손상 파일·미지원 형식)는 원본 그대로 반환 — 서버·버킷 검증에 맡긴다. */
export async function prepareImageFile(file: File, maxEdge: number = MAX_EDGE): Promise<File> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const long = Math.max(bmp.width, bmp.height)
    const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)
    if (long <= maxEdge && !isJpeg) { bmp.close(); return file }
    const scale = Math.min(1, maxEdge / long)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) { bmp.close(); return file }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85))
    if (!blob) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
