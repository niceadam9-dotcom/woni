/** 소방계획서 **빈칸 보고** — 「엑셀을 받으면 어디가 비어 있나, 그리고 왜 비나」.
 *
 *  사용자의 문제는 *「엑셀을 손으로 고친다」*이고, 그걸 없애는 것은 시트 배선이다. 다만 배선이
 *  끝나기 전까지 사용자는 **무엇이 빌지를 모른 채** 파일을 받는다 — 그래서 열어 보고, 빈칸을
 *  발견하고, 손으로 채운다. 이 모듈은 그 순환을 끊는다: **받기 전에** 빈칸을 화면에서 알린다.
 *
 *  🚨 **두 가지 빈칸을 절대 섞지 않는다.**
 *    · `empty`   — 앵커는 있는데 이 고객의 값이 없다 → **사용자가 채울 수 있다**
 *    · `unwired` — 앵커가 아예 없다 → **ERP가 아직 못 채운다**(우리 할 일, 사용자 탓 아님)
 *    섞으면 사용자가 **채울 수 없는 칸을 채우려 든다**. 타입으로 가른다.
 *
 *  ⚠ 「미입력」은 상태가 아니라 값의 속성이다. 그래서 `unwired`와 같은 축에 두지 않고
 *    `kind`로만 가른다 — 코드가 둘을 혼동할 방법이 없어야 한다.
 *
 *  ⭐ 슬롯 판정은 **실측으로 정했다**. 「테두리가 하나라도 none이 아니면 슬롯」이라는 첫 안은
 *    1.1에서 **1,620칸 전부**를 슬롯으로 만들었다(조밀한 표라 모든 칸이 어떤 표 안에 있다).
 *    라벨·상자·배너·사진을 걷어내고 **병합에 덮인 칸을 빼야** 뜻 있는 수가 나온다:
 *    전 워크북 62,280칸 → 그릴 수 있는 칸 3,951 → **값 슬롯 1,812**(`_probe-slot-denominator.mts`).
 */
import 'server-only'
import JSZip from 'jszip'
import { readSheetGrid, parseRef, type ReadCell } from '@/lib/xlsx-read-sheet'
import { firePlanTemplate } from '@/lib/fire-plan-template-cache'
import { sheetManifest } from '@/lib/fire-plan-xlsx-manifest'
import { FIRE_PLAN_ANCHORS, FIRE_PLAN_IMAGE_BOXES } from '@/lib/fire-plan-anchors'
import { FIRE_PLAN_FORMS, sectionsOfForm } from '@/lib/fire-plan-sections'
// 🚨 부작용 import — 대장이 manifest와 어긋나면 **여기서** 터진다(서버 경로의 관문)
import '@/lib/fire-plan-sections-verify'

export type BlankKind = 'empty' | 'unwired'

export type BlankCell = {
  sheet: string
  /** 'L4' */
  ref: string
  kind: BlankKind
  /** 이웃 라벨 — 사용자가 「어느 칸인지」 알아볼 유일한 단서다(좌표만으론 아무도 모른다) */
  near: string
  /** `empty`일 때만 — 그 칸을 채우는 필드 이름(배선돼 있다는 증거) */
  field?: string
}

export type SheetBlankReport = {
  sheet: string
  /** 사람이 값을 적는 칸 수 */
  slots: number
  /** 그중 ERP가 채우도록 배선된 칸 */
  wired: number
  /** 상자(체크) 칸 수 / 그중 배선된 것 */
  boxes: number
  wiredBoxes: number
  /** 빈칸 목록 — `unwired`가 앞, `empty`가 뒤(우리 할 일을 먼저 보인다) */
  blanks: BlankCell[]
}

/* ────────────────────────── 슬롯 판정 ────────────────────────── */

const anchorCells = (() => {
  const m = new Map<string, Map<string, string>>()   // sheet → cell → field
  for (const a of FIRE_PLAN_ANCHORS) {
    if (!m.has(a.sheet)) m.set(a.sheet, new Map())
    m.get(a.sheet)!.set(a.cell, a.field)
  }
  return m
})()

const photoCells = (() => {
  const m = new Map<string, Set<string>>()
  for (const b of FIRE_PLAN_IMAGE_BOXES) {
    if (!m.has(b.sheet)) m.set(b.sheet, new Set())
    m.get(b.sheet)!.add(b.cell)
  }
  return m
})()

const hasBorder = (c: ReadCell) =>
  c.style.left !== 'none' || c.style.right !== 'none' || c.style.top !== 'none' || c.style.bottom !== 'none'

/** 템플릿 zip — **읽기만** 하므로 프로세스당 한 번만 연다.
 *  ⚠ 시트마다 다시 열면 1.66MB 해제를 50번 한다(시트 하나당 ~6ms → 300ms를 헛되이 태운다). */
let zipMemo: Promise<JSZip> | null = null
function templateZip(): Promise<JSZip> {
  if (!zipMemo) {
    zipMemo = firePlanTemplate()
      .then(t => JSZip.loadAsync(t.bytes))
      .catch(e => { zipMemo = null; throw e })
  }
  return zipMemo
}

/** 시트 격자 — 템플릿이 정적이라 결과도 정적이다. 프로세스당 1회만 읽는다.
 *  ⚠ 이걸 안 하면 보고 한 번에 50시트를 다시 파싱해 **반복 호출에도 700ms**가 든다(실측).
 *    캐시 뒤 2회차부터 격자 비용이 0이 된다. 무게는 전 워크북 62,280칸 정도로, 서버 프로세스가
 *    들기에 부담이 없다. */
const gridMemo = new Map<string, Awaited<ReturnType<typeof readSheetGrid>>>()

async function grid(zip: JSZip, sheet: string) {
  const hit = gridMemo.get(sheet)
  if (hit) return hit
  const g = await readSheetGrid(zip, sheet)
  gridMemo.set(sheet, g)
  return g
}

/** 한 시트의 **값 슬롯** 참조 목록 — 정적(고객 무관)이라 프로세스당 1회만 센다 */
const slotMemo = new Map<string, string[]>()

async function sheetSlots(zip: JSZip, sheet: string): Promise<string[]> {
  const hit = slotMemo.get(sheet)
  if (hit) return hit
  const g = await grid(zip, sheet)
  const man = sheetManifest(sheet)
  const banner = new Set(man.bannerRows)
  const photo = photoCells.get(sheet) ?? new Set<string>()
  const refs = g.cells
    // 병합에 덮인 칸은 화면에도 인쇄물에도 없다 — 셀 수는 62,280인데 그릴 수 있는 건 3,951뿐이다
    .filter(c => !c.covered)
    // 테두리가 하나도 없으면 표 밖의 여백이다(표지 124칸·2.3 임무 210칸이 그렇다)
    .filter(hasBorder)
    // 법정 자구·상자·머리띠·사진 상자는 사람이 값을 적는 칸이 아니다
    .filter(c => !banner.has(c.row) && !man.labels[c.ref] && !man.boxes[c.ref] && !photo.has(c.ref))
    .map(c => c.ref)
  slotMemo.set(sheet, refs)
  return refs
}

/** 라벨 좌표 색인 — 시트당 1회. `{row, col, text}` 목록.
 *  ⚠ 라벨만 훑는다(1.1 기준 80칸). 빈칸마다 **전 셀 1,620칸**을 훑으면 보고 한 번에 200만 번
 *    비교가 돌아 반복 호출에도 300ms가 든다(실측). 분모를 20배 줄이는 것이 맞다. */
const labelIdxMemo = new Map<string, Array<{ row: number; col: number; text: string }>>()

function labelIndex(sheet: string): Array<{ row: number; col: number; text: string }> {
  const hit = labelIdxMemo.get(sheet)
  if (hit) return hit
  const labels = sheetManifest(sheet).labels
  const idx = Object.entries(labels).map(([ref, text]) => {
    const { row, col } = parseRef(ref)
    return { row, col, text: text.replace(/\s+/g, ' ').trim().slice(0, 24) }
  })
  labelIdxMemo.set(sheet, idx)
  return idx
}

/** 좌표만으론 아무도 못 알아본다 — 같은 행의 **가장 가까운 왼쪽 라벨**을 단서로 준다.
 *  없으면 같은 열의 위쪽 라벨(표 머리글)을 본다. */
function nearestLabel(sheet: string, target: ReadCell): string {
  const idx = labelIndex(sheet)
  let best: { d: number; text: string } | null = null
  for (const l of idx) {
    if (l.row !== target.row || l.col >= target.col) continue
    const d = target.col - l.col
    if (!best || d < best.d) best = { d, text: l.text }
  }
  if (best) return best.text
  for (const l of idx) {
    if (l.col !== target.col || l.row >= target.row) continue
    const d = target.row - l.row
    if (!best || d < best.d) best = { d, text: l.text }
  }
  return best?.text ?? ''
}

/* ────────────────────────── 보고 ────────────────────────── */

/** 한 시트의 빈칸 보고.
 *
 *  @param filled 이 고객에 대해 **값이 실제로 있는** 앵커 필드 집합.
 *    ⚠ `null`이면 고객 축을 보지 않고 **배선 여부만** 답한다(DB 왕복 없는 정적 보고).
 */
export async function sheetBlankReport(sheet: string, filled: Set<string> | null): Promise<SheetBlankReport> {
  const zip = await templateZip()
  const g = await grid(zip, sheet)
  const man = sheetManifest(sheet)
  const anchored = anchorCells.get(sheet) ?? new Map<string, string>()
  const slots = await sheetSlots(zip, sheet)
  const byRef = new Map(g.cells.map(c => [c.ref, c]))

  const boxRefs = Object.keys(man.boxes)
  const blanks: BlankCell[] = []

  for (const ref of slots) {
    const cell = byRef.get(ref)
    if (!cell) continue
    const field = anchored.get(ref)
    if (!field) {
      blanks.push({ sheet, ref, kind: 'unwired', near: nearestLabel(sheet, cell) })
    } else if (filled && !filled.has(field)) {
      blanks.push({ sheet, ref, kind: 'empty', near: nearestLabel(sheet, cell), field })
    }
  }

  // 🚨 우리 할 일(`unwired`)을 **먼저** 보인다. 사용자 할 일과 섞여 나오면 「내가 다 채워야 하나」로 읽힌다.
  blanks.sort((a, b) => (a.kind === b.kind ? a.ref.localeCompare(b.ref) : a.kind === 'unwired' ? -1 : 1))

  return {
    sheet,
    slots: slots.length,
    wired: slots.filter(r => anchored.has(r)).length,
    boxes: boxRefs.length,
    wiredBoxes: boxRefs.filter(r => anchored.has(r)).length,
    blanks,
  }
}

/** 여러 시트를 한 번에 — 한 목차 노드가 여러 시트를 담당하므로 이 모양이 기본이다 */
export async function blankReport(sheets: readonly string[], filled: Set<string> | null): Promise<SheetBlankReport[]> {
  const out: SheetBlankReport[] = []
  for (const s of sheets) out.push(await sheetBlankReport(s, filled))
  return out
}

export type FormBlankSummary = {
  sheets: number; slots: number; wired: number; boxes: number; wiredBoxes: number
}

/** 목차 노드별 **정적 요약** — 고객 축이 없어 DB 왕복이 0이다.
 *
 *  ⭐ 화면에 늘 띄우는 「ERP 미배선 N칸」 배지가 이걸 먹는다. 상세 목록(미입력 포함)만
 *    누를 때 서버 액션으로 조회한다 — 조립이 7쿼리 + 스토리지라 늘 돌릴 것이 아니다.
 *  ⚠ 전 시트를 훑지만 격자·슬롯·라벨이 전부 캐시라 **2회차부터 9ms**다(실측).
 */
export async function formBlankSummaries(): Promise<Record<string, FormBlankSummary>> {
  const out: Record<string, FormBlankSummary> = {}
  for (const f of FIRE_PLAN_FORMS) {
    const defs = sectionsOfForm(f.key)
    const rs = await blankReport(defs.map(d => d.sheet), null)
    out[f.key] = {
      sheets: defs.length,
      slots: rs.reduce((n, r) => n + r.slots, 0),
      wired: rs.reduce((n, r) => n + r.wired, 0),
      boxes: rs.reduce((n, r) => n + r.boxes, 0),
      wiredBoxes: rs.reduce((n, r) => n + r.wiredBoxes, 0),
    }
  }
  return out
}
