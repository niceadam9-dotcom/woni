// 변이 프로브 — 「진입 경로도 대역 = 표지 건물 사진」 축(2026-09-14)의 단언이 실제로 **무는지** 본다.
//
// 21/0 초록은 "무언가를 잡는다"만 말한다. "이것을 잡는다"는 제품을 되돌려 봐야 안다.
// 각 변이는 **되돌리려는 결함**과 **빨강이 되어야 할 단언**을 짝으로 들고 있다 —
// 빨강이긴 한데 엉뚱한 단언이 울면 그건 못 잡은 것으로 친다(⚠).
//
// 🚨 치환이 조용히 빗나가면 제품이 멀쩡한 채로 돌아 "초록 → 변이를 못 잡았다"로 오독하게 된다.
//    그래서 from 문자열이 없으면 **그 자리에서 죽인다**(건너뛰기 금지).
// 🚨 from은 **한 줄짜리만** 쓴다 — 이 저장소 소스는 CRLF가 섞여 있어 여러 줄 문자열이 조용히 안 맞는다.
//
// 실행: node scripts/_mutate-fireplan-route-fallback.mjs   (MUT=M3 처럼 골라 돌릴 수 있다)
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const REFS = 'src/lib/fire-plan-image-refs.ts'

/** expect = 이 변이로 빨강이 되어야 하는 단언 이름의 일부 */
const MUTANTS = [
  {
    name: 'M1 대역을 아예 세우지 않는다 — 버튼 시절로 되돌린다',
    from: "  if (cover) refs.push({ path: cover, kind: 'route', caption: '소방차 진입경로', priority: PRIORITY_FALLBACK })",
    to: '  void cover',
    expect: '진입경로 자리가 채워진다',
  },
  {
    name: 'M2 대역이 제 그림을 이긴다 — 서열을 맨 위로',
    from: 'export const PRIORITY_FALLBACK = 4',
    to: 'export const PRIORITY_FALLBACK = 0',
    expect: '제 경로도가 이긴다',
  },
  {
    name: 'M3 엉뚱한 파일을 대역으로 — 표지가 아니라 아무 슬롯이나 집는다',
    from: "  const cover = slotAssets.find(a => a.slot === 'cover')?.path",
    to: '  const cover = slotAssets[0]?.path',
    expect: '약도를 대역으로 쓰지 않는다',
  },
  {
    name: 'M4 수집기가 경로만 보고 건너뛴다 — 대역이 조용히 사라진다',
    from: '    const key = `${r.kind}|${path}`',
    to: '    const key = path',
    expect: '**두 자리**가 다 실린다',
  },
  {
    name: 'M5 같은 파일을 두 번 담는다 — 문서가 두 배로 무거워진다',
    from: "    if (already) { images.push({ file: already, kind: r.kind, caption: r.caption }); continue }",
    to: '    void already',
    expect: '바이트는 한 번만 담는다',
  },
  {
    name: 'M7 폐지된 자동 초안을 「제 그림」으로 친다 — 주행경로 지도 고객만 영영 옛 지도',
    from: '    const priority = isRetiredRouteDraft(s.fireAccess.routeImage) ? PRIORITY_RETIRED : PRIORITY_FORM',
    to: '    const priority = PRIORITY_FORM',
    expect: '표지가 있으면 자동 초안을 밀어낸다',
  },
  {
    name: 'M8 판정이 너무 넓다 — 사람이 올린 그림까지 초안으로 몰아 밀어낸다',
    from: "  return !!path && /(^|\\/)route-\\d+\\.[a-z0-9]+$/i.test(path)",
    to: '  return !!path',
    expect: '화살표를 얹은 그림은 표지가 있어도 안 밀린다',
  },
  {
    name: 'M9 초안을 대역 없이도 버린다 — 표지 없는 고객의 칸이 백지가 된다',
    from: '  if (s.fireAccess?.routeImage) {',
    to: '  if (s.fireAccess?.routeImage && !isRetiredRouteDraft(s.fireAccess.routeImage)) {',
    expect: '표지가 없으면 자동 초안이라도 인쇄한다',
  },
  {
    name: 'M6 자리가 1칸인 용도를 잊는다 — 위치도가 2장 인쇄된다',
    from: "const SINGLE_KINDS = new Set(['cover', 'map'])",
    to: 'const SINGLE_KINDS = new Set([])',
    expect: '위치도가 둘이면 1장만 인쇄된다',
  },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only)) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

let caught = 0
for (const m of TARGETS) {
  const original = readFileSync(REFS, 'utf8')
  try {
    if (!original.includes(m.from)) {
      throw new Error(`치환 대상을 못 찾음 (${REFS}) — 변이가 적용되지 않았다:\n${m.from}`)
    }
    writeFileSync(REFS, original.replace(m.from, m.to))

    let out = ''
    let failed = false
    try {
      out = execSync('npx tsx scripts/test-fire-plan-image-refs.mts', { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      failed = true
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    const redLines = out.split('\n').filter(l => l.includes('FAIL'))
    const hitExpected = redLines.some(l => l.includes(m.expect))
    if (failed && hitExpected) {
      caught++
      console.log(`✅ ${m.name}\n     → 빨강: ${redLines.map(l => l.trim()).join(' | ')}`)
    } else if (failed) {
      console.log(`⚠️  ${m.name}\n     → 빨강이긴 한데 의도한 단언이 아니다(기대: "${m.expect}")\n     → ${redLines.map(l => l.trim()).join(' | ') || '(FAIL 줄 없음 — 스위트가 중간에 죽었다)'}`)
    } else {
      console.log(`❌ ${m.name}\n     → 제품을 되돌렸는데 스위트가 초록이다 — 이 축을 무는 단언이 없다`)
    }
  } finally {
    writeFileSync(REFS, original)
  }
}

console.log(`\n변이 결과: ${caught} / ${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
