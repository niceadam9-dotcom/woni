/** 4단계 CellOrigin — 「이 칸은 어디서 입력하나」 (2026-09-18, 소방계획서_50 §10-2b)
 *
 *  요구 ④·⑤의 마지막 조각이다. 값은 한 곳에만 저장되므로(P3 — 감사로 중복 0 확인) 「고치면
 *  다 바뀐다」는 이미 참이고, 남은 것은 **「어디서 고치나」를 칸 단위로 답하는 것**이다 —
 *  빈칸 보고의 미입력 칸이 다른 절 소유일 때(3.3의 원천은 1.2.1) 사용자를 그리 보낸다.
 *
 *  ⭐ **사본 최소화** — 기본값은 대장(`FIRE_PLAN_SECTIONS`)의 시트→절이고, 원천이 그 절과
 *    다른 필드만 아래 OVERRIDES에 적는다. 대장이 이사하면(1.10.3→1.4 전례) 기본값이
 *    자동으로 따라간다.
 *  ⭐ 선언은 측정된다 — `test-fire-plan-origins.mts`가 ①전수(앵커 1,311 전 필드가 origin을
 *    얻는가) ②차분(한 원천만 흔들면 정확히 그 원천 선언 필드만 바뀌는가)을 단언한다.
 *  ⚠ 새 점프 기구를 만들지 않는다 — form 키는 목차 딥링크(`?form=`)의 그 어휘다.
 */
import { FIRE_PLAN_SECTIONS } from '@/lib/fire-plan-sections'

export type CellOrigin = {
  /** 목차 딥링크 form 키 (`?form=1.2` · `ch2` …) */
  form: string
  /** 절 안 카드 앵커 (CardAnchorBar id) */
  card?: string
  /** 원천 축 설명 — 사람이 읽는 근거(검사·디버그용) */
  source: string
}

const BY_SHEET = new Map(FIRE_PLAN_SECTIONS.map(d => [d.sheet, d]))

/** 원천이 「보여 주는 절」과 **다른** 필드 — [패턴, 원천 축, form, card?].
 *  ⚠ 순서가 뜻이다: 먼저 맞는 규칙이 이긴다(좁은 패턴을 앞에). */
const OVERRIDES: ReadonlyArray<readonly [RegExp, string, string, string?]> = [
  // 3.3은 1.2.1의 쌍둥이 — 값 계산을 한 함수로 공유한다(b4e5c18)
  [/^evac3_/, 'zones(1.2.1과 같은 축)', '1.2'],
  // 2.9 초기소화방법·가스 조치는 2장 팀별임무 문구(brigadeTeams)를 덮는다
  [/^ext29_(method_|gas$)/, 'brigadeTeams(2장 팀별임무)', 'ch2'],
  // 2.9 층별 상자는 건물 층수 원시값(1.1이 대표 입력처)
  [/^ext29_box_(high|ground|under)$/, '건물 층수(floors_above·below)', '1.1'],
  // 2.9 시설별 상자·2.12 위험물 표는 1.6.1 축(한 축 두 시트 — f5638ae)
  [/^ext29_box_(electric|gas|hazmat)$/, 'etcFacility(1.6.1)', '1.6'],
  [/^haz(12|61)_(?!name)/, 'hazmat.items(1.6.1 위험물 세부)', '1.6'],
  // 2.9 취약장소 표는 1.2.2 축(hazards)
  [/^haz29_/, 'hazards(1.2.2와 같은 축)', '1.2'],
  // 팀별 시트 대상명·2.12 대상명은 건물명(1.1)
  [/^(ext29|evac210|contact26|rescue211|resp13|haz12)_name$/, '건물명(1.1)', '1.1'],
  // 2.10 절차·방법·집결지와 2.13 절차는 3.4 evacPlan 축
  [/^(evac210_(false_alarm|procedure|method|assembly)|resp13_(false_alarm|fire))$/, 'evacPlan(3.4)', 'ch3', 'c-3.4'],
  // 2.10 경로 상자·서술은 3.4 evacRoutes 축
  [/^evac210_route/, 'evacRoutes(3.4)', 'ch3', 'c-3.4'],
  // 설비 파생 상자들은 1.4 설비 목록
  [/^(evac210_broadcast|contact26_(broadcast|autodial)|alert28_)/, 'facilities(1.4)', '1.4'],
  // 3.1의 계단·기타 피난시설 상자는 1.5 입력값(§9-6⑦ 단일 입력처)
  [/^evac1_(stair|etc)/, 'stairChecks·evacFire(1.5)', '1.5'],
  [/^evac1_elevators$/, '승강기(1.1과 같은 원천)', '1.1'],
  // 용도·등급·건물명은 1.1 (2.14·3.1·1.11.4 등 여러 시트가 비춘다)
  [/^purpose_full$|^customer_name$|^rec14_grade/, '건물·고객 마스터(1.1)', '1.1'],
  // 2.14의 선임자 확인란 원천은 1.7 선임현황
  [/^rec14_mgr/, '소방안전관리자(1.7)', '1.7'],
  // 1.11.1 대상자 중 자위소방대 인원은 편성표 행 수 파생 — 차분 검사가 잡았다(1.11엔 입력칸이 없다)
  [/^train_[tn]_brigade$/, 'brigade 행 수(2장 편성표)', 'ch2'],
]

/** 필드 하나의 입력처 — 못 찾으면 null(검사가 전수 가드로 잡는다) */
export function originOf(field: string, sheet: string): CellOrigin | null {
  for (const [re, source, form, card] of OVERRIDES) {
    if (re.test(field)) return { form, card, source }
  }
  const d = BY_SHEET.get(sheet)
  return d ? { form: d.form, card: (d as { card?: string }).card, source: `${sheet} 절 소유` } : null
}
