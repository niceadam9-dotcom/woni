/** 고객명 중복 판정 키 — 단일 원천 (순수·무의존).
 *
 *  ## 정규화를 어디까지 하는가 (실측으로 정한 선)
 *
 *  `addressDupKey`는 괄호 내용을 지운다(동/호수를 떼어 같은 건물로 묶으려고). **고객명에는
 *  그렇게 하면 안 된다** — 스테이징 실측에서 `그라지타운`과 `그라지타운(나~라동)`이 **둘 다
 *  별개 고객으로 존재**한다. 괄호를 지우면 이 둘이 같은 키가 되어 정상 등록을 막는다.
 *  `가온아파트 1동(40세대)` / `2동(30세대)` 처럼 괄호가 식별자인 이름도 있다.
 *
 *  그래서 **공백 제거 + 소문자**까지만 한다. 이 범위로 현행 고객 309건을 전수 대조한 결과
 *  중복 키가 **0건**이라, 차단 가드를 켜도 기존 데이터는 한 건도 막히지 않는다(2026-09-03 실측).
 *  `hangulMatch`(lib/hangul)가 쓰는 정규화와 같은 축이라 검색 체감과도 어긋나지 않는다.
 *
 *  ⚠ 정규화를 넓히려면 **넓힌 키로 기존 데이터를 다시 세어보고** 나서 넓힐 것.
 *    막히는 건수를 모르고 켜면 정상 등록이 통째로 막힌다. */
export function customerNameDupKey(name: string): string {
  return name.replace(/\s/g, '').toLowerCase()
}

/** 두 고객명이 '같은 이름'인가 — 저장·표기 차이(공백·대소문자)를 흡수한 비교 */
export function isSameCustomerName(a: string, b: string): boolean {
  const ka = customerNameDupKey(a)
  return !!ka && ka === customerNameDupKey(b)
}
