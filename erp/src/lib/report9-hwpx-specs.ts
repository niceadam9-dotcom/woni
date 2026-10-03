/** 별지 9호 HWPX 4~7쪽 「3. 소방시설등의 세부 현황」 채움 — 통합계획 B4 2단계(2026-10-03).
 *
 *  값을 따로 계산하지 않는다. PDF가 쓰는 `renderSpecSections`(별지 4호·9호 공용, 서식 원문 줄을 축자로 재현)의
 *  HTML을 **줄 단위로 읽어** 서식 문단에 옮긴다 — 두 산출물이 같은 한 번의 계산을 나눠 갖는다(D-7).
 *
 *  짝짓기 = 「골격」 대조. 줄에서 체크 칸 안(√/공백)·가장 안쪽 괄호 안·공백·쉼표를 지우면 서식 문단과 HTML 줄이
 *  같은 문자열이 된다. 서식 문단 순서대로 HTML 줄을 앞으로만 훑어(창 40줄) 첫 일치에 붙인다 — 「설치장소: 동명( )…」처럼
 *  같은 골격이 수십 번 나오므로 순서가 곧 짝이다.
 *  채움 = 체크 칸은 순서대로 √, 서식 쪽이 **빈 괄호**인 자리만 HTML 괄호 안 값으로. 서식 글자·런 구조는 건드리지 않는다
 *  (칸 안 글자만 바꾸고, 칸이 런 경계에 걸쳐도 태그는 그대로 둔다).
 *  3-1 표(동별 수량)는 줄이 아니라 칸이라 `s31DongRows`로 직접 채운다.
 *
 *  **순수 모듈**. 못 붙인 문단 수는 통계로 내보낸다(서식과 HTML 표기가 다른 몇 줄은 빈 서식으로 남는다). */
import { renderSpecSections, s31DongRows, type SpecMap } from '@/lib/doc-templates/spec-sections'
import { S31_COLUMNS, columnTotal } from '@/lib/facility-spec-schema'
import type { Report9Data } from '@/lib/doc-templates/report9'

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const decode = (s: string) => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

const CHECK_RE = /\[[\s √]*\]/g
const PAREN_RE = /\(([^()]*)\)/g
/** 골격 — 체크 칸 안·가장 안쪽 괄호 안·공백·쉼표·쌍점을 지운 꼴.
 *  쌍점: 설치장소 둘째 줄을 HTML은 「: 동명(…)」로, 서식은 들여쓰기만으로 잇는다 */
export function skeleton(s: string): string {
  return s.replace(CHECK_RE, '[]').replace(PAREN_RE, '()').replace(/[\s ,:]/g, '')
}

/** HTML 세부현황 → 후보 줄(문서 순서). 칸마다 「<br>로 갈린 각 줄」 뒤에 「그 줄로 끝나는 연속 2·3줄을 이은 줄」,
 *  끝에 「칸 전체를 이은 줄」 — 라벨 칸은 HTML이 `단독경보형<br>감지기`로 접고, 3-2 「설비의 종류」는 세 줄로
 *  나누지만 서식은 한 문단이라 이은 줄이 짝이 된다. 이은 줄은 마지막 줄 **바로 뒤**에 둬야 짝지은 뒤 포인터가
 *  그 칸의 다음 줄 앞에 선다 */
export function htmlLines(sections: string[]): string[] {
  const out: string[] = []
  for (const html of sections) {
    for (const m of html.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const lines = m[2].split(/<br\s*\/?>/).map(l => decode(l.replace(/<[^>]+>/g, '')))
      lines.forEach((l, j) => {
        out.push(l)
        for (const k of [2, 3]) if (j - k + 1 >= 0) out.push(lines.slice(j - k + 1, j + 1).join(''))
      })
      if (lines.length > 3) out.push(lines.join(''))
    }
  }
  return out.filter(l => /\[|\(/.test(l))
}

type Ch = { ch: string; s: number; e: number }
/** 문단 XML의 글자(<hp:t> 안) — 각 글자의 원문 위치. 엔티티는 한 글자 */
function charsOf(p: string): Ch[] {
  const out: Ch[] = []
  for (const t of p.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)) {
    const base = t.index! + '<hp:t>'.length
    const body = t[1]
    for (let i = 0; i < body.length;) {
      if (body[i] === '<') { i = body.indexOf('>', i) + 1; continue }        // <hp:lineBreak/> 등 안쪽 태그
      if (body[i] === '&') {
        const j = body.indexOf(';', i)
        out.push({ ch: decode(body.slice(i, j + 1)), s: base + i, e: base + j + 1 }); i = j + 1; continue
      }
      out.push({ ch: body[i], s: base + i, e: base + i + 1 }); i++
    }
  }
  return out
}

type Edit = { s: number; e: number; text: string }
/** chars[a..b) 안쪽 글자를 text로 — 첫 글자 자리에 넣고 나머지 글자만 지운다(사이 태그는 보존) */
function replaceInner(chars: Ch[], a: number, b: number, text: string, edits: Edit[]) {
  if (a >= b) { edits.push({ s: chars[a - 1].e, e: chars[a - 1].e, text: xmlEsc(text) }); return }
  edits.push({ s: chars[a].s, e: chars[a].e, text: xmlEsc(text) })
  for (let i = a + 1; i < b; i++) edits.push({ s: chars[i].s, e: chars[i].e, text: '' })
}

/** 한 문단을 HTML 한 줄로 채운다. 골격이 같다는 전제에서 체크 칸·괄호 수가 같아야 한다 */
function fillParagraph(p: string, line: string): { p: string; changed: number } {
  const chars = charsOf(p)
  const text = chars.map(c => c.ch).join('')
  const tChecks = [...text.matchAll(CHECK_RE)], lChecks = [...line.matchAll(CHECK_RE)]
  const tPar = [...text.matchAll(PAREN_RE)], lPar = [...line.matchAll(PAREN_RE)]
  if (tChecks.length !== lChecks.length || tPar.length !== lPar.length) return { p, changed: 0 }
  const edits: Edit[] = []
  tChecks.forEach((m, i) => {
    if (!lChecks[i][0].includes('√') || m[0].includes('√')) return
    replaceInner(chars, m.index! + 1, m.index! + m[0].length - 1, '√', edits)
  })
  tPar.forEach((m, i) => {
    if (/[^\s ,]/.test(m[1])) return                         // 서식 쪽에 글자가 있으면 원문 — 안 건드린다
    const v = lPar[i][1].replace(/ /g, ' ').trim()
    if (!v.replace(/[\s,]/g, '')) return
    replaceInner(chars, m.index! + 1, m.index! + m[0].length - 1, v, edits)
  })
  if (!edits.length) return { p, changed: 0 }
  edits.sort((x, y) => y.s - x.s)
  let out = p
  for (const ed of edits) out = out.slice(0, ed.s) + ed.text + out.slice(ed.e)
  // 글자 수가 바뀐 문단은 줄 배치 캐시를 떼어 한글이 다시 배치하게 한다
  out = out.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/, '')
  return { p: out, changed: edits.length }
}

export type SpecFillStats = { paragraphs: number; matched: number; unmatched: string[]; edits: number; s31Rows: number; warnings: string[] }

/** 3-1 표 — 합계 행(4행)·동별 행(5행~). 칸 = 동명·분말·기타·투척용·기타·자동확산·자동소화장치·비고 */
function fillS31(t: string, specs: SpecMap, stats: SpecFillStats): string {
  const sec = (specs['s31_extinguisher'] ?? {}) as Record<string, unknown>
  const rows = s31DongRows(sec)
  if (!rows.length) return t
  const qty = S31_COLUMNS.filter(c => c.total).map(c => c.key)
  const totals = qty.map(k => columnTotal(rows, k))
  const ROW0 = 5, MAXR = 8
  if (rows.length > MAXR) stats.warnings.push(`3-1 동별 ${rows.length}행 중 ${MAXR}행만 실림(서식 행 ${MAXR})`)
  const want = new Map<string, string>()   // "col,row" → 값
  const cols = [0, 2, 4, 5, 6, 7, 8, 9]
  qty.forEach((_, i) => { const n = totals[i]; if (n != null) want.set(`${cols[i + 1]},4`, String(n)) })
  rows.slice(0, MAXR).forEach((r, ri) => {
    const vals = ['dong', ...qty, 'note'].map(k => String(r[k] ?? '').trim())
    vals.forEach((v, ci) => { if (v) want.set(`${cols[ci]},${ROW0 + ri}`, v) })
  })
  stats.s31Rows = Math.min(rows.length, MAXR)
  return t.replace(/<hp:tc [\s\S]*?<\/hp:tc>/g, cell => {
    const a = cell.match(/<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/)
    const v = a && want.get(`${a[1]},${a[2]}`)
    if (!v) return cell
    const p = cell.match(/<hp:p [^>]*>(?:(?!<\/hp:p>)[\s\S])*?<hp:run charPrIDRef="(\d+)"\/>[\s\S]*?<\/hp:p>/)
    if (!p) { stats.warnings.push(`3-1 칸 (${a![1]},${a![2]})이 빈 칸이 아님`); return cell }
    const open = p[0].match(/^<hp:p [^>]*>/)![0]
    stats.edits++
    return cell.replace(p[0], `${open}<hp:run charPrIDRef="${p[1]}"><hp:t>${xmlEsc(v)}</hp:t></hp:run></hp:p>`)
  })
}

/** 4~7쪽 표 넷(표 3~6)을 채운다. edit(k, fn)은 호출부의 표 단위 편집기 */
export function fillSpecPages(
  edit: (k: number, fn: (t: string) => string) => void, d: Report9Data,
): SpecFillStats {
  const stats: SpecFillStats = { paragraphs: 0, matched: 0, unmatched: [], edits: 0, s31Rows: 0, warnings: [] }
  const specs = d.specs ?? {}
  const sections = renderSpecSections(specs, {
    form: 'annex9', derived: { installed: d.ledgerCodes ?? [], building: d.building },
  })
  const lines = htmlLines(sections)
  const sks = lines.map(skeleton)
  let ptr = 0
  const WINDOW = 40
  for (const k of [3, 4, 5, 6]) {
    edit(k, t => {
      if (k === 3) t = fillS31(t, specs, stats)
      return t.replace(/<hp:p [^>]*>[\s\S]*?<\/hp:p>/g, p => {
        const text = charsOf(p).map(c => c.ch).join('')
        if (!/\[[\s√]*\]|\(\s*\)|\([\s,]+\)/.test(text)) return p    // 채울 칸 없는 문단
        if (text.includes('√ 표')) return p                            // 4쪽 비고 「[  ]에는 … √ 표를」 — 안내문
        stats.paragraphs++
        const sk = skeleton(text)
        for (let i = ptr; i < Math.min(lines.length, ptr + WINDOW); i++) {
          if (sks[i] !== sk) continue
          ptr = i + 1
          stats.matched++
          const r = fillParagraph(p, lines[i])
          stats.edits += r.changed
          return r.p
        }
        stats.unmatched.push(text.trim().slice(0, 40))
        return p
      })
    })
  }
  return stats
}
