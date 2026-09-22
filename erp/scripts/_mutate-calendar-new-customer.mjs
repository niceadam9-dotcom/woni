// 변이 프로브 — 「달력에서 고객 등록 → 등록 **페이지** → 왔던 사이드바로 복귀」 축이 실제로 물리는지 본다.
//
// 🚨 2026-09-23 **다시 썼다.** 첫 판(2026-09-22)은 달력 위 **모달**을 물고 있었다 — 모달이
//   `/customers/new` 페이지로 옮겨 가자 치환 대상이 사라져 그대로 돌리면 0건 치환이었다.
//   계약이 바뀌면 변이도 새 계약의 급소를 물어야 한다(옛 줄을 찾아 헤매는 변이는 아무것도 증명 못 한다).
//
// 이 축의 급소는 「왕복 네 고리」다(`test-calendar-new-customer.mts` ③). 하나만 끊겨도
// 「등록하고 돌아왔는데 달력만 있다」 — 화면은 멀쩡해 보이고 에러도 없다. 그래서 고리마다 변이를 하나씩 건다.
// 가장 무서운 변이는 R4(떠나기 전에 패널을 닫는다 — 한 줄이면 되고 「정리 잘했다」처럼 보인다)와
// S1(오픈 리다이렉트 — 정규식 한 글자).
//
// 🚨 from은 한 줄짜리만 쓰고, **파일 안에 정확히 한 번** 있어야 한다(같은 줄이 여러 번이면
//   엉뚱한 자리를 물 수 있다 — 이 저장소에서 실제로 그랬다). 여러 번이면 `after`로 자리를 좁힌다.
//
// 실행: node scripts/_mutate-calendar-new-customer.mjs   (MUT=R4 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const FORM = 'src/components/customers/customer-new-client.tsx'
const CLIENT = 'src/components/inspections/inspection-calendar-client.tsx'
const CAL_PAGE = 'src/app/(dashboard)/inspections/calendar/page.tsx'
const NEW_PAGE = 'src/app/(dashboard)/customers/new/page.tsx'
const ACTIONS = 'src/app/(dashboard)/customers/actions.ts'
const SUITE = 'npx tsx scripts/test-calendar-new-customer.mts'

const MUTANTS = [
  // ── ③ 왕복 네 고리 ────────────────────────────────────────────────
  {
    name: 'R1 ㉠ 패널을 닫아도 day를 안 지운다 — 다음에 아무 링크로 와도 옛 날짜 패널이 열린다',
    file: CLIENT,
    from: "    else sp.delete('day')",
    to: '    else void 0',
    expect: '㉠',
  },
  {
    name: 'R2 ㉡ 복귀 주소가 day를 싣지 않는다 — 돌아오면 달력만 남는다',
    file: CLIENT,
    from: "    if (dayPanelDate) sp.set('day', dayPanelDate); else sp.delete('day')",
    to: "    sp.delete('day')",
    expect: '㉡ 복귀 주소(calendarBackHref)',
  },
  {
    name: 'R3 ㉡ 등록 링크가 from을 빠뜨린다 — 등록 페이지가 돌아갈 곳을 모른다',
    file: CLIENT,
    from: '    const q = new URLSearchParams({ anchor: date, from: calendarBackHref })',
    to: '    const q = new URLSearchParams({ anchor: date })',
    expect: '㉡ 등록 링크',
  },
  {
    name: 'R4 ㉣ 떠나기 전에 패널을 닫는다 — 「정리」처럼 보이지만 복귀 주소가 day를 잃는다',
    file: CLIENT,
    from: '                        onClick={() => openNewCustomer(dayPanelDate)}',
    to: '                        onClick={() => { setDayPanelDate(null); openNewCustomer(dayPanelDate) }}',
    expect: '㉣',
  },
  {
    name: 'R4b ㉣ 닫기를 옆 핸들러로 숨긴다 — onClick은 그대로라 모양만 보면 초록',
    file: CLIENT,
    from: '                        onClick={() => openNewCustomer(dayPanelDate)}',
    to: '                        onClick={() => openNewCustomer(dayPanelDate)} onMouseDown={() => setDayPanelDate(null)}',
    expect: '㉣',
  },
  {
    name: 'R5 ㉢ 달력 서버가 day를 되읽어도 클라이언트에 안 넘긴다',
    file: CAL_PAGE,
    from: '      initialDayPanelDate={initialDayPanelDate}',
    to: "      initialDayPanelDate={''}",
    expect: '㉢',
  },
  {
    name: 'R6 ㉢ 패널은 열리는데 달력은 기한초과 달로 뛴다 — 11월 패널 옆에 7월 달력',
    file: CLIENT,
    from: "    initialDayPanelDate ? new Date(initialDayPanelDate + 'T12:00:00')",
    to: '    false ? new Date()',
    expect: '보던 달',
  },
  {
    name: 'R6b ㉢ 우선순위를 뒤집는다 — 기한초과가 있으면 day를 이긴다',
    file: CLIENT,
    from: "    initialDayPanelDate ? new Date(initialDayPanelDate + 'T12:00:00')",
    to: "    earliestOverdue ? new Date(earliestOverdue + 'T12:00:00') : initialDayPanelDate ? new Date(initialDayPanelDate + 'T12:00:00')",
    expect: '보던 달',
  },
  {
    name: 'R7 폼이 복귀 주소를 무시한다 — 등록하면 고객 상세로 가 버린다',
    file: FORM,
    from: '      if (returnHref) { router.push(returnHref); return }',
    to: '      void returnHref',
    expect: '폼이 복귀 주소로',
  },
  {
    name: 'R8 등록 페이지가 짚은 날짜를 폼에 안 넘긴다',
    file: NEW_PAGE,
    from: '        initialAnchorDate={initialAnchorDate}',
    to: "        initialAnchorDate={''}",
    expect: '등록 페이지가 anchor',
  },
  {
    name: 'R9 프리필을 effect로 덮는다 — 사람이 고친 점검일자를 짚은 날짜가 다시 덮는다',
    file: FORM,
    from: '    plan_anchor_date: initialAnchorDate,',
    to: "    plan_anchor_date: '',",
    expect: '프리필은',
  },
  // ── 🚨 오픈 리다이렉트 ─────────────────────────────────────────────
  {
    name: 'S1 복귀 주소 검증에서 `//` 차단을 뺀다 — //evil.com으로 튕긴다',
    file: NEW_PAGE,
    from: "  const returnHref = /^\\/(?![/\\\\])/.test(from) ? from : ''",
    to: "  const returnHref = /^\\//.test(from) ? from : ''",
    expect: '오픈 리다이렉트',
  },
  {
    name: 'S2 복귀 주소를 검증 없이 넘긴다',
    file: NEW_PAGE,
    from: "  const returnHref = /^\\/(?![/\\\\])/.test(from) ? from : ''",
    to: '  const returnHref = from',
    expect: '오픈 리다이렉트',
  },
  // ── ① 폼은 한 벌 · ② 권한 · ④ 회귀 ──────────────────────────────
  {
    name: 'F1 필수 판정을 한 칸 줄인다 — 대표 관계인 없이 통과한다',
    file: FORM,
    from: "    ['대표 관계인', !!contacts['대표'].name.trim()],",
    to: '',
    expect: '6칸',
  },
  {
    name: 'F2 달력이 폼을 다시 들여온다 — 모달 부활의 첫 줄',
    file: CLIENT,
    from: "import { DocNoticeList } from '@/components/ui/doc-notice-list'",
    to: "import { DocNoticeList } from '@/components/ui/doc-notice-list'\nimport { CustomerNewClient } from '@/components/customers/customer-new-client'",
    expect: '번들에',
  },
  {
    name: 'P1 데이 패널 버튼의 권한 가림을 없앤다',
    file: CLIENT,
    from: '                    {canCreateCustomer && (',
    to: '                    {true && (',
    expect: '데이 패널 버튼이 cap으로',
  },
  {
    name: 'P2 서버 cap을 늘 참으로 — 달력 page가 권한을 안 본다',
    file: CAL_PAGE,
    from: "      canCreateCustomer={can(profile.role as UserRole, 'customer_manage')}",
    to: '      canCreateCustomer={true}',
    expect: 'customer_manage로 cap',
  },
  {
    name: 'P3 등록 액션의 권한 검사를 뺀다',
    file: ACTIONS,
    after: 'export async function createCustomerAction(',
    from: "  const profile = await requirePermission('customer_manage')",
    to: "  const profile = { id: '' } as { id: string }",
    expect: '서버 액션도 같은 권한',
  },
  {
    name: 'B1 from 없을 때의 폴백을 지운다 — 사이드바 밖에서 등록하면 아무 데도 못 간다',
    file: FORM,
    from: '      router.push(`/customers/${result.customerId}?created=1&onboarding=1`)',
    to: '      void result',
    expect: '폴백 보존',
  },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only + ' ')) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

const count = (s, sub) => s.split(sub).length - 1

let caught = 0
for (const m of TARGETS) {
  const original = readFileSync(m.file, 'utf8')
  try {
    // `after`가 있으면 그 뒤 **첫** 자리를, 없으면 파일에 **유일한** 자리를 문다.
    let at
    if (m.after) {
      const a = original.indexOf(m.after)
      if (a < 0) throw new Error(`after 앵커를 못 찾음 (${m.file}): ${m.after}`)
      at = original.indexOf(m.from, a)
    } else {
      const n = count(original, m.from)
      if (n !== 1) throw new Error(`치환 대상이 ${n}건 (${m.file}) — 정확히 1건이어야 한다:\n${m.from}`)
      at = original.indexOf(m.from)
    }
    if (at < 0) throw new Error(`치환 대상을 못 찾음 (${m.file}):\n${m.from}`)
    const mutated = original.slice(0, at) + m.to + original.slice(at + m.from.length)
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
