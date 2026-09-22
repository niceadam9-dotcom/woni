/** 소방계획서 고지 조각 → **갈 곳** (순수·무의존).
 *
 *  ## 왜 이 파일이 생겼나 (2026-09-22)
 *  `parseFirePlanNotice`는 조각에서 **시트 번호**(1.7.1 → 노드 1.7)를 읽어 준다. 그런데 실제
 *  고지의 상당수는 번호가 없는 **미입력 라벨**이다 — 「주소」·「건물 용도」·「수신기위치」처럼.
 *  그 라벨이 어느 화면 칸인지는 `plan-tab-view.tsx`의 `CHIP_TARGET`이 알고 있었는데,
 *  그건 그 화면 안에만 있어 **점검달력이 쓸 수 없었다**.
 *
 *  달력에도 [소방계획서 엑셀]이 생기면서 같은 표가 필요해졌다. 복제하면 한쪽만 고쳐진다 —
 *  「주소」 칩이 한 화면에선 기본정보로, 다른 화면에선 엉뚱한 데로 가는 상태가 된다.
 *  그래서 표를 여기로 빼고 두 화면이 **같은 것을 본다**.
 *
 *  ⚠ `CHIP_FIELD_ID`(입력칸 포커스용 DOM id)는 **가져오지 않았다** — 그건 고객 화면의
 *    DOM 사정이고 달력은 쓸 일이 없다. 필요해지면 그때 옮긴다.
 */

/** 라벨이 가리키는 화면 — 고객 상세의 탭·노드 어휘 */
export type FirePlanChipTarget = 'buildings' | 'info' | 'form11' | 'ch2' | 'consent'

/** 미입력 라벨 → 갈 곳. 번호 없는 조각은 이 표로만 목적지를 얻는다(없으면 글자로 남는다). */
export const FIRE_PLAN_CHIP_TARGET: Record<string, FirePlanChipTarget> = {
  '주소': 'info', '사용승인일': 'info',
  '건물 용도': 'buildings', '건축허가일': 'buildings', '연면적': 'buildings', '건축면적': 'buildings',
  '층수': 'buildings', '높이': 'buildings', '세대수': 'buildings', '건물동수': 'buildings',
  '승강기': 'buildings', '주차장': 'buildings',
  '수신기위치': 'form11', '구조': 'form11', '지붕': 'form11', '선임일': 'form11', '급수': 'form11',
  '화재보험': 'form11', '운영시간': 'form11', '인원': 'form11', '선임 형태': 'form11',
  '자위소방대': 'ch2', '송달 동의': 'consent',
}

/** 칩에 찍을 짧은 글씨 */
export const FIRE_PLAN_CHIP_LABEL: Record<FirePlanChipTarget, string> = {
  // 1.1은 [공통] 탭으로 이사했다(2026-09-20 3분리) — 칩도 그리로 보낸다. 송달 동의는 1.1 하단.
  buildings: '건물·시설 탭',
  info: '기본정보 탭',
  form11: '공통 탭 > 1.1 일반현황',
  ch2: '2장 자위소방대',
  consent: '공통 탭 1.1 하단 송달 동의',
}

/** 목적지 → 고객 상세 주소. `from`은 호출부가 붙인다(화면마다 돌아갈 곳이 다르다). */
export function firePlanChipHref(target: FirePlanChipTarget, customerId: string): string {
  const c = `/customers/${customerId}`
  switch (target) {
    case 'info':       return `${c}?tab=info`
    case 'buildings':  return `${c}?tab=buildings`
    // 1.1은 [공통] 탭으로 이사했다 — 송달 동의도 그 화면 하단이다
    case 'form11':     return `${c}?tab=facilities&form=1.1`
    case 'consent':    return `${c}?tab=facilities&form=1.1`
    case 'ch2':        return `${c}?tab=plan&form=ch2`
  }
}

/** 고지 조각 하나 → 갈 곳(없으면 null). **추측하지 않는다.**
 *
 *  🚨 2026-09-22 실측(활성 고객 12명 전건)이 이 함수의 모양을 정했다 — 실제 고지 조각 17종은
 *    거의 전부 **미입력 라벨 그 자체**였다(`수신기위치`·`구조`·`지붕`·`선임일`·`급수`·`화재보험`·
 *    `운영시간`·`인원`·`자위소방대`·`주소`·`건물 용도`·`층수`…). 시트 번호가 있는 조각은
 *    **한 종도 없었다** → `parseFirePlanNotice`의 노드 매핑만으로는 칩이 하나도 안 생긴다.
 *    그래서 순서는 ①시트 번호 ②미입력 라벨 **정확 일치** ③둘 다 아니면 **null**이다.
 *
 *  ⚠ ③에서 「모르면 1.1로」 같은 폴백을 두지 않는다. 고객 화면(`plan-tab-view`)은 그 폴백이
 *    있지만 그건 사람이 고른 누락 칩이라 맥락이 있다. 고지는 기계가 만든 문장이라
 *    모르는 것을 1.1로 보내면 **엉뚱한 화면**에 떨어뜨린다(`fire-plan-notice.ts`의 「3.5층창고」 교훈).
 */
export function firePlanNoticeHref(
  part: { text: string; form?: string },
  customerId: string,
  tabOf: (form: string) => string | undefined,
): { href: string; label: string } | null {
  if (part.form) {
    const tab = tabOf(part.form) ?? 'plan'
    return { href: `/customers/${customerId}?tab=${tab}&form=${part.form}`, label: part.form }
  }
  const t = FIRE_PLAN_CHIP_TARGET[part.text.trim()]
  if (!t) return null
  return { href: firePlanChipHref(t, customerId), label: FIRE_PLAN_CHIP_LABEL[t] }
}
