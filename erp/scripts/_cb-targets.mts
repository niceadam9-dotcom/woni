/** 다중상자 대상 칸 — 여러 프로브가 **같은 목록**을 봐야 한다(사본을 만들면 조용히 갈라진다).
 *
 *  조건은 제품의 적격 규칙에서 「상자 1개」만 뺀 것이다:
 *  상자가 **둘 이상** · 첫 글자가 상자(산문 제외) · 한 줄(여러 줄 제외).
 */
import { FIRE_PLAN_MANIFEST, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'

export type MultiBoxCell = {
  cell: string
  /** 라벨 안 상자들의 문자열 인덱스 */
  at: number[]
  label: string
}

export function multiBoxCells(sheet: string): MultiBoxCell[] {
  const man = sheetManifest(sheet)
  const out: MultiBoxCell[] = []
  for (const cell of Object.keys(man.boxes)) {
    const label = man.labels[cell]
    if (label === undefined) continue
    const at = [...label.matchAll(/[□☐]/g)].map(m => m.index!)
    if (at.length < 2) continue
    if (!/[□☐]/.test(label.trim()[0] ?? '')) continue
    if (label.includes('\n')) continue
    out.push({ cell, at, label })
  }
  return out.sort((a, b) => a.cell.localeCompare(b.cell))
}

/** 전 워크북 합계 — 검사·프로브가 같은 수를 본다 */
export function allMultiBoxCells(): { sheet: string; cells: MultiBoxCell[] }[] {
  return FIRE_PLAN_MANIFEST.sheets
    .map(s => ({ sheet: s.name, cells: multiBoxCells(s.name) }))
    .filter(x => x.cells.length > 0)
}
