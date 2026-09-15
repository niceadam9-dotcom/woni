// 변이 프로브 — 「법령 묶음 안 미등록 단위 자동 ／」 축(2026-09-15)이 실제로 무는지.
// 🚨 from은 한 줄짜리만(CRLF 혼재). 🚨 이 프로브가 도는 중에 대상 파일을 편집하지 말 것(스냅샷 복원).
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const ASM = 'src/lib/report9-assemble.ts'
const MAP = 'src/lib/sheet-facility-map.ts'
const WB = 'src/app/(dashboard)/inspections/[id]/workbook/route.ts'
const SUITE = 'npx tsx scripts/test-form3-axis.mts'

const MUTANTS = [
  { name: 'M1 인쇄가 중분류 판정을 다시 안 부른다 — 화면은 ／인데 문서는 빈칸(원래 결함)',
    file: ASM,
    from: '                  : sheetInstalled && groupInstalledInSheet(s.sheet_name, it.group_code ?? null, codes) === false',
    to: '                  : false',
    expect: '인쇄가 중분류 판정을 부른다' },
  { name: 'M2 인쇄가 세부묶음 판정을 안 부른다 — 자동소화장치가 빈칸으로',
    file: ASM,
    from: '                    : sheetInstalled && subgroupInstalledInSheet(it.subgroup_name, codes) === false',
    to: '                    : false',
    expect: '인쇄가 세부묶음 판정을 부른다' },
  { name: 'M3 엑셀에 목록을 안 내보낸다 — PDF만 고쳐지고 엑셀은 그대로',
    file: ASM,
    from: '    groupNaCodes: [...groupNaCodes],',
    to: '    groupNaCodes: [],',
    expect: '그 결과를 갑지 엑셀이 쓰도록 내보낸다' },
  { name: 'M4 엑셀이 그 목록을 안 쓴다',
    file: WB,
    from: '  if (r9.groupNaCodes.length) {',
    to: '  if (false as boolean) {',
    expect: '엑셀이 그 목록을 그대로 합성한다' },
  { name: 'M5 부모 체크를 하위 등록으로 오인 — 부모만 있어도 하위가 설치로',
    file: MAP,
    from: '  return facilityCodes.some(c => norm(c) === t)\n}\n\n/** 중분류가 입력 대상(활성)인가',
    to: '  return facilityCodes.length > 0\n}\n\n/** 중분류가 입력 대상(활성)인가',
    expect: '부모만 체크 → 주거용 주방 false' },
  { name: 'M6 명시 매핑 대신 정규화 퍼지 — 가스·분말·고체에어로졸이 끊긴다',
    file: MAP,
    from: '  const target = subgroupName ? FIRE_SUB_BY_SUBGROUP[subgroupName.trim()] : undefined',
    to: '  const target = subgroupName ? subgroupName.trim() : undefined',
    expect: '대장 코드로 이어진다' },
  // 🚨 `if (!target) return null`은 groupInstalledInSheet에도 있어 치환이 **첫 번째 함수**를 물었다
  //    (2026-09-15 실측 — 엉뚱한 단언이 울었다). 그래서 이 함수에만 있는 **한 줄**을 겨눈다.
  { name: 'M7 세부묶음 없는 칸까지 판정 — 1-A 소화기구가 해당없음이 된다',
    file: MAP,
    from: '  const target = subgroupName ? FIRE_SUB_BY_SUBGROUP[subgroupName.trim()] : undefined',
    to: "  const target = subgroupName ? (FIRE_SUB_BY_SUBGROUP[subgroupName.trim()] ?? 'ZZ') : 'ZZ'",
    expect: '세부묶음 없는 칸은 판정하지 않는다' },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only)) : MUTANTS
if (only && !TARGETS.length) throw new Error(`MUT=${only} 없음`)
let caught = 0
for (const m of TARGETS) {
  const orig = readFileSync(m.file, 'utf8')
  try {
    const from = orig.includes(m.from) ? m.from : m.from.replace(/\n/g, '\r\n')
    if (!orig.includes(from)) throw new Error(`치환 대상을 못 찾음 (${m.file}):\n${m.from}`)
    const to = from === m.from ? m.to : m.to.replace(/\n/g, '\r\n')
    writeFileSync(m.file, orig.replace(from, to))
    let out = '', failed = false
    try { out = execSync(SUITE, { encoding: 'utf8', stdio: 'pipe' }) }
    catch (e) { failed = true; out = `${e.stdout ?? ''}${e.stderr ?? ''}` }
    const red = out.split('\n').filter(l => l.includes('❌'))
    const hit = red.some(l => l.includes(m.expect))
    if (failed && hit) { caught++; console.log(`✅ ${m.name}\n     → 빨강: ${red.map(l => l.trim()).slice(0, 3).join(' | ')}`) }
    else if (failed) console.log(`⚠️  ${m.name}\n     → 빨강이나 의도한 단언이 아니다(기대 "${m.expect}")\n     → ${red.map(l => l.trim()).slice(0, 3).join(' | ') || '(❌ 없음 — 스위트가 죽었다)'}`)
    else console.log(`❌ ${m.name}\n     → 되돌렸는데 초록이다 — 무는 단언이 없다`)
  } finally { writeFileSync(m.file, orig) }
}
console.log(`\n변이 결과: ${caught} / ${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
