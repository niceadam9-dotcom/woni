// 별지서식 회차 카드 — 상태 배지 + 회차(N차) 표시 폐지 (2026-09-14 사용자 신고 축)
//
// 신고: 「예정 지연 172일 ⚠」이 오해를 부른다. 실측하니 지평리56만의 문제가 아니었다 —
// 자체점검 계획 777건 중 **292건(37.5%)**이 이 붉은 배지를 달고 있었고(중앙 151일·최대 255일),
// 그 대부분은 시스템 도입 전에 이미 지나간 달의 슬롯이라 **아무도 늦은 적이 없다**.
//
// 🎯 이 검사의 핵심은 「붉은색을 없앴는가」가 아니라 **「없애면 안 될 붉은색을 남겼는가」**다.
//    음성 단언만 넣으면 `kind:'planned'`를 늘 돌려주는 한 줄로 전부 초록이 되고, 그러면 진짜
//    법정 기한 초과(`overdue`)까지 조용해진다. [A8][B2]가 그 양성 대조다.
//
// 🚨 소스 단언은 **주석을 먼저 걷어낸다**(codeOnly) — 이 차수의 설명 주석에 '예정 지연'·'N차'가
//    그대로 적혀 있어, 걷어내지 않으면 코드를 되돌려도 주석에 걸려 초록으로 통과한다.
//
// 서버·DB 없이 순수 함수 + 소스 배선으로만 판정한다.
// 실행: npx tsx scripts/test-annex-round-pill.mts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { roundPill } from '../src/lib/annex-round-state.ts'
import { codeOnly, strippedStats } from './_code-only.mts'

const ROOT = process.cwd()
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}
// 🚨 codeOnly 사본이 CRLF에서 불발하던 것을 공유 모듈로 올렸다(2026-09-14) — `_code-only.mts` 참조.

console.log('▶ 별지서식 회차 배지 — 「지연」을 달 단위로 · 회차 표시 폐지')

const TODAY = '2026-09-14'
const P = (plannedDate: string | null, state = 'planned') => roundPill({ state, plannedDate }, TODAY)

// ── A. 과거 — 신고된 그 자리 ─────────────────────────────────────
{
  const p = P('2026-03-26')   // 지평리56 작동(자체) — 종전 「예정 지연 172일 ⚠」
  check('[A1] 신고 재현: 2026-03-26 → 「6개월 경과 · 미실시」',
    p.kind === 'elapsed' && p.label === '6개월 경과 · 미실시', `${p.kind} / ${p.label}`)
}
check('[A2] 「지연」이라는 말을 쓰지 않는다 (누군가 늦었다는 뜻이라서)',
  !P('2026-03-26').label.includes('지연'))
check('[A3] 일 단위 카운트를 쓰지 않는다 (법정 단위는 달이다)',
  !/\d+일/.test(P('2026-03-26').label), P('2026-03-26').label)
check('[A4] ⚠ 기호를 달지 않는다', !P('2026-03-26').label.includes('⚠'))

// ⭐ 같은 달이면 날짜가 지났어도 늦은 것이 아니다 — 법정 시기가 달 단위라서
check('[A5] 같은 달·날짜 지남(09-02) → 「이달 예정」 (늦지 않았다)',
  P('2026-09-02').kind === 'thisMonth' && P('2026-09-02').label === '이달 예정')
check('[A6] 같은 달·오늘(09-14) → 「이달 예정」', P('2026-09-14').kind === 'thisMonth')
check('[A7] 같은 달·미래(09-30) → 「이달 예정」', P('2026-09-30').kind === 'thisMonth')

// 🎯 양성 대조 — 없애면 안 될 붉은 축
check('[A8] 시작된 점검의 법정 기한 초과는 **그대로 「기한초과」**',
  P('2026-03-26', 'overdue').kind === 'overdue' && P(null, 'overdue').label === '기한초과')
check('[A9] 완료·진행중은 종전 그대로',
  P('2026-01-01', 'completed').label === '완료' && P('2026-01-01', 'in_progress').label === '진행중')

// 경계·자릿수
check('[A10] 한 달 차이 = 「1개월 경과」 (0이나 빈 문자열이 아니다)',
  P('2026-08-31').label === '1개월 경과 · 미실시', P('2026-08-31').label)
check('[A11] 해를 넘겨도 달로 센다 — 2025-03 → 18개월',
  P('2025-03-26').label === '18개월 경과 · 미실시', P('2025-03-26').label)
check('[A12] 8월 1일도 9월 14일 기준 1개월 (일자를 보지 않는다)',
  P('2026-08-01').label === '1개월 경과 · 미실시')

// 미래는 종전대로 D-N — 이 차수가 고치는 것은 과거 쪽이다
check('[A13] 다음 달 미래는 「예정 D-N」 유지', P('2026-10-26').kind === 'due')
check('[A14] D-N의 N은 실제 일수', P('2026-10-26').label === '예정 D-42', P('2026-10-26').label)
check('[A15] 날짜 없음 → 「예정」', P(null).kind === 'planned' && P(null).label === '예정')

// 시계를 스스로 읽지 않는다 — today 주입이 실제로 먹는가
check('[A16] today를 바꾸면 답이 바뀐다 (시계 주입이 배선돼 있다)',
  roundPill({ state: 'planned', plannedDate: '2026-03-26' }, '2026-04-01').label === '1개월 경과 · 미실시')

// ── B. 배선 — 화면이 이 모듈을 실제로 쓰는가 ──────────────────────
const CARD_RAW = read('src', 'components', 'customers', 'plan-annex-round-card.tsx')
const CARD = codeOnly(CARD_RAW)

// 계측기 자기 검사 — 이 파일 주석에 「예정 지연」이 그대로 적혀 있어, 안 걷히면 [B3]이 거짓 빨강이 된다
{
  const s = strippedStats(CARD_RAW)
  check('[B-1] codeOnly가 줄 주석을 실제로 걷어냈다 (계측기 자기 검사)',
    s.leftover === 0 && s.removed > 0, `남은 줄주석 ${s.leftover}줄 · 지운 글자 ${s.removed}`)
}

check('[B0] 카드가 roundPill을 import한다',
  /import \{[^}]*roundPill[^}]*\} from '@\/lib\/annex-round-state'/.test(CARD))
check('[B1] statePill이 roundPill(r, todayStr())에 위임한다',
  /roundPill\(r,\s*todayStr\(\)\)/.test(CARD))

// 🎯 양성 대조 — 붉은 클래스는 overdue **하나만** 남아야 한다(전부 지우면 진짜 경고가 죽는다)
const redKeys = [...CARD.matchAll(/(\w+):\s*'bg-red-50[^']*'/g)].map(m => m[1])
check('[B2] 붉은 배지 색은 overdue 하나뿐',
  redKeys.length === 1 && redKeys[0] === 'overdue', `현재: ${redKeys.join(', ') || '(없음)'}`)
check('[B3] 옛 인라인 규칙(「예정 지연」 리터럴)이 카드에 남아 있지 않다',
  !CARD.includes('예정 지연'))

// ── C. 회차(N차) 표시 폐지 ───────────────────────────────────────
const SECT = codeOnly(read('src', 'components', 'customers', 'plan-annex-section.tsx'))
check('[C1] 카드 라벨이 연도만 낸다 (「N차」 없음)',
  /const label = `\$\{r\.year\}년`/.test(CARD) && !/\$\{r\.sequenceNum\}차/.test(CARD))
check('[C2] 별지 모달 제목에도 「N차」가 없다',
  !/\$\{r\.sequenceNum\}차/.test(SECT))
check('[C3] 안내 문구가 없어진 「차수」를 설명하지 않는다',
  !SECT.includes('연도·차수·'))

// ⚠ 음성 대조 — 지운 것은 **표시**뿐이다. 데이터 키까지 지우면 계획 생성 멱등이 깨진다.
check('[C4] roundKey(React key·메시지 키)는 sequenceNum을 그대로 쓴다 (데이터 축 보존)',
  /function roundKey\(r: CustomerRound\) \{ return `\$\{r\.year\}-\$\{r\.sequenceNum\}` \}/.test(SECT))
check('[C5] CustomerRound 타입에서 sequenceNum을 지우지 않았다',
  codeOnly(read('src', 'app', '(dashboard)', 'reports', 'docs-actions.ts')).includes('sequenceNum'))

// ── D. 규칙이 화면 밖 순수 모듈에 있는가 ─────────────────────────
const LIB = codeOnly(read('src', 'lib', 'annex-round-state.ts'))
check('[D1] lib이 React·Next·DB를 끌고 오지 않는다', !/from '(react|next|@supabase)/.test(LIB))
check('[D2] lib이 시계를 스스로 읽지 않는다 (today는 주입)',
  !/new Date\(\)|Date\.now\(\)/.test(LIB))
check('[D3] lib이 Tailwind 클래스를 들고 있지 않다 (색은 화면 몫)', !/bg-\w+-\d/.test(LIB))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
