/** 소방계획서 엑셀 **정렬 분류** — 소방계획서_47 B-12.
 *
 *  원 출처는 독립 생성기 `scripts/_gs-book50.mts`(사용자 지시 4건, 2026-09-08)다. 판정 B가
 *  확인한 대로 그 지시들이 생성기에만 배선돼 있고 고객이 받는 ERP 워크북은 가운데 하나뿐이었다.
 *  두 벌로 두면 한쪽만 낡으므로(그 파일 계약 ③의 경험칙) **한 벌로 뽑아** 생성기와
 *  ERP 빌더(`build-fire-plan-template.mts`)가 같이 쓴다.
 *
 *  규칙(판정 순서까지가 규칙이다 — 생성기 원문 주석 그대로):
 *   ① 머리띠(배너) → 좌 (원본은 「서식 1.6」 배지 바로 뒤에서 왼쪽으로 흐른다)
 *   ② 체크 글리프 선두 → 좌 (「□ 1대」처럼 단위로도 읽히는 글자가 있어 단위보다 먼저)
 *   ③ 단위만 있는 빈 칸(「kW」·「  년   월」) → 우 (값을 왼쪽에 적으므로, 사용자 지시)
 *   ④ ERP가 채우는 칸(토큰 자리) → 좌 (사용자 지시 「ERP에서 나온 데이터는 입력 시 좌측정렬」
 *      — ⭐템플릿 **스타일**이므로 런타임 주입 값이 그대로 좌정렬을 받는다)
 *   ⑤ 긴 문장(무공백 12자 이상) → 좌 (「글자입력은 칸 안에서 좌측정렬」)
 *   ⑥ 나머지 라벨 → 가운데(현행 유지)
 */
import type { HAlign } from '@/lib/xlsx-build'

/** ⚠ 글리프는 **세 종류가 주력**이다(실측): `□` U+25A1 406개 · `☐` U+2610 174개 · `■` U+25A0 66개.
 *  눈으로는 구별되지 않아서 `[☐■]`만 쓴 1차 정규식이 646개 중 240개만 잡았다(생성기 실사고).
 *  글리프 목록을 손으로 적을 땐 실측으로 세고 적을 것. */
export const CHECK_GLYPHS = '□☐■▣☑☒✓✔'
export const isCheckText = (v: string): boolean => new RegExp(`^\\s*[${CHECK_GLYPHS}]`).test(v)

/** 단위 칸 — 「kW」「kVA」「대」「명」이나 「  년   월」처럼 **값을 왼쪽에 적는** 자리.
 *  ⚠ **단위만 있는 빈 칸**이어야 한다. 「<숫자>㎡」처럼 값이 이미 든 칸은 여기 걸리면 안 된다 —
 *  1차에 `\d[\d.,]*\s*단위`까지 우정렬로 잡아 연면적·건축면적이 오른쪽에 붙었다(생성기 실사고). */
const UNIT = '(?:kW|kVA|kva|㎡|㎥|m|대|명|원|회|개|일|년|월|층|人)'
export const isUnitCell = (v: string): boolean =>
  new RegExp(`^\\s*${UNIT}(?:\\s+(?:이상|이하))?\\s*$`).test(v)
  || new RegExp(`^\\s{2,}${UNIT}`).test(v)            // 「   년   월」류 — 앞이 입력 공백
  || /^\s*(매월|매년)\s{2,}/.test(v)                   // 「매월    일」·「매월  회 이상」

/** 긴 문장은 가운데로 몰면 읽기 나쁘다 — 좌측정렬(사용자 지시) */
export const isProse = (v: string): boolean => v.replace(/\s/g, '').length >= 12

/**
 * 셀 글자 → 수평 정렬. 판정 순서는 파일 머리주석 ①~⑥ 그대로다.
 *
 * @param v     셀에 실제로 남는 글자(토큰 칸은 비워진 뒤라 ''일 수 있다 — `token`으로 가른다)
 * @param token ERP가 채우는 칸인가 — 자리는 **양식**의 `{{토큰}}`이 정한다(값이 아니라)
 */
export function classifyAlign(v: string, opts: { banner?: boolean; token?: boolean } = {}): HAlign {
  if (opts.banner) return 'left'
  if (isCheckText(v)) return 'left'
  if (isUnitCell(v)) return 'right'
  if (opts.token) return 'left'
  if (isProse(v)) return 'left'
  return 'center'
}
