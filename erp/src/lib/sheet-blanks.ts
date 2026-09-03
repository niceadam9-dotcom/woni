/** 점검표 미입력 집계 — 순수 헬퍼 (소방계획서_39 S2).
 *
 *  sheet-overview.ts는 'server-only'라 클라이언트 컴포넌트(회차 카드·트리)가 **함수**를 import할 수
 *  없다(타입은 erased라 무방). 요약줄·발행 가드 팝업·onBlankCount가 전부 같은 정의를 쓰도록 여기
 *  한 곳에 둔다 — 화면마다 따로 세면 분모가 갈라져 팝업과 카운터가 다른 말을 한다.
 *
 *  구조적 타입만 받는다(SheetProgress import 안 함) — 서버 모듈 의존을 타입으로도 남기지 않는다. */

/** 설치인데 응답 0건 — 별지 결과칸이 **기본 ○(양호)**로 인쇄될 설비 수(2026-09-02 정책, 종전 공란).
 *  해소는 양갈래: 점검표 입력, 또는 실제 미설치면 1.4 대장에서 체크 해제(39 S2-4). */
export function countBlanks(sheets: Array<{ installed: boolean; responded: number }>): number {
  return sheets.filter(s => s.installed && s.responded === 0).length
}

/** 필수 미입력 항목 합 — **설치 시트의 범위 내 무응답 전부**(39 §0, 작동·종합 공통).
 *  분모(total)는 sheet-overview가 isItemInScope로 이미 거른 값이라 작동 회차의 ●는 안 들어간다.
 *  범례(고시 별지4호): 점검결과란은 ○/×/／ — 빈칸은 서식이 예정하지 않은 유일한 상태다. */
export function countRequiredItemBlanks(sheets: Array<{ installed: boolean; total: number; responded: number }>): number {
  return sheets.filter(s => s.installed).reduce((a, s) => a + (s.total - s.responded), 0)
}

/** 그중 ●(comprehensive_only) 무응답 합 — 종합 회차의 법정 명시 부분집합(39 S1 배지·고지 병기용).
 *  compBlank는 sheet-overview가 in-scope 항목으로만 세므로 작동 회차는 자동 0.
 *  법: 고시 별지4호 각주 — ●는 종합점검 항목. */
export function countCompBlanks(sheets: Array<{ installed: boolean; compBlank: number }>): number {
  return sheets.filter(s => s.installed).reduce((a, s) => a + s.compBlank, 0)
}
