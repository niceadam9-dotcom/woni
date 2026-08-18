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

/** 라이브러리 관리 화면(소방계획서_21 R1-4)이 body를 그리기 위한 스펙.
 *  body 모양은 두 가지뿐이다 — 고정키 Record(문자열) 와 Row[](행). 그 조합으로 8섹션이 전부 표현된다.
 *  기존 서식 컴포넌트는 재사용하지 않는다(props가 customerId에 묶이고, 라이브러리에 있으면 안 되는
 *  고객 고유 입력칸·저장 버튼을 품는다). 공용 렌더러 하나가 이 스펙만 보고 8섹션을 담당한다. */
export type PlanTextEditorField =
  /** body[key] 문자열 하나 (key 생략 시 body 자체가 문자열인 경우는 없다 — 8섹션 모두 객체/배열) */
  | { kind: 'text'; key: string; label: string; multiline?: boolean; placeholder?: string }
  /** body 자체가 Record<고정키, string> */
  | { kind: 'record'; entries: Array<{ key: string; label: string }> }
  /** key 생략 = body 자체가 Row[] · key 지정 = body[key]가 Row[] */
  | { kind: 'rows'; key?: string; cols: Array<{ key: string; label: string }>; addLabel?: string }

export type PlanTextSectionDef = {
  key: string
  label: string
  mode: 'replace' | 'append'
  /** 관리 화면 좌측 목차의 장 그룹 (장→섹션 2단) */
  chapter: '1장 일반현황' | '2장 자위소방대' | '3장 피난계획'
  /** 관리 화면 본문 편집기 구성 */
  editor: PlanTextEditorField[]
  pick: (form: unknown) => unknown
  merge: (current: unknown, body: unknown) => unknown
  injectEmpty: (current: unknown, body: unknown) => { next: unknown; changed: boolean }
  hasContent: (current: unknown) => boolean
}

/** 기록부 4종 공통 정의 — 서술 열만 라이브러리 대상 (§2).
 *  editor의 열도 textCols만 — 일자·장소·담당은 고객 고유라 라이브러리에서 편집할 대상이 아니다. */
function logSection(
  key: string, label: string, textCols: string[], allCols: string[],
  colLabels: Record<string, string>, addLabel: string,
): PlanTextSectionDef {
  return {
    key, label, mode: 'append',
    chapter: '1장 일반현황',
    editor: [{ kind: 'rows', cols: textCols.map(c => ({ key: c, label: colLabels[c] ?? c })), addLabel }],
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
function recordSection(
  key: string, label: string, keys: string[],
  chapter: PlanTextSectionDef['chapter'], keyLabels?: Record<string, string>,
): PlanTextSectionDef {
  return {
    key, label, mode: 'replace',
    chapter,
    editor: [{ kind: 'record', entries: keys.map(k => ({ key: k, label: keyLabels?.[k] ?? k })) }],
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
/** 2장 팀 라벨 — plan-ch2.tsx TEAMS와 같은 어휘(두 곳이 어긋나면 관리 화면과 서식이 다른 이름을 쓴다) */
const BRIGADE_TEAM_LABELS: Record<string, string> = {
  command: '지휘통제', contact: '비상연락', extinguish: '초기소화', evacuate: '피난유도',
  rescue: '응급구조', protect: '방호안전', initial: '초기대응체계',
}
const VULNERABLE_TYPES = ['노인', '어린이', '영유아', '임산부', '장애인', '기타']

export const PLAN_TEXT_SECTIONS: Record<string, PlanTextSectionDef> = {
  // 1.11 — scenario 치환 + details 추가 (headcount·월 선택·records는 고객 고유)
  training: {
    key: 'training', label: '1.11 훈련·교육', mode: 'replace',
    chapter: '1장 일반현황',
    editor: [
      { kind: 'text', key: 'scenarioType', label: '시나리오 구분', placeholder: '예: 아파트 · 공장 · 판매시설' },
      { kind: 'text', key: 'scenario', label: '훈련 시나리오', multiline: true },
      {
        kind: 'rows', key: 'details', addLabel: '훈련 계획 행 추가',
        cols: [
          { key: 'name', label: '훈련·교육명' }, { key: 'target', label: '대상' },
          { key: 'kind', label: '종류' }, { key: 'form', label: '형태' },
          { key: 'materials', label: '교재·자료' }, { key: 'plan', label: '계획 내용' },
        ],
      },
    ],
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
  fireworkLog: logSection('fireworkLog', '1.12 화기취급 감독', ['work', 'measure'], ['date', 'place', 'work', 'supervisor', 'measure'],
    { work: '작업 내용', measure: '안전조치' }, '작업 유형 추가'),
  constructionLog: logSection('constructionLog', '1.13 소방시설 공사·정비', ['content', 'note'], ['date', 'facility', 'content', 'company', 'note'],
    { content: '공사·정비 내용', note: '비고' }, '공사 유형 추가'),
  promoLog: logSection('promoLog', '1.14 화재예방·홍보', ['method', 'content'], ['date', 'method', 'content', 'target'],
    { method: '방법(게시·방송·교육 등)', content: '내용' }, '홍보 유형 추가'),
  recoveryLog: logSection('recoveryLog', '1.15 피해 복구', ['damage', 'recovery'], ['date', 'damage', 'recovery', 'cost'],
    { damage: '피해 내용', recovery: '복구 조치' }, '복구 유형 추가'),
  brigadeTeams: recordSection('brigadeTeams', '2장 팀별임무', BRIGADE_TEAM_KEYS, '2장 자위소방대', BRIGADE_TEAM_LABELS),
  // 3.4 — procedure만. routes·mapImage·assembly(집결지=건물 고유 장소)는 제외 (§2 정정 ①)
  evacPlan: {
    key: 'evacPlan', label: '3.4 피난유도 절차', mode: 'replace',
    chapter: '3장 피난계획',
    editor: [{ kind: 'text', key: 'procedure', label: '피난유도 절차', multiline: true }],
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
  /** 3.6 피난약자 방법 — **라이브러리는 한 칸, 고객 서식은 유형별 6칸** (2026-08-13 사용자 확정).
   *
   *  종전에는 여기도 6칸(recordSection)이라 공통문구 하나 만들자고 같은 문장을 여섯 번 쳐야 했다.
   *  그렇다고 고객 서식·생성 문서까지 한 줄로 합칠 수는 없다 — 생성 문서의 서식 3.6은
   *  「피난약자 **유형별** 피난 방법」이고 유형이 표의 행 축이다(fire-plan-template.ts:806-809,
   *  값이 있는 유형만 인쇄). 양식 항목명 자체가 유형별이라 합치면 제출 문서가 양식과 어긋난다.
   *
   *  그래서 라이브러리만 한 칸으로 두고, 고객에게 갈 때 유형별로 펼친다:
   *    · 자동주입·가져오기 = **비어 있는 유형만** 그 문구로 채운다(유형별로 다듬어 둔 값은 보존)
   *    · [공통으로 등록] = 고객이 쓴 유형별 문구 중 가장 많이 쓰인 문장을 대표로 올린다 */
  vulnerableMethods: {
    key: 'vulnerableMethods', label: '3.6 피난약자 방법', mode: 'append', chapter: '3장 피난계획',
    editor: [{
      kind: 'text', key: 'method', label: '피난 방법 (유형 공통)', multiline: true,
      placeholder: '예: 보조자가 동행해 계단으로 부축 이동, 이동이 어려운 경우 대피공간에서 구조 대기',
    }],
    // 고객 서식(Record<유형,string>) → 라이브러리 한 칸: 가장 많이 쓰인 문장을 대표로
    pick: form => ({ method: dominantText(VULNERABLE_TYPES.map(t => s(dict(form)[t]))) }),
    // 라이브러리 한 칸 → 고객 유형별: 빈 유형만 채운다(전체 덮어쓰기 금지 — 유형별 조정분 보존)
    merge: (current, body) => fillEmptyVulnerable(current, body).next,
    injectEmpty: (current, body) => fillEmptyVulnerable(current, body),
    hasContent: current => !!s(dict(current).method).trim(),
  },
}

/** 문자열 목록에서 가장 많이 등장한 비어있지 않은 문장 — 동률이면 먼저 나온 것 */
function dominantText(values: string[]): string {
  const count = new Map<string, number>()
  for (const v of values) {
    const t = v.trim()
    if (t) count.set(t, (count.get(t) ?? 0) + 1)
  }
  let best = '', bestN = 0
  for (const [t, n] of count) if (n > bestN) { best = t; bestN = n }
  return best
}

/** 라이브러리 한 칸(body.method)을 고객의 빈 유형에만 채운다 */
function fillEmptyVulnerable(current: unknown, body: unknown): { next: unknown; changed: boolean } {
  const method = s(dict(body).method).trim()
  if (!method) return { next: current, changed: false }
  const cur = dict(current)
  const fill = Object.fromEntries(VULNERABLE_TYPES.filter(t => !s(cur[t]).trim()).map(t => [t, method]))
  return Object.keys(fill).length > 0
    ? { next: { ...cur, ...fill }, changed: true }
    : { next: current, changed: false }
}

/** 관리 화면 목차 순서 — 장 그룹 → 섹션. PLAN_TEXT_SECTIONS 선언 순서를 그대로 따른다 */
export const PLAN_TEXT_CHAPTERS: Array<{ chapter: PlanTextSectionDef['chapter']; sections: PlanTextSectionDef[] }> =
  Object.values(PLAN_TEXT_SECTIONS).reduce((acc, def) => {
    const g = acc.find(x => x.chapter === def.chapter)
    if (g) g.sections.push(def)
    else acc.push({ chapter: def.chapter, sections: [def] })
    return acc
  }, [] as Array<{ chapter: PlanTextSectionDef['chapter']; sections: PlanTextSectionDef[] }>)

/** body가 실질적으로 비었는지 — 관리 화면의 ○(빈 섹션) 표시와 저장 가드에 쓴다 */
export function planTextBodyIsEmpty(sectionKey: string, body: unknown): boolean {
  return !planTextPreview(sectionKey, body)
}

/** 빈 본문 — 관리 화면 [새로 만들기]가 편집기를 띄우기 위한 뼈대.
 *  editor 스펙에서 모양을 그대로 유도한다(형태가 어긋나면 편집기가 필드를 못 그린다).
 *  record·key 없는 rows는 body 자체가 그 모양이라 다른 필드와 섞이지 않는다. */
export function emptyPlanTextBody(def: PlanTextSectionDef): unknown {
  for (const f of def.editor) {
    if (f.kind === 'record') return Object.fromEntries(f.entries.map(e => [e.key, '']))
    if (f.kind === 'rows' && f.key === undefined) return []
  }
  const body: Record<string, unknown> = {}
  for (const f of def.editor) {
    if (f.kind === 'text') body[f.key] = ''
    else if (f.kind === 'rows' && f.key !== undefined) body[f.key] = []
  }
  return body
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
      // 3.6은 라이브러리에서 한 칸이다(고객 서식만 유형별 6칸) — 키를 명시해 둔다.
      // Object.values로도 우연히 맞지만, 키가 늘면 엉뚱한 값이 미리보기에 뜬다
      case 'vulnerableMethods': return s(b.method)
      case 'brigadeTeams':
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
