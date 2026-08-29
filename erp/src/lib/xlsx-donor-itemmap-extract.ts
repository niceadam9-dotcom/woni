// ⚠ 빌드·검사 전용 — `src/app` 에서 import 금지.
//    런타임은 이 추출기가 **빌드 타임에** 만들어 둔 `xlsx-donor-itemmap.json`만 읽는다
//    (도너 시트는 공유문자열이 인라인 전개돼 있어 요청마다 XML을 파싱하면 비싸다 — 30 S5-1).
//    이 파일이 src/lib에 있는 이유는 검사가 **배포된 자산에서 맵을 재도출해** 커밋된 JSON과
//    대조해야 하기 때문이다. 추출기가 두 벌이면 그 대조가 무의미해진다.

/** 설비별 점검표(도너) 시트의 `item_code → 점검결과 칸` 좌표 추출 (소방계획서_32 D트랙)
 *
 *  **세 축을 함께 뽑아 교차검증한다.** 한 축만 믿으면 손목록이 되고, 손목록은 다음 것을 못 본다.
 *    ① A열의 item_code (`3-A-001` 꼴)
 *    ② 그 시트에서 「점검결과」 헤더가 있는 **열**
 *    ③ 그 칸이 list dataValidation sqref 안에 있는가
 *
 *  ⚠ ②를 빼고 결과열을 `C`로 고정하면 안 된다. 넓은 서식 4시트(옥3·스4·옥외3·다중1)는
 *  `A=번호, C=점검항목, J=점검결과(J:K 병합)`라서, C에 마크를 쓰면 **점검항목 문구를 덮어쓴다**.
 *  파일은 정상 개봉되고 주입 누락도 0이라 조용히 통과한다 — 2026-08-29 실측으로 잡은 사각이다. */

export type DonorItemEntry = {
  code: string
  sheet: string
  /** 점검결과 칸 (병합이면 앵커 좌표) */
  cell: string
  row: number
  /** 같은 행의 점검항목 문구 — 좌표·코드 결속의 독립 증거(검사가 DB item_name과 대조한다) */
  itemText: string
}

export type DonorExtract = {
  entries: DonorItemEntry[]
  /** 시트 → 결과열 ('C' | 'J') */
  resultCols: Record<string, string>
  /** 시트 → dv는 걸렸는데 코드행이 아닌 칸 수(펌프성능시험·수기 표). 무해하지만 변하면 알아야 한다 */
  dvOnly: Record<string, number>
  /** 하나라도 있으면 빌드를 세운다 */
  failures: string[]
}

const CODE_RE = /^\d{1,2}-[A-Z]-\d{3}$/
const RESULT_HEADER = '점검결과'

const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
const colName = (n: number) => {
  let s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26 }
  return s
}
const unesc = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&#13;/g, '\r')
  .replace(/&amp;/g, '&')   // 반드시 마지막 — 먼저 풀면 `&amp;lt;`가 `<`로 둔갑한다

/** sqref 전개. ⚠ 2열 이상 범위를 버리면 안 된다 — 결과칸이 `J4:K9`처럼 병합된 시트가 4개다.
 *  종전 프로브가 단일 열 범위만 받아 그 시트들의 dv를 통째로 '결손'으로 오판했다(32 C-2). */
export function expandSqref(sq: string): Set<string> {
  const out = new Set<string>()
  for (const part of sq.trim().split(/\s+/)) {
    const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(part)
    if (!m) continue
    if (!m[3]) { out.add(`${m[1]}${m[2]}`); continue }
    for (let c = colNum(m[1]); c <= colNum(m[3]); c++)
      for (let r = +m[2]; r <= +m[4]; r++) out.add(`${colName(c)}${r}`)
  }
  return out
}

/** 시트 XML → 좌표별 문자열 값.
 *  ⚠ 세 가지를 동시에 지켜야 한다 — 하나라도 빠지면 값이 **조용히** 밀리거나 사라진다:
 *   (a) 속성 순서 무관: LibreOffice는 `<c s=".." r="A4">`를 낸다. `<c r="` 고정 정규식은 대부분을 놓친다
 *   (b) 자기닫힘 수용: `<c r="C16" s="734"/>` 를 안 받으면 뒤 셀의 `</c>`를 먹어 값이 한 칸 밀린다
 *   (c) 3형 전부: inlineStr(도너는 빌드가 전개했다) · t="s"(공유문자열) · 그냥 `<v>` */
export function readCells(xml: string, sst: string[] = []): { val: Map<string, string>; refs: Set<string> } {
  const val = new Map<string, string>()
  const refs = new Set<string>()
  for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /\br="([A-Z]+\d+)"/.exec(m[1])?.[1]
    if (!ref) continue
    refs.add(ref)                        // 값이 없어도 '셀은 있다' — F-4는 이 집합으로 판정한다
    const attrs = m[1], body = m[2] ?? ''
    let v: string
    if (/t="inlineStr"/.test(attrs)) {
      v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
    } else {
      const vm = /<v>([^<]*)<\/v>/.exec(body)
      if (!vm) continue
      v = /t="s"/.test(attrs) ? (sst[+vm[1]] ?? '') : vm[1]
    }
    val.set(ref, unesc(v))
  }
  return { val, refs }
}

/** `3-A-001` → [3, 'A', 1] — 시트 안 행 순서 단조성 판정용 */
function codeKey(code: string): [number, string, number] {
  const [a, b, c] = code.split('-')
  return [+a, b, +c]
}
function codeLt(x: [number, string, number], y: [number, string, number]): boolean {
  if (x[0] !== y[0]) return x[0] < y[0]
  if (x[1] !== y[1]) return x[1] < y[1]
  return x[2] < y[2]
}

export function extractDonorItemMap(
  sheets: Array<{ name: string; xml: string }>,
  opts: { sst?: string[]; skipSheets?: string[] } = {},
): DonorExtract {
  const sst = opts.sst ?? []
  const skip = new Set(opts.skipSheets ?? [])
  const entries: DonorItemEntry[] = []
  const resultCols: Record<string, string> = {}
  const dvOnly: Record<string, number> = {}
  const failures: string[] = []
  const seen = new Map<string, DonorItemEntry>()

  for (const { name, xml } of sheets) {
    if (skip.has(name)) continue
    const { val, refs } = readCells(xml, sst)

    // ① A열 코드행 — 행 순서대로
    const codes: Array<{ row: number; code: string }> = []
    for (const [ref, v] of val) {
      if (!/^A\d+$/.test(ref)) continue
      const t = v.trim()
      if (CODE_RE.test(t)) codes.push({ row: +ref.slice(1), code: t })
    }
    if (!codes.length) continue          // 목차·항목 0행 시트는 대상 아님
    codes.sort((a, b) => a.row - b.row)

    // ② 결과열 — 「점검결과」 헤더 셀의 열. F-1: 정확히 1개여야 한다
    const heads = [...val].filter(([, v]) => v.trim() === RESULT_HEADER).map(([ref]) => ref)
    if (heads.length !== 1) {
      failures.push(`F-1 ${name}: 「${RESULT_HEADER}」 헤더가 ${heads.length}개 — 결과열을 정할 수 없다 (${heads.join(',') || '없음'})`)
      continue
    }
    const rcol = /^([A-Z]+)/.exec(heads[0])![1]
    resultCols[name] = rcol

    // 병합 지도 — F-7(비앵커 금지)
    const mergedNonAnchor = new Set<string>()
    for (const mm of xml.matchAll(/<mergeCell[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      const a = /^([A-Z]+)(\d+)$/.exec(mm[1])!, b = /^([A-Z]+)(\d+)$/.exec(mm[2])!
      for (let c = colNum(a[1]); c <= colNum(b[1]); c++)
        for (let r = +a[2]; r <= +b[2]; r++) {
          const ref = `${colName(c)}${r}`
          if (ref !== mm[1]) mergedNonAnchor.add(ref)
        }
    }

    // ③ dv 축 — 결과열에 걸린 list dv만. `#REF!`는 목록 원천이 죽은 것이라 유효로 치지 않는다
    const dvCells = new Set<string>()
    for (const d of xml.matchAll(/<dataValidation[^>]*sqref="([^"]+)"[^>]*type="list"[^>]*>([\s\S]*?)<\/dataValidation>/g)) {
      const f1 = /<formula1>([\s\S]*?)<\/formula1>/.exec(d[2])?.[1] ?? ''
      if (f1.includes('#REF!')) continue
      for (const c of expandSqref(d[1])) if (new RegExp(`^${rcol}\\d+$`).test(c)) dvCells.add(c)
    }

    const codeRows = new Set(codes.map(c => c.row))
    dvOnly[name] = [...dvCells].filter(c => !codeRows.has(+c.slice(rcol.length))).length

    let prev: [number, string, number] | null = null
    let prevCode = ''
    for (const { row, code } of codes) {
      const cell = `${rcol}${row}`

      // F-2 두 축 불일치
      if (!dvCells.has(cell)) failures.push(`F-2 ${name}!${cell} (${code}): 코드행인데 유효한 list dv가 없다`)
      // F-4 결과셀 부재 — 없는 셀엔 쓸 수 없다(스크럽으로 값만 비운 자기닫힘 셀은 '있다')
      if (!refs.has(cell)) failures.push(`F-4 ${name}!${cell} (${code}): 결과셀이 XML에 없다`)
      // F-5 표본 답 잔존 — 남의 점검결과를 인쇄하게 된다
      const cur = (val.get(cell) ?? '').trim()
      if (cur !== '') failures.push(`F-5 ${name}!${cell} (${code}): 결과셀이 비어 있지 않다 = ${JSON.stringify(cur).slice(0, 40)}`)
      // F-7 병합 비앵커 — 쓰면 값이 안 보인다
      if (mergedNonAnchor.has(cell)) failures.push(`F-7 ${name}!${cell} (${code}): 병합 범위의 비앵커 칸`)
      // F-6 행 순서 단조성 — **정답을 몰라도** 코드 중복·행 뒤바뀜을 잡는 축
      const key = codeKey(code)
      if (prev && !codeLt(prev, key)) failures.push(`F-6 ${name}!A${row}: 코드가 행 순서로 증가하지 않는다 — ${prevCode} 다음에 ${code}`)
      prev = key; prevCode = code

      const entry: DonorItemEntry = {
        code, sheet: name, cell, row,
        // 점검항목 문구는 결과열 왼쪽에서 가장 가까운 비어 있지 않은 칸(좁은 서식 B, 넓은 서식 C)
        itemText: nearestItemText(val, rcol, row),
      }
      // F-3 중복 귀속 — 한 응답이 사라지고 다른 응답이 옆 행에 찍힌다
      const dup = seen.get(code)
      if (dup) failures.push(`F-3 ${code}: 중복 귀속 — ${dup.sheet}!${dup.cell} ↔ ${name}!${cell}`)
      else { seen.set(code, entry); entries.push(entry) }
    }
  }
  return { entries, resultCols, dvOnly, failures }
}

function nearestItemText(val: Map<string, string>, rcol: string, row: number): string {
  for (let c = colNum(rcol) - 1; c >= 2; c--) {   // A열(=1)은 코드라 제외
    const v = (val.get(`${colName(c)}${row}`) ?? '').trim()
    if (v) return v
  }
  return ''
}
