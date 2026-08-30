// 소방계획서_36 — 토큰 대비값 기준 계산 (S6-10 자가검증 상수의 원천)
// 브라우저·앱과 무관한 **순수 계산**이다. 프로브가 이 값을 재현하지 못하면 프로브가 틀린 것.
// 실행: node scripts/_probe-36-wcag-constants.mjs
const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const L = hex => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`hex 형식 아님: ${hex}`)
  const [r, g, b] = [1, 2, 3].map(i => lin(parseInt(m[i], 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (fg, bg) => {
  const [a, b] = [L(fg), L(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const LIGHT = { ink: '#090c1d', 'ink-strong': '#292d34', 'ink-sub': '#514b81', 'ink-soft': '#847ba8', 'ink-faint': '#b0acd6' }
const DARK = { ink: '#ededf0', 'ink-strong': '#d8d8de', 'ink-sub': '#a8a5c0', 'ink-soft': '#8c88a8', 'ink-faint': '#6e6a8a' }
const SURFACE = { light: '#ffffff', dark: '#232327' }
const PAPER = { light: '#f8f9fa', dark: '#1b1b1e' }

for (const [mode, toks] of [['light', LIGHT], ['dark', DARK]]) {
  console.log(`\n── ${mode} (surface ${SURFACE[mode]} · paper ${PAPER[mode]})`)
  for (const [name, hex] of Object.entries(toks)) {
    const s = ratio(hex, SURFACE[mode]), p = ratio(hex, PAPER[mode])
    const v = r => (r >= 4.5 ? 'AA' : r >= 3.0 ? '큰글자만' : '실패')
    console.log(`   ${name.padEnd(10)} ${hex}  surface ${s.toFixed(2)}:1 [${v(s)}]  paper ${p.toFixed(2)}:1 [${v(p)}]`)
  }
}

// 문서가 적어둔 값과 대조 — 설계 JSON/MD의 상수가 곧 프로브의 오라클이 된다
// 문서(§2.3)에 실린 값과 대조 — **F-6 정정 후 값**이다.
// 최초안의 3.14·6.76·4.76·9.3·11은 오기였고 여기서 잡혔다. 이 절은 그 회귀를 막는다.
console.log('\n── 소방계획서_36 문서 기재값 대조 (F-6 정정본)')
for (const [label, got, doc] of [
  ['ink-faint 라이트', ratio(LIGHT['ink-faint'], SURFACE.light), 2.16],
  ['ink-faint 다크', ratio(DARK['ink-faint'], SURFACE.dark), 3.05],
  ['ink-sub 라이트', ratio(LIGHT['ink-sub'], SURFACE.light), 7.86],
  ['ink-sub 다크', ratio(DARK['ink-sub'], SURFACE.dark), 6.57],
  ['ink-soft 다크', ratio(DARK['ink-soft'], SURFACE.dark), 4.62],
]) {
  const ok = Math.abs(got - doc) < 0.05
  console.log(`   ${ok ? '✅' : '❌'} ${label.padEnd(18)} 계산 ${got.toFixed(3)} vs 문서 ${doc}`)
}

// --t-ink-meta 후보 — AA 4.5:1을 surface·paper **양쪽에서** 넘기는 값을 찾는다(S5-1)
//
// 설계 의도(D-5): ink-faint = 순수 장식(AA 비대상) / ink-meta = 정보를 담은 보조 텍스트(AA 대상).
// 그래서 ink-faint의 **색상은 유지하고 명도만** 옮겨 AA를 넘기는 가장 가까운 값을 고른다 —
// 팔레트에 새 색을 들이지 않고 '같은 계열의 읽히는 버전'이 되게.
const hex2 = h => { const m = /^#?(..)(..)(..)$/.exec(h); return [1,2,3].map(i => parseInt(m[i],16)) }
const toHex = a => '#' + a.map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')

/** ⚠ surface·paper만 보면 부족하다 — 앱은 **brand-tint 배경 위에도** 보조 텍스트를 얹는다
 *  (설정의 옵션 카드가 그렇다). 실제로 그 자리에서 4.25:1이 나와 미달이 드러났다(2026-08-30).
 *  배경 후보를 셋으로 늘려 **최악 배경**을 기준으로 고른다. */
const TINT = { light: '#f5f4ff', dark: '#2a2542' }

function findMeta(mode, fromHex, toward) {
  const from = hex2(fromHex), to = hex2(toward)
  const worst = h => Math.min(ratio(h, SURFACE[mode]), ratio(h, PAPER[mode]), ratio(h, TINT[mode]))
  // ink-faint에서 목표색(라이트=ink, 다크=흰색) 쪽으로 조금씩 옮기며 처음 AA를 넘는 지점
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const c = toHex(from.map((v, i) => v + (to[i] - v) * t))
    if (worst(c) >= 4.5) return { hex: c, t: t.toFixed(2), surface: ratio(c, SURFACE[mode]), paper: ratio(c, PAPER[mode]), tint: ratio(c, TINT[mode]) }
  }
  return null
}

console.log('\n── --t-ink-meta 후보 (ink-faint 계열 유지 · surface·paper 양쪽 ≥4.5:1)')
for (const [mode, base, toward] of [
  ['light', LIGHT['ink-faint'], LIGHT['ink']],
  ['dark', DARK['ink-faint'], '#ffffff'],
]) {
  const r = findMeta(mode, base, toward)
  console.log(r
    ? `   ${mode}: ${base} → **${r.hex}**  (t=${r.t})  surface ${r.surface.toFixed(2)} · paper ${r.paper.toFixed(2)} · tint ${r.tint.toFixed(2)}`
    : `   ${mode}: 후보 없음`)
}
