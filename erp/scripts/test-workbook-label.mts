/** 결과보고서 엑셀 버튼의 **이름이 한 벌인가** — 2026-09-21 사용자 지시의 유일한 자.
 *
 *  고친 것: 같은 산출물(갑지 통합 워크북)이 표면마다 다른 글씨였다.
 *    회차 카드 「엑셀」 · 보고서 탭 「엑셀로 받기」 · 작업대 「엑셀로 받기」 · 점검 목록 「엑셀」
 *  회차 탭에는 바로 옆에 [소방계획서 엑셀]이 뜨는데, 정작 **갈라야 하는 쪽이 이름 없이**
 *  맨 「엑셀」이라 무엇의 엑셀인지 읽히지 않았다. → 전부 `WORKBOOK_LABEL`로 모은다.
 *
 *  ⭐ **문자열이 있는가를 묻지 않는다.** 그렇게 물으면 누가 「보고서 엑셀」을 한 줄 더 적어 넣어도
 *    초록이고, 그게 바로 이 결함이 처음 생긴 방식이다(표면마다 각자 적었다). 그래서 묻는 것은
 *    ① 상수가 **한 곳에만** 정의됐는가 ② 화면을 그리는 자리들이 그 **상수를 참조**하는가
 *    ③ 옛 글씨가 **사라졌는가**(역방향) ④ 잘린다고 버린 고정 폭이 정말 없는가.
 *
 *  실행: npx tsx scripts/test-workbook-label.mts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { codeOnly } from './_code-only.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../src')

let pass = 0
const fails: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✔ ${name}`) }
  else { fails.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8')
const BUTTON = 'components/inspections/workbook-xlsx-button.tsx'
const CHIP = 'components/customers/plan-annex-round-card.tsx'

/* ── ① 정의는 한 곳 ── */
console.log('① 단일 원천')
const btnSrc = read(BUTTON)
const btnCode = codeOnly(btnSrc)
const defs = [...btnCode.matchAll(/export const WORKBOOK_LABEL\s*=\s*'([^']+)'/g)]
check('WORKBOOK_LABEL이 정확히 한 번 정의된다', defs.length === 1, `${defs.length}건`)
const LABEL = defs[0]?.[1] ?? ''
check('그 값이 「보고서 엑셀」', LABEL === '보고서 엑셀', JSON.stringify(LABEL))

/* ── ② 그리는 자리가 상수를 참조하는가 ──
 * 🎯 여기가 이 검사의 핵심이다. 「보고서 엑셀」이 화면에 뜨는가가 아니라, 그 글씨가
 *    **한 곳에서 나오는가**를 묻는다. 표면이 각자 적으면 다시 갈라진다. */
console.log('\n② 참조 (자기 글씨를 적지 않는다)')
const chipSrc = read(CHIP)
const chipCode = codeOnly(chipSrc)
check('회차 카드가 상수를 import 한다',
  /import\s*\{[^}]*\bWORKBOOK_LABEL\b[^}]*\}\s*from\s*'@\/components\/inspections\/workbook-xlsx-button'/.test(chipCode))
check('회차 카드가 상수를 렌더에 쓴다', /\{WORKBOOK_LABEL\}/.test(chipCode))
// 음성 — 칩이 글씨를 **직접** 적으면 안 된다(두 벌이 되는 순간 갈라진다)
check('회차 카드에 라벨 리터럴이 없다', !chipCode.includes("'보고서 엑셀'") && !/>\s*보고서 엑셀\s*</.test(chipCode))

const btnUses = [...btnCode.matchAll(/\{WORKBOOK_LABEL\}/g)].length
check('버튼 컴포넌트의 두 표면(compact·default)이 모두 상수를 쓴다', btnUses === 2, `${btnUses}곳`)

/* 🚨 **다섯 번째 표면** — 번들 생성 패널의 `<a href>`. 같은 라우트(`/workbook`)를 부르는데
 *   종전엔 「엑셀로 받기」라 이름이 갈려 있었다. 첫 판에서 이걸 놓쳐 **넷만 고치고 「한 벌」이라
 *   부를 뻔했다** — 표면 수를 세어 두는 이유가 이것이다.
 *   ⚠ 이 표면은 `X-Workbook-Missing` 고지를 못 받는 경로다(`<a href>`라 새 탭에서 사라진다).
 *     그건 **동작 축**이라 이번에 안 건드렸고, 여기서도 묻지 않는다. 다만 그 상태가 조용히
 *     바뀌지 않도록 «아직 a href다»를 박아 둔다 — 누가 고치면 이 줄이 먼저 말해 준다. */
const PANEL = 'components/inspections/bundle-generate-panel.tsx'
const panelCode = codeOnly(read(PANEL))
check('번들 패널(5번째 표면)이 상수를 import 한다',
  /import\s*\{[^}]*\bWORKBOOK_LABEL\b[^}]*\}\s*from\s*'@\/components\/inspections\/workbook-xlsx-button'/.test(panelCode))
check('번들 패널이 상수를 렌더에 쓴다', /\{WORKBOOK_LABEL\}/.test(panelCode))
check('번들 패널에 「엑셀로 받기」 리터럴이 없다', !panelCode.includes('엑셀로 받기'))
check('번들 패널은 여전히 <a href> 경로다(동작 축은 이번에 안 건드렸다)',
  /<a href=\{`\/inspections\/\$\{inspectionId\}\/workbook`\}/.test(panelCode))

/* ── ③ 역방향 — 옛 글씨가 사라졌는가 ── */
console.log('\n③ 역방향 (옛 이름 소멸)')
check('버튼에 「엑셀로 받기」가 없다', !btnCode.includes('엑셀로 받기'))
// 맨 「엑셀」 리터럴(따옴표로 감싼 단독 글씨)이 렌더에 남아 있으면 안 된다
check("버튼에 단독 '엑셀' 리터럴이 없다", !/:\s*'엑셀'/.test(btnCode))
check('회차 카드에 맨 「엑셀」 줄이 없다', !/^\s*엑셀\s*$/m.test(chipCode))

/* ── ④ 폭 — 잘림 방지 ──
 * 고정 폭은 「엑셀」 두 글자에 맞춘 값이라 5글자가 들어가면 잘린다. 버린 게 맞는지 묻는다. */
console.log('\n④ 폭')
check('compact에서 고정 폭 w-[2.6rem]이 사라졌다', !btnCode.includes('w-[2.6rem]'))

/* ── ⑤ 전제 — 호출부가 실재하는가(공허 통과 방지) ── */
console.log('\n⑤ 전제')
const CALLERS = [
  'app/(dashboard)/customers/[id]/page.tsx',       // 보고서 탭
  'app/(dashboard)/inspections/page.tsx',          // 점검 목록(compact)
  'components/inspections/inspection-workbench.tsx', // 작업대 2곳
]
const callerCode = CALLERS.map(p => codeOnly(read(p)))
const counts = callerCode.map(c => [...c.matchAll(/<WorkbookXlsxButton\b/g)].length)
const total = counts.reduce((a, b) => a + b, 0)
check('WorkbookXlsxButton 호출부가 4곳 실재한다(보고서 탭·점검 목록·작업대 2)', total === 4,
  `보고서탭 ${counts[0]} · 목록 ${counts[1]} · 작업대 ${counts[2]} = ${total}`)
// 🚨 호출부가 라벨을 **따로 넘기면** 단일성이 깨진다 — 넘기는 곳이 없어야 한다
check('어느 호출부도 라벨을 따로 넘기지 않는다',
  !/<WorkbookXlsxButton[^>]*\blabel=/.test(callerCode.join('\n')))

console.log(`\n${fails.length ? '❌' : '✅'} ${pass}/${pass + fails.length}`)
if (fails.length) { console.log(fails.map(f => `   · ${f}`).join('\n')); process.exit(1) }
