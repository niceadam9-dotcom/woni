/** 제품 모듈(`applyFirePlanCheckboxes`)이 낸 산출물을 실제 Excel로 검증하기 위한 표본 생성.
 *  시범 스크립트가 아니라 **라우트가 쓰는 그 경로**로 만든다.
 *  기대값에는 좌표를 싣지 않는다 — 위치 판정의 자[尺]는 Excel이 보고하는 칸 사각형이어야지,
 *  내가 방금 쓴 식이면 대조가 성립하지 않는다([[feedback_ruler_changed_between_revisions]]).
 *
 *  2026-09-14 확대: 1.4 한 장이 아니라 **전 워크북**이다. 시트 번호도 함께 실어 보내
 *  PS 쪽이 이름으로 대조하게 한다 — 「8번이 1.4겠지」를 가정하면 서식이 한 장 늘 때 조용히 밀린다.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { applyFirePlanCheckboxes, firePlanCheckboxCells } from '../src/lib/fire-plan-checkbox-controls.ts'
import { FIRE_PLAN_MANIFEST, labelAt } from '../src/lib/fire-plan-xlsx-manifest.ts'

const HERE = import.meta.dirname
const S14 = '1.4 소방시설 현황'
const OUT = path.join(process.env.TEMP ?? '/tmp', 'fireplan-prod.xlsx')

/** 켜 두는 칸 — 1.4에서만 켠다. 「다른 시트로 안 샌다」를 Excel에서도 묻기 위한 배치다. */
const ON = ['J3', 'J5', 'AJ7', 'J13', 'J19', 'AJ19', 'J24']
/** 다중상자 칸의 **몇 번째 상자**를 켤 것인가(2026-09-14). 한 칸 안에서 켜짐·꺼짐이
 *  **상자별로** 갈리는지를 Excel에서 묻는 유일한 표본이다 — 안 켜 두면 그 축이 공허하게 통과한다. */
const ON_MULTI: Record<string, number> = { R16: 2 }   // 1.4!R16 = 「(간이)완강기」(0-based 2번째)

const bytes = new Uint8Array(await readFile(path.join(HERE, '..', 'templates', 'fire-plan-workbook.xlsx')))
/** n번째 상자만 켠 글자를 만든다(0-based) */
const turnOn = (label: string, n: number): string => {
  let k = -1
  return label.replace(/[□☐]/g, g => (++k === n ? '■' : g))
}
const injected = await injectWorkbook(bytes, [
  ...ON.map(cell => ({ sheet: S14, cell, value: turnOn(labelAt(S14, cell), 0) })),
  ...Object.entries(ON_MULTI).map(([cell, n]) => ({ sheet: S14, cell, value: turnOn(labelAt(S14, cell), n) })),
])
if (injected.missed.length) throw new Error(`주입 미착지: ${injected.missed.join(' ')}`)

const res = await applyFirePlanCheckboxes(injected.bytes)
console.log(`applied=${res.applied} skipped=${res.skipped.length} ${res.skipped.join(' ')}`)
await writeFile(OUT, Buffer.from(res.bytes))

const onSet = new Set(ON)
const sheets = FIRE_PLAN_MANIFEST.sheets.map((s, i) => ({
  index: i + 1,                       // Excel Worksheets.Item()은 1-based
  name: s.name,
  cells: firePlanCheckboxCells(s.name).map(c => ({
    ref: c.cell,
    box: c.boxIndex,
    // 🚨 기대 위치는 「칸 왼쪽」이 아니라 **「칸 왼쪽 + 이 상자의 오프셋」**이다(다중상자).
    //   자[尺]는 여전히 Excel이 보고하는 `Range.Left`이고, 우리는 거기에 오프셋만 더한다.
    // 13px = 칸 들여쓰기 보정(제품의 `TEXT_INSET_PX`). 여기 **같은 수를 손으로 적는다** —
    // 제품 상수를 그대로 가져다 쓰면 보정이 통째로 빠져도 양쪽이 함께 틀려 초록이 된다.
    offsetPt: Math.round((c.offsetPx + 13) * 0.75 * 100) / 100,
    // 세로 축(2026-09-16) — 「몇째 줄 / 몇 줄」만 보낸다. 자리를 계산해 보내면 PS가 내 식을
    // 되풀이할 뿐이라 대조가 성립하지 않는다. 자[尺]는 Excel의 `Range.Top`·`Range.Height`다.
    line: c.lineIndex,
    lines: c.lineCount,
    checked: s.name === S14
      && ((c.boxIndex === 0 && onSet.has(c.cell)) || ON_MULTI[c.cell] === c.boxIndex),
    // 🚨 기대 글자 = **주입이 써 넣은 그대로**. 이제 상자를 다른 글자로 갈지 않고 **색만** 칠하므로
    //   체크박스 단계는 칸 값을 한 글자도 안 바꾼다 — 켜진 칸은 주입이 적은 `■`가 그대로 남는다.
    //   「포함하는가」가 아니라 **같은가**를 묻는다(다중상자에서 하나만 처리해도 포함은 통과한다).
    expectText: s.name === S14 && (onSet.has(c.cell) || c.cell in ON_MULTI)
      ? turnOn(labelAt(s.name, c.cell), ON_MULTI[c.cell] ?? 0)
      : labelAt(s.name, c.cell),
    // 이 상자가 라벨의 몇 번째 글자인가(1-based) — Excel에서 **그 글자의 색**을 따져보려고 보낸다
    boxAt: [...labelAt(s.name, c.cell).matchAll(/[□☐]/g)].map(mm => mm.index! + 1)[c.boxIndex],
  })),
})).filter(s => s.cells.length > 0)

const total = sheets.reduce((a, s) => a + s.cells.length, 0)
await writeFile(OUT + '.expect.json', JSON.stringify({
  total, sheetCount: FIRE_PLAN_MANIFEST.sheets.length, sheets,
}, null, 1))
const onCount = sheets.reduce((a, s) => a + s.cells.filter(c => c.checked).length, 0)
const onMulti = sheets.reduce((a, s) => a + s.cells.filter(c => c.checked && c.box > 0).length, 0)
// 🚨 다중상자 켜짐 표본이 0이면 「상자별로 켜짐이 갈리는가」를 Excel이 **한 번도 안 묻는다**
if (!onMulti) throw new Error('다중상자 켜짐 표본 0 — 그 축이 공허하게 통과한다')
console.log(`작성: ${OUT}  (컨트롤 ${total}개 / 시트 ${sheets.length}장 / 켜짐 ${onCount} · 그중 다중상자 ${onMulti})`)
if (total !== res.applied) throw new Error(`기대 ${total} ≠ applied ${res.applied}`)
