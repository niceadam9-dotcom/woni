/** 변이 프로브 — 서식 1.10.1 배선(2026-09-14).
 *
 *  검사가 초록인 것은 '무언가를 잡는다'는 뜻이지 '이것을 잡는다'는 뜻이 아니다. 제품을 한 곳씩
 *  되돌려 보고 `test-fire-plan-xlsx.mts`가 **실제로 붉어지는지** 확인한다.
 *
 *  🚨 치환이 **안 먹었는데 초록**이면 그건 통과가 아니라 **미실행**이다(CRLF·공백 흔들림으로
 *    실제로 겪은 사고다). 그래서 치환 건수를 세고 0이면 그 변이를 실패로 친다.
 *
 *  실행: npx tsx scripts/_probe-1101-mutants.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const R = (p: string) => resolve(HERE, '..', p)

const VALUES = R('src/lib/fire-plan-xlsx-values.ts')
const RESOLVER = R('src/lib/fire-plan-inspection-plan.ts')
const MONTH = R('src/lib/plan-month.ts')
const ANCHORS = R('src/lib/fire-plan-anchors.ts')

type Mutant = { name: string; file: string; from: string; to: string }

const MUTANTS: Mutant[] = [
  { name: '작동점검 상자를 안 켠다', file: VALUES,
    from: `boxLabelCell(F1101, 'D5', true)`, to: `boxLabelCell(F1101, 'D5', false)` },
  { name: '종합 머리를 늘 켠다', file: VALUES,
    from: `boxLabelCell(F1101, 'D8', compBlock)`, to: `boxLabelCell(F1101, 'D8', true)` },
  { name: '2차 상자를 늘 켠다', file: VALUES,
    from: `boxLabelCell(F1101, 'V10', !!ip.comp2Month)`, to: `boxLabelCell(F1101, 'V10', true)` },
  { name: '최초점검 상자를 늘 켠다', file: VALUES,
    from: `boxLabelCell(F1101, 'V8', ip.isInitial)`, to: `boxLabelCell(F1101, 'V8', true)` },
  { name: '작동 점검자를 종합 값으로 잰다(교차 배선)', file: VALUES,
    from: `boxLabelCell(F1101, 'AF7', ip.opInspector === '외주')`,
    to: `boxLabelCell(F1101, 'AF7', ip.compInspector === '외주')` },
  { name: '종합 시기에 작동 달을 넣는다', file: VALUES,
    from: `yearMonthCell(F1101, 'AP9', ip.compMonth)`, to: `yearMonthCell(F1101, 'AP9', ip.opMonth)` },
  { name: '종합 점검자를 블록과 무관하게 켠다', file: VALUES,
    from: `boxLabelCell(F1101, 'V12', compBlock && ip.compInspector === '자체')`,
    to: `boxLabelCell(F1101, 'V12', ip.compInspector === '자체')` },
  { name: '사용승인일을 안 싣는다', file: VALUES,
    from: `prefixCell(F1101, 'A4', planDate(d.useApprovalDate))`, to: `prefixCell(F1101, 'A4', '')` },
  { name: '연월칸이 법정 자구를 버린다', file: VALUES,
    from: `return tpl.replace(/\\s*년/, \` \${p.year}년\`).replace(/\\s*월/, \` \${p.month}월\`)`,
    to: `return \`\${p.year} \${p.month}\`` },
  /* ⚠ 패턴에 **줄바꿈을 넣지 않는다** — 이 트리는 전 파일이 CRLF라 `\n`은 한 곳도 안 맞는다.
   *   처음에 `return tpl\n`으로 적었다가 치환 0곳이 됐고, 위 건수 가드가 그걸 잡았다
   *   (가드가 없었으면 '초록이니 통과'로 읽혀 **미실행이 통과로 둔갑**한다). */
  { name: '연월칸이 값이 없어도 서식을 지운다', file: VALUES,
    from: `if (!s) return tpl`, to: `if (!s) return ''` },
  { name: '왕복 대조를 뺀다(레거시 글자 유실)', file: MONTH,
    from: `return formatPlanMonth(p.year, p.month) === s ? p : null`, to: `return p` },
  { name: '점검자 기본값을 자체로', file: RESOLVER,
    from: `opInspector: insp?.opInspector || '외주',`, to: `opInspector: insp?.opInspector || '자체',` },
  { name: '고객 입력을 무시하고 자동값만 쓴다', file: RESOLVER,
    from: `opMonth: insp?.opMonth?.trim() ? insp.opMonth : (auto.operationMonth ?? ''),`,
    to: `opMonth: auto.operationMonth ?? '',` },
  { name: '종합 블록 판정에서 최초점검을 뺀다', file: RESOLVER,
    from: `return !!ip.compMonth || ip.isInitial || !!ip.comp2Month`, to: `return !!ip.compMonth` },
  { name: '연월칸 예외를 늘 참으로(백지 불변식 구멍)', file: ANCHORS,
    from: `return !!lbl && /^\\s*년\\s*월\\s*$/.test(lbl)`, to: `return true` },
]

const suite = () => {
  try {
    execFileSync('npx', ['tsx', R('scripts/test-fire-plan-xlsx.mts')], { encoding: 'utf8', shell: true })
    return true   // 전건 초록
  } catch { return false }  // 하나라도 붉음 → exit != 0
}

console.log('[0] 대조군 — 손대지 않은 트리는 초록이어야 한다')
if (!suite()) { console.log('  FAIL 대조군이 이미 붉다 — 변이 실험이 성립하지 않는다'); process.exit(1) }
console.log('  ok   대조군 초록\n')

let caught = 0
for (const m of MUTANTS) {
  const orig = readFileSync(m.file, 'utf8')
  const hits = orig.split(m.from).length - 1
  if (hits !== 1) {
    // 🚨 안 먹은 치환을 초록으로 넘기면 그게 공허 통과다
    console.log(`  FAIL ${m.name} — 치환 대상이 ${hits}곳(1이어야 한다). 변이가 **돌지 않았다**`)
    continue
  }
  writeFileSync(m.file, orig.replace(m.from, m.to))
  const green = suite()
  writeFileSync(m.file, orig)
  if (green) console.log(`  FAIL ${m.name} — 제품을 되돌렸는데 검사가 초록이다(단언이 이 축을 안 문다)`)
  else { caught++; console.log(`  ok   ${m.name} — 붉어졌다`) }
}

console.log(`\n=== 변이 ${caught}/${MUTANTS.length} 빨강 ===`)
process.exit(caught === MUTANTS.length ? 0 : 1)
