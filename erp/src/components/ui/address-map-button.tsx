'use client'

import { MapPin } from 'lucide-react'
import { useState } from 'react'
import { AddressMapModal } from './address-map-modal'

/** 주소 → 지도 버튼 (소방계획서_24 S5-7 확산)
 *
 *  모달만 공용으로 두면 **"주소가 없으면 버튼을 그리지 않는다"**는 판단이 붙이는 화면마다
 *  복제된다. 그 판단이 이 기능의 핵심이라 여기 한곳에 둔다 — 눌렀는데 빈 지도가 뜨는 것은
 *  지도가 없는 것보다 나쁘다. 붙이는 쪽은 주소를 그대로 넘기면 되고, null이어도 안전하다.
 *
 *  S5-7이 회귀했던 원인이 "기능이 화면 하나에 묶여 있어 그 화면과 함께 소실된 것"이었다.
 *  붙이는 지점이 늘어도 판단은 한곳이어야 같은 일을 되풀이하지 않는다.
 */
export function AddressMapButton({ customerName, address, className, iconOnly = false, testId = 'address-map-button' }: {
  customerName: string
  /** null·빈 문자열이면 버튼 자체가 그려지지 않는다 */
  address?: string | null
  /** 기본 스타일에 **덧붙는다**(치환이 아니다) — 정렬 보정용 */
  className?: string
  /** 목록처럼 행이 많고 폭이 좁은 자리 — 아이콘만. 판정은 그대로 여기 한곳에 남는다 */
  iconOnly?: boolean
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const addr = address?.trim()
  if (!addr) return null   // ← 이 한 줄이 이 컴포넌트의 존재 이유다

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen(true)}
        title={`지도에서 보기 — ${addr}`}
        className={`inline-flex items-center gap-0.5 shrink-0 text-[11px] text-brand hover:underline align-middle ${className ?? ''}`}
      >
        <MapPin className={iconOnly ? 'size-3.5' : 'size-3'} />
        {!iconOnly && '지도'}
      </button>
      {open && (
        <AddressMapModal customerName={customerName} address={addr} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
