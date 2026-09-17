/** 2.3 임무 — 슬롯 41칸 좌표·병합 구조 실측 (2026-09-18)
 *  D-2 전제 검증 후속: `brigadeTeams`(팀별 임무 서술+프리셋)가 이 시트의 원천인지,
 *  41칸이 어떤 표 구조(팀 블록·조직도)로 놓였는지 실측한다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-23-duty-slots.mts */
import JSZip from 'jszip'
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'

const SHEET = '2.3 임무'
const rs = await blankReport([SHEET], null)
console.log(`슬롯 ${rs[0].slots} · 상자 ${rs[0].boxes}`)
for (const b of rs[0].blanks) console.log(`  ${b.kind.padEnd(8)} ${b.ref}`)

const t = await firePlanTemplate()
const zip = await JSZip.loadAsync(t.bytes)
const g = await readSheetGrid(zip, SHEET)
console.log(`\n행 수 ${g.rows} · 열 수 ${g.cols}`)

/* 슬롯 41칸의 테두리 변 수 — 값 칸(4변 상자)인가 조직도 연결선(1~2변)인가 */
console.log('\n=== 슬롯 테두리 변 수 ===')
const blankRefs = new Set(rs[0].blanks.map(b => b.ref))
const edgeCount = new Map<number, string[]>()
for (const c of g.cells) {
  if (!blankRefs.has(c.ref)) continue
  const s = c.style as Record<string, unknown>
  const edges = ['top', 'bottom', 'left', 'right']
    .filter(k => s[k] && s[k] !== 'none').length
  const arr = edgeCount.get(edges) ?? []
  arr.push(c.ref)
  edgeCount.set(edges, arr)
}
for (const [n, refs] of [...edgeCount.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${n}변: ${refs.length}칸 — ${refs.join(' ')}`)
}
