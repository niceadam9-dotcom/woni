/** 변이 프로브 — `test-facility-status`가 정말 무는가 (2026-09-16)
 *
 *  검사가 초록인 것과 검사가 **일하는** 것은 다르다. 규칙을 하나씩 망가뜨리고
 *  스위트가 **빨강이 되는지**를 본다. 안 빨개지는 변이가 있으면 그 축은 단언이 없는 것이다.
 *
 *  🚨 치환이 **0건이면 실패로 친다**. CRLF·자구 변경으로 조용히 안 걸리면 「변이가 안 돌았는데
 *    초록」이 되어 정반대 결론을 준다(2026-09-09·09-11에 두 번 겪었다).
 *
 *  실행: node scripts/_mutate-facility-status.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const SRC = new URL('../src/lib/facility-status.ts', import.meta.url)
const original = readFileSync(SRC, 'utf8')

/** 규칙 변이 — [이름, 찾을 것, 바꿀 것] */
const MUTANTS = [
  ['M1  0이 체크를 켠다(송학떡집 결함 부활)',
    'return n != null && n > 0', 'return n != null && n >= 0'],
  ['M2  값이 있기만 하면 켠다(종전 !!txt 판정)',
    'return n != null && n > 0', 'return n != null'],
  ['M3  음수도 켠다',
    'return n != null && n > 0', 'return n != null && n !== 0'],
  ['M4  별지 9호 합계에 특별피난계단을 더한다(이중 계상)',
    'const sum = Math.max(0, d ?? 0) + Math.max(0, e ?? 0)',
    'const sum = Math.max(0, d ?? 0) + Math.max(0, e ?? 0) + Math.max(0, countOf(c.special) ?? 0)'],
  ['M5  합계 0을 null로 안 접는다',
    'return sum > 0 ? sum : null', 'return sum'],
  ['M6  숫자를 못 읽어도 1로 친다',
    'if (!m) return null', 'if (!m) return 1'],
  ['M7  빈 문자열을 0으로 읽는다(모른다↔0 혼동)',
    "if (s === '') return null", "if (s === '') return 0"],
  ['M8  1.5 탭 사전이 열쇠말을 안 보고 아무 값이나 집는다',
    'for (const k of STAIR_KINDS) out[k] = src[STAIR_LABEL[k]]',
    'for (const k of STAIR_KINDS) out[k] = src[STAIR_LABEL[k]] ?? Object.values(src)[0]'],
  ['M9  옥외계단을 종류 목록에서 뺀다',
    "export const STAIR_KINDS = ['special', 'direct', 'escape', 'outdoor'] as const",
    "export const STAIR_KINDS = ['special', 'direct', 'escape'] as const"],
  ['M10 승강기만 다른 술어를 쓴다(축 갈라짐)',
    'passenger: checkFromCount(c.passenger),', 'passenger: c.passenger != null,'],
  ['M11 계단 컬럼 이름이 마이그와 어긋난다',
    "direct: 'stair_direct_count',", "direct: 'stairs_direct_count',"],
]

/** 배선 변이 — [이름, 대상파일, 찾을 것, 바꿀 것]
 *
 *  🚨 규칙이 옳아도 **화면·조립기가 그 규칙을 안 부르면** 사용자에겐 없는 것이다. 순수 변이만
 *    돌리면 그 구멍이 통째로 초록으로 남는다(2026-09-13에 배선 변이만 잡아낸 결함이 있었다).
 *    특히 계단은 입력구가 셋이었고 **되돌리는 쪽**이 조용히 이기던 축이라, 그 부활을 각각 문다. */
const WIRING = [
  ['W1  엑셀이 옛 원천(1.5 탭 JSON)으로 되돌아간다',
    '../src/lib/fire-plan-xlsx-values.ts',
    'const stairOn = stairChecks(d.stairCounts ?? {})',
    "const stairOn = { special: !!d.forms?.evacFire?.stairs?.['특별피난계단'], direct: !!d.forms?.evacFire?.stairs?.['직통계단'], escape: !!d.forms?.evacFire?.stairs?.['피난계단'], outdoor: !!d.forms?.evacFire?.stairs?.['옥외계단'] }"],
  ['W2  건물 폼이 합계를 파생으로 안 쓴다',
    '../src/components/customers/building-inline-panel.tsx',
    'stairs_count: stairsSumForAnnex9({', 'stairs_count_disabled: ({'],
  ['W3  소방계획서 정보 저장이 합계를 다시 덮는다(입력구 두 벌 부활)',
    '../src/app/(dashboard)/customers/fire-plan-info-actions.ts',
    '      ramp_count: toInt(input.rampCount),',
    '      stairs_count: toInt(input.stairsCount),\n      ramp_count: toInt(input.rampCount),'],
  /* ⚠ 줄바꿈을 패턴에 넣지 않는다 — 이 파일은 **CRLF**라 `\n`으로 적으면 0건 치환이 되고
   *   그러면 「변이가 안 돌았는데 초록」이라는 정반대 결론이 나온다(건수 가드가 실제로 잡았다). */
  ['W4  1.5 탭이 용도만 보고 계단을 다시 지어낸다',
    '../src/components/customers/plan-form15.tsx',
    "compartment: 'floor',",
    "stairs: { '직통계단': '1' }, compartment: 'floor',"],
  /* 🚨 **비우기 축** — 실제로 내가 처음 이렇게 짰다가 검사에 걸린 변이다(회고가 아니라 재현이다).
   *   `undefined`는 저장 액션이 「안 건드림」으로 읽으므로, 계단을 다 지워도 옛 합계가 남고
   *   별지 9호가 유령 개소를 계속 인쇄한다. 채움만 묻는 검사는 이걸 영영 못 본다. */
  ['W6  합계를 undefined로 보내 「비우기」가 죽는다',
    '../src/components/customers/building-inline-panel.tsx',
    '          direct: form.stair_direct_count, escape: form.stair_escape_count,\r\n        }),',
    '          direct: form.stair_direct_count, escape: form.stair_escape_count,\r\n        }) ?? undefined,'],
  ['W7  계단 4종을 undefined로 보내 「비우기」가 죽는다',
    '../src/components/customers/building-inline-panel.tsx',
    'stair_direct_count: int(form.stair_direct_count) ?? null,',
    'stair_direct_count: int(form.stair_direct_count),'],
  ['W5  조립기가 이관 전 고객 폴백을 잃는다',
    '../src/lib/fire-plan-generate.ts',
    'const legacy = stairCountsFromLegacyMap(sections.evacFire?.stairs)',
    'const legacy = stairCountsFromLegacyMap(null)'],
]

let bit = 0, missed = 0, skipped = 0
const run = () => {
  try {
    execSync('npx tsx scripts/test-facility-status.mts', { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: 'pipe' })
    return { red: false, out: '' }
  } catch (e) { return { red: true, out: String(e.stdout ?? '') + String(e.stderr ?? '') } }
}
const report = (name, red, out) => {
  const failLine = (out.match(/^.*FAIL.*$/m) ?? [''])[0].trim()
  if (red) { bit++; console.log(`  ✅ 물었다  ${name}\n            ↳ ${failLine.slice(0, 110)}`) }
  else { missed++; console.log(`  ❌ 생존    ${name}  ← 이 축엔 단언이 없다`) }
}

console.log('── 규칙 변이 ──')
for (const [name, from, to] of MUTANTS) {
  const hits = original.split(from).length - 1
  if (hits !== 1) {                                   // 0건도 2건 이상도 실패다
    console.log(`  SKIP ${name} — 치환 대상 ${hits}건(1건이어야 한다)`)
    skipped++
    continue
  }
  writeFileSync(SRC, original.replace(from, to))
  const { red, out } = run()
  report(name, red, out)
}
writeFileSync(SRC, original)

console.log('\n── 배선 변이 ──')
let wRestored = true
for (const [name, rel, from, to] of WIRING) {
  const url = new URL(rel, import.meta.url)
  const before = readFileSync(url, 'utf8')
  const hits = before.split(from).length - 1
  if (hits !== 1) {                                   // CRLF·자구 변경으로 조용히 0건이 되는 것을 막는다
    console.log(`  SKIP ${name} — 치환 대상 ${hits}건(1건이어야 한다)`)
    skipped++
    continue
  }
  writeFileSync(url, before.replace(from, to))
  const { red, out } = run()
  report(name, red, out)
  writeFileSync(url, before)
  if (readFileSync(url, 'utf8') !== before) wRestored = false
}

// 되돌려 놓았는지 스스로 확인한다 — 변이 잔재를 남기면 다음 사람이 유령을 쫓는다
const restored = readFileSync(SRC, 'utf8') === original && wRestored
console.log(`\n원복 ${restored ? 'OK' : '🚨 실패'} · 물림 ${bit} / 생존 ${missed} / 건너뜀 ${skipped}`)
process.exit(missed === 0 && skipped === 0 && restored ? 0 : 1)
