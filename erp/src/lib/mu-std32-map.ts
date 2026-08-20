/** MU 16칸 ↔ STD-32 점검항목 매핑 (소방계획서_22 S14 — Q-10, 2026-08-14 사용자 확정)
 *
 *  Q-10: 다중이용업소 점검표는 두 벌(STD-32 법정 44항목 / MU-01 결과표 16칸)이 입력 화면에 동시에
 *  떠 있었다. 확정 설계 — **STD-32가 유일한 입력 원천**이고, 별지 4호 2쪽·9호 3쪽의 안전시설등
 *  결과표 16칸(muResults)은 STD-32 응답에서 **롤업 파생**한다. MU-01 직접 응답이 있는 레거시 건은
 *  그 값이 이긴다(호출부가 보장 — deriveMuFromStd32는 파생값만 내놓는다).
 *
 *  매핑 유도 원천: 법정 32번 블록(`_별지4호_현행판_추출.txt:3644-3794`)의 설비 블록 ↔ MU 칸 라벨
 *  (seed-mu-sheet.mjs, 2026-08-15 스테이징 실측). 검증은 `_probe-mu-std32-map.mts` —
 *  16칸 전부 ≥1 매핑 / STD-32 각 항목은 정확히 0~1칸 귀속 / 코드는 법정 44항목 안(S14-1).
 *
 *  롤업 규칙(S14-2, 선례 rollUpForm3Results 계열): 매핑 항목 중 X 있으면 X → O 있으면 O →
 *  전부 N이면 N → 응답 없으면 공란(키 없음). */

export const MU_STD32_MAP: Record<string, string[]> = {
  // 소화설비
  'MU-001': ['32-A-001', '32-A-002', '32-A-003', '32-A-004', '32-A-005'],                      // 소화기 또는 자동확산소화기
  'MU-002': ['32-A-011', '32-A-012', '32-A-013', '32-A-014', '32-A-015', '32-A-016', '32-A-017', '32-A-018'], // 간이스프링클러설비
  // 경보설비
  'MU-003': ['32-B-001', '32-B-002', '32-B-003'],                                              // 비상경보설비 또는 자동화재탐지설비
  'MU-004': ['32-B-011'],                                                                      // 가스누설경보기
  // 피난구조설비
  'MU-005': ['32-C-001', '32-C-002', '32-C-003', '32-C-004', '32-C-005'],                      // 피난기구
  'MU-006': ['32-C-011', '32-C-012'],                                                          // 피난유도선
  'MU-007': ['32-F-001'],                                                                      // 피난안내도, 피난안내영상물
  'MU-008': ['32-C-021', '32-C-022', '32-C-023', '32-C-031', '32-C-032', '32-C-041', '32-C-042'], // 유도등, 유도표지 또는 비상조명등
  'MU-009': ['32-C-051', '32-C-052', '32-C-053'],                                              // 휴대용비상조명등
  'MU-010': ['32-E-004'],                                                                      // 창문
  // 비상구
  'MU-011': ['32-D-003'],                                                                      // 방화문 (방화문·방화셔터의 관리·작동상태)
  'MU-012': ['32-D-001', '32-D-002'],                                                          // 비상구(비상탈출구) — 피난동선·피난구/발코니/부속실
  // 기타
  'MU-013': ['32-E-001'],                                                                      // 영업장 내부 피난통로
  'MU-014': ['32-E-002'],                                                                      // 영상음향차단장치
  'MU-015': ['32-E-003'],                                                                      // 누전차단기
  'MU-016': ['32-G-001', '32-G-002'],                                                          // 방염대상물품
}

/** MU 16칸 코드 — 법정 서식의 칸 수는 고정이다(별지 4호 2쪽·9호 3쪽 공용). */
export const MU_CODES: readonly string[] =
  Array.from({ length: 16 }, (_, i) => `MU-${String(i + 1).padStart(3, '0')}`)

/** 다중이용업소가 **아니면** 빈 칸을 전부 'N'(／)으로 채운다 (A안, 2026-08-20 사용자 확정).
 *
 *  근거 — 서식 3쪽 머리말 "해당없는 항목은 /표시를 합니다"(report9.ts:444). 종전에는 비대상 건의
 *  16칸이 통째로 공란이었다(서림사 사례: 1.10.3 미입력 + MU 직접응답 0 + STD-32 응답 0).
 *  1절 소방시설등이 `rollUpForm3Results`에서 '미설치 → N'을 찍는 것과 대칭이 맞지 않았다.
 *
 *  1.10.3 미입력(applicable 부재)도 비대상으로 본다 — 1절이 fire_facilities 행 부재를 미설치로
 *  단정하는 것과 같은 축. 다중이용업소(applicable === true)면 무변경이라, 응답이 아직 없는 칸은
 *  공란(입력 대기)으로 남는다 = 1절의 '설치됐는데 응답 없음'과 동일 취급.
 *  이미 값이 있는 칸(직접 응답·STD-32 파생)은 절대 덮지 않는다. */
export function fillNonApplicableMu(
  muResults: Record<string, 'O' | 'X' | 'N'>,
  applicable: boolean | null | undefined,
): Record<string, 'O' | 'X' | 'N'> {
  if (applicable) return muResults
  for (const k of MU_CODES) if (!muResults[k]) muResults[k] = 'N'
  return muResults
}

/** STD-32 응답 → MU 16칸 파생값 (S14-2). 직접 응답 우선(S14-3)은 호출부 몫 —
 *  이 함수는 파생값만 반환하고, 응답이 하나도 없는 칸은 키를 만들지 않는다(공란 유지). */
export function deriveMuFromStd32(
  std32ResultOf: (code: string) => string | null | undefined,
): Record<string, 'O' | 'X' | 'N'> {
  const out: Record<string, 'O' | 'X' | 'N'> = {}
  for (const [mu, codes] of Object.entries(MU_STD32_MAP)) {
    const vals = codes.map(std32ResultOf).filter((v): v is 'O' | 'X' | 'N' => v === 'O' || v === 'X' || v === 'N')
    if (!vals.length) continue
    out[mu] = vals.includes('X') ? 'X' : vals.includes('O') ? 'O' : 'N'
  }
  return out
}
