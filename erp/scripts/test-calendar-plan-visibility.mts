// 점검달력 — 계획 항목이 **그 고객의 이름으로** 보이는가 (2026-09-14 지평리56 신고 축)
//
// 신고: "지평리56이 점검달력에서 조회가 안 된다". 파 보니 **결함이 둘**이었고, 이 축을 단언하는
// 검사는 한 건도 없었다 — 두 결함 모두 전 스위트 초록인 채로 운영에 나가 있었다.
//
//  ① 서버가 자체점검 계획을 **아예 안 실었다** — `.in('plan_type', ['monthly','event'])`.
//     그래서 [종합]·[작동] 탭은 `inspections` 행이 생긴 뒤(=점검이 실제로 시작된 뒤)에야
//     무언가를 보여줬다. 예정일이 잡혀 있어도 그날까지 그 고객은 달력 어느 칸에도 없었다.
//  ② 정기 집계 칩이 **1건뿐인 날에도** 이름을 가렸다. 검색해서 1건만 남겨도 「정기 1건」.
//
// 🎯 이 검사의 핵심은 「폈는가」가 아니라 **「뭉쳐야 할 때 그대로 뭉치는가」**다.
//    음성 단언만 넣으면 `groups: []`를 늘 돌려주는 한 줄로 전부 초록이 되고, 그러면 하루
//    100건짜리 날의 "+N개 더 보기" 폭발이라는 원래 문제로 되돌아간다. [A5][A6]이 그 양성 대조다.
//
// 🚨 소스 단언은 **주석을 먼저 걷어낸다**(codeOnly) — 이 차수의 설명 주석에 'special_종합'과
//    plan_type 목록이 그대로 적혀 있어, 걷어내지 않으면 코드를 되돌려도 주석에 걸려 초록이 된다.
//
// 서버·DB 없이 순수 함수 + 소스 배선으로만 판정한다.
// 실행: npx tsx scripts/test-calendar-plan-visibility.mts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { layoutPlanChips, PLAN_CHIP_NAME_MAX } from '../src/lib/calendar-chips.ts'
import { codeOnly, strippedStats } from './_code-only.mts'

const ROOT = process.cwd()
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// 🚨 codeOnly 사본이 CRLF에서 불발하던 것을 공유 모듈로 올렸다(2026-09-14) — `_code-only.mts` 참조.
//    이 파일의 [B-0]이 계측기 자체를 단언한다.

console.log('▶ 점검달력 계획 항목 표시 — 자체점검 적재 + 정기 집계 펴기')

// ── A. 순수 함수 — 개별 칩 / 집계 칩 가르기 ──────────────────────
const D = '2026-09-28'
const mk = (plan_type: string, n: number, date = D) =>
  Array.from({ length: n }, (_, i) => ({ plan_type, scheduled_date: date, id: `${plan_type}-${i}` }))

const OPEN = { searching: false }
const SEARCH = { searching: true }

// 신고 재현: 그 날 정기 1건 — 검색하지 않아도 이름이 보여야 한다
{
  const r = layoutPlanChips(mk('monthly', 1), OPEN)
  check('[A1] 정기 1건인 날은 집계하지 않고 이름을 편다 (지평리56 ①)',
    r.individuals.length === 1 && r.groups.length === 0,
    `개별 ${r.individuals.length} / 집계 ${r.groups.length}`)
}

check(`[A2] 정기 ${PLAN_CHIP_NAME_MAX}건(상한)까지는 편다`,
  (() => { const r = layoutPlanChips(mk('monthly', PLAN_CHIP_NAME_MAX), OPEN)
    return r.individuals.length === PLAN_CHIP_NAME_MAX && r.groups.length === 0 })())

// 🎯 양성 대조 — 뭉쳐야 할 때 뭉치는가. 이게 빠지면 "늘 편다"가 전부 통과한다.
{
  const r = layoutPlanChips(mk('monthly', PLAN_CHIP_NAME_MAX + 1), OPEN)
  check(`[A3] 정기 ${PLAN_CHIP_NAME_MAX + 1}건(상한 초과)은 **집계 칩 1개로 뭉친다**`,
    r.individuals.length === 0 && r.groups.length === 1 && r.groups[0].items.length === PLAN_CHIP_NAME_MAX + 1,
    `개별 ${r.individuals.length} / 집계 ${r.groups.length}`)
}
{
  const r = layoutPlanChips(mk('monthly', 60), OPEN)
  check('[A4] 하루 60건도 집계 칩 1개 — "+N개 더 보기" 폭발 방지가 살아 있다',
    r.individuals.length === 0 && r.groups.length === 1 && r.groups[0].items.length === 60)
}

// ⭐ 검색 중이면 건수와 무관하게 편다 — 좁히는 행위의 목적이 "누구인지 보는 것"이라서
{
  const r = layoutPlanChips(mk('monthly', 60), SEARCH)
  check('[A5] 검색 중이면 60건도 전부 편다 (건수 무관)',
    r.individuals.length === 60 && r.groups.length === 0,
    `개별 ${r.individuals.length} / 집계 ${r.groups.length}`)
}

// ② 자체점검은 언제나 건별 — '누구의 종합점검인가'가 그 탭을 여는 이유다
for (const t of ['special_종합', 'special_작동', 'event']) {
  const r = layoutPlanChips(mk(t, 60), OPEN)
  check(`[A6] ${t} 60건은 **뭉치지 않는다** (언제나 건별)`,
    r.individuals.length === 60 && r.groups.length === 0,
    `개별 ${r.individuals.length} / 집계 ${r.groups.length}`)
}

// 날짜가 다르면 각각 따로 센다 — 한 날 상한을 다른 날과 합산하면 안 된다
{
  const r = layoutPlanChips([...mk('monthly', 3, '2026-09-28'), ...mk('monthly', 3, '2026-10-26')], OPEN)
  check('[A7] 상한은 **날짜별**로 센다 (3+3은 6건이어도 둘 다 편다)',
    r.individuals.length === 6 && r.groups.length === 0)
}
{
  const r = layoutPlanChips([...mk('monthly', 9, '2026-09-28'), ...mk('monthly', 1, '2026-10-26')], OPEN)
  check('[A8] 같은 목록 안에서 한 날은 뭉치고 다른 날은 펼 수 있다',
    r.groups.length === 1 && r.groups[0].date === '2026-09-28' && r.individuals.length === 1)
}

// 섞인 목록 — 자체점검은 펴지고 정기만 뭉친다
{
  const r = layoutPlanChips([...mk('special_종합', 2), ...mk('monthly', 9)], OPEN)
  check('[A9] 섞인 날: 자체점검 2건은 이름으로, 정기 9건만 집계로',
    r.individuals.length === 2 && r.individuals.every(p => p.plan_type === 'special_종합')
    && r.groups.length === 1 && r.groups[0].items.length === 9)
}

// 무손실 — 어떤 항목도 사라지지 않는다(칩이 통째로 증발하는 것이 이 축의 최악 결함이다)
{
  const src = [...mk('special_작동', 2), ...mk('monthly', 9), ...mk('event', 1)]
  for (const opts of [OPEN, SEARCH]) {
    const r = layoutPlanChips(src, opts)
    const out = r.individuals.length + r.groups.reduce((s, g) => s + g.items.length, 0)
    check(`[A10] 입력 ${src.length}건이 하나도 안 사라진다 (searching=${opts.searching})`,
      out === src.length, `출력 ${out}건`)
  }
}

// ── B. 배선 ① — 서버가 자체점검 계획을 싣는가 ────────────────────
// 순수 함수만 단언하면 「규칙은 옳은데 서버가 그 행을 안 준다」가 초록으로 통과한다.
// 실제로 그게 ①의 정체였다.
const PAGE_RAW = read('src', 'app', '(dashboard)', 'inspections', 'calendar', 'page.tsx')
const PAGE = codeOnly(PAGE_RAW)

// 계측기 자기 검사 — 이 파일이 특히 위험하다: 주석에 「종전엔 monthly·event만 실어」가 적혀 있어
// 걷히지 않으면 코드를 되돌려도 설명글에 걸려 초록이 된다. 실측상 종전 사본은 여기서 **0글자**를 지웠다.
{
  const s = strippedStats(PAGE_RAW)
  check('[B-0] codeOnly가 줄 주석을 실제로 걷어냈다 (계측기 자기 검사)',
    s.leftover === 0 && s.removed > 0, `남은 줄주석 ${s.leftover}줄 · 지운 글자 ${s.removed}`)
}

const inMatch = PAGE.match(/\.in\('plan_type',\s*\[([^\]]*)\]\)/)
check('[B0] 달력 서버가 plan_type 목록으로 계획을 조회한다 (앵커 생존)', Boolean(inMatch))
const planTypes = (inMatch?.[1] ?? '').split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
for (const t of ['monthly', 'event', 'special_종합', 'special_작동']) {
  check(`[B1] 조회 목록에 ${t}가 있다`, planTypes.includes(t), `현재: ${planTypes.join(', ') || '(없음)'}`)
}

// 시작된 자체점검은 inspections 축이 6단계로 그린다 — 계획 칩까지 실으면 같은 날 두 번 나온다
check('[B2] 시작된(inspection_id 있는) 자체점검은 계획 칩에서 뺀다 (중복 방지)',
  /\(p\.plan_type === 'special_종합' \|\| p\.plan_type === 'special_작동'\) && p\.inspection_id\) return \[\]/.test(PAGE))

// ── C. 배선 ② — 화면이 순수 모듈을 실제로 쓰는가 ─────────────────
const CAL_RAW = read('src', 'components', 'inspections', 'inspection-calendar-client.tsx')
const CAL = codeOnly(CAL_RAW)

check('[C1] 달력이 layoutPlanChips를 import한다',
  /import \{[^}]*layoutPlanChips[^}]*\} from '@\/lib\/calendar-chips'/.test(CAL))
check('[C2] 계획 칩 계산이 layoutPlanChips에 searching을 넘긴다 (검색 축 배선)',
  /layoutPlanChips\(visiblePlanItems,\s*\{\s*searching:\s*Boolean\(custQuery\)\s*\}\)/.test(CAL))
// 음성: 옛 인라인 규칙이 되살아나면 잡는다 (가장 그럴듯한 되돌림 형태)
check('[C3] 옛 인라인 집계 규칙(NAME_MAX 리터럴)이 화면에 남아 있지 않다',
  !/NAME_MAX\s*=/.test(CAL))

// 탭 필터 — 종합·작동 탭이 계획을 통째로 버리던 분기가 되살아나면 잡는다
check('[C4] 종합 탭이 special_종합 계획을 통과시킨다',
  /calMode === 'comp' && p\.plan_type !== 'special_종합'/.test(CAL))
check('[C5] 작동 탭이 special_작동 계획을 통과시킨다',
  /calMode === 'oper' && p\.plan_type !== 'special_작동'/.test(CAL))

// ── D. 규칙이 화면 밖 순수 모듈에 있는가 ─────────────────────────
const LIB = codeOnly(read('src', 'lib', 'calendar-chips.ts'))
check('[D1] lib 모듈이 React·Next·DB를 끌고 오지 않는다 (순수)',
  !/from '(react|next|@supabase)/.test(LIB))
check('[D2] lib 모듈이 오늘 날짜를 스스로 읽지 않는다 (완료·지연 셈은 호출부 몫)',
  !/new Date\(\)|Date\.now\(\)/.test(LIB))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
