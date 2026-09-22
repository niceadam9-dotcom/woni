// 변이 프로브 — 「달력에서 고객 등록」 축(2026-09-22)이 실제로 물리는지 본다.
//
// 17/0 초록은 "무언가를 잡는다"만 말한다. 이 축은 **거의 전부 소스 단언**이라 특히 공허 통과가 쉽다.
// 가장 중요한 변이는 M1·M2 — **폼 복제**와 **권한 누락**이다. 둘 다 「화면은 멀쩡한데 규칙이 사라지는」 부류다.
//
// 🚨 from은 한 줄짜리만 쓴다 — 이 저장소 소스는 CRLF가 섞여 여러 줄 문자열이 조용히 안 맞는다.
//
// 실행: node scripts/_mutate-calendar-new-customer.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const FORM = 'src/components/customers/customer-new-client.tsx'
const CLIENT = 'src/components/inspections/inspection-calendar-client.tsx'
const PAGE = 'src/app/(dashboard)/inspections/calendar/page.tsx'
const ACTIONS = 'src/app/(dashboard)/customers/actions.ts'
const SUITE = 'npx tsx scripts/test-calendar-new-customer.mts'

const MUTANTS = [
  {
    name: 'M1 필수 판정을 한 칸 줄인다 — 달력 등록만 대표 관계인 없이 통과한다',
    file: FORM,
    from: "    ['대표 관계인', !!contacts['대표'].name.trim()],",
    to: '',
    expect: '6칸',
  },
  {
    name: 'M2 권한 가림을 없앤다 — 권한 없는 직원에게도 버튼이 뜬다(눌러 봐야 서버가 던진다)',
    file: CLIENT,
    from: '                    {canCreateCustomer && (',
    to: '                    {true && (',
    expect: '데이 패널 버튼이 cap으로 가려진다',
  },
  {
    name: 'M3 서버 cap을 늘 참으로 — page가 권한을 안 보고 내린다',
    file: PAGE,
    from: "      canCreateCustomer={can(profile.role as UserRole, 'customer_manage')}",
    to: '      canCreateCustomer={true}',
    expect: 'customer_manage로 cap을 내린다',
  },
  {
    name: 'M4 서버 액션의 권한 검사를 뺀다 — 폼 데이터가 아무에게나 열린다',
    file: ACTIONS,
    from: "  await requirePermission('customer_manage')\n  const admin = createAdminClient()\n  const [{ data: employeesRaw }, company, purposes] = await Promise.all([",
    to: '  const admin = createAdminClient()\n  const [{ data: employeesRaw }, company, purposes] = await Promise.all([',
    expect: '서버 액션도 같은 권한',
  },
  {
    name: 'M5 기존 화면의 이동 폴백을 지운다 — /customers/new에서 등록해도 아무 일이 없다',
    file: FORM,
    from: '      router.push(`/customers/${result.customerId}?created=1&onboarding=1`)',
    to: '      void result',
    expect: '폴백 보존',
  },
  {
    name: 'M6 onCreated가 있어도 이동한다 — 달력이 등록하자마자 화면을 떠난다',
    file: FORM,
    from: '      if (onCreated) {',
    to: '      if (false && onCreated) {',
    expect: 'onCreated가 있으면 이동하지 않는다',
  },
  {
    name: 'M7 프리필을 끊는다 — 짚은 날짜가 점검일자로 안 간다',
    file: CLIENT,
    from: '                initialAnchorDate={newCustomerDate}',
    to: "                initialAnchorDate={''}",
    expect: '짚은 날짜가 점검일자로 넘어간다',
  },
  {
    name: 'M8 폼 데이터를 달력 서버가 미리 싣는다 — 등록 안 하는 방문에도 비용이 붙는다',
    file: PAGE,
    from: "import { dateChangeVerdict } from '@/lib/inspection-date-change'",
    to: "import { dateChangeVerdict } from '@/lib/inspection-date-change'\nimport { listBuildingPurposes } from '@/lib/building-purposes'",
    expect: '열 때** 받는다',
  },
  {
    name: 'M9 「나머지 채우기」가 탭을 직접 고른다 — 서버의 첫 미완 탭 판정을 앞지른다',
    file: CLIENT,
    from: '                href={`/customers/${created.customerId}?created=1&onboarding=1&from=${encodeURIComponent(calendarBackHref)}`}',
    to: '                href={`/customers/${created.customerId}?tab=plan`}',
    expect: '목적지 탭을 화면이 고르지 않는다',
  },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only)) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

let caught = 0
for (const m of TARGETS) {
  const original = readFileSync(m.file, 'utf8')
  try {
    if (!original.includes(m.from)) {
      throw new Error(`치환 대상을 못 찾음 (${m.file}) — 변이가 적용되지 않았다:\n${m.from}`)
    }
    const mutated = original.replace(m.from, m.to)
    if (mutated === original) throw new Error(`0건 치환 — 변이가 안 먹었다: ${m.name}`)
    writeFileSync(m.file, mutated)

    let out = '', failed = false
    try {
      out = execSync(SUITE, { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      failed = true
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    const red = out.split('\n').filter(l => l.includes('❌'))
    const hit = red.some(l => l.includes(m.expect))
    if (failed && hit) {
      caught++
      console.log(`✅ ${m.name}\n     → 빨강: ${red.map(l => l.trim()).slice(0, 3).join(' | ')}`)
    } else if (failed) {
      console.log(`⚠️  ${m.name}\n     → 빨강이긴 한데 의도한 단언이 아니다(기대: "${m.expect}")\n     → ${red.map(l => l.trim()).slice(0, 3).join(' | ') || '(❌ 줄 없음 — 스위트가 중간에 죽었다)'}`)
    } else {
      console.log(`❌ ${m.name}\n     → 제품을 되돌렸는데 스위트가 초록이다 — 이 축을 무는 단언이 없다`)
    }
  } finally {
    writeFileSync(m.file, original)
  }
}

console.log(`\n변이 ${caught}/${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
