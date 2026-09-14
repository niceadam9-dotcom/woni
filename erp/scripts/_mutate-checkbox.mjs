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
/** 확대(2026-09-14) 이후 **다른 파일의 규칙에도 기대고 있다** — 그 결합도 변이로 물어야 한다 */
const ALIGN = path.join(HERE, '..', 'src', 'lib', 'fire-plan-align.ts')
const TEST = 'npx tsx scripts/test-fire-plan-checkbox.mts'

const MUTATIONS = [
  { name: '여러 행 병합 무시(컨트롤을 첫 행에만)', from: 'merges.get(cellRef) ?? c.row0 + 1', to: 'c.row0 + 1' },
  { name: '여러 줄 칸 제외 규칙 삭제', from: "    if (label.includes('\\n')) continue\n", to: '' },
  { name: '「상자가 맨 앞」 규칙 삭제(산문 포함됨)', from: "    if (!EMPTY_BOX_RE.test(label.trim()[0] ?? '')) continue\n", to: '' },
  // 🔁 「상자 1개」 규칙은 2026-09-14에 **폐지**됐다(다중상자를 달기 시작). 그 자리를 대신하는
  //   축은 아래 [다중상자] 셋이다 — 변이를 지우지 않고 **옮겼다**.
  { name: 'ctrlProp이 체크를 안 싣는다', from: `\${checked ? ' checked="Checked"' : ''}`, to: "${''}" },
  { name: 'VML이 체크를 안 싣는다', from: "+ (checked ? '<x:Checked>1</x:Checked>' : '')", to: "+ ''" },
  // 🔁 종전 변이(「상자를 반각 공백으로 비움」)는 대상이 사라졌다 — 이제 글자를 아예 안 바꾸고
  //   **색만** 칠한다. 그 계약을 되돌리는 변이로 **교체**한다(지우기만 하면 그 축이 무검증이 된다).
  {
    name: '[실사고] 색칠 대신 글자를 갈아 끼움(전각 공백) — 폭이 달라 뒤 글자가 밀린다',
    from: `runs.push(\`<r><rPr><color rgb="\${fill}"/></rPr><t xml:space="preserve">\${escXml(ch)}</t></r>\`)`,
    to: `runs.push(\`<r><t xml:space="preserve">　</t></r>\`)`,
  },
  {
    name: '[실사고] 배경색 대신 흰색 고정(색 깔린 17칸에서 흰 네모가 드러난다)',
    from: 'const fill = fillOf(Number(/ s="(\\d+)"/.exec(m[1])?.[1] ?? 0))',
    to: "const fill = 'FFFFFFFF'",
  },
  { name: '컨트롤 폭 2열 → 0열', from: 'const CTRL_COLS = 2', to: 'const CTRL_COLS = 0' },
  { name: 'Content_Types에 ctrlProp Override 안 넣음', from: 'ct = ct.replace(\'</Types>\', overrides.join(\'\') + \'</Types>\')', to: "ct = ct" },
  { name: '루트 mc namespace 안 넣음', from: 'if (!/xmlns:mc=/.test(root)) root = root.replace', to: 'if (false) root = root.replace' },

  /* ── 확대(1.4 40칸 → 전 워크북 582칸)가 **새로 만든** 축. 한 시트만 달 때는 존재할 수 없던 결함들이다. ── */
  {
    name: '[확대] 범위를 1.4로 되돌림(27장이 조용히 빠진다)',
    from: 'FIRE_PLAN_MANIFEST.sheets.map(s => s.name)', to: "['1.4 소방시설 현황']",
  },
  {
    name: '[확대] ctrlProp 번호를 시트마다 1부터(파트가 서로 덮어쓴다)',
    from: '  for (const sheet of sheets) {', to: '  for (const sheet of sheets) { ctrlPropNo = 0;',
  },
  {
    name: '[확대] VML 파트를 전 시트가 공유(한 장에 582개가 몰린다)',
    from: 'const vmlPart = `xl/drawings/vmlDrawing${++vmlNo}.vml`',
    to: 'const vmlPart = `xl/drawings/vmlDrawing1.vml`; ++vmlNo',
  },
  {
    name: '[확대] 꼬리를 pageSetup **앞**에 끼움(CT_Worksheet 순서 위반 — Excel만 문다)',
    from: "for (const after of ['<picture', '<oleObjects', '<webPublishItems', '<tableParts', '<extLst']) {",
    to: "for (const after of ['<pageSetup', '<picture', '<oleObjects', '<webPublishItems', '<tableParts', '<extLst']) {",
  },
  {
    name: '[확대] 정렬 규칙을 바꿈 — 「상자 선두 → 좌」를 가운데로(컨트롤이 상자에서 떨어진다)',
    file: ALIGN, from: "  if (isCheckText(v)) return 'left'", to: "  if (isCheckText(v)) return 'center'",
  },
  // 🚨 실제로 터졌던 결함의 변이. 이 두 줄이 원래 판이었고, 노드 52/0·변이 15/15가 전부 초록인데
  //   **Excel이 컨트롤을 두 배로 셌다**. 그때 없던 단언을 [B-5]⑤가 지금 들고 있다.
  {
    name: '[확대·실사고] idmap을 전 파트가 data="1"로 공유(Excel이 컨트롤을 두 배로 센다)',
    from: 'data="${idBlock}"', to: 'data="1"',
  },
  {
    name: '[확대·실사고] shape id를 블록 무시하고 전역 연번으로(1025+applied)',
    from: 'const shapeId = idBlock * 1024 + shapes.length + 1', to: 'const shapeId = 1025 + applied',
  },
  // 🚨 두 번째 실사고. 아래 모서리를 「다음 행의 꼭대기」로 적으면 시트 마지막 행에 붙은 컨트롤의
  //   to행이 dimension을 넘어, 엑셀이 빈 행까지 인쇄해 **표 아래에 점선 띠**가 찍힌다(3장).
  //   이것도 수치·변이·LO 전부 통과였고 **인쇄 렌더 대조**만이 잡았다.
  {
    name: '[확대·실사고] 아래 모서리를 「다음 행 꼭대기」로(인쇄물에 점선 띠가 생긴다)',
    from: '${toRow0}, ${toRowOffPx}</x:Anchor>', to: '${endRow1}, 0</x:Anchor>',
  },

  /* ── 다중상자(`□ 유 □ 무`) 축 — 2026-09-14 ─────────────────────────────────────── */
  {
    name: '[다중상자] 상자가 여럿인 칸을 도로 뺀다(유/무를 못 누르게 된다)',
    from: 'if (at.length === 1) { out.push({ cell, col, row0, boxIndex: 0, offsetPx: 0 }); continue }',
    to: 'if (at.length !== 1) continue\n    if (at.length === 1) { out.push({ cell, col, row0, boxIndex: 0, offsetPx: 0 }); continue }',
  },
  {
    name: '[다중상자] 실측 오프셋을 버리고 0으로(상자가 전부 첫 자리에 겹친다)',
    from: 'out.push({ cell, col, row0, boxIndex: i, offsetPx: offs[i] })',
    to: 'out.push({ cell, col, row0, boxIndex: i, offsetPx: 0 })',
  },
  // ⚠ 「표에 없는 칸도 그냥 단다」 변이는 **동등 변이라 목록에서 뺐다** — 지금은 다중상자 17칸이
  //   전부 표에 있어서 그 갈래를 아무도 안 밟는다(밟게 하려면 표를 지워야 하는데 그건 다른 변이다).
  //   가드 자체는 남겨 둔다: 서식이 새 다중상자 칸을 얻으면 그때 이 갈래가 살아난다.
  //   ⭐ 「잡힐 수 없는 변이」를 목록에 두면 놓침으로 세어져 프로브가 늘 빨갛다(45 교훈).
  {
    name: '[들여쓰기] 보정을 0으로(컨트롤이 상자보다 15px 왼쪽에 선다 — 배포본의 상태)',
    from: 'const TEXT_INSET_PX = 15', to: 'const TEXT_INSET_PX = 0',
  },
]

const originals = new Map()
for (const m of MUTATIONS) {
  const f = m.file ?? SRC
  if (!originals.has(f)) originals.set(f, readFileSync(f, 'utf8'))
}
let caught = 0, missed = 0, notApplied = 0
try {
  for (const m of MUTATIONS) {
    const f = m.file ?? SRC
    const original = originals.get(f)
    const n = original.split(m.from).length - 1
    if (n !== 1) {
      notApplied++
      console.log(`  [치환불가] ${m.name} — 원문에 ${n}회 등장(1회여야 한다)`)
      continue
    }
    writeFileSync(f, original.replace(m.from, m.to), 'utf8')
    let red = false
    try { execSync(TEST, { cwd: path.join(HERE, '..'), stdio: 'pipe' }) } catch { red = true }
    writeFileSync(f, original, 'utf8')   // 다음 변이가 겹치지 않게 즉시 되돌린다
    if (red) { caught++; console.log(`  [빨강 ✓] ${m.name}`) }
    else { missed++; console.log(`  [초록 ✗] ${m.name}  ← 이 축에 단언이 없다`) }
  }
} finally {
  for (const [f, original] of originals) writeFileSync(f, original, 'utf8')
}
console.log(`\n변이 ${MUTATIONS.length}건 — 잡음 ${caught} · 놓침 ${missed} · 치환불가 ${notApplied}`)
process.exit(missed === 0 && notApplied === 0 ? 0 : 1)
