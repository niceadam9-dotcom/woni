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
        onclose?: () => void
        width?: string | number
        height?: string | number
        theme?: Record<string, string>
      }) => { open: () => void; embed: (el: HTMLElement) => void }
    }
  }
}

export function useDaumPostcode() {
  useEffect(() => {
    if (document.getElementById('daum-postcode-script')) return
    const s = document.createElement('script')
    s.id = 'daum-postcode-script'
    s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
    s.async = true
    document.head.appendChild(s)
  }, [])

  // 레이어(임베드) 방식 — 구 팝업(open) 방식은 브라우저 팝업 차단기에 걸리면 클릭해도 무반응
  // (2026-08-04 주소 조회 불가 이슈). 화면 안 오버레이에 임베드해 차단기와 무관하게 동작.
  return (onComplete: (data: DaumPostcodeData) => void) => {
    if (!window.daum?.Postcode) {
      alert('주소 검색 서비스를 불러오는 중입니다. 잠시 후 다시 시도해주세요.\n(계속 안 되면 인터넷 연결을 확인해주세요)')
      return
    }
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center'
    const box = document.createElement('div')
    box.style.cssText = 'width:min(440px,94vw);height:min(540px,86vh);background:#fff;border-radius:12px;overflow:hidden;position:relative;box-shadow:0 10px 40px rgba(0,0,0,.25)'
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '✕ 닫기'
    close.style.cssText = 'position:absolute;top:0;right:0;z-index:1;font-size:12px;padding:6px 10px;background:#fff;border:none;border-bottom-left-radius:8px;cursor:pointer;color:#514b81'
    const inner = document.createElement('div')
    inner.style.cssText = 'width:100%;height:100%'
    box.appendChild(inner)
    box.appendChild(close)
    wrap.appendChild(box)
    document.body.appendChild(wrap)
    const destroy = () => wrap.remove()
    close.onclick = destroy
    wrap.onclick = e => { if (e.target === wrap) destroy() }
    new window.daum.Postcode({
      oncomplete: data => { destroy(); onComplete(data) },
      width: '100%',
      height: '100%',
    }).embed(inner)
  }
}
