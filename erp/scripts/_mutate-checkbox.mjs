/** 변이 검사 — `test-fire-plan-checkbox.mts`의 초록이 실제로 무는가.
 *
 *  대조군 대조는 「무언가를 잡는다」만 보여 줄 뿐 「이것을 잡는다」를 안 보여 준다. 제품을
 *  한 군데씩 되돌려 놓고 검사가 **빨개지는지** 직접 본다. 빨개지지 않는 변이는 그 축에
 *  단언이 없다는 뜻이다.
 *
 *  🚨 치환이 **안 된 것**은 통과가 아니라 실패로 친다 — CRLF나 공백 차이로 변이가 조용히
 *    안 돌면 「검사가 물었다」고 오독하게 된다(전례 있음).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const HERE = import.meta.dirname
const SRC = path.join(HERE, '..', 'src', 'lib', 'fire-plan-checkbox-controls.ts')
const TEST = 'npx tsx scripts/test-fire-plan-checkbox.mts'

const MUTATIONS = [
  { name: '여러 행 병합 무시(컨트롤을 첫 행에만)', from: 'merges.get(c.cell) ?? c.row0 + 1', to: 'c.row0 + 1' },
  { name: '여러 줄 칸 제외 규칙 삭제', from: "    if (label.includes('\\n')) continue\n", to: '' },
  { name: '「상자가 맨 앞」 규칙 삭제(산문 포함됨)', from: "    if (!EMPTY_BOX_RE.test(label.trim()[0] ?? '')) continue\n", to: '' },
  { name: '「상자 1개」 규칙 삭제(다중 상자 포함됨)', from: "    if ((label.match(/[□☐]/g) ?? []).length !== 1) continue\n", to: '' },
  { name: 'ctrlProp이 체크를 안 싣는다', from: `\${checked ? ' checked="Checked"' : ''}`, to: "${''}" },
  { name: 'VML이 체크를 안 싣는다', from: "+ (checked ? '<x:Checked>1</x:Checked>' : '')", to: "+ ''" },
  { name: '상자를 반각 공백으로 비움(폭 유실)', from: "const BLANK = '　'", to: "const BLANK = ' '" },
  { name: '컨트롤 폭 2열 → 0열', from: 'const CTRL_COLS = 2', to: 'const CTRL_COLS = 0' },
  { name: 'Content_Types에 ctrlProp Override 안 넣음', from: 'ct = ct.replace(\'</Types>\', overrides.join(\'\') + \'</Types>\')', to: "ct = ct" },
  { name: '루트 mc namespace 안 넣음', from: 'if (!/xmlns:mc=/.test(root)) root = root.replace', to: 'if (false) root = root.replace' },
]

const original = readFileSync(SRC, 'utf8')
let caught = 0, missed = 0, notApplied = 0
try {
  for (const m of MUTATIONS) {
    const n = original.split(m.from).length - 1
    if (n !== 1) {
      notApplied++
      console.log(`  [치환불가] ${m.name} — 원문에 ${n}회 등장(1회여야 한다)`)
      continue
    }
    writeFileSync(SRC, original.replace(m.from, m.to), 'utf8')
    let red = false
    try { execSync(TEST, { cwd: path.join(HERE, '..'), stdio: 'pipe' }) } catch { red = true }
    if (red) { caught++; console.log(`  [빨강 ✓] ${m.name}`) }
    else { missed++; console.log(`  [초록 ✗] ${m.name}  ← 이 축에 단언이 없다`) }
  }
} finally {
  writeFileSync(SRC, original, 'utf8')
}
console.log(`\n변이 ${MUTATIONS.length}건 — 잡음 ${caught} · 놓침 ${missed} · 치환불가 ${notApplied}`)
process.exit(missed === 0 && notApplied === 0 ? 0 : 1)
