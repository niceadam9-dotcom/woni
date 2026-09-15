// 변이 프로브 — 「기본 담당자」 축(2026-09-15)의 단언이 실제로 무는지.
// 🚨 from은 한 줄짜리만(CRLF 혼재). 🚨 도는 중에 대상 파일을 편집하지 말 것(스냅샷 복원).
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const LIB = 'src/lib/default-assignee.ts'
const ACT = 'src/app/(dashboard)/customers/actions.ts'
const SUITE = 'npx tsx scripts/test-default-assignee.mts'

const LIST = 'app/(dashboard)/customers/page.tsx'
const REG = 'src/components/customers/regional-assign-client.tsx'

const MUTANTS = [
  { name: 'M9 목록이 표식을 잃는다 — 화면마다 다른 말을 한다',
    file: 'src/' + LIST,
    from: "                              ? assigneeLabel(empMap.get(c.assigned_employee_id) ?? '-', c.assigned_source)",
    to: "                              ? (empMap.get(c.assigned_employee_id) ?? '-')",
    expect: '고객 목록이 같은 문구 함수를 쓴다' },
  { name: 'M10 지역별 배정 화면이 표식을 잃는다 — 바꿀 대상을 못 찾는다',
    file: REG,
    from: "                          ? <span className=\"text-ink-sub\">현 담당: <strong>{assigneeLabel(currentEmp, c.assigned_source)}</strong></span>",
    to: "                          ? <span className=\"text-ink-sub\">현 담당: <strong>{currentEmp}</strong></span>",
    expect: '지역별 담당 배정이 같은 문구 함수를 쓴다' },
  { name: 'M11 목록 조회에서 출처를 뺀다 — 값이 undefined라 표식이 조용히 사라진다',
    file: 'src/lib/customer-list.ts',
    from: "      inspection_type, inspection_sub_type, address, is_active, assigned_employee_id, assigned_source, created_at,",
    to: "      inspection_type, inspection_sub_type, address, is_active, assigned_employee_id, created_at,",
    expect: '조회**가 assigned_source를 싣는다' },
  { name: 'M12 드롭다운 옆 배지를 없앤다 — 관리자는 영영 못 본다',
    file: 'src/components/customers/assign-employee-inline.tsx',
    from: '        <span data-testid="assign-default-badge"',
    to: '        <span',
    expect: '드롭다운 옆에도 「기본」 배지가 있다' },
  { name: 'M1 설정이 비어도 채운다 — 없는 담당자를 지어낸다',
    file: LIB, from: '  if (!defaultAssigneeId) return false                       // ①',
    to: '  // removed', expect: '설정이 비면 안 채운다' },
  { name: 'M2 이미 배정된 고객을 덮는다 — 사람이 고른 값이 사라진다',
    file: LIB, from: '  if (customer.assigned_employee_id) return false            // ②',
    to: '  // removed', expect: '이미 배정된 고객은 건드리지 않는다' },
  { name: 'M3 유형을 안 가린다 — 작동/종합 미배정까지 채운다',
    file: LIB, from: "  return customer.inspection_type === '일반관리'              // ③",
    to: '  return true', expect: '유형이 "작동"이면 안 채운다' },
  { name: 'M4 라벨이 「(일반)」으로 — 점검유형 라벨과 겹친다',
    file: LIB, from: "  return source === 'default' ? `${name} (기본)` : name",
    to: "  return source === 'default' ? `${name} (일반)` : name", expect: '(기본)' },
  { name: 'M5 출처 미상에도 표식을 붙인다 — 없던 「(기본)」이 생긴다',
    file: LIB, from: "  return source === 'default' ? `${name} (기본)` : name",
    to: "  return source !== 'manual' ? `${name} (기본)` : name", expect: '출처 미상(null)' },
  { name: 'M6 수동 배정이 출처를 안 바꾼다 — 「(기본)」이 거짓으로 남는다',
    file: ACT, from: "      assigned_source: employeeId ? 'manual' : null,",
    to: '      // removed', expect: '출처를 manual로 남긴다' },
  { name: 'M7 일괄 적용이 배정 알림을 보낸다 — 대표에게 알림 폭탄',
    file: ACT, from: '  for (const t of targets) await _syncEmployeeToRelated(admin, t.id, defaultId)',
    to: "  for (const t of targets) { await _syncEmployeeToRelated(admin, t.id, defaultId); await notifyIfEnabled(admin, defaultId, 'assignment', { title: 'x', message: 'x', type: 'inspection_assigned', reference_id: t.id, reference_type: 'inspection' }) }",
    expect: '배정 알림을 보내지 않는다' },
  { name: 'M8 담당 전파를 뺀다 — 고객은 배정인데 계획 항목은 미배정',
    file: ACT, from: '  for (const t of targets) await _syncEmployeeToRelated(admin, t.id, defaultId)',
    to: '  void targets', expect: '담당 전파는 한다' },
]

const only = process.env.MUT
const T = only ? MUTANTS.filter(m => m.name.startsWith(only)) : MUTANTS
if (only && !T.length) throw new Error(`MUT=${only} 없음`)
let caught = 0
for (const m of T) {
  const orig = readFileSync(m.file, 'utf8')
  try {
    const from = orig.includes(m.from) ? m.from : m.from.replace(/\n/g, '\r\n')
    if (!orig.includes(from)) throw new Error(`치환 대상을 못 찾음 (${m.file}):\n${m.from}`)
    writeFileSync(m.file, orig.replace(from, from === m.from ? m.to : m.to.replace(/\n/g, '\r\n')))
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
console.log(`\n변이 결과: ${caught} / ${T.length} 잡음`)
process.exit(caught === T.length ? 0 : 1)
