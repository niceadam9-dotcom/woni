'use client'

import { useEffect } from 'react'

export type DaumPostcodeData = {
  zonecode: string      // 우편번호
  roadAddress: string   // 도로명주소
  jibunAddress: string  // 지번주소
  bcode?: string        // 법정동코드 10자리 (건축물대장 API 조회용)
  sido: string          // 시/도
  sigungu: string       // 시/군/구
  bname: string         // 법정동명
  bname1: string        // 읍면 (법정읍면동 앞부분)
  bname2: string        // 리/동 (법정동 뒷부분)
  roadname: string      // 도로명
  buildingName: string  // 건물명
  apartment: string     // 공동주택 여부 ('Y'/'N')
}

declare global {
  interface Window {
    daum?: {
      Postcode: new (opts: {
        oncomplete: (data: DaumPostcodeData) => void
        theme?: Record<string, string>
      }) => { open: () => void }
    }
  }
}

export function useDaumPostcode() {
  useEffect(() => {
    if (document.getElementById('daum-postcode-script')) return
    const s = document.createElement('script')
    s.id = 'daum-postcode-script'
    s.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
    s.async = true
    document.head.appendChild(s)
  }, [])

  return (onComplete: (data: DaumPostcodeData) => void) => {
    if (!window.daum?.Postcode) {
      alert('주소 검색 서비스를 불러오는 중입니다. 잠시 후 다시 시도해주세요.')
      return
    }
    new window.daum.Postcode({ oncomplete: onComplete }).open()
  }
}
