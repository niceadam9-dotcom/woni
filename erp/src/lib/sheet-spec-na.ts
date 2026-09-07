/** 세부제원 기반 조건부 항목 자동 ／ — 「정말 해당없는 항목」의 판정 축 (2026-09-07 사용자 지시).
 *
 *  ── 왜 필요한가 ────────────────────────────────────────────────────────────
 *  고시 점검표에는 조건이 이름에 박힌 항목이 있다 — 「(폐쇄형 헤드의 경우)」「(습식의 경우)」
 *  「자가발전설비인 경우」. 개방형 헤드를 쓰는 대상물에서 27-C-004(시험장치 — 폐쇄형)는 **정의상**
 *  해당없음인데, 39 규약이 설치 시트의 전 항목을 필수로 만들면서 사람이 매번 ／를 손으로 찍어야 했다.
 *  그 조건들의 답은 이미 1.4 **세부제원**(customer_facility_specs)에 있다 — 거기를 정본으로 삼는다.
 *
 *  ── 세 갈래로만 답한다(추측 금지) ─────────────────────────────────────────
 *    ① 제원이 조건과 **어긋난다**      → 자동 ／ (specNA — 회색·입력 불가·문서에 ／)
 *    ② 제원이 조건과 **맞는다**        → 평소대로 입력 대상
 *    ③ 제원이 **비었다·서로 다르다**   → ②와 같이 입력 대상(필수 유지)
 *  ③이 이 파일의 핵심이다. 모르면 사람이 판단한다 — 빈 제원을 '해당없음'으로 읽으면 점검하지 않은
 *  항목이 법정 문서에 ／로 나간다. 다건물 고객은 동마다 제원이 다를 수 있어(개방형 동 + 폐쇄형 동)
 *  **전 건물의 값이 하나로 모일 때만** 판정한다(`agree` — 하나라도 어긋나면 ③).
 *
 *  ── 저장하지 않는다 ────────────────────────────────────────────────────────
 *  미설치 중분류 회색(2026-09-03)과 같은 규약이다: 자동 ／는 **표시·인쇄만** 하고 응답 행을 만들지
 *  않는다. ／를 저장해 두면 나중에 제원을 고쳤을 때 그 ／가 '응답 있음'으로 살아나 39 필수 강제를
 *  통과시킨다 — 조건이 바뀌었는데 옛 판정이 남는 사고 경로다(groupActiveInSheet 주석과 같은 이유).
 *
 *  ── 축이 갈라지면 안 되는 네 곳 ───────────────────────────────────────────
 *  입력 화면(sheet-actions inactiveItemCodes) · 카운터 분모(sheet-overview buildSheetOverviews) ·
 *  완료 보류 게이트(countInstalledRequiredBlanks) · 인쇄(report9-assemble sheetSections).
 *  넷이 같은 함수를 부르지 않으면 "화면은 ／인데 문서는 빈칸"이 된다. 그래서 판정은 여기 한 곳이다.
 */

/** customer_facility_specs 한 행 — 섹션 1개의 spec JSONB( { blockKey: { fieldKey: 값 } } ) */
export type SpecRow = { section_key: string; spec: Record<string, unknown> | null }

/** 값이 '입력됐다'고 볼 수 있는가 — multicheck 빈 배열·공백 문자열은 미입력이다(③) */
function present(v: unknown): boolean {
  if (v == null || v === false) return false
  if (Array.isArray(v)) return v.length > 0
  return String(v).trim() !== ''
}
const str = (v: unknown) => String(v ?? '').trim()
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => String(x).trim()) : [])

/** select 값이 목록 중 하나 → 자동 ／. 목록 밖 값·미입력은 판정 안 함(③) */
const isOneOf = (...bad: string[]) => (v: unknown) => present(v) && bad.includes(str(v))
/** multicheck에 이 선택지가 **없으면** 자동 ／ — 단, 배열이 비어 있으면 미입력이라 판정 안 함(③) */
const lacks = (opt: string) => (v: unknown) => arr(v).length > 0 && !arr(v).includes(opt)

type SpecNaRule = {
  /** 겨누는 항목 코드 — 카탈로그에 없는 코드는 조용히 무시된다(시딩 차이 허용) */
  codes: string[]
  /** [섹션, 블록, 필드] — facility-spec-schema.ts의 키와 문자 그대로 같아야 한다 */
  path: [string, string, string]
  /** true = 조건 불성립 → 자동 ／. **미입력·판정 불가에는 반드시 false**(③) */
  na: (v: unknown) => boolean
  /** 화면 툴팁·문서 경고에 그대로 나가는 근거 — 사람이 반박할 수 있어야 한다 */
  why: string
}

/** 판정 표 — **여기 없는 조건은 전부 종전대로 필수**다.
 *
 *  ⚠ 등재 기준: 세부제원 필드가 그 조건을 **직접** 말할 때만. 비슷한 축을 억지로 잇지 않는다.
 *    · 간이스프링클러 4-F-001「습식의 경우」→ 제외. spec의 `simple_sprinkler.type`은 펌프/캐비닛/
 *      상수도라 **가압방식**이지 습식·건식 축이 아니다(이름만 비슷한 다른 축).
 *    · 21-A-002「상시(3선식의 경우 점검스위치 작동시) 점등 여부」→ 제외. 3선식이 아니어도 점등은
 *      점검한다 — 괄호가 조건이 아니라 **부연**인 문장이다.
 *    · 「다른 소화설비와 겸용인 경우」「바닥보다 낮은 경우 제외」→ 제외. 대응 제원 필드가 없다.
 *    · 가스계·제연·비상콘센트의「자가발전설비인 경우」→ 제외. 비상전원 제원은 3-2 **수계** 공통사항
 *      에만 있다. 다른 계열에 그 값을 갖다 쓰면 없는 근거를 지어내는 셈이다.
 */
export const SPEC_NA_RULES: SpecNaRule[] = [
  // ── 스프링클러 종류(3-3 개별사항) — 습식/부압식/준비작동식/건식/일제살수식 ──────────────
  {
    codes: ['3-G-001', '3-G-011'],
    path: ['s33_water_each', 'sprinkler', 'type'],
    na: isOneOf('준비작동식', '일제살수식'),
    why: '유수검지 연동 항목(습식·건식 전용) — 세부제원 3-3 스프링클러 종류가 준비작동식·일제살수식',
  },
  {
    codes: ['3-G-002', '3-G-012'],
    path: ['s33_water_each', 'sprinkler', 'type'],
    na: isOneOf('습식', '건식'),
    why: '감지기 연동 항목(준비작동식·일제개방밸브 전용) — 세부제원 3-3 스프링클러 종류가 습식·건식',
  },
  {
    codes: ['3-I-005'],
    path: ['s33_water_each', 'sprinkler', 'type'],
    na: isOneOf('일제살수식'),
    why: '폐쇄형 전용 항목 — 세부제원 3-3 스프링클러 종류가 일제살수식(개방형)',
  },

  // ── 연결살수설비(3-8 소화활동설비) — 헤드 형식·습식/건식 ───────────────────────────
  // 헤드 형식은 이번에 신설한 판정 전용 필드다(서식에는 인쇄되지 않는다 — facility-spec-schema 주석).
  {
    codes: ['27-A-003', '27-A-011'],
    path: ['s38_activity', 'sprinkler_connect', 'head_type'],
    na: isOneOf('폐쇄형'),
    why: '개방형 헤드 전용 항목 — 세부제원 3-8 연결살수 헤드 형식이 폐쇄형',
  },
  {
    codes: ['27-C-003', '27-C-004'],
    path: ['s38_activity', 'sprinkler_connect', 'head_type'],
    na: isOneOf('개방형'),
    why: '폐쇄형 헤드 전용 항목 — 세부제원 3-8 연결살수 헤드 형식이 개방형',
  },
  {
    codes: ['27-C-002'],
    path: ['s38_activity', 'sprinkler_connect', 'method'],
    na: isOneOf('건식'),
    why: '습식 전용 항목(동결방지조치) — 세부제원 3-8 연결살수 방식이 건식',
  },

  // ── 가스계(3-4) 기동장치 방식 — 전기식/가스압력식/기계식(판정 전용 신설 필드) ──────────
  // 세 방식은 배타라 하나를 고르면 나머지 둘의 전용 항목이 정의상 해당없음이 된다.
  // ⚠ 가스계 시트는 **넷**이다 — 이산화탄소(9)·할론(10)·할로겐화합물(11)·분말(12).
  //   STD-09를 빠뜨렸다가 프로브의 카탈로그 대조로 잡았다(같은 문장을 쓰는 형제를 함께 볼 것).
  {
    codes: ['9-C-022', '10-C-022', '11-C-022', '12-D-022'],
    path: ['s34_gas', 'gas_system', 'starter_type'],
    na: isOneOf('가스압력식', '기계식'),
    why: '전기식 기동장치 전용 항목 — 세부제원 3-4 기동장치 방식이 다름',
  },
  {
    codes: ['9-C-023', '9-C-024', '10-C-023', '10-C-024', '11-C-023', '11-C-024', '12-D-023', '12-D-024'],
    path: ['s34_gas', 'gas_system', 'starter_type'],
    na: isOneOf('전기식', '기계식'),
    why: '가스압력식 기동장치 전용 항목 — 세부제원 3-4 기동장치 방식이 다름',
  },
  {
    codes: ['9-C-025', '10-C-025', '11-C-025', '12-D-025'],
    path: ['s34_gas', 'gas_system', 'starter_type'],
    na: isOneOf('전기식', '가스압력식'),
    why: '기계식 기동장치 전용 항목 — 세부제원 3-4 기동장치 방식이 다름',
  },
  {
    codes: ['12-A-009'],
    path: ['s34_gas', 'gas_system', 'charge_type'],
    na: isOneOf('가압식'),
    why: '축압식 전용 항목(지시압력계) — 세부제원 3-4 축압/가압이 가압식',
  },

  // ── 피난구조설비(3-6) — 비상조명등 예비전원 · 휴대용 전원 ─────────────────────────
  {
    codes: ['22-A-004'],
    path: ['s36_evac', 'emergency_light', 'power'],
    na: lacks('내장형'),
    why: '예비전원 내장형 전용 항목 — 세부제원 3-6 비상조명등 비상전원에 내장형이 없음',
  },
  {
    codes: ['22-B-006'],
    path: ['s36_evac', 'portable_light', 'power'],
    na: isOneOf('충전식 배터리식'),
    why: '건전지 전용 항목 — 세부제원 3-6 휴대용비상조명등 전원이 충전식 배터리식',
  },
  {
    codes: ['22-B-007'],
    path: ['s36_evac', 'portable_light', 'power'],
    na: isOneOf('건전지식'),
    why: '충전식 배터리 전용 항목 — 세부제원 3-6 휴대용비상조명등 전원이 건전지식',
  },

  // ── 부속실 제연(3-8) 과압방지장치 ──────────────────────────────────────────────
  {
    codes: ['25-A-001'],
    path: ['s38_activity', 'smoke_lobby', 'overpressure'],
    na: isOneOf('그 밖의 것', '해당없음'),
    why: '자동차압·과압조절형(또는 플랩)댐퍼 전용 항목 — 세부제원 3-8 과압방지장치가 해당 없음',
  },

  // ── 수계 공통(3-2) 비상전원 — 「자가발전설비인 경우」 ────────────────────────────
  // 수계 7시트만이다(위 등재 기준 참조). 비상전원 종류를 하나라도 골랐는데 자가발전설비가
  // 없으면 연료·정기점검 항목은 정의상 해당없음이다.
  {
    // 수계 8시트 — 옥내(2)·스프링클러(3)·간이(4)·조기진압(5)·물분무(6)·미분무(7)·포(8)·옥외(13).
    // 포소화설비(8)를 빠뜨렸다가 카탈로그 재조사에서 잡았다(첫 조사가 1000행에 잘려 있었다).
    codes: [
      '2-G-003', '2-G-004', '3-J-003', '3-J-004', '4-J-003', '4-J-004',
      '5-K-003', '5-K-004', '6-K-003', '6-K-004', '7-H-003', '7-H-004',
      '8-K-003', '8-K-004', '13-F-003', '13-F-004',
    ],
    path: ['s32_water_common', 'emergency_power', 'types'],
    na: lacks('자가발전설비'),
    why: '자가발전설비 전용 항목 — 세부제원 3-2 비상전원 종류에 자가발전설비가 없음',
  },
]

/** 규칙이 겨누는 전체 항목 코드 — 검사·프로브가 '이 표가 실제 카탈로그와 맞는가'를 볼 때 쓴다 */
export const SPEC_NA_TARGET_CODES: string[] = [...new Set(SPEC_NA_RULES.flatMap(r => r.codes))]

/** 세부제원 행들(전 건물) → 판정 결과.
 *
 *  건물마다 행이 따로 오므로 같은 경로의 값이 여러 개다. **전부 자동 ／로 모일 때만** ／다 —
 *  개방형 동과 폐쇄형 동이 섞여 있으면 그 항목은 어느 동 기준인지 알 수 없어 사람이 판단한다(③).
 *
 *  @returns 항목코드 → 근거 문구. 키가 없으면 판정 안 함(=입력 대상). */
export function specNaReasons(rows: SpecRow[]): Record<string, string> {
  const bySection = new Map<string, Array<Record<string, unknown>>>()
  for (const r of rows) {
    if (!r.spec || typeof r.spec !== 'object') continue
    const arrs = bySection.get(r.section_key)
    if (arrs) arrs.push(r.spec)
    else bySection.set(r.section_key, [r.spec])
  }
  const out: Record<string, string> = {}
  for (const rule of SPEC_NA_RULES) {
    const [section, block, field] = rule.path
    const values: unknown[] = []
    for (const spec of bySection.get(section) ?? []) {
      const blk = spec[block]
      if (!blk || typeof blk !== 'object') continue
      const v = (blk as Record<string, unknown>)[field]
      if (present(v)) values.push(v)
    }
    // ③ — 아무 동도 입력하지 않았거나, 동들의 판정이 갈리면 손대지 않는다
    if (values.length === 0) continue
    if (!values.every(v => rule.na(v))) continue
    for (const c of rule.codes) out[c] = rule.why
  }
  return out
}

/** 이 점검 건에서 자동 ／가 될 항목 코드 집합 — 호출부 4곳(입력·집계·완료게이트·인쇄) 공용 */
export function specNaCodes(rows: SpecRow[]): Set<string> {
  return new Set(Object.keys(specNaReasons(rows)))
}
