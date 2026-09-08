/** 소방계획서 엑셀 템플릿 스크럽 규약 — 소방계획서_42 S3-3 · 단일 원천.
 *
 *  법정 양식 `erp_goal/_Data/양식-placeholder.hwpx`는 **표본 고객 문서에서 값만 `{{token}}`으로
 *  바꾼 것**이라, 토큰화되지 않은 칸에는 표본의 답이 그대로 남아 있다. 그중 실명·개인 연락처·
 *  내부 업무 메모·표본 지역 기관은 전 고객 산출물에 실려 나가면 안 된다
 *  (소방계획서_27 고아 sharedStrings 사고와 같은 부류 — **육안으로는 안 보이는 축**).
 *
 *  두 축으로 닫는다:
 *   ① 빌드가 `strip` 정규식으로 원문에서 지운다 (`build-fire-plan-template.mts`)
 *   ② 게이트·테스트가 `needle` 리터럴을 **전 파트 원시 바이트**에서 찾아 0건을 단언한다.
 *     셀 값 스캔만으로는 부족하다 — .xlsx는 zip이라 셀에 안 보여도 파트 안에 원문이 남는다.
 *
 *  ⚠ **지우지 않기로 한 것들**(실측 2026-09-08, 설계 JSON의 '업체 등록번호' 기술을 정정):
 *    `㈜승진소방이엔지` · `경기도 양평군 양평읍 덕평리 98-1` · `경기양평 제2020-01호` ·
 *    `031-772-3019` 는 **표본 고객이 아니라 이 ERP 운영사 자신**의 등록 정보다. 서식 1.8
 *    업무대행 현황은 어느 고객 문서에서든 같은 값이므로 지우면 오히려 빈칸이 된다.
 *    `1588-7500`(전기안전공사 대표번호)도 전국 공통이라 남긴다.
 */

export interface ScrubRule {
  /** 게이트가 원시 바이트에서 찾는 리터럴 — 하나라도 남으면 실패 */
  needle: string
  /** 빌드가 셀 원문에서 지우는 범위. needle보다 넓을 수 있다(메모는 줄 끝까지) */
  strip: RegExp
  why: string
}

/** ⚠ `strip`에 `g` 플래그를 두므로 `lastIndex`가 남는다 — 쓸 때마다 0으로 되돌릴 것 */
export const FIRE_PLAN_SCRUB_RULES: ScrubRule[] = [
  { needle: '김흥준', strip: /김흥준/g, why: '표본 소방안전관리자 실명(서식 1.11.4 훈련교관·교육강사)' },
  { needle: '010-4373-4578', strip: /010-4373-4578/g, why: '표본 소방안전관리자 개인 휴대폰' },
  // 메모는 라벨과 한 셀에 붙어 있다 — 리터럴만 지우면 '[해당 층 평면도]  민원실 - …'이 남는다.
  { needle: '양평군청', strip: /양평군청[^\n]*/g, why: '내부 업무 메모(서식 1.5.2 평면도 칸)' },
  { needle: '양평소방서', strip: /양평소방서/g, why: '표본 관할 소방서 — 고객마다 다르고 ERP가 자동 조회한다' },
  { needle: '양평병원', strip: /양평병원/g, why: '표본 인근 병원' },
  { needle: '031-770-0120', strip: /031-770-0120/g, why: '표본 관할 소방서 전화' },
  { needle: '031-770-2270', strip: /031-770-2270/g, why: '표본 인근 병원 전화' },
  { needle: '031-798-0019', strip: /031-798-0019/g, why: '표본 지역 가스안전공사 전화' },
  { needle: '031-775-1638', strip: /031-775-1638/g, why: '표본 승강기 업체 전화' },
]

export const FIRE_PLAN_SCRUB_NEEDLES: string[] = FIRE_PLAN_SCRUB_RULES.map(r => r.needle)

/** 한 셀의 원문에서 니들을 지운다. 앞뒤 공백은 다듬되 셀 안의 줄바꿈은 보존한다 */
export function scrubText(text: string): { text: string; hits: string[] } {
  let out = text
  const hits: string[] = []
  for (const r of FIRE_PLAN_SCRUB_RULES) {
    r.strip.lastIndex = 0
    if (!r.strip.test(out)) continue
    r.strip.lastIndex = 0
    out = out.replace(r.strip, '')
    hits.push(r.needle)
  }
  if (!hits.length) return { text, hits }
  return { text: out.replace(/[ \t]{2,}/g, ' ').trim(), hits }
}

/* ────────────────────────── 체크 마크 (S3-4) ────────────────────────── */

/**
 * 🚨 **템플릿에 남아 있으면 안 되는 '체크된 표시'**.
 *
 * 표본 고객의 답이 그대로 굳으면 전 고객 문서에 남의 답이 인쇄된다. 갑지의 전 시트 덮개
 * 불변식을 이식한 것이고, 손목록이 못 보는 **다음 표본의 답**을 잡는 것이 이 정규식이다.
 *
 * ⚠ 안내문 `※ □에는 해당되는 곳에 √표를 합니다.` 의 맨 `√`는 **건드리지 않는다** —
 *   법정 자구다. 그래서 `[√]`처럼 **괄호에 갇힌 것만** 체크로 본다(별지 제28호서식 어휘).
 */
export const FIRE_PLAN_MARK_CHECKED_RE = /■|☑|▣|\[\s*[√✓✔]\s*\]/

/** 체크된 표시를 빈 표시로 되돌린다. `■`만 상자 글자를 몰라 호출부가 넘긴다(F-6) */
export function uncheckText(text: string, emptyBox: string): string {
  return text
    .replace(/\[\s*[√✓✔]\s*\]/g, '[ ]')
    .replace(/[☑▣]/g, '☐')
    .replace(/■/g, emptyBox)
}
