/** 인쇄 번들 셀 단위 임의 문구 오버라이드 — 순수 코어 (조회·부작용 없음).
 *
 *  왜 있나: 별지 서식엔 케이스별로 넣어야 하는 문구가 있는데 입력 폼에 칸이 없다. 그 압력을 빼는
 *  통로다. 정식 입력 칸(annex_inputs)의 대체재가 아니라 **압력 밸브**다 — 같은 칸이 여러 건에서
 *  반복 수정되면 그건 정식 칸을 만들라는 신호다(annex_override_events 집계).
 *
 *  설계 골자:
 *   · 템플릿(doc-templates/*)은 손대지 않는다. 완성된 HTML 문자열에 대한 **후처리 패스**다.
 *     renderDocument() 안에서 하지 않는 이유: 렌더 HTML을 문자열로 검사하는 프로브가 여럿이고,
 *     base.ts가 선언한 "렌더는 순수 함수, 조회 없음" 계약을 깨기 때문.
 *   · 파서를 쓰지 않는다(의존성 0). 8종 템플릿의 td/th/h1/p/div/span 열기·닫기가 완전 균형이고
 *     각 쌍이 같은 템플릿 리터럴에서 방출된다는 사실을 _probe-override-feasibility.mts가 실측했다.
 *     이 성질은 test-annex-overrides.mts의 불변식으로 고정된다 — 깨지면 여기가 먼저 터진다.
 *   · 미리보기와 PDF가 **같은 함수를 거친다**. 그래야 "검수한 화면 = 인쇄물"이 구조적으로 보장된다.
 *
 *  ⚠ 빈 칸 해시 충돌: 법정 서식은 빈 칸 투성이고 사용자의 유스케이스가 정확히 "빈 칸에 문구 넣기"다.
 *     빈 칸은 canonHash가 전부 같으므로(sha('')) 키가 밀렸을 때 해시 검증만으로는 오적용을 못 막는다.
 *     그래서 labelPath를 1차 검증에 함께 넣는다. 이 파일에서 가장 중요한 안전 장치다. */

import { createHash } from 'node:crypto'
import { esc } from './doc-templates/base'

// ── 타입 ─────────────────────────────────────────────────────────────────────

/** 편집 등급.
 *  never  = 키를 발급하지 않는다. 클라이언트가 그 칸을 지목할 수단 자체가 없다(정책이 아니라 구조).
 *  locked = 법정 라벨·고정 문안. manager/admin만, 붉은 배지 + 감사 기록.
 *  free   = 자유 편집. 사용자가 원한 '케이스별 임의 문구'는 전부 여기서 해결된다. */
export type OverrideGrade = 'free' | 'locked' | 'never'

export type CellIndex = {
  /** `${쪽인덱스}.${쪽 내 문서순서}` — 등급이 바뀌어도 밀리지 않도록 never 셀도 순번을 소비한다 */
  key: string
  tag: string
  grade: Exclude<OverrideGrade, 'never'>
  /** data-ok가 부착된 HTML 기준 오프셋 (applyOverrides가 쓰는 좌표계) */
  innerStart: number
  innerEnd: number
  canonHash: string
  /** [문서 제목(sticky h1), 같은 표의 직전 th, 같은 행의 직전 td] — **쪽 번호는 넣지 않는다**.
   *  '(3쪽 중 2쪽)'은 페이지네이션이 밀리면 같이 변해서, 정확히 복구가 필요한 순간에 앵커가 무너진다. */
  labelPath: string
  /** 진단·표시용(복구 판정에는 쓰지 않는다 — 쪽 번호를 포함하므로) */
  pageSig: string
  origText: string
}

export type IndexedDocument = { html: string; cells: CellIndex[]; structHash: string }

export type SavedOverride = {
  key: string
  value: string
  canonHash: string
  labelPath: string
  origText: string
}

export type OverrideWarning = {
  key: string
  kind: 'data_changed' | 'skipped_ambiguous' | 'skipped_missing'
  message: string
  origText?: string
  currentText?: string
}

export type ResolveResult = {
  /** 적용할 값 — cell.key → 평문 */
  resolved: Map<string, string>
  warnings: OverrideWarning[]
  /** 키 자가치유 — 호출부가 DB의 ok_key를 갱신한다 */
  healed: Array<{ from: string; to: string }>
  /** data_changed가 하나라도 있으면 PDF 생성을 막는다 — 사람이 확인해야 한다 */
  blocked: boolean
}

// ── 스캔 ─────────────────────────────────────────────────────────────────────

const KEY_TAGS = new Set(['td', 'th', 'h1', 'p', 'div', 'span'])
/** 우리 템플릿의 속성값엔 '>'가 없다(모든 값이 esc를 거친다). CSS의 '>'(자식 선택자)는
 *  <style> 안에 있고 그 안엔 '<'가 없어 태그로 오인되지 않는다. */
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)

const classesOf = (attrs: string): string[] =>
  (/class\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? '').trim().split(/\s+/).filter(Boolean)

/** 미입력 하이라이트 span인가 — base.ts:55 / spec-sections.ts:69,129 / exterior.ts:288.
 *  내용은 항상 공백·엔티티뿐(태그 없음)이라 통째로 건너뛰어도 안전하다.
 *  건너뛰는 이유: 이래야 키 인덱스가 highlight 플래그에 불변이 되고, 미리보기에서 고친 셀과
 *  인쇄되는 셀이 어긋나지 않는다(Phase 0 ②가 8종 전부에서 실측). */
const isMissingSpan = (tag: string, cls: string[]) => tag === 'span' && cls.includes('missing')

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** 태그를 걷어낸 순수 텍스트 */
export function textOf(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/** 앵커 비교용 정규화.
 *  · .missing span 제거 — highlight on/off에서 같은 해시가 나와야 한다
 *  · <img src> 값 비움 — cover는 미리보기가 서명 URL, PDF가 상대경로라 src만 갈린다
 *    (assembleCover({forPreview})가 바꾸는 건 문자열 값뿐이고 요소 구성은 같다는 걸 Phase 0 ④가 실측)
 *  · data-ok 제거 — 부착 전/후 어느 쪽을 넣어도 같은 값이 나오게 */
export function canon(inner: string): string {
  return inner
    // 하이라이트 span은 **벗겨낸다**(지우지 않는다). 지우면 빈칸 서식 문자가 같이 사라져
    // highlight 쪽만 내용이 줄어든다 — 실제로 3-8 전실의 '동명( , , , , )'이 쉼표째 span 안에
    // 들어가 있어서, 삭제 방식이면 on은 '동명()' off는 '동명(,,,,)'로 갈렸다.
    .replace(/<span class="missing">([\s\S]*?)<\/span>/g, '$1')
    .replace(/(<img[^>]*\ssrc=)"[^"]*"/gi, '$1""')
    .replace(/\sdata-ok="[^"]*"/g, '')
    // 공백에 무감각하게 만든다 — 앵커 비교 전용 값이라 가독성은 필요 없고, 이래야
    // highlight on/off에서 같은 해시가 나온다. 두 빈칸 헬퍼가 서로 반대로 동작하기 때문:
    //   base.ts:52 val()          highlight → <span class="missing">&nbsp;…</span> / off → '' (아무것도 안 냄)
    //   spec-sections.ts:66 slot() highlight → <span class="missing">   </span>    / off → '   ' (공백을 냄)
    // span을 지우면 val은 맞지만 slot이 '(   )' vs '()'로 갈리고, 공백 하나로 치환하면
    // 반대로 slot은 맞고 val이 갈린다. 공백을 전부 없애야 양쪽이 동시에 맞는다.
    // (이게 어긋나면 미리보기에서 저장한 수정이 PDF 렌더에서 tier1을 놓쳐 매번 복구 경로로 떨어진다)
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, '')
}

/** 내용에 자식 요소가 있는가 — <br>과 하이라이트 span은 잎으로 친다 */
function isNonLeaf(inner: string): boolean {
  const stripped = inner
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<span class="missing">[\s\S]*?<\/span>/g, '')
  return /<[a-zA-Z/]/.test(stripped)
}

const LOCKED_CLASSES = new Set([
  'doc-ref',      // ■ 서식 출처 (base.ts:85)
  'page-no',      // (n쪽 중 제m쪽)
  'footnote',     // 210mm×297mm 용지 규격
  'sec-title',    // □ 특정소방대상물 등 절 제목
  'sec-head',     // 외관점검표 섹션 제목
  'law',          // 근거 조문 (report1011.ts)
  'result-note',  // ※ 점검결과란은 … (exterior.ts)
  'doc-title',
])

function gradeOf(tag: string, cls: string[], inner: string, text: string): OverrideGrade {
  // ── never — 키를 아예 안 준다 ──
  if (/<img\b/i.test(inner)) return 'never'          // 표지 사진·로고
  if (isNonLeaf(inner)) return 'never'               // 컨테이너(자식이 대신 키를 받는다)
  // 'mk' = 점검결과 마크 칸 표식(report4.ts·report9.ts·exterior.ts). 점검자가 시트에 입력한
  // *점검 사실*이라 인쇄 검수에서 ○→×를 여는 건 자체점검 결과 위조 통로다. 시트로 돌아가야 한다.
  if (cls.includes('mk')) return 'never'

  // ── locked — 법정 라벨·고정 문안. manager/admin + 명시 토글로만 ──
  if (tag === 'th' || tag === 'h1') return 'locked'
  if (cls.some(c => LOCKED_CLASSES.has(c))) return 'locked'
  if (text.startsWith('※')) return 'locked'          // 서식 각주(비고 규칙·작성방법 등)

  return 'free'
}

/**
 * HTML을 훑어 편집 가능한 셀에 data-ok 키를 부착한다.
 *
 * 키 순번은 never 셀도 소비한다 — 나중에 등급 규칙이 바뀌어도 기존 오버라이드의 키가 밀리지 않는다.
 * never 셀에 키를 주지 않는 건 세 가지를 동시에 해결한다: 크기(외관점검표는 셀의 77%가 결과 칸이라
 * 전량 부착 시 +41.2%였다 → +9.4%), 위조 방지(HTML에 키가 없으면 지목 자체가 불가), 기존 프로브 보호
 * (`<td class="center">○</td>` 같은 정확 문자열 단언이 바이트 그대로 남는다).
 */
export function indexDocument(html: string): IndexedDocument {
  const cells: CellIndex[] = []
  const inserts: Array<{ at: number; text: string }> = []

  let pageIdx = -1
  let seqInPage = 0
  let lastH1 = ''        // sticky — 설비별 점검표는 이어지는 쪽에 h1이 없다. 이월시켜야 앵커가 산다.
  let curDocRef = ''
  let curPageNo = ''
  let curTh = ''         // 같은 표의 직전 th
  let prevTd = ''        // 같은 행의 직전 텍스트 td
  let colInRow = -1      // 같은 행에서의 칸 순번 — 데이터 변경·쪽 밀림 양쪽에 불변이라 안전한 판별자
  const structParts: string[] = []

  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  let skipUntil = 0

  while ((m = TAG_RE.exec(html))) {
    if (m.index < skipUntil) continue
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    const attrs = m[3] ?? ''
    const cls = closing ? [] : classesOf(attrs)

    // ── 문맥 갱신 ──
    if (!closing) {
      if (tag === 'div' && cls.includes('page')) { pageIdx++; seqInPage = 0; curDocRef = ''; curPageNo = '' }
      else if (tag === 'table') curTh = ''
      else if (tag === 'tr') { prevTd = ''; colInRow = -1 }
    }

    if (closing || !KEY_TAGS.has(tag)) continue
    if (isMissingSpan(tag, cls)) {
      const close = html.indexOf('</span>', TAG_RE.lastIndex)
      skipUntil = close < 0 ? TAG_RE.lastIndex : close + '</span>'.length
      continue
    }

    // ── 대응하는 닫는 태그 찾기 (같은 태그명 깊이 카운터) ──
    const innerStart = TAG_RE.lastIndex
    const innerEnd = findClose(html, tag, innerStart)
    if (innerEnd < 0) continue   // 균형이 깨진 문서 — 불변식 테스트가 먼저 잡는다
    const inner = html.slice(innerStart, innerEnd)
    const text = textOf(inner)

    // ── 문맥에 기여하는 값 먼저 반영 (자기 자신의 labelPath에는 안 들어간다) ──
    if (tag === 'h1') lastH1 = text
    if (cls.includes('doc-ref')) curDocRef = text
    if (cls.includes('page-no')) curPageNo = text

    const seq = seqInPage++
    if (tag === 'td' || tag === 'th') colInRow++
    const grade = gradeOf(tag, cls, inner, text)
    structParts.push(`${tag}:${grade}`)

    if (grade !== 'never') {
      const key = `${Math.max(pageIdx, 0)}.${seq}`
      cells.push({
        key, tag, grade,
        innerStart, innerEnd,           // 부착 전 좌표 — 아래에서 보정한다
        canonHash: sha(canon(inner)),
        // 구분자를 넣는다 — 이어붙이면 ['a','bc']와 ['ab','c']가 같은 라벨이 된다
        labelPath: [lastH1, curTh, prevTd, `c${colInRow}`].join('|~|'),
        pageSig: sha([curDocRef, curPageNo, lastH1].join('')),
        origText: text,
      })
      inserts.push({ at: m.index + 1 + tag.length, text: ` data-ok="${key}"` })
    }

    // ── 뒤 형제의 labelPath 재료 ──
    if (tag === 'th') curTh = text
    else if (tag === 'td' && text) prevTd = text
  }

  // data-ok를 삽입하고, 셀 오프셋을 삽입본 좌표계로 옮긴다
  const out = spliceAll(html, inserts)
  shiftOffsets(cells, inserts)

  return { html: out, cells, structHash: sha(structParts.join('|')) }
}

/** `<tag ...>` 뒤 from부터 대응하는 `</tag>`의 시작 위치. 같은 태그의 중첩만 세면 된다. */
function findClose(html: string, tag: string, from: number): number {
  const re = new RegExp(`<(/?)${tag}(\\s[^>]*)?>`, 'gi')
  re.lastIndex = from
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    depth += m[1] === '/' ? -1 : 1
    if (depth === 0) return m.index
  }
  return -1
}

function spliceAll(html: string, inserts: Array<{ at: number; text: string }>): string {
  let out = ''
  let last = 0
  for (const ins of inserts) {
    out += html.slice(last, ins.at) + ins.text
    last = ins.at
  }
  return out + html.slice(last)
}

/** 삽입 후 좌표로 보정 — 각 오프셋 앞에 삽입된 문자열 길이의 누적을 더한다.
 *  삽입점은 여는 태그 안(`<td` 바로 뒤)이라 항상 그 셀의 innerStart보다 앞선다. */
function shiftOffsets(cells: CellIndex[], inserts: Array<{ at: number; text: string }>): void {
  const pts = inserts.map(i => i.at)
  const prefix: number[] = [0]
  for (let i = 0; i < inserts.length; i++) prefix.push(prefix[i] + inserts[i].text.length)
  const shiftAt = (pos: number) => {
    let lo = 0, hi = pts.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid] <= pos) lo = mid + 1; else hi = mid }
    return prefix[lo]
  }
  for (const c of cells) {
    c.innerStart += shiftAt(c.innerStart)
    c.innerEnd += shiftAt(c.innerEnd)
  }
}

// ── 해석 ─────────────────────────────────────────────────────────────────────

/**
 * 저장된 오버라이드를 현재 문서에 맞춘다.
 *
 * 1) 키 + canonHash + labelPath 전부 일치 → 적용 (정상)
 * 2) labelPath + canonHash가 같은 셀이 문서 전체에 정확히 1개 → 적용 + 키 자가치유
 *    (별지 4호는 설비가 늘면 뒤 쪽 인덱스가 통째로 밀린다 — report4.ts의 sheetItemPages/pumpTestPages)
 * 3) labelPath만 같고 canonHash가 다름 = 자동값이 갱신됨 → 적용하되 경고 + **PDF 생성 차단**
 * 4) 그 외(0개 또는 2개 이상) → 미적용 + 경고
 *
 * 3단계를 두는 이유: 법정 문서에선 조용히 붙이는 것도 조용히 버리는 것도 안 된다. 사람이 봐야 한다.
 * 사용자가 확인하면 호출부가 canon_hash를 현재 값으로 재기록하고, 다음 해석은 1단계로 떨어진다.
 */
export function resolveOverrides(cells: CellIndex[], saved: SavedOverride[]): ResolveResult {
  const byKey = new Map(cells.map(c => [c.key, c]))
  const resolved = new Map<string, string>()
  const warnings: OverrideWarning[] = []
  const healed: Array<{ from: string; to: string }> = []
  let blocked = false

  for (const s of saved) {
    const direct = byKey.get(s.key)
    if (direct && direct.canonHash === s.canonHash && direct.labelPath === s.labelPath) {
      resolved.set(direct.key, s.value)
      continue
    }

    // 이미 다른 오버라이드가 차지한 셀은 후보에서 뺀다 — 한 칸에 둘이 붙지 않게
    const sameLabel = cells.filter(c => c.labelPath === s.labelPath && !resolved.has(c.key))
    const exact = sameLabel.filter(c => c.canonHash === s.canonHash)
    if (exact.length === 1) {
      resolved.set(exact[0].key, s.value)
      if (exact[0].key !== s.key) healed.push({ from: s.key, to: exact[0].key })
      continue
    }

    if (sameLabel.length === 1) {
      resolved.set(sameLabel[0].key, s.value)
      if (sameLabel[0].key !== s.key) healed.push({ from: s.key, to: sameLabel[0].key })
      blocked = true
      warnings.push({
        key: s.key, kind: 'data_changed',
        message: `자동값이 "${s.origText || '(공란)'}" → "${sameLabel[0].origText || '(공란)'}"으로 바뀌었습니다. 수정 문구를 유지할지 확인이 필요합니다.`,
        origText: s.origText, currentText: sameLabel[0].origText,
      })
      continue
    }

    warnings.push({
      key: s.key,
      kind: sameLabel.length === 0 ? 'skipped_missing' : 'skipped_ambiguous',
      message: sameLabel.length === 0
        ? '수정한 칸을 문서에서 찾지 못했습니다(서식이 바뀌었을 수 있습니다) — 이 수정은 적용되지 않았습니다.'
        : `같은 위치 후보가 ${sameLabel.length}곳이라 어느 칸인지 확정할 수 없습니다 — 이 수정은 적용되지 않았습니다.`,
      origText: s.origText,
    })
  }

  return { resolved, warnings, healed, blocked }
}

// ── 적용 ─────────────────────────────────────────────────────────────────────

/** 편집값은 평문으로만 저장한다 → 렌더 시점에만 이스케이프한다.
 *  서버 sanitizer가 필요 없고(파서 없이 화이트리스트를 만드는 건 위험), XSS 표면이 0이며,
 *  붙여넣기가 끌고 오는 Word 스타일이 table-layout:fixed 서식을 깨뜨리지 못한다. */
export function renderValue(value: string): string {
  return esc(value).replace(/\r?\n/g, '<br>')
}

/** indexDocument가 돌려준 html/cells 좌표계에 값을 덧씌운다.
 *  오프셋이 무효화되지 않도록 **뒤에서 앞으로** 치환한다. */
export function applyOverrides(html: string, cells: CellIndex[], resolved: Map<string, string>): string {
  if (resolved.size === 0) return html
  const targets = cells
    .filter(c => resolved.has(c.key))
    .sort((a, b) => b.innerStart - a.innerStart)
  let out = html
  for (const c of targets) {
    out = out.slice(0, c.innerStart) + renderValue(resolved.get(c.key)!) + out.slice(c.innerEnd)
  }
  return out
}

// ── 저장 값 정규화 ───────────────────────────────────────────────────────────

export const MAX_OVERRIDE_LEN = 2000
export const MAX_OVERRIDES_PER_DOC = 200

const LF = 10
const SPACE = 32
const DEL = 127

/** 줄바꿈만 남기고 제어문자를 걷어낸다 + 길이 상한. 저장 값은 항상 순수 텍스트다.
 *  정규식 문자 클래스 대신 코드포인트 비교를 쓴다 — 소스에 제어문자 리터럴을 남기지 않기 위해. */
export function normalizeValue(raw: string): string {
  let out = ''
  for (const ch of raw.replace(/\r\n?/g, '\n')) {
    const c = ch.codePointAt(0) ?? 0
    if (c === LF || (c >= SPACE && c !== DEL)) out += ch
  }
  return out.slice(0, MAX_OVERRIDE_LEN)
}
