// 변이 프로브 — 「신규등록 순서」 축(2026-09-15)의 단언이 실제로 무는지.
// 🚨 from은 한 줄짜리만(CRLF 혼재). 🚨 도는 중에 대상 파일을 편집하지 말 것(스냅샷 복원이 덮는다).
// 🚨 치환 문자열의 **유일성**을 확인할 것 — 들여쓰기가 다른 같은 줄이 있으면 짧은 쪽이
//    긴 쪽의 부분 문자열이라 String.replace가 엉뚱한 자리를 문다(2026-09-15 실제로 당함).
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const LIB = 'src/lib/onboarding-steps.ts'
const PAGE = 'src/app/(dashboard)/customers/[id]/page.tsx'
const NEW = 'src/components/customers/customer-new-client.tsx'
const STRIP = 'src/components/customers/onboarding-strip.tsx'
const SHELL = 'src/components/customers/customer-tabs.tsx'
const SUITE = 'npx tsx scripts/test-onboarding-order.mts'

const MUTANTS = [
  // ── ① 건너뛰기: 원래 결함이 되살아나는 갈래들 ──
  { name: 'M1 건물 단계를 건너뛴다 — 원래 결함의 재발',
    file: LIB, from: "  if (!s.buildings) return 'buildings'",
    to: '  // removed', expect: '둘 다 비면 건물·시설부터' },
  { name: 'M2 관계인 단계를 건너뛴다 — 대표 없이 계획서로',
    file: LIB, from: "  if (!s.contacts) return 'contacts'",
    to: '  // removed', expect: '건물이 찼으면 관계인으로' },
  { name: 'M3 등록 폼이 다시 소방계획서로 직행 — 순서가 통째로 무력해진다',
    file: NEW, from: '      router.push(`/customers/${result.customerId}?created=1&onboarding=1`)',
    to: '      router.push(`/customers/${result.customerId}?created=1&tab=plan&onboarding=1`)',
    expect: '등록 폼이 소방계획서로 직행시키지 않는다' },

  // ── ② 붙잡기: 다 채운 사용자를 가두는 갈래 (사용자 요청의 후반부) ──
  { name: 'M4 다 채워도 건물로 붙잡는다 — 「모두 채워지면 소방계획서로」를 어긴다',
    file: LIB, from: "  return 'plan'", to: "  return 'buildings'",
    expect: '둘 다 채우면 소방계획서로 간다' },
  { name: 'M5 온보딩이 사용자 지정 탭을 덮는다 — 이력 탭을 눌러도 끌려간다',
    file: PAGE, from: '  const effectiveTab = onboardingActive && !initialTab ? obNext : resolvedTab',
    to: '  const effectiveTab = onboardingActive ? obNext : resolvedTab',
    expect: '?tab=을 명시하면 사용자 지정이 이긴다' },

  // ── ③ 완성도 술어 ──
  { name: 'M6 다동 — 전 동에 용도를 요구한다 — 부속동 때문에 영원히 미완',
    file: LIB, from: '  return active.length > 0 && active.some(b => !!b.purpose && b.total_area != null)',
    to: '  return active.length > 0 && active.every(b => !!b.purpose && b.total_area != null)',
    expect: '한 동만 완비면 참' },
  // 🚨 이 줄은 buildingsDone·onboardingHint **두 함수에** 있다(유일성 가드가 잡았다) → 두 줄 앵커
  { name: 'M7 비활성 동을 센다 — 폐쇄한 건물로 통과된다',
    file: LIB,
    from: '  const active = buildings.filter(b => b.is_active)\n  return active.length > 0 && active.some(b => !!b.purpose && b.total_area != null)',
    to: '  const active = buildings.slice()\n  return active.length > 0 && active.some(b => !!b.purpose && b.total_area != null)',
    expect: '비활성 동만 있으면 거짓' },
  { name: 'M8 용도를 안 본다 — 실측 미완의 94%가 그냥 통과한다',
    file: LIB, from: '  return active.length > 0 && active.some(b => !!b.purpose && b.total_area != null)',
    to: '  return active.length > 0 && active.some(b => b.total_area != null)',
    expect: '용도가 비면 거짓' },
  { name: 'M9 연면적 0을 미입력으로 친다 — 0과 빈칸을 뭉갠다',
    file: LIB, from: '  return active.length > 0 && active.some(b => !!b.purpose && b.total_area != null)',
    to: '  return active.length > 0 && active.some(b => !!b.purpose && !!b.total_area)',
    expect: '연면적 0은 「입력됨」이다' },
  { name: 'M10 대표가 아닌 관계인도 통과 — 아무나 있으면 찬 것으로 본다',
    file: LIB, from: "  return contacts.some(c => c.role === '대표')",
    to: '  return contacts.length > 0', expect: '대표가 아닌 관계인만 있으면 거짓' },

  // ── ④ 띠 표시 ──
  { name: 'M11 「지금」이 여러 칸 — 어디로 가야 할지 알 수 없다',
    file: LIB, from: "    { key: 'buildings', label: '건물·시설', done: s.buildings, current: next === 'buildings', gate: true },",
    to: "    { key: 'buildings', label: '건물·시설', done: s.buildings, current: true, gate: true },",
    // 🚨 종전 기대는 「한 상태만」 재던 단언이라 이 변이가 **살아남았다**(그 표본에선 동등 변이).
    //    검사를 네 상태 전수로 고치고 나서야 물었다.
    expect: '「지금」은 **네 상태 전부** 정확히 하나' },
  { name: 'M12 문구가 무엇이 빈지 안 말한다 — 연면적 채운 사람은 뭘 할지 모른다',
    file: LIB, from: '    ? `건물의 ${missing.join(\'·\')}을(를) 입력하면 다음으로 넘어갑니다.`',
    to: '    ? `건물 정보를 입력하면 다음으로 넘어갑니다.`',
    expect: '문구가 「용도」를 집어 말한다' },
  { name: 'M13 띠 라벨이 탭과 달라진다 — 같은 것으로 안 읽힌다',
    file: LIB, from: "    { key: 'contacts', label: '관계인', done: s.contacts, current: next === 'contacts', gate: true },",
    to: "    { key: 'contacts', label: '관계인 정보', done: s.contacts, current: next === 'contacts', gate: true },",
    expect: '「관계인」 라벨이 띠와 탭에서 같다' },

  // ── ⑤ 배선: 규칙 두 벌 / 차단 금지 ──
  { name: 'M14 탭 ⚠가 제 손으로 다시 센다 — 규칙이 두 벌이 된다',
    file: PAGE, from: "    { key: 'buildings', label: '건물·시설', warn: !obState.buildings },",
    to: "    { key: 'buildings', label: '건물·시설', warn: !(buildings.filter(b => b.is_active).length > 0) },",
    expect: '건물 탭 ⚠가 **그 값**을 쓴다' },
  { name: 'M15 탭을 잠근다 — 실측 96.7%가 소방계획서에서 막힌다(사용자 결정 위반)',
    file: SHELL, from: '                onClick={() => switchTab(t.key)}',
    to: '                onClick={() => switchTab(t.key)} disabled={t.warn}',
    expect: '탭 셸이 탭을 잠그지 않는다' },
  { name: 'M16 띠가 URL만 바꾼다 — 주소는 바뀌는데 화면이 안 따라온다',
    file: STRIP, from: '          type="button" onClick={() => tabs?.goTab(next)} data-testid="onboarding-next"',
    to: '          type="button" onClick={() => router.push(`?tab=${next}`)} data-testid="onboarding-next"',
    expect: '[다음]이 셸의 goTab을 부른다' },
  { name: 'M17 [안내 닫기]가 보던 탭을 뺏는다',
    file: STRIP, from: "    sp.delete('onboarding')",
    to: "    sp.delete('onboarding'); sp.set('tab', 'plan')",
    expect: '[안내 닫기]는 띠만 접는다' },
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
    // 🚨 유일성 — 부분 문자열로 엉뚱한 자리를 물면 기대와 다른 단언이 운다
    const n = orig.split(from).length - 1
    if (n !== 1) throw new Error(`치환 대상이 ${n}곳 (${m.file}): ${m.from.trim().slice(0, 50)}`)
    writeFileSync(m.file, orig.replace(from, from === m.from ? m.to : m.to.replace(/\n/g, '\r\n')))
    let out = '', failed = false
    try { out = execSync(SUITE, { encoding: 'utf8', stdio: 'pipe' }) }
    catch (e) { failed = true; out = `${e.stdout ?? ''}${e.stderr ?? ''}` }
    const red = out.split('\n').filter(l => l.includes('❌'))
    const hit = red.some(l => l.includes(m.expect))
    if (failed && hit) { caught++; console.log(`✅ ${m.name}\n     → 빨강: ${red.map(l => l.trim()).slice(0, 2).join(' | ')}`) }
    else if (failed) console.log(`⚠️  ${m.name}\n     → 빨강이나 의도한 단언이 아니다(기대 "${m.expect}")\n     → ${red.map(l => l.trim()).slice(0, 3).join(' | ') || '(❌ 없음 — 스위트가 죽었다)'}`)
    else console.log(`❌ ${m.name}\n     → 되돌렸는데 초록이다 — 무는 단언이 없다`)
  } finally { writeFileSync(m.file, orig) }
}
console.log(`\n변이 결과: ${caught} / ${T.length} 잡음`)
process.exit(caught === T.length ? 0 : 1)
