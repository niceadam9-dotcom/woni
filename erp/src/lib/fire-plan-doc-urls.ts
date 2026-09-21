/** 소방계획서 산출물 라우트 주소 — **단일 원천**.
 *
 *  이 두 주소는 종전에 네 곳에 문자열로 흩어져 있었다(`fire-plan-xlsx-button`·`fire-plan-view`·
 *  고객 목록 행·회차 탭). 라우트를 옮기는 날 한 곳만 고쳐지면 나머지는 **404를 조용히** 낸다 —
 *  버튼은 눌리고 아무 일도 안 일어나는 부류라 사용자가 먼저 알아차린다.
 *
 *  ⚠ 여기는 **주소만** 갖는다. 받는 방식은 갈라져 있고, 그게 맞다:
 *    - 엑셀은 `fetch`+`Blob` — 라우트가 `X-FirePlan-Missing` 헤더로 보내는 고지를 잡아야 한다.
 *      `window.open`으로 열면 고지가 그대로 사라진다(`fire-plan-xlsx-button` 주석의 회귀 금지 항목).
 *    - PDF는 고지 헤더가 없어 `window.open` 그대로다 — 새 탭 뷰어에서 바로 인쇄하는 것이 실사용 흐름.
 */

/** 소방계획서 엑셀 — 누를 때마다 현재 입력값으로 즉석 생성한다(파일을 저장하지 않는다) */
export function firePlanXlsxUrl(customerId: string): string {
  return `/customers/${customerId}/fire-plan/xlsx`
}

/** 소방계획서 PDF — `download=true`면 내려받기, 아니면 새 탭 뷰어(인쇄 흐름).
 *  ⚠ 서버에 `GOTENBERG_URL`이 없으면 이 라우트는 500이다(로컬 dev엔 구조적으로 없다). */
export function firePlanPdfUrl(customerId: string, download = false): string {
  return `/customers/${customerId}/fire-plan/pdf${download ? '?download=1' : ''}`
}
