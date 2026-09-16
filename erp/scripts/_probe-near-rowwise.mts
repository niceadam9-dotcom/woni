/** 첫 패스(같은 행 왼쪽 라벨)로 결정되는 빈칸 찾기 — 변이 M9가 그 경로를 안 타서 살아남았다. */
import { sheetBlankReport } from '../src/lib/fire-plan-blanks.ts'
import { sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { parseRef } from '../src/lib/xlsx-read-sheet.ts'
import { FIRE_PLAN_MANIFEST as M } from '../src/lib/fire-plan-xlsx-manifest.ts'
for (const s of M.sheets.map(x => x.name)) {
  const r = await sheetBlankReport(s, null)
  const man = sheetManifest(s)
  const idx = Object.entries(man.labels).map(([ref, t]) => ({ ...parseRef(ref), t }))
  for (const b of r.blanks) {
    const { row, col } = parseRef(b.ref)
    const sameRowLeft = idx.filter(l => l.row === row && l.col < col)
    if (sameRowLeft.length > 0 && b.near) {
      console.log(`${s}!${b.ref} 「${b.near}」  (같은 행 왼쪽 라벨 ${sameRowLeft.length}개)`)
      break
    }
  }
}
