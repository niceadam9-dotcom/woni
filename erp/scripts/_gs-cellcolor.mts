/** hwpx 셀별 **글자색** 추출 — 「hwp에서 빨강 글씨는 엑셀에서도 빨강」(사용자 지시).
 *
 *  색은 본문이 아니라 `header.xml`의 문자속성표에 있고, 본문 run이 `charPrIDRef`로 가리킨다:
 *
 *    <hp:tc …>
 *      <hp:subList><hp:p><hp:run charPrIDRef="35"><hp:t>글자</hp:t></hp:run></hp:p></hp:subList>
 *      <hp:cellAddr colAddr="2" rowAddr="5"/>
 *    </hp:tc>
 *
 *  ⚠ 표는 **중첩**된다(run 안에 hp:tbl이 들어온다) — 스택으로 따라가지 않으면 좌표가 엉킨다.
 *  ⚠ 공용 `hwpx-table.ts`는 건드리지 않는다(타 세션 자산) — 여기서 따로 훑는다. 대신 표별
 *    셀 수를 parseTables 결과와 **대조**해 순서가 어긋나면 알린다.
 */
import { readFileSync } from 'node:fs'

export interface CellColorMap {
  /** `${tableIndex},${row},${col}` → `RRGGBB` (검정은 넣지 않는다) */
  colors: Map<string, string>
  /** 표별 셀 수 — parseTables와 대조하는 눈멂 가드용 */
  cellCounts: number[]
  palette: Map<string, number>
}

export function scanCellColors(headerXml: string, sectionXml: string): CellColorMap {
  /* 1) charPr id → 색 */
  const colorOf = new Map<number, string>()
  for (const m of headerXml.matchAll(/<hh:charPr\b[^>]*?id="(\d+)"[^>]*?textColor="#?([0-9A-Fa-f]{6})"/g)) {
    colorOf.set(Number(m[1]), m[2].toUpperCase())
  }

  /* 2) 본문 훑기 */
  const colors = new Map<string, string>()
  const cellCounts: number[] = []
  const palette = new Map<string, number>()

  const tblStack: number[] = []          // 표 인덱스 스택(중첩)
  let tblSeq = -1
  type Cur = { tbl: number; runColors: string[]; hasText: boolean; row: number | null; col: number | null }
  const tcStack: Cur[] = []
  let curCharPr: number | null = null

  const tagRe = /<(\/?)(hp:tbl|hp:tc|hp:run|hp:t|hp:cellAddr)\b([^>]*)>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(sectionXml))) {
    const close = m[1] === '/', tag = m[2], attrs = m[3]
    if (tag === 'hp:tbl') {
      if (close) tblStack.pop()
      else { tblSeq++; tblStack.push(tblSeq); cellCounts[tblSeq] = 0 }
    } else if (tag === 'hp:tc') {
      if (close) {
        const c = tcStack.pop()
        if (c && c.row !== null && c.col !== null) {
          cellCounts[c.tbl] = (cellCounts[c.tbl] ?? 0) + 1
          /* 셀 안 run 중 **글자를 가진** 것들의 색 — 첫 색을 셀 색으로 본다(섞이면 첫 run이 라벨이다) */
          const col = c.runColors.find(Boolean)
          if (col && col !== '000000') {
            colors.set(`${c.tbl},${c.row},${c.col}`, col)
            palette.set(col, (palette.get(col) ?? 0) + 1)
          }
        }
      } else {
        tcStack.push({ tbl: tblStack[tblStack.length - 1] ?? 0, runColors: [], hasText: false, row: null, col: null })
      }
    } else if (tag === 'hp:run' && !close) {
      const id = /charPrIDRef="(\d+)"/.exec(attrs)?.[1]
      curCharPr = id ? Number(id) : null
    } else if (tag === 'hp:t' && !close) {
      const cur = tcStack[tcStack.length - 1]
      if (cur && curCharPr !== null) { cur.runColors.push(colorOf.get(curCharPr) ?? ''); cur.hasText = true }
    } else if (tag === 'hp:cellAddr' && !close) {
      const cur = tcStack[tcStack.length - 1]
      if (cur) {
        cur.col = Number(/colAddr="(\d+)"/.exec(attrs)?.[1] ?? -1)
        cur.row = Number(/rowAddr="(\d+)"/.exec(attrs)?.[1] ?? -1)
      }
    }
  }
  return { colors, cellCounts, palette }
}

/* 단독 실행 시 요약 */
if (process.argv[1]?.endsWith('_gs-cellcolor.mts')) {
  const JSZip = (await import('jszip')).default
  const { fileURLToPath } = await import('node:url')
  const { dirname, resolve } = await import('node:path')
  const HERE = dirname(fileURLToPath(import.meta.url))
  const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
  const r = scanCellColors(
    await zip.file('Contents/header.xml')!.async('string'),
    await zip.file('Contents/section0.xml')!.async('string'),
  )
  console.log(`색 있는 셀 ${r.colors.size}개 · 표 ${r.cellCounts.length}개 · 셀 합 ${r.cellCounts.reduce((a, b) => a + b, 0)}`)
  console.log('색 분포:')
  for (const [c, n] of [...r.palette.entries()].sort((a, b) => b[1] - a[1])) console.log(`  #${c}  ${n}칸`)
}
