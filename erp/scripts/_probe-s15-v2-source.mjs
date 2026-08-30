/* §15 V-2 차단 해소 — 원천 서식에서 현2 44~46행의 라벨↔내용 소속을 확정한다.
 *
 * ⚠나는 이것을 "사용자만 확인 가능"이라 넘겼는데 틀렸다. 원천 `erp/보고서 갑지.xls`가 저장소에 있다.
 *   파생본(빌드 산출 xlsx)에서 어긋나 보였다면 원천을 열어야지, 사람에게 넘길 일이 아니었다.
 *
 * 보는 것: 현2 시트의 38~48행에 대해 A~E열 값 + 병합 범위. 병합이 라벨의 관할을 정한다.
 * 실행: cd F:\AI\ERP\erp; node scripts/_probe-s15-v2-source.mjs
 */
import { readFileSync } from 'fs'
import XLSX from 'xlsx'

const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const wb = XLSX.read(readFileSync(SRC), { cellStyles: true })
console.log(`원천: ${SRC}`)
console.log(`시트 ${wb.SheetNames.length}장 — ${wb.SheetNames.join(' ')}\n`)

const NAME = wb.SheetNames.find(n => n.replace(/\s+/g, '') === '현2') ?? '현2'
const ws = wb.Sheets[NAME]
if (!ws) { console.log(`⚠ 「현2」 시트를 못 찾았다`); process.exit(1) }

const merges = (ws['!merges'] ?? []).map(m => ({
  ref: XLSX.utils.encode_range(m), r1: m.s.r + 1, r2: m.e.r + 1, c1: m.s.c, c2: m.e.c,
}))
const V = (col, row) => {
  const c = ws[XLSX.utils.encode_cell({ c: col, r: row - 1 })]
  return c ? String(c.v ?? '').replace(/\s+/g, ' ').trim() : ''
}
const COLS = { A: 0, B: 1, C: 2, D: 3, E: 4 }

console.log(`══ ${NAME} 38~48행 (원천) ══`)
for (let r = 38; r <= 48; r++) {
  const parts = []
  for (const [n, i] of Object.entries(COLS)) { const v = V(i, r); if (v) parts.push(`${n}=${v.slice(0, 66)}`) }
  const mg = merges.filter(m => m.r1 <= r && r <= m.r2 && m.c1 <= 2)
    .map(m => `${m.ref}${m.r1 === r ? '←시작' : ''}`)
  console.log(`  r${String(r).padStart(2)}  ${parts.join('  |  ') || '(빈 행)'}`)
  if (mg.length) console.log(`        병합: ${mg.join(' ')}`)
}

console.log('\n══ B열 세로 병합 전수 (라벨 관할) ══')
for (const m of merges.filter(m => m.c1 === 1 && m.c2 === 1 && m.r2 > m.r1).sort((a, b) => a.r1 - b.r1)) {
  console.log(`  ${m.ref}  「${V(1, m.r1)}」  관할 r${m.r1}~r${m.r2}`)
}
console.log('\n══ C열 세로 병합 전수 (내용 블록) ══')
for (const m of merges.filter(m => m.c1 === 2 && m.r2 > m.r1).sort((a, b) => a.r1 - b.r1)) {
  console.log(`  ${m.ref}  r${m.r1}~r${m.r2}  ${V(2, m.r1).slice(0, 60)}`)
}
