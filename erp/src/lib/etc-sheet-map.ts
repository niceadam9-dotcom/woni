/** 「기타」 3종 ↔ 대장 코드 ↔ 자체점검 「기타사항」(STD-31) 항목 코드 — **단일 원천** (2026-09-21).
 *
 *  왜 한 곳으로 모았나: 같은 관계가 네 군데에 흩어져 있었다 —
 *    · report9-assemble.ts  항목코드 → key (ETC_ITEM_MAP, 롤업용)
 *    · report9.ts / xlsx-workbook.ts  key → 대장 코드 (체크 축·2026-09-21 신설)
 *    · etc-items-panel.tsx  대장 코드 → 시트 이름만 알고 **항목은 몰랐다**(그래서 배지가 시트 단위였다)
 *  흩어져 있으면 서식이 바뀔 때 한쪽만 고쳐지고, 그때 생기는 것이 「화면은 완료인데 문서는 빈칸」이다.
 *
 *  ⚠ 퍼지 매칭 금지(T-3 교훈) — 항목 코드는 **명시 열거**한다. '방염' 같은 짧은 어휘는
 *    양방향 includes에 너무 쉽게 걸린다(sheet-facility-map.ts:139 실측).
 *
 *  ⚠ 여기 적힌 항목 구성은 **법정 서식 축자**다(별지 4호 「31. 기타사항 점검표」):
 *      31-A-001 ○ 방화문 및 방화셔터 …        (작동·종합 공통)
 *      31-A-002 ● 비상구 및 피난통로 확보 …   (종합점검 전용)
 *      31-B-001 ● 선처리 방염대상물품 …       (종합점검 전용)
 *      31-B-002 ● 후처리 방염대상물품 …       (종합점검 전용)
 *    범례: 「※ 점검항목 중 "●"는 종합점검의 경우에만 해당한다」.
 *    2026-09-21 사용자 확인 — 서식대로 둔다(작동점검 회차에서 비상구·방염은 입력 대상이 아니다).
 *    그 사실을 화면이 말하지 않아 「체크했는데 왜 결과가 없나」로 읽히던 것이 이 파일을 만든 계기다.
 *    ● 여부 자체는 여기 적지 않는다 — 카탈로그(inspection_sheet_items.comprehensive_only)가 정본이고,
 *    여기 또 적으면 시드가 바뀔 때 두 벌이 갈린다. 범위 판정은 isItemInScope 한 곳이 한다. */

export type EtcKey = 'door' | 'exit' | 'flame'

export const ETC_KEYS: readonly EtcKey[] = ['door', 'exit', 'flame']

/** key → 1.4 대장(fire_facilities.facility_code) 코드 — facility-codes.ts ETC_ITEMS의 앞 3종과 같은 문자열 */
export const ETC_LEDGER_CODE: Record<EtcKey, string> = {
  door: '방화문 및 방화셔터',
  exit: '비상구 및 피난통로',
  flame: '방염',
}

/** key → 자체점검 「기타사항」(STD-31 · v2025) 항목 코드. 방염만 선·후처리 2행이다. */
export const ETC_SHEET_ITEM_CODES: Record<EtcKey, readonly string[]> = {
  door: ['31-A-001'],
  exit: ['31-A-002'],
  flame: ['31-B-001', '31-B-002'],
}

const KEY_BY_ITEM: Record<string, EtcKey> = Object.fromEntries(
  ETC_KEYS.flatMap(k => ETC_SHEET_ITEM_CODES[k].map(code => [code, k])))

/** 항목 코드 → key (별지 조립 롤업용). 기타사항 항목이 아니면 undefined. */
export function etcKeyOfItemCode(itemCode: string): EtcKey | undefined {
  return KEY_BY_ITEM[itemCode]
}
