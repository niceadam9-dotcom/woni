/** 표지 제목 자동 대형화 — 「이름 길이에 맞춰 가장 크게」 (2026-09-21 사용자 지시).
 *
 *  ## 왜 템플릿에 고정 크기를 못 박을 수 없는가
 *
 *  표지 제목 칸은 **A3:BH3 전폭 병합**이고 폭은 60열 × 1.8자 = 108자 = **570.7pt**다.
 *  제목 원문은 `[ {고객명} ] 소방계획서`라 **고객마다 길이가 다르다** — 실측(활성 309명):
 *
 *      한 줄로 안 넘치는 최대 크기:  가장 긴 이름 23pt · 중앙값 42pt · 가장 짧은 이름 54pt
 *
 *  즉 어떤 고정 크기를 골라도 한쪽이 깨진다. 종전 32pt는 **309명 중 32명(10%)에서 이미 넘쳐**
 *  제목이 잘린 채 나가고 있었다(2026-09-21 실측). 템플릿은 고객을 모르므로 이 계산은
 *  **런타임에서만** 할 수 있다.
 *
 *  ## 두 줄로 나누는 이유
 *
 *  한 줄로는 폭이 곧 천장이라 용문3조차 57pt가 한계다(사용자 요구 「최소 몇 배」를 못 맞춘다).
 *  `[ 이름 ]`과 `소방계획서`로 나누면 긴 쪽만 재면 되므로 같은 폭에서 **두 배 가까이** 커진다
 *  (용문3: 57pt → 114pt). 나누는 자리는 닫는 대괄호 뒤 — 양식 원문이 정한 경계다.
 *
 *  ## 글자 폭 모델
 *
 *  한글·한자·전각 = 1em, 그 밖(영문·숫자·공백·괄호) = 0.5em. **실측으로 검증됐다**:
 *  `[ 용문3 ] 소방계획서`를 10em으로 재고 32pt를 곱하면 320pt인데, 생성물에서 잰 실제
 *  점유율이 570.7pt의 56%(=320pt)로 정확히 일치했다.
 *
 *  🚨 글꼴을 바꾸면 이 모델을 **다시 재야 한다**(지금은 HY헤드라인M — 사용자가 납품 원본과
 *    같게 유지하기로 확정). PDF에서는 그 글꼴이 없어 Noto로 대체되므로 폭이 조금 달라진다 —
 *    그래서 아래 `SAFETY`로 여유를 둔다.
 */

/** 표지 제목 칸의 폭(pt) — 60열 × 1.8자. `(108 × 7 + 5)px × 0.75` (실측과 일치) */
export const COVER_WIDTH_PT = 570.75

/** 폭 여유 — PDF 글꼴 대체(Noto)·자간 차이를 흡수한다. 넘쳐 잘리는 쪽이 조금 작은 쪽보다 나쁘다 */
const SAFETY = 0.94
/** 상한 — 이보다 키우면 띠 높이가 한 쪽을 위협한다(사진 상자 330pt와 공존해야 한다) */
const MAX_PT = 96
/** 하한 — 이보다 작으면 표지 제목 구실을 못 한다. 여기 걸리는 이름은 세 줄로 넘긴다 */
const MIN_PT = 24
/** 줄 높이 배수 · 칸 위아래 여백(pt) */
const LINE_FACTOR = 1.22
const PAD_PT = 16
/** 띠 높이 하한 — 글자가 작아도 표지 띠가 납작해지지 않게 */
const MIN_ROW_PT = 100

/** 글자 폭(em) — 한글·한자·전각 1, 그 밖 0.5 */
export function coverTitleEm(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    // 한글(자모 포함)·한자·전각기호 = 1em, 그 밖 = 0.5em
    w += (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7ff)
      || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff01 && c <= 0xff60) ? 1 : 0.5
  }
  return w
}

export interface CoverTitleLayout {
  /** 인쇄할 줄들 — 칸에는 `\n`으로 이어 넣는다(칸 서식에 `wrapText`가 켜져 있어야 한다) */
  lines: string[]
  fontPt: number
  rowHeightPt: number
}

/** 제목을 `[ 이름 ]` / `소방계획서` 로 가른다. 그 꼴이 아니면 **한 줄 그대로**(양식이 바뀐 것이다) */
export function splitCoverTitle(title: string): string[] {
  const m = /^(.*\])\s*(\S.*)$/.exec(title.trim())
  if (!m) return [title.trim()]
  return [m[1].trim(), m[2].trim()]
}

/** 띠 높이 상한(pt) — 사진 상자 330pt·정보 블록과 함께 **한 쪽**(838pt) 안에 있어야 한다 */
const MAX_ROW_PT = 300

/** 긴 줄을 둘로 접는다 — 띄어쓰기가 있으면 **가운데에 가장 가까운 공백**에서(자연스러운 자리),
 *  없으면 글자 수 절반에서. 접는 목적은 「가장 긴 줄」을 줄여 글자를 키우는 것이다. */
function foldLine(s: string): string[] {
  const ch = [...s]
  const mid = ch.length / 2
  let best = -1
  for (let i = 0; i < ch.length; i++) {
    if (ch[i] !== ' ') continue
    if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i
  }
  const cut = best > 0 ? best : Math.ceil(mid)
  const head = ch.slice(0, cut).join('').trim()
  const tail = ch.slice(cut).join('').trim()
  return head && tail ? [head, tail] : [s]
}

/**
 * 이 제목을 **가장 크게** 앉히는 줄 나눔·글자 크기·띠 높이.
 *
 * 후보를 만들어 놓고 **글자가 가장 커지는 것**을 고른다(줄 수가 적은 쪽이 아니다):
 * 긴 이름은 이름 줄을 한 번 더 접어야 크게 들어간다 — 실측 「외갓집체험마을 (외갓집영농조합법인)」은
 * 두 줄이면 27pt인데 이름을 접으면 **53pt**다. 다만 줄이 늘면 띠가 높아지므로 `MAX_ROW_PT`로 가둔다.
 */
export function coverTitleLayout(title: string, widthPt: number = COVER_WIDTH_PT): CoverTitleLayout {
  const usable = widthPt * SAFETY
  const base = splitCoverTitle(title)
  const sizeFor = (ls: string[]) => Math.min(usable / Math.max(...ls.map(coverTitleEm), 0.5), MAX_PT)
  const heightFor = (ls: string[], pt: number) => Math.round(ls.length * pt * LINE_FACTOR + PAD_PT)

  // 후보 ① 양식이 정한 경계 그대로 · ② 이름 줄을 한 번 더 접기(두 줄일 때만 뜻이 있다)
  const candidates: string[][] = [base]
  if (base.length === 2) candidates.push([...foldLine(base[0]), base[1]])

  let best = base
  let bestPt = 0
  for (const ls of candidates) {
    const pt = sizeFor(ls)
    if (heightFor(ls, pt) > MAX_ROW_PT) continue      // 띠가 한 쪽을 위협하면 후보에서 뺀다
    if (pt > bestPt) { best = ls; bestPt = pt }
  }
  // 전 후보가 높이에 걸리면(상한을 아주 낮게 잡은 경우) 원래 나눔으로 되돌아간다
  if (bestPt === 0) { best = base; bestPt = sizeFor(base) }

  const fontPt = Math.max(Math.floor(bestPt), MIN_PT)
  const rowHeightPt = Math.min(Math.max(heightFor(best, fontPt), MIN_ROW_PT), MAX_ROW_PT)
  return { lines: best, fontPt, rowHeightPt }
}

/* ────────────────────────── styles.xml · 시트 XML 수술 ────────────────────────── */

export interface CoverTitlePatch {
  applied: boolean
  fontPt: number
  lines: number
  rowHeightPt: number
  notes: string[]
}

/** `<xf …/>` 하나에 가운데·세로가운데·줄바꿈 정렬을 보장한다(자기닫힘·자식 둘 다 받는다) */
function withWrapAlignment(xf: string): string {
  const align = '<alignment horizontal="center" vertical="center" wrapText="1"/>'
  const head = /^<xf\b[^>]*?(\/?)>/.exec(xf)
  if (!head) return xf
  let attrs = head[0].replace(/\/?>$/, '')
  if (!/applyAlignment=/.test(attrs)) attrs += ' applyAlignment="1"'
  else attrs = attrs.replace(/applyAlignment="[^"]*"/, 'applyAlignment="1"')
  const body = head[1] === '/' ? '' : xf.slice(head[0].length).replace(/<\/xf>$/, '')
  return `${attrs}>${body.replace(/<alignment[^>]*\/>/, '')}${align}</xf>`
}

/**
 * 표지 제목 칸의 글자 크기·줄·띠 높이를 이 고객에 맞게 갈아끼운다(순수 — I/O 없음).
 *
 * 🚨 `cellXfs`·`fonts`의 `count`를 반드시 갱신한다 — 어긋나면 **Excel만** 복구 대화상자를
 *   띄운다(LibreOffice는 조용히 통과해 우리 렌더 검사로는 안 잡힌다).
 */
export function patchCoverTitle(stylesXml: string, sheetXml: string, cell: string): {
  stylesXml: string; sheetXml: string; result: CoverTitlePatch
} {
  const notes: string[] = []
  const none = (msg: string): { stylesXml: string; sheetXml: string; result: CoverTitlePatch } => ({
    stylesXml, sheetXml, result: { applied: false, fontPt: 0, lines: 0, rowHeightPt: 0, notes: [...notes, msg] },
  })

  const cellRe = new RegExp(`<c[^>]*\\br="${cell}"[^>]*>[\\s\\S]*?</c>|<c[^>]*\\br="${cell}"[^>]*/>`)
  const cm = cellRe.exec(sheetXml)
  if (!cm) return none(`${cell} 칸 없음`)
  const title = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[0])?.[1] ?? ''
  if (!title.trim()) return none(`${cell} 글자 없음(값 주입 전이다)`)

  const layout = coverTitleLayout(title)

  // ① 글꼴 — 이 칸이 쓰는 글꼴을 복제해 크기만 바꾼다(이름·굵기는 그대로 승계)
  const sIdx = Number(/\bs="(\d+)"/.exec(cm[0])?.[1] ?? NaN)
  if (!Number.isFinite(sIdx)) return none(`${cell} s 속성 없음`)
  const xfsStart = stylesXml.indexOf('<cellXfs')
  const xfsOpenEnd = stylesXml.indexOf('>', xfsStart) + 1
  const xfsEnd = stylesXml.indexOf('</cellXfs>')
  const fontsStart = stylesXml.indexOf('<fonts')
  const fontsOpenEnd = stylesXml.indexOf('>', fontsStart) + 1
  const fontsEnd = stylesXml.indexOf('</fonts>')
  if (xfsStart < 0 || xfsEnd < 0 || fontsStart < 0 || fontsEnd < 0) return none('styles.xml에 fonts/cellXfs 블록 부재')

  const xfs = [...stylesXml.slice(xfsOpenEnd, xfsEnd).matchAll(/<xf[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0])
  const fonts = [...stylesXml.slice(fontsOpenEnd, fontsEnd).matchAll(/<font>[\s\S]*?<\/font>|<font\/>/g)].map(m => m[0])
  const xf = xfs[sIdx]
  if (!xf) return none(`cellXfs[${sIdx}] 없음`)
  const fontId = Number(/fontId="(\d+)"/.exec(xf)?.[1] ?? NaN)
  const baseFont = fonts[fontId]
  if (!baseFont) return none(`fonts[${fontId}] 없음`)

  const newFont = /<sz val="[\d.]+"\/>/.test(baseFont)
    ? baseFont.replace(/<sz val="[\d.]+"\/>/, `<sz val="${layout.fontPt}"/>`)
    : baseFont.replace(/^<font>/, `<font><sz val="${layout.fontPt}"/>`)
  let fIdx = fonts.indexOf(newFont)
  if (fIdx < 0) { fonts.push(newFont); fIdx = fonts.length - 1 }

  const newXf = withWrapAlignment(xf.replace(/fontId="\d+"/, `fontId="${fIdx}"`))
  let xIdx = xfs.indexOf(newXf)
  if (xIdx < 0) { xfs.push(newXf); xIdx = xfs.length - 1 }

  // ② 시트 — 글자를 여러 줄로 바꾸고 새 스타일을 가리킨다
  const text = layout.lines.join('\n')
  const newCell = cm[0]
    .replace(/\bs="\d+"/, `s="${xIdx}"`)
    .replace(/<t[^>]*>[\s\S]*?<\/t>/, `<t xml:space="preserve">${text}</t>`)
  let outSheet = sheetXml.slice(0, cm.index) + newCell + sheetXml.slice(cm.index + cm[0].length)

  // ③ 행 높이 — 줄 수에 맞춰 띠를 키운다(안 키우면 둘째 줄이 테두리 밖으로 잘린다)
  const rowNum = /\d+$/.exec(cell)?.[0]
  if (rowNum) {
    const rowRe = new RegExp(`<row[^>]*\\br="${rowNum}"[^>]*>`)
    const rm = rowRe.exec(outSheet)
    if (rm) {
      let tag = rm[0]
      tag = /\bht="/.test(tag) ? tag.replace(/\bht="[\d.]+"/, `ht="${layout.rowHeightPt}"`)
        : tag.replace(/^<row/, `<row ht="${layout.rowHeightPt}"`)
      if (!/customHeight=/.test(tag)) tag = tag.replace(/>$/, ' customHeight="1">')
      outSheet = outSheet.slice(0, rm.index) + tag + outSheet.slice(rm.index + rm[0].length)
    } else notes.push(`행 ${rowNum} 태그 없음 — 높이는 템플릿 값 유지`)
  }

  // ④ count 갱신 — 어기면 Excel만 복구창
  const outStyles = stylesXml.slice(0, fontsStart)
    + stylesXml.slice(fontsStart, fontsOpenEnd).replace(/count="\d+"/, `count="${fonts.length}"`)
    + fonts.join('')
    + stylesXml.slice(fontsEnd, xfsStart)
    + stylesXml.slice(xfsStart, xfsOpenEnd).replace(/count="\d+"/, `count="${xfs.length}"`)
    + xfs.join('')
    + stylesXml.slice(xfsEnd)

  return {
    stylesXml: outStyles, sheetXml: outSheet,
    result: { applied: true, fontPt: layout.fontPt, lines: layout.lines.length, rowHeightPt: layout.rowHeightPt, notes },
  }
}

/* ────────────────────────── 적용기 (zip 왕복) ────────────────────────── */

/**
 * 워크북 바이트를 받아 표지 제목을 이 고객에 맞게 키운 바이트를 돌려준다.
 *
 * 라우트에서 **값 주입 뒤**에 돌아야 한다 — 칸이 아직 공란이면 잴 제목이 없다.
 * 실패해도 문서는 나간다(제목은 종전 크기로 남을 뿐이다) — 사유는 notes로 고지에 실린다.
 */
export async function applyFirePlanCoverTitle(
  workbookBytes: Uint8Array, sheetName: string, cell: string,
): Promise<{ bytes: Uint8Array; result: CoverTitlePatch }> {
  const JSZip = (await import('jszip')).default
  const { sheetFileMap } = await import('@/lib/xlsx-inject')
  const zip = await JSZip.loadAsync(workbookBytes)
  const files = await sheetFileMap(zip)
  const path = files.get(sheetName)
  const stylesFile = zip.file('xl/styles.xml')
  if (!path || !stylesFile) {
    return { bytes: workbookBytes, result: { applied: false, fontPt: 0, lines: 0, rowHeightPt: 0, notes: [`표지 시트(${sheetName}) 또는 styles.xml 부재`] } }
  }
  const sheetXml = await zip.file(path)!.async('string')
  const stylesXml = await stylesFile.async('string')
  const patched = patchCoverTitle(stylesXml, sheetXml, cell)
  if (!patched.result.applied) return { bytes: workbookBytes, result: patched.result }

  zip.file(path, patched.sheetXml)
  zip.file('xl/styles.xml', patched.stylesXml)
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return { bytes, result: patched.result }
}
