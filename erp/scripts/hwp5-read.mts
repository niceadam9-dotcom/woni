/** HWP 5.0(OLE/CFB) 본문 리더 — 소방계획서_42 S7-3.
 *
 *  `.hwp`는 hwpx와 달리 **바이너리**다: CFB 복합문서 → `BodyText/Section0` 스트림 →
 *  (압축이면) raw deflate → 레코드 열. 레코드 헤더는 UINT32 하나에 세 값이 접혀 있다:
 *
 *    tagID = v & 0x3FF   ·   level = (v >> 10) & 0x3FF   ·   size = (v >> 20) & 0xFFF
 *    size == 0xFFF 이면 **다음 UINT32가 진짜 크기**다(확장 헤더).
 *
 *  ⭐ 표·셀은 **레벨**로 갈린다(바이트 오프셋으로 세지 않는다):
 *
 *    CTRL_HEADER (L)            ← 표 컨트롤
 *      TABLE       (L+1)        ← 표 속성
 *      LIST_HEADER (L+1)        ← 셀 1
 *        PARA_HEADER (L+2) → PARA_TEXT (L+3)
 *      LIST_HEADER (L+1)        ← 셀 2 …
 *
 *  즉 TABLE 을 만난 레벨과 **같은 레벨의 LIST_HEADER**가 그 표의 셀이고, 더 깊은 TABLE 은
 *  중첩표다. 스택으로 따라가면 중첩도 자연히 풀린다(hwpx 파서를 스캐너로 짠 것과 같은 이유).
 *
 *  ⚠ PARA_TEXT의 제어문자는 **폭이 다르다**. 확장·인라인 컨트롤은 WCHAR 8칸을 차지하므로
 *    1칸으로 세면 그 뒤 글자가 통째로 어긋난다(가장 흔한 오독 지점이다).
 *
 *  이 파일은 **읽기 전용**이고 저장소의 실고객 문서를 다룬다 — 산출물을 커밋하지 말 것(R-2).
 */
import * as CFB from 'cfb'
import { inflateRawSync } from 'node:zlib'

/**
 * 레코드 태그.
 *
 * ⚠ **스펙 문서에서 베끼지 말고 실측으로 정한 값이다.** HWPTAG_BEGIN 기준이 자료마다 하나씩
 *   어긋나 있어서, 흔히 인용되는 `HWPTAG_BEGIN+60 = 76`을 TABLE로 두었더니 표가 **8개**로
 *   나왔다(그 8개는 사실 그림 개체였고, rowCnt/colCnt 자리에서 25955x9330 같은 HWPUNIT이
 *   나왔다). 정답지가 있어서 역산했다 — 양식 hwpx가 표 95개이므로 **개수가 95인 태그**를 찾으면
 *   그게 TABLE이고, 그 답은 76이 아니라 **77**이었다(`_probe-42-hwp5-tags.mts`).
 *   교차 확인: 67이 2,448개 = 설계 문서가 적어 둔 '2,448문단'과 일치.
 */
export const TAG = {
  PARA_HEADER: 66,
  PARA_TEXT: 67,          // 실측 2448개 = 문단 수
  CTRL_HEADER: 71,
  LIST_HEADER: 72,        // 실측 4034개 ≈ 셀 4033 + 표 밖 리스트 1
  TABLE: 77,              // 실측 95개 = 표 수 (스펙 인용값 76이 아니다)
} as const

export interface Hwp5Record { tag: number; level: number; size: number; at: number; payload: Buffer }

export interface Hwp5Cell {
  text: string
  /** LIST_HEADER 페이로드에서 읽은 좌표. 오프셋 보정에 실패하면 null(추측을 사실처럼 적지 않는다) */
  row: number | null
  col: number | null
  rowSpan: number | null
  colSpan: number | null
}

export interface Hwp5Table {
  index: number
  depth: number
  rowCnt: number
  colCnt: number
  cells: Hwp5Cell[]
}

/* ────────────────────────── 컨테이너 ────────────────────────── */

export function readSectionStream(buf: Buffer, section = 0): { bytes: Buffer; compressed: boolean } {
  const cfb = CFB.read(buf, { type: 'buffer' })
  const head = CFB.find(cfb, 'FileHeader')
  if (!head?.content) throw new Error('hwp5: FileHeader 스트림이 없다 — HWP 5.0 파일이 아니다')
  const hb = Buffer.from(head.content as Uint8Array)
  const sig = hb.subarray(0, 17).toString('latin1')
  if (!sig.startsWith('HWP Document File')) throw new Error(`hwp5: 시그니처 불일치 — '${sig}'`)
  // 속성 UINT32 의 bit0 = 압축 여부
  const compressed = (hb.readUInt32LE(36) & 1) === 1

  const ent = CFB.find(cfb, `/BodyText/Section${section}`) ?? CFB.find(cfb, `BodyText/Section${section}`)
  if (!ent?.content) throw new Error(`hwp5: BodyText/Section${section} 이 없다`)
  const raw = Buffer.from(ent.content as Uint8Array)
  // ⚠ zlib 헤더가 없는 **raw** deflate 다. inflateSync를 쓰면 'incorrect header check'가 난다
  return { bytes: compressed ? inflateRawSync(raw) : raw, compressed }
}

/* ────────────────────────── 레코드 ────────────────────────── */

export function walkRecords(bytes: Buffer): Hwp5Record[] {
  const out: Hwp5Record[] = []
  let i = 0
  while (i + 4 <= bytes.length) {
    const v = bytes.readUInt32LE(i)
    const tag = v & 0x3ff
    const level = (v >> 10) & 0x3ff
    let size = (v >> 20) & 0xfff
    let at = i + 4
    if (size === 0xfff) { size = bytes.readUInt32LE(at); at += 4 }
    if (at + size > bytes.length) break // 꼬리가 잘렸다 — 조용히 멈추되 여기까지는 유효
    out.push({ tag, level, size, at, payload: bytes.subarray(at, at + size) })
    i = at + size
  }
  return out
}

/* ────────────────────────── 본문 텍스트 ────────────────────────── */

/** WCHAR 8칸을 차지하는 확장·인라인 컨트롤 */
const WIDE_CTRL = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23, 4, 5, 6, 7, 8, 19, 20])

export function decodeParaText(payload: Buffer): string {
  const out: string[] = []
  const n = Math.floor(payload.length / 2)
  for (let i = 0; i < n; i++) {
    const c = payload.readUInt16LE(i * 2)
    if (c < 32) {
      if (WIDE_CTRL.has(c)) { i += 7; continue }  // 8 WCHAR 짜리 — 1칸으로 세면 뒤가 다 어긋난다
      if (c === 10 || c === 13) out.push('\n')
      continue
    }
    out.push(String.fromCharCode(c))
  }
  return out.join('')
}

/* ────────────────────────── 표 ────────────────────────── */

/**
 * LIST_HEADER 페이로드에서 셀 좌표를 읽는다.
 *
 * ⚠ 공통부(문단 수·속성) 길이가 문서·구현마다 다르게 기술돼 있어 **오프셋을 단정하지 않는다**.
 *   후보를 여러 개 두고 호출부가 hwpx 실측과 대조해 고르게 한다(`calibrateCellOffset`).
 *   눈대중으로 하나 골라 박으면 그 순간부터 좌표가 조용히 틀린다.
 */
export function readCellAt(payload: Buffer, off: number): Omit<Hwp5Cell, 'text'> | null {
  if (payload.length < off + 8) return null
  return {
    col: payload.readUInt16LE(off),
    row: payload.readUInt16LE(off + 2),
    colSpan: payload.readUInt16LE(off + 4),
    rowSpan: payload.readUInt16LE(off + 6),
  }
}

export const CELL_OFFSET_CANDIDATES = [8, 6, 10, 12] as const

/** TABLE 레코드 페이로드 → rowCnt/colCnt. 속성 UINT32 다음에 UINT16 두 개 */
function readTableDims(payload: Buffer): { rowCnt: number; colCnt: number } {
  if (payload.length < 8) return { rowCnt: 0, colCnt: 0 }
  return { rowCnt: payload.readUInt16LE(4), colCnt: payload.readUInt16LE(6) }
}

/** 레코드 열 → 표 목록(중첩 포함, 등장 순서). 좌표 오프셋은 호출부가 정한다 */
export function extractTables(records: Hwp5Record[], cellOffset: number): Hwp5Table[] {
  const out: Hwp5Table[] = []
  const stack: { level: number; table: Hwp5Table }[] = []
  let cur: Hwp5Cell | null = null

  for (const r of records) {
    // 레벨이 얕아지면 그만큼 표를 닫는다
    while (stack.length && r.level < stack[stack.length - 1].level) { stack.pop(); cur = null }
    const top = stack[stack.length - 1]

    if (r.tag === TAG.TABLE) {
      const { rowCnt, colCnt } = readTableDims(r.payload)
      const t: Hwp5Table = { index: out.length, depth: stack.length, rowCnt, colCnt, cells: [] }
      out.push(t)
      // TABLE 은 셀 LIST_HEADER 와 **같은 레벨**에 온다
      stack.push({ level: r.level, table: t })
      cur = null
      continue
    }

    if (r.tag === TAG.LIST_HEADER && top && r.level === top.level) {
      const co = readCellAt(r.payload, cellOffset)
      cur = { text: '', row: co?.row ?? null, col: co?.col ?? null, rowSpan: co?.rowSpan ?? null, colSpan: co?.colSpan ?? null }
      top.table.cells.push(cur)
      continue
    }

    if (r.tag === TAG.PARA_TEXT && cur) {
      const t = decodeParaText(r.payload)
      cur.text = cur.text ? `${cur.text}\n${t}` : t
      continue
    }
  }
  return out
}

/**
 * 좌표 오프셋 보정 — **정답지가 따로 있을 때만 쓴다**.
 *
 * 양식 hwpx는 `hp:cellAddr`로 좌표를 명시하므로 그것을 기준으로, HWP5 쪽 후보 오프셋 중
 * (row,col)이 가장 많이 일치하는 것을 고른다. 일치율이 낮으면 `null`을 돌려 **좌표를 쓰지 말라고**
 * 알린다 — 틀린 좌표로 대조하면 대조 자체가 거짓말이 된다.
 */
export function calibrateCellOffset(
  records: Hwp5Record[],
  truth: Array<Array<{ row: number; col: number }>>,
): { offset: number; hitRate: number } | null {
  let best: { offset: number; hitRate: number } | null = null
  for (const off of CELL_OFFSET_CANDIDATES) {
    const tables = extractTables(records, off)
    let hit = 0, total = 0
    for (let i = 0; i < Math.min(tables.length, truth.length); i++) {
      const a = tables[i].cells, b = truth[i]
      for (let k = 0; k < Math.min(a.length, b.length); k++) {
        total++
        if (a[k].row === b[k].row && a[k].col === b[k].col) hit++
      }
    }
    const rate = total ? hit / total : 0
    if (!best || rate > best.hitRate) best = { offset: off, hitRate: rate }
  }
  return best && best.hitRate >= 0.95 ? best : null
}
