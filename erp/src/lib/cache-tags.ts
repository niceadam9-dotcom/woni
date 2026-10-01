/** 요청 간 캐시(`unstable_cache`)의 태그 상수 — 읽는 쪽과 무효화하는 쪽이 **같은 문자열**을 쓰도록 한 곳에 둔다.
 *
 *  ⚠ 이 모듈은 `next/cache`를 import하지 않는다 — Next 밖에서 도는 스크립트(`--conditions=react-server`)가
 *  lib를 타고 들어와도 터지지 않게. 무효화(`updateTag`)는 Server Action 파일에서 직접 부른다.
 *
 *  무효화 구멍은 TTL이 막는다: 크론(auto-start·deadline-notify)·시드 스크립트는 DB를 직접 쓰므로
 *  태그를 못 건드린다. 그래서 두 캐시 모두 60초 백스톱을 둔다 — 뱃지는 "할 일이 있다"는 보조 신호라
 *  1분 늦는 것은 허용되지만, 사용자가 **방금 한 일**은 즉시 반영돼야 한다(그쪽이 updateTag). */

/** 사이드바 빨강/주황 뱃지(지연·D-Day / D-3) — 단계 완료·점검일 변경·점검 삭제 시 무효화 */
export const STEP_BADGE_TAG = 'step-badge'

/** 미발송 사전 안내 건수(사이드바 문자 뱃지·달력 도구줄 버튼) — 발송·시점 규칙 저장·계획일 이동 시 무효화 */
export const SMS_BADGE_TAG = 'sms-badge'
