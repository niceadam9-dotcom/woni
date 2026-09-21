/** 변이 검사 — 키보드 왕복 단언이 **실제로 무는가** (2026-09-21).
 *
 *  이 저장소의 교훈: 모양만 보는 단언은 기능이 죽어도 초록으로 남는다. 그래서 새 단언마다
 *  그것을 깨는 최소 변이를 넣고 **빨강이 되는지** 본다. 빨강이 안 되면 제품이 아니라 계측기를 의심한다.
 *
 *  🚨 소스를 PowerShell로 읽고 쓰면 한글이 깨진다(CP949) — 반드시 node에서 utf8로.
 *  🚨 치환 0건이면 '변이를 넣었다고 착각한 초록'이 된다 — 건수를 가드한다.
 *
 *  실행: node scripts/_mut-tree-keyboard.mjs   (dev 서버가 떠 있어야 한다)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const S = 'src/components/customers'
const MUTANTS = [
  { id: 'M1', file: `${S}/plan-tab-view.tsx`, desc: '소방계획서 트리 roving tabindex 제거(전부 Tab 대상)',
    from: 'tabIndex={sel === key ? 0 : -1}', to: 'tabIndex={0}',
    expect: '④ 트리에서 Tab 대상인 노드는 선택된 1개뿐' },
  { id: 'M2', file: `${S}/customer-tabs.tsx`, desc: '탭 바 roving tabindex 제거',
    from: 'tabIndex={active === t.key ? 0 : -1}', to: 'tabIndex={0}',
    expect: '④ 탭 바에서 Tab 대상인 탭은 활성 1개뿐' },
  { id: 'M3', file: 'src/components/ui/unsaved-nav.tsx', desc: '확인창 ESC 닫기 제거',
    from: "if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return }",
    to: "if (e.key === 'Escape') { return }",
    expect: '⑥ ESC로 확인창이 닫힌다' },
  { id: 'M4', file: 'src/components/ui/unsaved-nav.tsx', desc: '확인창으로 포커스 들이기 제거',
    from: "dialogRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()",
    to: "void dialogRef",
    expect: '⑥ 포커스가 확인창 **안**에 있다' },
  { id: 'M5', file: 'src/components/ui/unsaved-nav.tsx', desc: '확인창 포커스 트랩 제거',
    from: "if (e.key !== 'Tab') return", to: "if (e.key !== 'Tab') return; if (1) return",
    expect: '⑥ Tab이 창 밖으로 새지 않는다' },
  { id: 'M6', file: `${S}/tree-keyboard.ts`, desc: 'Enter(상세 진입) 해석 제거',
    from: "if (pressed === 'Enter') return { kind: 'enter' }", to: "if (pressed === 'Enter') return null",
    expect: '⑤ Enter: 트리 → 상세 패널로 포커스 진입' },
  { id: 'M7', file: `${S}/tree-keyboard.ts`, desc: 'End(마지막 노드) 해석 제거',
    from: ": pressed === 'End' ? keys[keys.length - 1]", to: ": pressed === 'End' ? undefined",
    expect: '⑤ End: 마지막 노드(archive)' },
  { id: 'M8', file: `${S}/plan-tab-view.tsx`, desc: '이동 후 트리 포커스 복원 제거(확인창 [이동] 경로)',
    from: 'focusTreeNode(treeRef.current, key)', to: 'void treeRef',
    expect: '⑥ [이동] 후 포커스가 목적지 노드를 따라온다' },
  { id: 'M9', file: `${S}/plan-tab-view.tsx`, desc: '상세→트리 ESC 복귀 제거',
    from: 'focusTreeNode(treeRef.current, sel)', to: 'void treeRef',
    expect: '⑤ ESC: 상세 → 선택 노드로 복귀' },
  { id: 'M10', file: `${S}/tree-keyboard.ts`, desc: '↓를 이전 노드로 뒤집기',
    from: "pressed === 'ArrowDown' || pressed === 'ArrowRight' ? keys[i + 1]",
    to: "pressed === 'ArrowDown' || pressed === 'ArrowRight' ? keys[i - 1]",
    expect: '① ↓: 1.5 → 1.6' },
]

function runProbe() {
  try {
    return execFileSync('npx', ['tsx', 'scripts/_probe-tree-keyboard.mts'],
      { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

// 기준선 — 변이 전에 전부 초록이어야 '빨강=변이 때문'이라고 말할 수 있다
console.log('기준선(변이 없음) 실행…')
const base = runProbe()
const baseOk = /0 실패/.test(base)
console.log(`  기준선: ${baseOk ? '전부 초록 ✅' : '빨강 있음 ❌ — 아래 변이 판정은 무효'}`)
console.log(`  ${base.trim().split('\n').pop()}`)
if (!baseOk) process.exit(1)

let caught = 0
for (const m of MUTANTS) {
  const orig = readFileSync(m.file, 'utf8')
  const hits = orig.split(m.from).length - 1
  if (hits !== 1) {
    console.log(`${m.id} ⚠ 치환 대상 ${hits}건 (1건이어야 함) — 변이 무효, 건너뜀: ${m.desc}`)
    continue
  }
  writeFileSync(m.file, orig.replace(m.from, m.to), 'utf8')
  try {
    const out = runProbe()
    // 기대한 그 단언이 빨강인가 (다른 게 빨강이면 변이가 엉뚱한 걸 깼다는 뜻이라 함께 본다)
    const line = out.split('\n').find(l => l.includes(m.expect)) ?? ''
    const red = line.includes('❌')
    const total = out.trim().split('\n').pop() ?? ''
    if (red) caught++
    console.log(`${m.id} ${red ? '✅ 잡힘' : '🚨 생존'} — ${m.desc}`)
    console.log(`     기대 단언: ${line.trim() || '(출력에서 못 찾음)'}`)
    console.log(`     ${total.trim()}`)
  } finally {
    writeFileSync(m.file, orig, 'utf8')
  }
}
console.log(`\n변이 결과: ${caught}/${MUTANTS.length} 잡힘`)
