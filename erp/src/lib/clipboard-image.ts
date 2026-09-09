'use client'

/** 클립보드 이미지 읽기 — 지도·화면을 캡처(Win+Shift+S)한 뒤 [붙여넣기] 버튼용.
 *
 *  customer-assets-client의 지역 함수였다(2026-08-05). 서식 1.3 진입 경로도·삽입 사진의
 *  ImageSlot이 같은 창구를 갖게 되면서 공용화(2026-09-08) — 두 벌로 두면 한쪽만 고쳐지고
 *  '슬롯에선 되는데 경로도에선 안 되는' 차이가 다시 생긴다.
 *
 *  ⚠ 클라이언트 전용(navigator.clipboard) — 'use client' 컴포넌트에서만 부를 것. */
export async function readClipboardImage(): Promise<File | null> {
  try {
    if (!navigator.clipboard?.read) return null
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find(t => t.startsWith('image/'))
      if (type) {
        const blob = await item.getType(type)
        const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
        return new File([blob], `clipboard.${ext}`, { type })
      }
    }
    return null
  } catch {
    return null   // 권한 거부·미지원 브라우저 — 호출부에서 안내
  }
}

/** 붙여넣기 실패 시 화면에 띄우는 공통 문구 — 세 창구(슬롯·경로도·사진)가 같은 말을 하도록 */
export const CLIPBOARD_EMPTY_MSG =
  '클립보드에 이미지가 없습니다 — 지도 화면을 캡처(Win+Shift+S)한 뒤 다시 눌러주세요.'
