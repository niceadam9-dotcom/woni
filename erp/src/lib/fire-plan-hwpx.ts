/** 소방계획서 한글파일(HWPX) 렌더러 — 1단계: 표지·개정이력·서식 1.1 (2026-10-06 사용자 요청)
 *
 *  사용자: 「소방계획서를 hwp 만들 수 있는지」 → .hwp(바이너리)는 서버(리눅스 도커)에서 못 쓰므로
 *  **HWPX**로 만든다(별지 9호·사진첩과 같은 방식 — zip 안 XML 치환, 한컴 SDK 없음).
 *
 *  ⭐ 값을 따로 계산하지 않는다. 소방계획서 엑셀과 **같은 값 맵**(`buildFirePlanValues`)을 받는다 —
 *     PDF·엑셀·한글 세 산출물이 같은 조립(`assembleFirePlan`)을 먹는다(D-7).
 *  ⭐ 칸 위치도 새로 정하지 않는다. 엑셀 서식은 **이 HWPX 양식의 표를 옮겨 만든 것**이고(소방계획서_42),
 *     빌더가 그 사상을 manifest `gridTops`에 남겼다: 표 t가 엑셀 top행부터 rows행, HWPX 열 i가 엑셀 cols[i]열.
 *     그래서 엑셀 앵커(시트·셀)를 **기계적으로** HWPX (표, 행, 열)로 되돌린다 — 손 사상표 0.
 *
 *  양식: 사용자 제공 「25년 이후 소방계획서 양식」 HWPX — manifest 원천(`양식-placeholder.hwpx`)과 `{{키}}` 65칸
 *  말고 칸 내용이 전부 같다(4,033칸 실측). 다만 **이전 작성분 흔적**(표지 「리젠시빌」, ■ 승용 등)이 남아 있어
 *  ① 앵커 칸은 값이 비어도 항상 덮고 ② 빌더가 엑셀에서 지운 흔적 칸(restoredBoxes·sampleBlanked·scrubbed·
 *  fillInStripped)은 엑셀의 정리된 글자로 덮는다.
 *
 *  **순수 모듈**: 파일을 읽지 않는다(호출부가 양식 바이트를 넘긴다).
 */
import JSZip from 'jszip'
import type { CellValue } from '@/lib/xlsx-inject'
import { FIRE_PLAN_ANCHORS } from '@/lib/fire-plan-anchors'
import { sheetManifest, FIRE_PLAN_MANIFEST } from '@/lib/fire-plan-xlsx-manifest'

/** 1단계 범위 — 시트 이름(manifest) */
export const FIRE_PLAN_HWPX_STAGE1 = ['표지', '개정이력', '1.1 건축물 일반현황'] as const

export type HwpxCellTarget = { table: number; row: number; col: number }

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 'AW6' → { r0: 5, c0: 48 } */
function decodeRef(ref: string): { r0: number; c0: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) throw new Error(`셀 주소가 아니다: ${ref}`)
  let c = 0
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r0: Number(m[2]) - 1, c0: c - 1 }
}

/** 엑셀 앵커(시트·셀) → HWPX 표 칸. 사상이 없으면 null(엑셀 전용 칸 — 예: 표지 사진·소재지 블록) */
export function anchorToHwpx(sheet: string, cell: string): HwpxCellTarget | null {
  const s = sheetManifest(sheet)
  const { r0, c0 } = decodeRef(cell)
  for (const g of s.gridTops) {
    if (r0 < g.top || r0 >= g.top + g.rows) continue
    const col = g.cols.indexOf(c0)
    return col < 0 ? null : { table: g.table, row: r0 - g.top, col }
  }
  // 띠 행(표 한 칸짜리 제목 — 표지 「[ 이름 ] 소방계획서」)은 격자 밖 표에 순서대로 대응한다
  const bi = s.bannerRows.indexOf(r0)
  if (bi >= 0 && c0 === 0) {
    const gridTables = new Set(s.gridTops.map(g => g.table))
    const t = s.tables.filter(x => !gridTables.has(x))[bi]
    if (t !== undefined) return { table: t, row: 0, col: 0 }
  }
  return null
}

/* ───────────── 표·칸 위치 (중첩 표가 있다 — 제2장 2.3·2.4) ───────────── */

/** 모든 표의 [시작, 끝) — 여는 태그 순서(= manifest·parseTables의 표 번호) */
function tableSpans(xml: string): Array<[number, number]> {
  const ev: Array<[number, 1 | -1]> = []
  for (let i = xml.indexOf('<hp:tbl '); i >= 0; i = xml.indexOf('<hp:tbl ', i + 1)) ev.push([i, 1])
  for (let i = xml.indexOf('</hp:tbl>'); i >= 0; i = xml.indexOf('</hp:tbl>', i + 1)) ev.push([i, -1])
  ev.sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  const stack: number[] = []
  for (const [pos, k] of ev) {
    if (k === 1) { stack.push(out.length); out.push([pos, -1]) }
    else { const idx = stack.pop()!; out[idx][1] = pos + '</hp:tbl>'.length }
  }
  return out
}

type CellSpan = { start: number; end: number; row: number; col: number; nested: boolean }

/** 표 [s, e) 안의 **그 표 소속** 칸들(중첩 표의 칸은 제외) */
function cellSpans(xml: string, s: number, e: number): CellSpan[] {
  const out: CellSpan[] = []
  const tags = /<hp:tbl |<\/hp:tbl>|<hp:tc |<\/hp:tc>/g
  tags.lastIndex = s
  let tblDepth = 0, tcDepth = 0, cellStart = -1, nested = false
  for (let m = tags.exec(xml); m && m.index < e; m = tags.exec(xml)) {
    const t = m[0]
    if (t === '<hp:tbl ') { tblDepth++; if (tblDepth > 1 && cellStart >= 0) nested = true }
    else if (t === '</hp:tbl>') tblDepth--
    else if (t === '<hp:tc ') { if (tblDepth === 1 && tcDepth === 0) { cellStart = m.index; nested = false } tcDepth++ }
    else {
      tcDepth--
      if (tblDepth === 1 && tcDepth === 0 && cellStart >= 0) {
        const end = m.index + '</hp:tc>'.length
        const cell = xml.slice(cellStart, end)
        // 칸 자신의 주소는 subList 뒤 — 중첩 표 칸의 주소가 앞에 있어도 마지막 것이 자기 것이다
        const a = cell.lastIndexOf('<hp:cellAddr ')
        const tag = cell.slice(a, cell.indexOf('/>', a))
        out.push({
          start: cellStart, end,
          col: Number(/colAddr="(\d+)"/.exec(tag)?.[1] ?? -1),
          row: Number(/rowAddr="(\d+)"/.exec(tag)?.[1] ?? -1),
          nested,
        })
        cellStart = -1
      }
    }
  }
  return out
}

/** 칸 글자(문단 사이 줄바꿈) — 단위 판정용 */
function cellPlain(cell: string): string {
  return cell
    .replace(/<hp:lineBreak\/>/g, '\n').replace(/<hp:(fwSpace|nbSpace|tab)[^>]*\/>/g, ' ')
    .replace(/<\/hp:p>/g, '\n')
    .replace(/<hp:t>([^<]*)<\/hp:t>|<[^>]+>/g, (_m, t: string | undefined) => t ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim()
}

/* ───────────── 칸 글자 고치기 — 런·그림을 보존한다 ─────────────
 *  양식 칸은 한 칸 안에서 글자 모양이 갈린다(표지 제목: 「[ 」파랑·건물명 빨강·「 소방계획서」검정,
 *  체크 칸: 「■」와 「 승용」이 다른 런). 표지 제목 칸에는 장식 테두리 **그림**까지 들어 있다.
 *  그래서 칸을 통째로 갈지 않고 `<hp:t>` 글자만 고친다:
 *   ① 상자만 다른 칸(공백 무시 시 상자 기호 말고 같다) — 상자 글자만 제자리에서 바꾼다(배치 불변)
 *   ② 그 밖 — 옛 글자와 새 글자의 앞·뒤 공통부는 두고 가운데만 바꾼다(바뀐 자리의 런 모양을 물려받는다)
 *  줄바꿈('\n')은 `<hp:lineBreak/>`. 그림 안 글(`hp:drawText`)은 건드리지 않는다. */

const BOX = /[■☐□√]/
type TSeg = { start: number; end: number; chars: string[]; empty: boolean }
const PUA = 0xe000

/** 칸 안 본문 `<hp:t>`들(그림 글상자 안은 제외) → 조각 목록. 안쪽 태그는 한 글자로 접고 표로 되돌린다 */
function textSegs(cell: string, tags: string[]): TSeg[] {
  const masked: Array<[number, number]> = []
  for (let i = cell.indexOf('<hp:drawText'); i >= 0; i = cell.indexOf('<hp:drawText', i + 1)) {
    const e = cell.indexOf('</hp:drawText>', i)
    masked.push([i, e < 0 ? cell.length : e])
  }
  const out: TSeg[] = []
  const re = /<hp:t>([\s\S]*?)<\/hp:t>|<hp:t\/>/g
  for (let m = re.exec(cell); m; m = re.exec(cell)) {
    if (masked.some(([a, b]) => m!.index > a && m!.index < b)) continue
    const inner = m[1] ?? ''
    const chars: string[] = []
    const parts = inner.split(/(<[^>]+>)/)
    for (const p of parts) {
      if (!p) continue
      if (p.startsWith('<')) {
        if (/^<hp:lineBreak\s*\/>$/.test(p)) chars.push('\n')
        else { tags.push(p); chars.push(String.fromCharCode(PUA + tags.length - 1)) }
      } else for (const ch of p.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) chars.push(ch)
    }
    out.push({ start: m.index, end: m.index + m[0].length, chars, empty: m[1] === undefined })
  }
  return out
}

function segXml(chars: string[], tags: string[]): string {
  if (!chars.length) return '<hp:t/>'
  let s = ''
  for (const ch of chars) {
    const c = ch.charCodeAt(0)
    if (ch === '\n') s += '<hp:lineBreak/>'
    else if (c >= PUA && c < PUA + tags.length) s += tags[c - PUA]
    else s += xmlEsc(ch)
  }
  return `<hp:t>${s}</hp:t>`
}

/** 글자가 하나도 없는 칸에 처음 쓸 자리 — 그림·컨트롤이 없는 첫 런 */
function insertIntoEmptyCell(cell: string, text: string): string {
  const t = segXml([...text], [])
  const self = /<hp:run charPrIDRef="(\d+)"\/>/.exec(cell)
  if (self) return cell.slice(0, self.index) + `<hp:run charPrIDRef="${self[1]}">${t}</hp:run>` + cell.slice(self.index + self[0].length)
  const plain = /<hp:run charPrIDRef="(\d+)">((?:(?!<\/hp:run>)[\s\S])*?)<\/hp:run>/g
  for (let m = plain.exec(cell); m; m = plain.exec(cell)) {
    if (/<hp:(pic|ctrl|rect|tbl|container|ole|line|ellipse)/.test(m[2])) continue
    const at = m.index + m[0].length - '</hp:run>'.length
    return cell.slice(0, at) + t + cell.slice(at)
  }
  const p = /<hp:p [^>]*>/.exec(cell)
  if (!p) return cell
  const at = p.index + p[0].length
  return cell.slice(0, at) + `<hp:run charPrIDRef="0">${t}</hp:run>` + cell.slice(at)
}

function rewriteCell(cell: string, text: string): string {
  const tags: string[] = []
  const segs = textSegs(cell, tags)
  const flat: Array<{ s: number; i: number }> = []
  segs.forEach((g, s) => g.chars.forEach((_c, i) => flat.push({ s, i })))
  const O = segs.flatMap(g => g.chars).join('')
  const N = text
  if (O === N) return cell
  let next: string[][] = segs.map(g => [...g.chars])

  if (!segs.length) {
    if (!N) return cell
    return dropLineseg(insertIntoEmptyCell(cell, N))
  }
  const strip = (s: string) => s.replace(/\s+/g, '').replace(/[-]/g, '')
  const boxOnly = BOX.test(O) && strip(O).replace(new RegExp(BOX.source, 'g'), '■') === strip(N).replace(new RegExp(BOX.source, 'g'), '■')
  if (boxOnly) {
    // ① 상자 글자만 순서대로 갈아 끼운다
    const want = [...N].filter(ch => BOX.test(ch))
    let k = 0
    next = segs.map(g => g.chars.map(ch => (BOX.test(ch) && k < want.length ? want[k++] : ch)))
  } else if (!O) {
    // 글자 조각은 있는데 비었다(<hp:t/>) — 첫 조각에 넣는다
    next[0] = [...N]
  } else {
    // ② 앞·뒤 공통부를 두고 가운데만
    const o = [...O], n = [...N]
    let p = 0
    while (p < o.length && p < n.length && o[p] === n[p]) p++
    let s = 0
    while (s < o.length - p && s < n.length - p && o[o.length - 1 - s] === n[n.length - 1 - s]) s++
    const delFrom = p, delTo = o.length - s
    const ins = n.slice(p, n.length - s)
    // 넣을 자리: 지우는 범위의 첫 글자 조각. 지울 게 없으면 — 앞·뒤 공통부 **사이의 빈 조각**이 있으면 거기
    // (깨끗한 서식의 표지 제목: 빨간 건물명 런이 비어 있다. 바로 앞 「[ 」에 붙이면 이름이 파랗게 찍힌다),
    // 없으면 바로 앞 글자의 조각(맨 앞이면 첫 글자 조각)
    const leftSeg = p > 0 ? flat[p - 1].s : -1
    const rightSeg = p < o.length ? flat[p].s : segs.length
    const gap = segs.findIndex((g, k) => k > leftSeg && k < rightSeg && g.chars.length === 0)
    const anchor = delTo > delFrom ? flat[delFrom]
      : gap >= 0 ? { s: gap, i: 0 }
      : (p > 0 ? { s: flat[p - 1].s, i: flat[p - 1].i + 1 } : { s: flat[0].s, i: 0 })
    const del = new Set<string>()
    for (let x = delFrom; x < delTo; x++) del.add(`${flat[x].s},${flat[x].i}`)
    next = segs.map((g, si) => {
      const out: string[] = []
      g.chars.forEach((ch, i) => {
        if (si === anchor.s && i === anchor.i) out.push(...ins)
        if (!del.has(`${si},${i}`)) out.push(ch)
      })
      if (si === anchor.s && anchor.i >= g.chars.length) out.push(...ins)
      return out
    })
  }
  let outCell = cell
  for (let si = segs.length - 1; si >= 0; si--) {
    const g = segs[si]
    if (next[si].join('') === g.chars.join('') && !g.empty) continue
    if (g.empty && !next[si].length) continue
    outCell = outCell.slice(0, g.start) + segXml(next[si], tags) + outCell.slice(g.end)
  }
  return dropLineseg(outCell)
}

/** 줄 배치 캐시를 떼어 한글이 다시 배치하게 한다(글자 수가 바뀐 칸) */
function dropLineseg(cell: string): string {
  return cell.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '')
}

/** 미리보기 그림 자리 — 양식 원본 썸네일(이전 작성 건물 표지)을 지운다: 흰 1×1 PNG */
const BLANK_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))

/** 칸 글자가 단위만 인쇄된 칸(「㎡」「m」「급」「명」) — 엑셀 `unitCell`과 같은 규칙으로 값 뒤에 붙인다 */
const UNIT_ONLY = /^(㎡|m|급|명|층|대|개소|km|분)$/

export type FirePlanHwpxStats = {
  written: number
  /** 범위 안 앵커인데 HWPX 칸으로 못 되돌린 것(엑셀 전용 칸) */
  unmapped: string[]
  /** 되돌렸는데 그 칸이 없다 = 양식·manifest 불일치(결함) */
  missingCell: string[]
  /** 중첩 표를 품은 칸이라 건드리지 않은 것 */
  skippedNested: string[]
  /** 흔적 정리로 엑셀 서식 글자를 되쓴 칸 */
  restored: number
}

function str(v: CellValue | undefined): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v : String(v)
}

/** 양식 HWPX + 값 맵 → 채운 HWPX. sheets = 이번에 채울 시트(manifest 이름) */
export async function fillFirePlanHwpx(
  template: Uint8Array, values: Map<string, CellValue>,
  sheets: readonly string[] = FIRE_PLAN_HWPX_STAGE1,
): Promise<{ bytes: Uint8Array; stats: FirePlanHwpxStats }> {
  const zip = await JSZip.loadAsync(template)
  const secFile = zip.file('Contents/section0.xml')
  if (!secFile) throw new Error('양식에 Contents/section0.xml이 없습니다')
  let xml = await secFile.async('string')
  const stats: FirePlanHwpxStats = { written: 0, unmapped: [], missingCell: [], skippedNested: [], restored: 0 }

  // 쓸 칸 모으기 — 표마다 [행,열] → 글자. 앵커가 흔적 정리보다 이긴다(같은 칸이면 값)
  const plan = new Map<number, Map<string, { text: string; label: string; unit: boolean }>>()
  const put = (t: HwpxCellTarget, text: string, label: string, unit: boolean, overwrite: boolean) => {
    const m = plan.get(t.table) ?? new Map()
    const k = `${t.row},${t.col}`
    if (!overwrite && m.has(k)) return
    m.set(k, { text, label, unit })
    plan.set(t.table, m)
  }
  for (const sheet of sheets) {
    const s = sheetManifest(sheet)
    // 흔적 정리 — 엑셀 빌더가 지운 칸을 엑셀의 정리된 글자로
    // sampleBlanked는 manifest JSON엔 있지만 타입 선언엔 없다(빌더 기록용 필드) — 넓혀 읽는다
    const sampleBlanked = (s as { sampleBlanked?: Record<string, string> }).sampleBlanked ?? {}
    const residue = new Set([
      ...Object.keys(s.restoredBoxes ?? {}), ...Object.keys(sampleBlanked),
      ...Object.keys(s.scrubbed ?? {}), ...Object.keys(s.fillInStripped ?? {}),
    ])
    for (const cell of residue) {
      const t = anchorToHwpx(sheet, cell)
      if (!t) continue
      put(t, s.labels[cell] ?? '', `${sheet}!${cell}(흔적)`, false, false)
    }
  }
  for (const a of FIRE_PLAN_ANCHORS) {
    if (!sheets.includes(a.sheet)) continue
    const t = anchorToHwpx(a.sheet, a.cell)
    if (!t) { stats.unmapped.push(`${a.field}@${a.sheet}!${a.cell}`); continue }
    put(t, str(values.get(a.field)), `${a.field}@${a.sheet}!${a.cell}`, true, true)
  }

  // 뒤 표부터 고친다 — 앞을 고치면 뒤 표의 위치가 밀린다
  const spans = tableSpans(xml)
  for (const tIdx of [...plan.keys()].sort((a, b) => b - a)) {
    const span = spans[tIdx]
    if (!span) { for (const v of plan.get(tIdx)!.values()) stats.missingCell.push(`${v.label}(표${tIdx} 없음)`); continue }
    const cells = cellSpans(xml, span[0], span[1])
    const byKey = new Map(cells.map(c => [`${c.row},${c.col}`, c]))
    const edits: Array<{ c: CellSpan; text: string }> = []
    for (const [k, v] of plan.get(tIdx)!) {
      const c = byKey.get(k)
      if (!c) { stats.missingCell.push(`${v.label}→표${tIdx}(${k})`); continue }
      if (c.nested) { stats.skippedNested.push(`${v.label}→표${tIdx}(${k})`); continue }
      let text = v.text
      if (v.unit) {
        const orig = cellPlain(xml.slice(c.start, c.end))
        if (UNIT_ONLY.test(orig)) text = text ? (text.endsWith(orig) ? text : `${text}${orig}`) : orig
        else {
          // 이미 채운 파일을 다시 채울 때(「691.85㎡」 칸에 숫자만 오는 경우) — 칸 끝 단위를 이어 붙인다(멱등)
          const um = /(㎡|m|급|명|층|대|개소|km|분)$/.exec(orig)
          if (um && /^[\d.,]+$/.test(text.trim())) text = `${text.trim()}${um[1]}`
        }
      } else stats.restored++
      edits.push({ c, text })
    }
    for (const { c, text } of edits.sort((a, b) => b.c.start - a.c.start)) {
      xml = xml.slice(0, c.start) + rewriteCell(xml.slice(c.start, c.end), text) + xml.slice(c.end)
      stats.written++
    }
  }
  stats.restored = Math.min(stats.restored, stats.written)

  zip.file('Contents/section0.xml', xml)
  // 미리보기 글(목록 썸네일 문구)은 양식 원본(이전 작성 건물)이다 — 비운다. 그림 썸네일은 그대로 둔다
  if (zip.file('Preview/PrvText.txt')) zip.file('Preview/PrvText.txt', '', { createFolders: false })
  if (zip.file('Preview/PrvImage.png')) zip.file('Preview/PrvImage.png', BLANK_PNG, { createFolders: false })
  // 양식에서 무압축인 두 항목(mimetype은 OCF 규약상 첫 항목·무압축 필수)은 그대로 무압축 — report9-hwpx와 같은 규약.
  // 항목 순서는 JSZip이 유지한다
  for (const name of ['mimetype', 'version.xml']) {
    const f = zip.file(name)
    if (f) zip.file(name, await f.async('uint8array'), { compression: 'STORE', createFolders: false })
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return { bytes, stats }
}

/** 시트별 사상 현황 — 다음 단계 범위를 정할 때 본다(앵커 수 · HWPX로 되돌릴 수 있는 수) */
export function firePlanHwpxCoverage(): Array<{ sheet: string; anchors: number; mapped: number }> {
  return FIRE_PLAN_MANIFEST.sheets.map(s => {
    const as = FIRE_PLAN_ANCHORS.filter(a => a.sheet === s.name)
    return { sheet: s.name, anchors: as.length, mapped: as.filter(a => anchorToHwpx(a.sheet, a.cell)).length }
  })
}
