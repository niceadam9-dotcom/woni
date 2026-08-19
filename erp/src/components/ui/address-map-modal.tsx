'use client'

import { X, ExternalLink, MapPin, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'

/** 주소 지도 모달 — 방문 준비용 (소방계획서_24 S5-7)
 *
 *  폐지된 점검현황 모니터링에 있던 KakaoMapModal을 **공용 컴포넌트로 되살린 것**이다.
 *  그 화면을 지우면서 함께 사라졌는데(대체 없이 소실), 담당자가 "이 고객이 어디쯤인가"를
 *  확인하던 수단이라 지역 순회 준비에서 아쉬웠다.
 *
 *  되살리기 전에 **실제로 그려지는지 확인했다**(scripts/_probe-kakao-iframe.mts) —
 *  프레임이 막히면 빈 상자만 남고, 그건 지도가 없는 것보다 나쁘다(눌렀는데 아무것도 안 나온다).
 *  카카오는 X-Frame-Options를 걸지 않아 렌더된다(2026-08-19 실측: 픽셀 83종).
 *
 *  다만 iframe은 **남의 서비스에 기대는 것**이라 언제든 막힐 수 있다.
 *  그래서 [새 창에서 열기]를 항상 함께 둔다 — 프레임이 죽어도 길은 남는다.
 *  주소 복사도 붙인다(내비에 찍어 넣는 것이 실제 동선이다).
 */
export function AddressMapModal({ customerName, address, onClose }: {
  customerName: string
  address: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const q = encodeURIComponent(address)
  const embedUrl = `https://map.kakao.com/link/search/${q}`
  const openUrl = `https://map.kakao.com/?q=${q}`

  function copyAddress() {
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* 클립보드 권한 없음 — 주소가 화면에 그대로 보이니 손으로 복사할 수 있다 */ })
  }

  // 붙는 자리와 무관하게 뜨도록 body에 그린다.
  //  ① 행 전체가 클릭 대상인 표(ClickableRow) 안에 두면, 배경을 눌러 닫는 클릭이 그 행까지
  //     올라가 **닫자마자 다른 페이지로 튕긴다**(배경 div는 a·button이 아니라 예외에 안 걸린다).
  //  ② overflow-hidden·transform이 걸린 조상 아래에서는 fixed가 그 상자에 갇혀 잘린다.
  // 열림 자체가 사용자 조작 이후라 서버 렌더 시점에는 그려지지 않는다(하이드레이션 불일치 없음).
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        data-testid="address-map-modal"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[#eceaf8]">
          <MapPin className="size-4 text-[#7b68ee] shrink-0" />
          <h2 className="text-sm font-semibold text-[#090c1d] truncate">{customerName}</h2>
          <button onClick={copyAddress}
            title="주소 복사 — 내비에 붙여 넣기"
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#514b81] hover:bg-[#f5f4ff] transition-colors shrink-0">
            {copied ? <><Check className="size-3 text-emerald-600" /> 복사됨</> : <><Copy className="size-3" /> 주소 복사</>}
          </button>
          <a href={openUrl} target="_blank" rel="noopener noreferrer"
            title="카카오맵에서 열기 — 길찾기는 여기서"
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors shrink-0">
            <ExternalLink className="size-3" /> 새 창
          </a>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-[#f5f4ff] text-[#8b87b8] shrink-0">
            <X className="size-4" />
          </button>
        </div>

        <p className="px-5 py-2 text-[11px] text-[#514b81] border-b border-[#f5f4ff] break-all">{address}</p>

        <div className="relative h-[460px]">
          <iframe
            src={embedUrl}
            className="w-full h-full border-0 rounded-b-2xl"
            title={`${customerName} 위치`}
            loading="lazy"
          />
          {/* 프레임이 막히면 이 문구가 빈 화면 뒤에 남아 다음 행동을 알려준다 */}
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] text-[#b0acd6]">
            지도가 안 보이면 위 [새 창]으로 열어주세요
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
