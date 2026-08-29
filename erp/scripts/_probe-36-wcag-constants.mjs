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
console.log('\n── 소방계획서_36 문서 기재값 대조')
for (const [label, got, doc] of [
  ['ink-faint 라이트', ratio(LIGHT['ink-faint'], SURFACE.light), 2.16],
  ['ink-faint 다크', ratio(DARK['ink-faint'], SURFACE.dark), 3.14],
  ['ink-sub 다크', ratio(DARK['ink-sub'], SURFACE.dark), 6.76],
  ['ink-soft 다크', ratio(DARK['ink-soft'], SURFACE.dark), 4.76],
]) {
  const ok = Math.abs(got - doc) < 0.05
  console.log(`   ${ok ? '✅' : '❌'} ${label.padEnd(18)} 계산 ${got.toFixed(3)} vs 문서 ${doc}`)
}

// --t-ink-meta 후보 — AA 4.5:1을 surface·paper 양쪽에서 넘기는 값을 찾는다(S5-1)
console.log('\n── --t-ink-meta 후보 (surface·paper 양쪽 ≥4.5:1)')
for (const [mode, base] of [['light', LIGHT['ink-sub']], ['dark', DARK['ink-sub']]]) {
  const worst = h => Math.min(ratio(h, SURFACE[mode]), ratio(h, PAPER[mode]))
  console.log(`   ${mode} 기준 ink-sub ${base}: 최악 ${worst(base).toFixed(2)}:1`)
}
