// 변이 프로브 — 소방계획서 엑셀 사진 상자 (2026-09-14)
//
// 왜 필요한가: `test-fire-plan-images.mts`가 83/0 초록이라는 사실은 「무언가를 잡는다」만 말해 줄 뿐
// 「이것을 잡는다」를 말해 주지 않는다. 제품을 되돌리는 변이를 심어 **빨강이 되는지**, 그리고
// 그것이 **의도한 단언**에서 빨강이 되는지 확인한다.
//
// 실행: node scripts/_mutate-fireplan-images.mjs      (전량)
//       MUT=M4 node scripts/_mutate-fireplan-images.mjs  (하나만)
//
// ⚠ 치환이 조용히 빗나가면(공백·줄바꿈 차이) 제품이 멀쩡한 채로 돌아 "초록 = 변이를 못 잡았다"로
//   오독하게 된다. 그래서 from 문자열이 없으면 **그 자리에서 죽인다**(건너뛰기 금지).
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const LIB = 'src/lib/fire-plan-xlsx-images.ts'
const ANCH = 'src/lib/fire-plan-anchors.ts'

/* ⚠ `npx tsx …`을 쓰지 않는다 — execSync는 cmd.exe로 도는데 거기서는 `npx`가 tsx를 못 찾아
 *   ("'tsx' is not recognized") **테스트가 한 줄도 안 돌고 종료코드만 1**이 된다. 그러면 전 변이가
 *   「빨강인데 FAIL 0건」으로 보이고, 그걸 '잡았다'로 오독하면 이 프로브 자체가 공허해진다
 *   (실제로 첫 실행이 11/11 그 꼴이었다). tsx CLI를 node로 직접 부른다. */
const TEST_CMD = 'node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/test-fire-plan-images.mts'

/** expect = 이 변이로 빨강이 되어야 하는 단언의 이름 조각 */
const MUTANTS = [
  {
    name: 'M1 상자 좌표를 라벨 줄로 옮긴다(진입경로도 A2→A1)',
    file: ANCH,
    from: "{ field: 'img_route',        kind: 'route', index: 0, sheet: FP_SHEET.F1_3_ROUTE, cell: 'A2', labelCell: 'A1' },",
    to: "{ field: 'img_route',        kind: 'route', index: 0, sheet: FP_SHEET.F1_3_ROUTE, cell: 'A1', labelCell: 'A1' },",
    expect: 'img_route 상자가 크다',
  },
  {
    name: 'M2 0-based 변환을 빠뜨린다(그림이 한 칸 밀린다)',
    file: LIB,
    from: '+ `<xdr:from><xdr:col>${box.c1 - 1 + cx0.i}</xdr:col><xdr:colOff>${cx0.off * EMU_PER_PX}</xdr:colOff>`',
    to: '+ `<xdr:from><xdr:col>${box.c1 + cx0.i}</xdr:col><xdr:colOff>${cx0.off * EMU_PER_PX}</xdr:colOff>`',
    expect: '그림이 상자 안에서 가운데',
  },
  {
    // 🚨 이 결함이 실제로 산출물에 있었다(2026-09-14). 구조 단언 83건이 전부 초록이었고
    //    **LibreOffice 렌더 육안**이 잡았다 — 그래서 「오프셋이 그 칸 폭 안」 단언을 새로 세웠다.
    name: 'M12 가운데 오프셋을 칸으로 안 쪼개고 첫 칸에 통째로 준다(뷰어가 클램프 → 왼쪽에 붙는다)',
    file: LIB,
    from: '      const cx0 = splitOffset(colSizes, g.padX)',
    to: '      const cx0 = { i: 0, off: g.padX }',
    expect: '오프셋이 그 칸 폭 안',
  },
  {
    name: 'M3 가로세로비를 무시하고 상자를 꽉 채운다',
    file: LIB,
    from: '  const scale = Math.min(innerW / img.w, innerH / img.h)',
    to: '  const scale = Math.max(innerW / img.w, innerH / img.h)',
    expect: '상자를 안 넘는다',
  },
  {
    name: 'M4 배정에서 index를 무시한다(평면도 2칸에 같은 장이 들어간다)',
    file: LIB,
    from: '    const im = byKind.get(b.kind)?.[b.index]',
    to: '    const im = byKind.get(b.kind)?.[0]',
    expect: '평면도 2장째',
  },
  {
    name: 'M5 미디어 확장자를 .jpg로 쓴다(파일은 열리는데 그림만 안 보인다)',
    file: LIB,
    from: '      const file = `fireplan-${nextDrawing}-${++mediaSeq}.jpeg`',
    to: '      const file = `fireplan-${nextDrawing}-${++mediaSeq}.jpg`',
    expect: 'media는 전부 .jpeg',
  },
  {
    name: 'M6 [Content_Types]에 jpeg Default를 안 단다',
    file: LIB,
    from: "  if (!/<Default\\s+Extension=\"jpeg\"/.test(out)) {",
    to: '  if (false) {',
    expect: 'jpeg Default',
  },
  {
    name: 'M7 자리표 비우기를 빠뜨린다(그림 밑에 「[해당 층 평면도]」가 남는다)',
    file: LIB,
    from: '    if (b.clearPlaceholder) blankCells.push({ sheet: a.sheet, cell: a.cell })',
    to: '    void b.clearPlaceholder',
    expect: '자리표 비우기',
  },
  {
    name: 'M8 워크시트에 <drawing> 태그를 안 넣는다(파트만 있고 아무도 안 본다)',
    file: LIB,
    from: '    xml = insertDrawingTag(xml, sheetRid)',
    to: '    void sheetRid',
    expect: '시트에 <drawing>이 있다',
  },
  {
    name: 'M9 넘친 장수를 조용히 버린다',
    file: LIB,
    from: "    if (have > slots) notes.push(`${kind} 이미지 ${have - slots}장 미표기(양식 상자 ${slots}칸)`)",
    to: '    void have; void slots',
    expect: '넘침 고지',
  },
  {
    name: 'M10 상자 없는 종류(표지 사진)를 조용히 버린다',
    file: LIB,
    from: "    notes.push(`${kind} 이미지 ${list.length}장은 엑셀 서식에 상자가 없어 미표기(PDF에는 인쇄됩니다)`)",
    to: '    void list',
    expect: '상자 없음',
  },
  {
    name: 'M11 상자 크기를 재지 않고 고정 300×200으로 놓는다',
    file: LIB,
    from: '      const g = fit(img, boxW, boxH)',
    to: '      const g = fit(img, 300, 200)',
    expect: '그림이 상자를 채운다',
  },
]

const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only + ' ')) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

/* 대조군 — 변이 없이 초록인가. 이걸 안 재면 「전부 빨강」이 계측기 고장인지 제품 결함인지 모른다 */
{
  let ok = true, out = ''
  try { out = execSync(TEST_CMD, { encoding: 'utf8', stdio: 'pipe' }) }
  catch (e) { ok = false; out = `${e.stdout ?? ''}${e.stderr ?? ''}` }
  const green = /결과: \d+ pass \/ 0 fail/.test(out)
  console.log(`[대조군] ${ok && green ? '초록 ✓' : '빨강 ✗'} — ${out.trim().split('\n').pop()}`)
  if (!ok || !green) { console.log('대조군이 초록이 아니면 변이 판정이 성립하지 않는다'); process.exit(1) }
}

let caught = 0
for (const m of TARGETS) {
  const orig = readFileSync(m.file, 'utf8')
  if (!orig.includes(m.from)) {
    console.log(`\n### ${m.name}\n  ✗ from 문자열을 못 찾았다 — 변이가 심기지 않았다(실패로 친다)`)
    console.log(`     file=${m.file}`)
    process.exitCode = 1
    continue
  }
  writeFileSync(m.file, orig.replace(m.from, m.to), 'utf8')
  let out = ''
  let red = false
  try {
    out = execSync(TEST_CMD, { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    red = true
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  } finally {
    writeFileSync(m.file, orig, 'utf8')
  }
  const fails = out.split('\n').filter(l => l.includes('FAIL')).map(l => l.trim())
  const hit = fails.some(l => l.includes(m.expect))
  console.log(`\n### ${m.name}`)
  console.log(`  ${red ? '빨강' : '초록'} · FAIL ${fails.length}건`)
  for (const f of fails.slice(0, 4)) console.log(`     ${f}`)
  if (red && fails.length === 0) {
    // 단언이 문 게 아니라 **검사가 아예 안 돈** 것이다 — 초록보다 더 나쁜 상태다
    console.log(`  ✗ 빨강인데 FAIL 0건 — 검사가 돌지 않았다(프로브 고장)`)
    console.log(out.trim().split('\n').slice(-3).join('\n'))
    process.exitCode = 1
  } else if (red && hit) { caught++; console.log(`  ✓ 의도한 단언이 물었다: '${m.expect}'`) }
  else if (red) { console.log(`  △ 빨강이지만 '${m.expect}' 가 아니다 — 단언을 다시 볼 것`); process.exitCode = 1 }
  else { console.log(`  ✗ 초록 — 이 변이를 아무도 못 잡는다`); process.exitCode = 1 }
}
console.log(`\n변이 ${caught}/${TARGETS.length} 빨강(의도한 단언)`)
if (caught !== TARGETS.length) process.exitCode = 1
