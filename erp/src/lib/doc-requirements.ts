/** 문서 요구 매트릭스 — 고객 유형별 필요 문서·필수 필드 (소방계획서_4.md §9-8, 2026-07-21 실무 확인 매트릭스)
 *
 *  유형 분기를 화면에 하드코딩하지 않는다 — 모든 화면이 이 상수만 읽는다.
 *  | 유형                | 소방계획서 | 점검표                | 별지 9호            | 10·11호 |
 *  | 소방안전관리 · 종합  | 필요      | 소방시설등점검표       | 작동+종합(15일 보고) | 불량 시 |
 *  | 소방안전관리 · 작동  | 필요      | 소방시설등점검표       | 작동(15일 보고)     | 불량 시 |
 *  | 일반관리            | 해당없음   | 외관점검표(2년 보관)   | 해당없음            | 해당없음 |
 */

export type CustomerDocProfile = {
  inspection_type: string // '종합' | '작동' | '일반관리'
}

export type DocKey = 'fire_plan' | 'checklist' | 'report9_operate' | 'report9_comprehensive' | 'exterior'

export type DocRequirement = {
  doc: DocKey
  label: string
  need: boolean
  note?: string // 기한·보관 규칙 등 안내
}

/** 일반관리(외관·기능·일반) 여부 — 소방계획서·별지 9호 작성 대상 아님 */
export function isGeneralManagement(c: CustomerDocProfile): boolean {
  return c.inspection_type === '일반관리'
}

/** 고객 유형별 필요 문서 목록 — 칩·카드·준비 화면 공용 */
export function requiredDocs(c: CustomerDocProfile): DocRequirement[] {
  const general = isGeneralManagement(c)
  const comprehensive = c.inspection_type === '종합'
  return [
    { doc: 'fire_plan', label: '소방계획서', need: !general, note: general ? '일반관리 — 작성 대상 아님' : undefined },
    general
      ? { doc: 'exterior', label: '외관점검표', need: true, note: '작성·2년 보관 (보고 없음)' }
      : { doc: 'checklist', label: '소방시설등점검표', need: true, note: '별지 9호 첨부' },
    { doc: 'report9_operate', label: '별지 9호(작동)', need: !general, note: general ? undefined : '점검 후 15일 내 보고' },
    { doc: 'report9_comprehensive', label: '별지 9호(종합)', need: !general && comprehensive, note: comprehensive ? '점검 후 15일 내 보고' : undefined },
  ]
}

/** 빠른 입력 필수 필드 정의 (§1-1) — 별지 9호 1~2쪽 ∪ 소방계획서 준비율 어휘.
 *  일반관리 고객은 빈 배열(입력 화면 미노출 — §9-8).
 *  경사로·계단·피난용승강기 등 컬럼 미비 항목은 P4 서식 확장에서 추가. */
export type RequiredFieldDef = { key: string; label: string }

export const QUICK_REQUIRED_FIELDS: RequiredFieldDef[] = [
  // 대상물 기본 (별지 9호 1~2쪽)
  { key: 'address', label: '주소' },
  { key: 'purpose', label: '건물 용도' },
  { key: 'useApprovalDate', label: '사용승인일' },
  { key: 'permitDate', label: '건축허가일' },
  { key: 'totalArea', label: '연면적' },
  { key: 'buildingArea', label: '건축면적' },
  { key: 'floors', label: '층수' },
  { key: 'height', label: '높이' },
  { key: 'households', label: '세대수' },
  { key: 'buildingCount', label: '건물동수' },
  { key: 'elevator', label: '승강기' },
  { key: 'parking', label: '주차장' },
  // 소방계획서 준비율 어휘 (fire-plan-readiness 9종)
  { key: 'receiverLocation', label: '수신기위치' },
  { key: 'structure', label: '구조' },
  { key: 'roof', label: '지붕' },
  { key: 'managerSelectedAt', label: '선임일' },
  { key: 'grade', label: '급수' },
  { key: 'insurance', label: '화재보험' },
  { key: 'opHours', label: '운영시간' },
  { key: 'headcount', label: '인원' },
  { key: 'brigade', label: '자위소방대' },
  // 별지 9호 1쪽 송달 (098)
  { key: 'emailConsent', label: '송달 동의' },
]

export function requiredFields(c: CustomerDocProfile): RequiredFieldDef[] {
  return isGeneralManagement(c) ? [] : QUICK_REQUIRED_FIELDS
}

/** 빠른 입력 필수 완성도 — 값 존재 여부 맵으로 done/missing 산출 (준비율 이원화의 '필수' 게이지) */
export function computeQuickReadiness(
  c: CustomerDocProfile,
  filled: Record<string, boolean>,
): { done: number; total: number; missing: string[] } {
  const defs = requiredFields(c)
  const missing = defs.filter(d => !filled[d.key]).map(d => d.label)
  return { done: defs.length - missing.length, total: defs.length, missing }
}
