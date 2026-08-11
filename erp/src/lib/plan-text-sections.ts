/** 공통 서술 라이브러리 — 대상 8섹션의 추출·병합·빈칸 판정 단일 원천 (소방계획서_15_별도라이브러리.md §2·§4-3)
 *
 *  서버(자동주입·화이트리스트)와 클라이언트(가져오기·등록)가 같은 정의를 쓴다.
 *  여기가 틀어지면 고객 고유 값(일자·인원·실시 기록·집결지)이 라이브러리를 타고 오염되므로
 *  섹션별 필드 취사선택은 반드시 이 파일에서만 한다.
 *
 *  - pick(form)            : 폼/DB 값 → 라이브러리 body (고객 고유 필드 제거)
 *  - merge(current, body)  : body → 폼 값 (가져오기 — 치환형은 서술 필드 교체, 추가형은 행 append)
 *  - injectEmpty(current, body): 자동주입 — **빈 칸만** 채움. changed=false면 저장하지 않는다
 *  - hasContent(current)   : 치환형 UI의 "기존 서술을 덮어씁니다" 확인 필요 여부 */

type Row = Record<string, string>
type Dict = Record<string, unknown>

const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : [])
const dict = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {})

/** 행 배열: 서술 열만 남기고 나머지(일자·장소·담당 등)는 빈 값으로 정규화 */
function pickRows(v: unknown, textCols: string[], allCols: string[]): Row[] {
  return rows(v)
    .map(r => Object.fromEntries(allCols.map(c => [c, textCols.includes(c) ? s(r[c]).trim() : ''])))
    .filter(r => textCols.some(c => r[c]))
}
/** 행 배열 추가형 병합 — 기존 행 유지 + 템플릿 행 append (§1-4-6, 기록 유실 방지) */
function appendRows(current: unknown, body: unknown, textCols: string[], allCols: string[]): Row[] {
  return [...rows(current), ...pickRows(body, textCols, allCols)]
}

/** 문자열 Record(팀별임무·피난약자): 허용 키만, 빈 값 제거 */
function pickRecord(v: unknown, keys: string[]): Record<string, string> {
  const d = dict(v)
  return Object.fromEntries(keys.map(k => [k, s(d[k]).trim()]).filter(([, t]) => t))
}

export type PlanTextSectionDef = {
  key: string
  label: string
  mode: 'replace' | 'append'
  pick: (form: unknown) => unknown
  merge: (current: unknown, body: unknown) => unknown
  injectEmpty: (current: unknown, body: unknown) => { next: unknown; changed: boolean }
  hasContent: (current: unknown) => boolean
}

/** 기록부 4종 공통 정의 — 서술 열만 라이브러리 대상 (§2) */
function logSection(key: string, label: string, textCols: string[], allCols: string[]): PlanTextSectionDef {
  return {
    key, label, mode: 'append',
    pick: form => pickRows(form, textCols, allCols),
    merge: (current, body) => appendRows(current, body, textCols, allCols),
    // 자동주입은 0행일 때만 — 행이 하나라도 있으면 실제 기록이 시작된 것 (§4-0)
    injectEmpty: (current, body) => {
      if (rows(current).length > 0) return { next: current, changed: false }
      const tpl = pickRows(body, textCols, allCols)
      return tpl.length > 0 ? { next: tpl, changed: true } : { next: current, changed: false }
    },
    hasContent: current => rows(current).length > 0,
  }
}

/** 문자열 Record 공통 정의 — 2장 팀별임무(7키)·3.6 피난약자(6키) */
function recordSection(key: string, label: string, keys: string[]): PlanTextSectionDef {
  return {
    key, label, mode: 'replace',
    pick: form => pickRecord(form, keys),
    // 가져오기 = body에 있는 키만 교체 (없는 키의 기존 입력은 유지)
    merge: (current, body) => ({ ...dict(current), ...pickRecord(body, keys) }),
    // 자동주입 = 빈 키만 채움
    injectEmpty: (current, body) => {
      const cur = dict(current)
      const src = pickRecord(body, keys)
      const fill = Object.fromEntries(Object.entries(src).filter(([k]) => !s(cur[k]).trim()))
      return Object.keys(fill).length > 0
        ? { next: { ...cur, ...fill }, changed: true }
        : { next: current, changed: false }
    },
    hasContent: current => keys.some(k => s(dict(current)[k]).trim()),
  }
}

const TRAINING_DETAIL_COLS = ['name', 'at', 'place', 'target', 'kind', 'form', 'materials', 'plan']
// at(일시)·place(장소)는 고객 고유 — 라이브러리에 저장하지 않는다 (§2 정정 ②)
const TRAINING_DETAIL_TEXT = ['name', 'target', 'kind', 'form', 'materials', 'plan']
const BRIGADE_TEAM_KEYS = ['command', 'contact', 'extinguish', 'evacuate', 'rescue', 'protect', 'initial']
const VULNERABLE_TYPES = ['노인', '어린이', '영유아', '임산부', '장애인', '기타']

export const PLAN_TEXT_SECTIONS: Record<string, PlanTextSectionDef> = {
  // 1.11 — scenario 치환 + details 추가 (headcount·월 선택·records는 고객 고유)
  training: {
    key: 'training', label: '1.11 훈련·교육', mode: 'replace',
    pick: form => {
      const f = dict(form)
      return {
        scenario: s(f.scenario).trim(),
        scenarioType: s(f.scenarioType).trim(),
        details: pickRows(f.details, TRAINING_DETAIL_TEXT, TRAINING_DETAIL_COLS),
      }
    },
    merge: (current, body) => {
      const cur = dict(current)
      const b = dict(body)
      const scenario = s(b.scenario).trim()
      return {
        ...cur,
        ...(scenario ? { scenario, scenarioType: s(b.scenarioType).trim() } : {}),
        details: appendRows(cur.details, b.details, TRAINING_DETAIL_TEXT, TRAINING_DETAIL_COLS),
      }
    },
    injectEmpty: (current, body) => {
      const cur = dict(current)
      const b = dict(body)
      const scenario = s(b.scenario).trim()
      const canScenario = scenario && !s(cur.scenario).trim()
      const tpl = rows(cur.details).length === 0 ? pickRows(b.details, TRAINING_DETAIL_TEXT, TRAINING_DETAIL_COLS) : []
      if (!canScenario && tpl.length === 0) return { next: current, changed: false }
      return {
        next: {
          ...cur,
          ...(canScenario ? { scenario, scenarioType: s(b.scenarioType).trim() } : {}),
          ...(tpl.length > 0 ? { details: tpl } : {}),
        },
        changed: true,
      }
    },
    hasContent: current => !!s(dict(current).scenario).trim(),
  },
  fireworkLog: logSection('fireworkLog', '1.12 화기취급 감독', ['work', 'measure'], ['date', 'place', 'work', 'supervisor', 'measure']),
  constructionLog: logSection('constructionLog', '1.13 소방시설 공사·정비', ['content', 'note'], ['date', 'facility', 'content', 'company', 'note']),
  promoLog: logSection('promoLog', '1.14 화재예방·홍보', ['method', 'content'], ['date', 'method', 'content', 'target']),
  recoveryLog: logSection('recoveryLog', '1.15 피해 복구', ['damage', 'recovery'], ['date', 'damage', 'recovery', 'cost']),
  brigadeTeams: recordSection('brigadeTeams', '2장 팀별임무', BRIGADE_TEAM_KEYS),
  // 3.4 — procedure만. routes·mapImage·assembly(집결지=건물 고유 장소)는 제외 (§2 정정 ①)
  evacPlan: {
    key: 'evacPlan', label: '3.4 피난유도 절차', mode: 'replace',
    pick: form => ({ procedure: s(dict(form).procedure).trim() }),
    merge: (current, body) => {
      const procedure = s(dict(body).procedure).trim()
      return procedure ? { ...dict(current), procedure } : current
    },
    injectEmpty: (current, body) => {
      const cur = dict(current)
      const procedure = s(dict(body).procedure).trim()
      if (!procedure || s(cur.procedure).trim()) return { next: current, changed: false }
      return { next: { ...cur, procedure }, changed: true }
    },
    hasContent: current => !!s(dict(current).procedure).trim(),
  },
  vulnerableMethods: recordSection('vulnerableMethods', '3.6 피난약자 방법', VULNERABLE_TYPES),
}

/** 서버 화이트리스트 (§5) — 구 COPYABLE_SECTION_KEYS·현 FORM_SECTION_KEYS와 같은 방어 패턴 */
export const PLAN_TEXT_SECTION_KEYS = new Set(Object.keys(PLAN_TEXT_SECTIONS))

/** B-7(소방계획서_19 K-8 · L-D-4): jsonb 키 순서와 무관한 내용 동등 비교.
 *  Postgres jsonb는 키를 정규화(길이→사전순)해 돌려주므로 JSON.stringify 직접 비교는 항상 다르다고
 *  판정된다 — 동일 내용 재등록에도 version이 +1 되던 결함의 근인. 키를 정렬해 비교한다. */
export function planTextBodyEquals(a: unknown, b: unknown): boolean {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort()
        .map(k => [k, sortKeys((v as Record<string, unknown>)[k])]))
    }
    return v
  }
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

/** 리스트 미리보기 40자 — 이름만으로 항목을 구분 못 하는 문제 보완 (§4-1) */
export function planTextPreview(sectionKey: string, body: unknown): string {
  const b = body as Dict
  const first = (() => {
    switch (sectionKey) {
      case 'training': return s(b.scenario)
      case 'evacPlan': return s(b.procedure)
      case 'brigadeTeams': case 'vulnerableMethods':
        return Object.values(dict(b)).map(s).find(t => t.trim()) ?? ''
      default: {
        const r = rows(b)[0]
        return r ? Object.values(r).find(t => t.trim()) ?? '' : ''
      }
    }
  })()
  const t = first.trim().replace(/\s+/g, ' ')
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}
