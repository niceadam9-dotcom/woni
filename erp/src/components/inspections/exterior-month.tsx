'use client'

import { createContext, useContext, useState } from 'react'

/** EX-4(소방계획서_19, 마이그레이션 125) — 외관점검표 '점검 월' 공유 상태.
 *
 *  외관점검표는 12개월 연간 서식이라 응답이 (점검건, 항목, **월**)로 저장된다.
 *  월 선택기는 점검표 입력 카드에 있지만 **음성 입력 카드도 같은 페이지의 형제**라,
 *  월을 지역 상태로 두면 "7월을 골라놓고 음성으로 저장했는데 시작월에 찍히는" 오귀속이 난다
 *  (독립 검증 2회차에서 실증 — 게다가 달을 바꿔 반복하면 month=0 한 행을 덮어써 이전 입력이 사라졌다).
 *  그래서 월은 두 카드를 감싸는 이 provider가 단일 원천으로 들고 있는다.
 *
 *  0 = 점검일 기준(기본·레거시) — 조립이 그 점검 건의 시작월로 폴백한다. */
type Ctx = { month: number; setMonth: (m: number) => void; isExterior: boolean }

const ExteriorMonthContext = createContext<Ctx | null>(null)

export function ExteriorMonthProvider({ isExterior, children }: { isExterior: boolean; children: React.ReactNode }) {
  const [month, setMonth] = useState(0)
  return (
    <ExteriorMonthContext.Provider value={{ month, setMonth, isExterior }}>
      {children}
    </ExteriorMonthContext.Provider>
  )
}

/** provider 밖에서도 안전하게 쓰인다 — 그 경우 월 축 없음(0)으로 동작해 종전과 같다 */
export function useExteriorMonth(): Ctx {
  return useContext(ExteriorMonthContext) ?? { month: 0, setMonth: () => {}, isExterior: false }
}
