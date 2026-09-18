/** 서식 1.14.1 화재예방·홍보 **계획** — 방법 10종 (2026-09-18, ④ 넷째 축 `forms.promoPlan`)
 *
 *  화면(1.14 카드 월 격자)과 엑셀(fire-plan-anchors PROMO_SEEDS)이 **이 한 벌**을 나눠 쓴다.
 *  라벨은 양식 A6~A15의 자구다 — 사본이지만 **적재 시 대조로 검증된다**(fire-plan-anchors가
 *  `labelAt`과 맞대어 어긋나면 throw — FORM14_CELLS와 같은 규약). 여기서 라벨을 고치면
 *  양식과 어긋나는 순간 서버가 못 뜬다.
 *
 *  ⚠ manifest를 import하지 않는다 — 이 모듈은 클라이언트로 간다(146KB 번들 유출 전례).
 *  ⚠ `etc`의 양식 자구는 `기타(                  ) `(빈 괄호) — 대조는 접두로 한다.
 */
export const PROMO_METHODS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'period', label: '화재예방 홍보기간 운영' },
  { key: 'poster', label: '포스터, 표어 전시' },
  { key: 'video', label: '영상물 상영' },
  { key: 'visit', label: '체험시설(체험관) 견학' },
  { key: 'notice', label: '문서, 이메일 공지' },
  { key: 'leaflet', label: '홍보물(리플렛, 스티커) 배부' },
  { key: 'banner', label: '현수막, 배너 설치' },
  { key: 'sns', label: '모바일 App, SNS 활용' },
  { key: 'campaign', label: '구내 캠페인 방송' },
  { key: 'etc', label: '기타' },
]

/** 방법별 실시 월(1~12) — `forms.promoPlan` 축의 모양 */
export type PromoPlan = Partial<Record<string, number[]>>
