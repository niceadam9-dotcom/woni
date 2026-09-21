/** 변이 검사 — 표지 단언이 **실제로 무는가** (2026-09-21).
 *  🚨 소스는 node에서 utf8로만 읽고 쓴다(PowerShell은 한글을 깬다) · 치환 건수를 가드한다.
 *  실행: node scripts/_mut-cover-title.mjs   (dev 서버 필요)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const LIB = 'src/lib/fire-plan-cover-title.ts'
const ROUTE = 'src/app/(dashboard)/customers/[id]/fire-plan/xlsx/route.ts'
const MUTANTS = [
  { id: 'M1', file: LIB, desc: '자동 크기 폐지 — 종전 고정 32pt로 되돌림',
    from: 'const fontPt = Math.max(Math.floor(bestPt), MIN_PT)', to: 'const fontPt = 32',
    expect: '① 제목 크기' },
  { id: 'M2', file: LIB, desc: '폭 여유 제거 + 상한 해제(넘치게)',
    from: 'const SAFETY = 0.94', to: 'const SAFETY = 2.2',
    expect: '② 가장 넓은 줄이 띠 폭 안' },
  { id: 'M3', file: LIB, desc: '띠 높이를 줄 수와 무관하게 고정',
    from: 'const rowHeightPt = Math.min(Math.max(heightFor(best, fontPt), MIN_ROW_PT), MAX_ROW_PT)',
    to: 'const rowHeightPt = 40',
    expect: '③ 띠 높이' },
  { id: 'M4', file: LIB, desc: 'wrapText 제거(두 줄이 한 줄로 뭉개짐)',
    from: "const align = '<alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/>'",
    to: "const align = '<alignment horizontal=\"center\" vertical=\"center\"/>'",
    expect: '③ 제목 칸에 wrapText' },
  { id: 'M5', file: LIB, desc: 'fonts count 갱신 누락(Excel 복구창 유발)',
    from: 'stylesXml.slice(fontsStart, fontsOpenEnd).replace(/count="\\d+"/, `count="${fonts.length}"`)',
    to: 'stylesXml.slice(fontsStart, fontsOpenEnd)',
    expect: '④ fonts count' },
  { id: 'M6', file: LIB, desc: 'cellXfs count 갱신 누락(Excel 복구창 유발)',
    from: 'stylesXml.slice(xfsStart, xfsOpenEnd).replace(/count="\\d+"/, `count="${xfs.length}"`)',
    to: 'stylesXml.slice(xfsStart, xfsOpenEnd)',
    expect: '④ cellXfs count' },
  { id: 'M7', file: ROUTE, desc: '주소 없을 때 라벨 지우기 폐지(유령 라벨 부활)',
    from: "const coverAddrLabel = data.address?.trim()", to: "const coverAddrLabel = true",
    expect: '⑥ 소재지' },
]

function runProbe() {
  try {
    return execFileSync('npx', ['tsx', 'scripts/_probe-cover-title.mts'],
      { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) { return `${e.stdout ?? ''}${e.stderr ?? ''}` }
}

console.log('기준선(변이 없음) 실행…')
const base = runProbe()
if (!/0 실패/.test(base)) {
  console.log('  기준선에 빨강이 있다 — 변이 판정 무효'); console.log(base.trim().split('\n').slice(-4).join('\n'))
  process.exit(1)
}
console.log('  기준선 전부 초록 ✅ ', base.trim().split('\n').pop())

let caught = 0
for (const m of MUTANTS) {
  const orig = readFileSync(m.file, 'utf8')
  const hits = orig.split(m.from).length - 1
  if (hits !== 1) { console.log(`${m.id} ⚠ 치환 ${hits}건(1이어야) — 건너뜀: ${m.desc}`); continue }
  writeFileSync(m.file, orig.replace(m.from, m.to), 'utf8')
  try {
    const out = runProbe()
    const red = out.split('\n').filter(l => l.includes(m.expect) && l.includes('❌'))
    if (red.length) caught++
    console.log(`${m.id} ${red.length ? '✅ 잡힘' : '🚨 생존'} — ${m.desc}`)
    console.log(`     ${(red[0] ?? '(기대 단언이 빨강이 아니다)').trim()}`)
    console.log(`     ${out.trim().split('\n').pop()}`)
  } finally { writeFileSync(m.file, orig, 'utf8') }
}
console.log(`\n변이 결과: ${caught}/${MUTANTS.length} 잡힘`)
