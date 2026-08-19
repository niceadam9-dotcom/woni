/** 건물 유형 분류 (주택형·상가형·공장형)
 *
 *  ⚠ 2026-08-19 — '공통 수기 프리셋'(유형별 문구를 생성된 문서에 전역 치환)은 **폐지**됐다.
 *  유형별 문구는 이제 '계획서 공통문구'(plan_text_library)가 담당한다 — 문구가 고객 서식 값으로
 *  들어가므로 화면에서 보는 것과 인쇄물이 같고, 버전·사용처 추적이 함께 붙는다.
 *
 *  폐지된 것: PRESET_FILE_KEYS · PresetEntry · FirePlanPreset · DEFAULT_PRESETS · defaultPreset ·
 *  ANCHORS(양식 예시 문구 12개) · applyPresetPairs(HTML 전역 문자열 치환) · _presets/{유형}.json.
 *  치환 방식이 위험했던 이유: (1) 문서 전역 치환이라 섹션 범위가 없어 '1층 주차장' 같은 짧은 앵커가
 *  엉뚱한 곳까지 바꿨고, (2) DB에 없는 문구가 인쇄물에만 존재해 화면과 제출 문서가 갈라졌으며,
 *  (3) 고객이 그 칸을 채우면 앵커가 사라져 치환이 조용히 불발됐다.
 *
 *  이 파일에 남은 것은 **유형 분류뿐**이다 — 서식 1.11.1(계획 유형 ★ 표시)·1.5(용도 기본값 버튼)가
 *  문구와 무관하게 이 분류를 쓴다. */

export const PRESET_TYPES = ['주택형', '상가형', '공장형'] as const
export type PresetType = (typeof PRESET_TYPES)[number]

/** 건물 용도 → 유형 자동 추천 (표시·기본값 버튼용 — 문구를 자동으로 바꾸지는 않는다) */
export function recommendPresetType(purpose: string | null | undefined): PresetType {
  const p = (purpose ?? '').trim()
  if (/주택|아파트|빌라|연립|다세대|기숙사|주거/.test(p)) return '주택형'
  if (/공장|창고|위험물|제조|물류/.test(p)) return '공장형'
  return '상가형'
}
