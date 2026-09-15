/** 갑지 템플릿 자산 수리 — `완료보고서!I19~I22`(이행조치 일자 4행)에 **날짜 서식**을 보장한다.
 *
 *  🚨 2026-09-15 사용자 신고: 이행조치 일자에 `46299`가 인쇄됐다. 값은 옳았다
 *    (= 2026-10-04, 총 이행기간 종료일) — **표시만** 틀렸다.
 *
 *  ## 왜 났나
 *  우리가 넣는 값은 `isoToSerial()`이 만든 **숫자**다(`xlsx-workbook.ts`). 숫자가 날짜로 보이려면
 *  그 칸에 날짜 numFmt가 있어야 한다. 그런데 자산 실측이 이랬다:
 *    I19 numFmtId=164 General ❌ / I20 numFmtId=189 `yyyy-m-d` ✅ / I21·I22 General ❌
 *  **4행 중 한 행만** 서식을 갖고 있었다. 주입기는 스타일 인덱스를 **일부러 보존**하므로
 *  (`xlsx-inject.ts` — 잃으면 그 칸만 서식이 빠진다) 보존된 General이 그대로 적용됐다.
 *  우리 코드가 아니라 자산의 결함이다: 자산엔 `f="개요!G10"`이 있는데도 서식이 General이라,
 *  템플릿을 그냥 엑셀로 열어도 I19는 시리얼로 보인다.
 *
 *  ⚠ **불량 1건일 때만 드러난다** — 2건이면 둘째 행이 I20(정상)에 들어가 가려지고, 3·4건이면
 *    I21·I22도 깨진다. 「보이니까 괜찮다」로 넘어갈 수 있던 자리다.
 *
 *  ## 수리 방식
 *  I20의 스타일을 **복사하지 않는다** — `borderId`가 행마다 다르다(85·86·83). 각 칸의 현재 xf를
 *  그대로 복제해 **`numFmtId`만** 날짜로 바꾼 새 xf를 만들고 그 칸이 그리로 가리키게 한다.
 *  `fontId`도 I20만 112로 다른데(나머지 104) **건드리지 않는다** — 3대1이라 I20이 예외일 뿐이고,
 *  폰트는 서식 결함이 아니라 시각 결정이다(바꾸려면 사람이 정해야 한다).
 *
 *  ⚠ 날짜 서식 id를 **새로 만들지 않는다.** 이 4행 중 이미 날짜인 칸의 id를 재사용한다 —
 *    `numFmts`를 늘리면 다른 자산 검사(도너 스타일 수 대조)가 함께 움직인다.
 *  ⚠ `cellXfs`의 `count`를 반드시 갱신한다. 어긋나면 **Excel만** 복구창을 띄운다(LibreOffice는 통과).
 *
 *  멱등: 이미 날짜 서식이면 건너뛴다. 같은 xf가 이미 있으면 새로 만들지 않고 그 인덱스를 쓴다.
 */
export const DONEDATE_SHEET = '완료보고서'
export const DONEDATE_CELLS = ['I19', 'I20', 'I21', 'I22'] as const

/** 엑셀 내장 날짜·시간 서식 id (14~22·45~47) */
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

export type XlsxPart = { get(path: string): Promise<string>; set(path: string, xml: string): void }

export type DoneDatePatchResult = {
  /** 실제로 바꾼 칸 */
  changed: string[]
  /** 이미 날짜여서 건너뛴 칸 */
  skipped: string[]
  /** 재사용한 날짜 서식 id */
  dateFmtId: number | null
  /** cellXfs 개수 전/후 */
  xfsBefore: number
  xfsAfter: number
  notes: string[]
}

export function isDateNumFmt(id: number, customFmt: ReadonlyMap<number, string>): boolean {
  return BUILTIN_DATE.has(id) || /[ymd]/i.test(customFmt.get(id) ?? '')
}

/** styles.xml·시트 XML 문자열을 받아 수리한 문자열을 돌려준다(순수 — I/O 없음).
 *  호출부가 zip에서 꺼내 넣기만 하면 되므로 빌더·CLI·검사가 같은 함수를 쓴다. */
export function patchDoneDateNumFmt(stylesXml: string, sheetXml: string): {
  stylesXml: string; sheetXml: string; result: DoneDatePatchResult
} {
  const notes: string[] = []
  const customFmt = new Map(
    [...stylesXml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)]
      .map(m => [Number(m[1]), m[2]] as [number, string]))

  const xfsStart = stylesXml.indexOf('<cellXfs')
  const xfsOpenEnd = stylesXml.indexOf('>', xfsStart) + 1
  const xfsEnd = stylesXml.indexOf('</cellXfs>')
  if (xfsStart < 0 || xfsEnd < 0) {
    return { stylesXml, sheetXml, result: { changed: [], skipped: [], dateFmtId: null, xfsBefore: 0, xfsAfter: 0, notes: ['cellXfs 블록 부재'] } }
  }
  const xfs = [...stylesXml.slice(xfsOpenEnd, xfsEnd).matchAll(/<xf[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0])
  const xfsBefore = xfs.length

  const cellRe = (ref: string) => new RegExp(`(<c[^>]*\\br="${ref}")([^>]*)`)
  const styleOf = (ref: string): number | null => {
    const m = sheetXml.match(cellRe(ref))
    const s = m ? /s="(\d+)"/.exec(m[2])?.[1] : null
    return s == null ? null : Number(s)
  }
  const fmtOf = (si: number) => Number(/numFmtId="(\d+)"/.exec(xfs[si] ?? '')?.[1] ?? 0)

  // 날짜 서식 id는 **이 4행이 이미 쓰는 것**을 재사용한다
  let dateFmtId: number | null = null
  for (const ref of DONEDATE_CELLS) {
    const si = styleOf(ref)
    if (si == null) continue
    const id = fmtOf(si)
    if (isDateNumFmt(id, customFmt)) { dateFmtId = id; break }
  }
  if (dateFmtId == null) {
    notes.push('이 4행 중 날짜 서식을 가진 칸이 하나도 없다 — 어떤 서식을 쓸지 사람이 정해야 한다(자동 생성하지 않는다)')
    return { stylesXml, sheetXml, result: { changed: [], skipped: [], dateFmtId: null, xfsBefore, xfsAfter: xfsBefore, notes } }
  }

  const changed: string[] = [], skipped: string[] = []
  let outSheet = sheetXml
  for (const ref of DONEDATE_CELLS) {
    const si = styleOf(ref)
    if (si == null) { notes.push(`${ref}: 칸 없음 또는 s 속성 없음 — 건너뜀`); continue }
    if (isDateNumFmt(fmtOf(si), customFmt)) { skipped.push(ref); continue }
    let clone = xfs[si].replace(/numFmtId="\d+"/, `numFmtId="${dateFmtId}"`)
    clone = /applyNumberFormat=/.test(clone)
      ? clone.replace(/applyNumberFormat="[^"]*"/, 'applyNumberFormat="true"')
      : clone.replace(/^<xf /, '<xf applyNumberFormat="true" ')
    let idx = xfs.indexOf(clone)
    if (idx < 0) { xfs.push(clone); idx = xfs.length - 1 }
    outSheet = outSheet.replace(cellRe(ref), (_a, head: string, attrs: string) =>
      head + attrs.replace(/s="\d+"/, `s="${idx}"`))
    changed.push(ref)
  }

  if (changed.length === 0) {
    return { stylesXml, sheetXml: outSheet, result: { changed, skipped, dateFmtId, xfsBefore, xfsAfter: xfsBefore, notes } }
  }
  // ⚠ count 갱신 — 어긋나면 Excel만 복구창을 띄운다
  const outStyles = stylesXml.slice(0, xfsStart)
    + stylesXml.slice(xfsStart, xfsOpenEnd).replace(/count="\d+"/, `count="${xfs.length}"`)
    + xfs.join('')
    + stylesXml.slice(xfsEnd)
  return { stylesXml: outStyles, sheetXml: outSheet, result: { changed, skipped, dateFmtId, xfsBefore, xfsAfter: xfs.length, notes } }
}
