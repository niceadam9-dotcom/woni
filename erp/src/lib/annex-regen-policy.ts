/** 과거 점검 건 재생성 차단 정책 — 규약 버전 축 (소방계획서_23 S9-1 재설계, 2026-08-21 사용자 확정)
 *
 *  왜 막는가: 점검표 입력 규약이 "무응답 = 해당없음(／)"에서 "무응답 = 공란(미점검)"으로 바뀌었다
 *  (소방계획서_22 Q-9 / 23 Q-19). 구 규약 하에 입력된 건의 무응답은 **의도된 해당없음**인데,
 *  새 렌더로 재생성하면 같은 DB 상태가 "미점검 공란"으로 인쇄돼 멀쩡히 끝난 점검이 부실 점검처럼
 *  보인다. 값을 지어내 재현하는 것(무응답→／)은 법정 문서 허위기록이라 배제하고, 그런 건은
 *  재생성을 차단한다 — 보관함 원본이 원천이다.
 *
 *  왜 날짜 축을 버렸는가: 종전 CUTOFF(날짜 상수)는 점검 **실시일**을 봤는데 규약은 **입력 행위**의
 *  속성이다. 실시일과 입력일이 다른 회차에서 어떤 날짜를 넣어도 어긋나고, 실제로 2026-08-18 기입이
 *  전건 차단(스테이징 26/26·운영 8/8)을 냈다. 이제 규약은 점검 건 자체에 새긴다(149 sheet_protocol):
 *   · 신규 회차 — DB DEFAULT가 자동으로 현재 규약을 새긴다(생성 경로가 몇 개든 빠짐없음)
 *   · 미상(NULL) 회차 — 첫 점검표 입력 때 서버가 현재 규약을 스탬프한다(sheet-actions
 *     stampSheetProtocol — 규약은 입력 행위의 속성이라는 원칙을 코드로 못 박은 것)
 *   · 미상 + 이미 응답 있음 — 어느 규약 입력인지 모르므로 보수적으로 차단. 사실을 아는 관리자가
 *     [신규약으로 입력된 회차 — 확정]으로 해제한다(confirmSheetProtocolAction, activity_logs 기록)
 *  날짜 상수가 없으니 "잘못 기입하면 전건 차단"이라는 급소 자체가 사라진다. */

/** inspections.sheet_protocol 값 (149) */
export type SheetProtocol = 'legacy_na' | 'blank_unanswered'

/** 현재 규약 — 신규 스탬프·DB DEFAULT와 같은 값이어야 한다(149) */
export const CURRENT_SHEET_PROTOCOL: SheetProtocol = 'blank_unanswered'

/** 이 점검 건의 별지 재생성이 차단 대상인가 — 서버 액션·화면이 같은 함수로 판정한다.
 *  respondedCount는 protocol이 null일 때만 판정에 쓰인다(미상인데 입력이 있으면 차단). */
export function isRegenBlocked(p: {
  sheetProtocol: SheetProtocol | null
  respondedCount: number
}): boolean {
  if (p.sheetProtocol === 'legacy_na') return true
  if (p.sheetProtocol === null) return p.respondedCount > 0
  return false
}

/** 차단 사유 문구 — 서버 액션·UI 공용 */
export const REGEN_BLOCKED_MESSAGE =
  '구 규약(무응답=해당없음) 또는 규약 미상 상태로 입력된 점검이라 재생성하면 결과 표기가 달라질 수 있습니다 — 보관함 원본을 사용하세요. 신규약으로 입력된 회차임이 확실하면 관리자가 [확정]으로 해제할 수 있습니다.'
