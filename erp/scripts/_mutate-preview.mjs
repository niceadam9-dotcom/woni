/** 변이 프로브 — `test-fire-plan-preview.mts`가 **실제로 무는지** 증명한다.
 *
 *  리더는 「그럴듯하게 틀리기」가 쉬운 부류다(테두리를 전부 none으로 읽어도 SheetJS 교차검증은
 *  초록이다 — 그쪽이 테두리를 모르니까). 그래서 축마다 하나씩 망가뜨려 **각각 다른 단언이**
 *  잡는지 본다.
 *
 *  🚨 치환 0건은 **실패로 친다**(CRLF·따옴표 차이로 조용히 안 바뀌면 「변이했는데 초록」이 된다).
 *
 *  실행: node scripts/_mutate-preview.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const READER = resolve(HERE, '../src/lib/xlsx-read-sheet.ts')
const TEST = resolve(HERE, 'test-fire-plan-preview.mts')
const ANCHORS = resolve(HERE, '../src/lib/fire-plan-anchors.ts')
const VALUES = resolve(HERE, '../src/lib/fire-plan-xlsx-values.ts')

const MUTANTS = [
  ['M1 테두리를 전부 none으로 읽는다 → [2]·[5]가 빨강이어야 (SheetJS는 이 축을 모른다)',
    READER, `    return (st?.[1] as BorderKind) ?? 'none'`, `    return 'none'`, 1],
  ['M2 채움을 늘 null로 읽는다 → [2]·[5]가 빨강이어야',
    READER, `  if (!/patternType="solid"/.test(xml)) return null`, `  return null\n  if (!/patternType="solid"/.test(xml)) return null`, 1],
  ['M3 병합을 안 읽는다 → [1]·[2]가 빨강이어야',
    READER, `  const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1])`,
    `  const merges: string[] = []`, 1],
  ['M4 열 번호를 한 칸 민다 → [1]이 빨강이어야',
    READER, `  return n - 1`, `  return n`, 1],
  ['M5 xml 실체 참조를 안 푼다 → [2] 글자 단언이 빨강이어야(픽스처에 <&>가 있다)',
    READER, `        text: t ? unescXml(t[1]) : '',`, `        text: t ? t[1] : '',`, 1],
  ['M6 덮인 칸 표식을 안 세운다 → [2] covered/span 단언이 빨강이어야',
    READER, `        covered.set(\`\${r}:\${c}\`, a)`, `        void a`, 1],
  ['M7 행 높이를 늘 0으로 읽는다 → [1]·[2]가 빨강이어야',
    READER, `    rowHeights[r] = Number(/ht="([\\d.]+)"/.exec(attrs)?.[1] ?? 0)`, `    rowHeights[r] = 0`, 1],
  ['M8 정렬을 늘 center로 읽는다 → [2]·[5]가 빨강이어야',
    READER, `    const align = (/horizontal="(left|center|right)"/.exec(xf)?.[1] as HAlign) ?? 'left'`,
    `    const align = 'center' as HAlign`, 1],
  /* 🚨 M9는 **리더가 아니라 제품의 유혹**을 겨눈다. 1.13의 「남는 열에 남는 값을 넣기」가
   *   실제로 잡히는지 — 시공업체를 「작업책임자」 칸에 배선해 본다. [13]의 음성 단언이
   *   물지 않으면 이 규약은 주석일 뿐이다. */
  ['M9 시공업체를 「작업책임자」 칸에 넣는다 → [13] 음성 단언이 빨강이어야',
    ANCHORS, `  ['AP', 'note', 'AP2'],`, `  ['X', 'company', 'X2'],\n  ['AP', 'note', 'AP2'],`, 1],
  /* 🚨 M10 — 3.3의 유혹. 「평일 주간」을 「근무」 칸에 넣으면 시간대가 인원 구분으로 둔갑한다. */
  ['M10 평일 인원을 3.3 「근무」 칸에 넣는다 → [14] 음성 단언이 빨강이어야',
    ANCHORS, `  ['AO', 'company', 'AO4'], // 관리주체(입주사)`,
    `  ['AA', 'weekday', 'AA5'],\n  ['AO', 'company', 'AO4'], // 관리주체(입주사)`, 1],
  /* 🎯 M11 — 이 시트의 **핵심 계약**. 3.3만 제 계산을 하게 **갈라뜨린다**.
   *   ⚠ `zoneRowValues` 자체를 고치면 두 시트가 **함께** 바뀌어 항등이 안 물린다 — 그게 바로
   *     공유의 목적이다. 그래서 변이는 공유를 **깨는** 쪽이어야 한다. */
  ['M11 3.3만 제 계산을 한다(공유를 깬다) → [14] D-7 항등이 빨강이어야',
    VALUES,
    'Object.entries(zoneRowValues(zones[i]))) v.set(`evac3_',
    'Object.entries({ ...zoneRowValues(zones[i]), usage: txt(zones[i]?.name) })) v.set(`evac3_', 1],
  /* M12 — 공유 함수를 고치면 **두 시트가 같이** 바뀐다. 항등은 초록이고(설계대로),
   *   값 단언이 잡아야 한다. 「같기만 하면 통과」가 아님을 증명한다. */
  ['M12 공유 계산에서 용도 변환을 뺀다 → [14] 「빈 채로 일치한 게 아니다」가 빨강이어야',
    VALUES, `    usage: purposeShort(z?.name),`, `    usage: txt(z?.name),`, 1],
  /* 🎯 M13 — 1.9가 2.2와 **같은 사람**을 뽑는가. 대장 판정을 갈라뜨린다. */
  ['M13 1.9만 대장을 다르게 뽑는다(공유를 깬다) → [15] 「2.2와 같다」가 빨강이어야',
    VALUES, `  put9('brig9_lead', lead)`, `  put9('brig9_lead', fieldTeam[0])`, 1],
  /* 🚨 M14 — 「모르는 것을 안 켠다」. 해당없음을 편성표 유무로 켜 보면 [15] 음성이 물어야. */
  ['M14 편성표가 있으면 「해당없음」도 켠다 → [15] 음성 단언이 빨강이어야',
    ANCHORS, `  { field: 'brig9_running', sheet: BRIG9_SHEET, cell: BRIG9_RUNNING_CELL, labelCell: BRIG9_RUNNING_CELL },`,
    `  { field: 'brig9_running', sheet: BRIG9_SHEET, cell: 'Y2', labelCell: 'Y2' },`, 1],
  /* 🚨 M15 — 어간을 안 떼면 `비상연락반`이 제 줄을 못 찾는다(2.1·1.9가 함께 쓰는 술어). */
  ['M15 팀 이름 꼬리를 안 뗀다 → [15] 「비상연락반이 제 줄에」가 빨강이어야',
    VALUES, `const teamStem = (s: string | undefined) => txt(s).replace(/[팀반]$/, '')`,
    `const teamStem = (s: string | undefined) => txt(s)`, 1],
  /* 🚨 M16 — 각괄호 상자의 **폭**. `[  ]`를 `[√]`로 줄이면 뒤 자구가 밀린다(칸이 좁다). */
  ['M16 각괄호 폭을 줄인다 → [16] 「폭이 유지된다」가 빨강이어야',
    VALUES, "return tpl.replace(/\\[(\\s+)\\]/, (_m, sp: string) => `[√${sp.slice(1)}]`)",
    "return tpl.replace(/\\[\\s+\\]/, '[√]')", 1],
  /* 🚨 M17 — 이 양식의 표시는 `■`가 아니라 `√`다(시트가 스스로 적어 놓았다). */
  ['M17 각괄호에 ■를 찍는다 → [16] 「■를 쓰지 않았다」가 빨강이어야',
    VALUES, '`[√${sp.slice(1)}]`', '`[■${sp.slice(1)}]`', 1],
  /* 🎯 M18 — 2.14가 제 값을 만들면(선임일자 표기를 달리) 1.7.1과 갈라진다. */
  ['M18 2.14만 선임일자 표기를 달리한다 → [16] 항등이 빨강이어야',
    VALUES, `  v.set('rec14_mgr_date', planDate(d.managerSelectedAt))`,
    `  v.set('rec14_mgr_date', txt(d.managerSelectedAt))`, 1],
  /* 🎯 M19 — 이 시트의 **핵심 계약**. 확인 칸을 배선하면 참석을 단언하게 된다. */
  ['M19 참석확인 칸을 배선한다 → [17] 핵심 음성이 빨강이어야',
    ANCHORS, `      { field: \`att14_\${n}_name\`, sheet: ATT14_SHEET, cell: \`\${colName}\${row}\`, labelCell },`,
    `      { field: \`att14_\${n}_name\`, sheet: ATT14_SHEET, cell: \`\${colName}\${row}\`, labelCell },\n      { field: \`att14_\${n}_role2\`, sheet: ATT14_SHEET, cell: \`\${c ? 'BA' : 'W'}\${row}\`, labelCell },`, 1],
  /* 🚨 M20 — 두 단이 안 이어지면 명단이 25명에서 조용히 끊긴다. */
  ['M20 오른쪽 단도 0번부터 센다 → [17] 「단이 이어진다」가 빨강이어야',
    ANCHORS, `    const n = c * ATT14_ROWS + i`, `    const n = i`, 1],
  /* 🚨 M21 — 직책에 개별임무를 넣는다(1.13 「남는 열」과 같은 유혹). */
  ['M21 직책 칸에 개별임무를 넣는다 → [17] 음성 단언이 빨강이어야',
    VALUES, "    v.set(`att14_${i}_role`, txt(m?.team))", "    v.set(`att14_${i}_role`, txt(m?.duty))", 1],
  /* 🎯 M22 — 3.5의 핵심. 물러나지 않고 **조각만** 넣으면 `로비`가 조용히 사라진다. */
  ['M22 구역을 조각만 넣는다(물러나지 않는다) → [18] 「둘 다 비었다」가 빨강이어야',
    VALUES, `    else return null          // 해석 못 한 토큰이 하나라도 있으면 통째로 물러난다`,
    `    else continue`, 1],
  /* 🚨 M23 — 「해당없음」인데 상자를 켠다(없는 사실을 지어내기). */
  ['M23 해당없음을 무시하고 상자를 켠다 → [18] 음성 단언이 빨강이어야',
    VALUES, `  const vulCount = (t: string, k: 'work' | 'use') => (vulNone ? '' : txt(vul?.counts?.[t]?.[k]))`,
    `  const vulCount = (t: string, k: 'work' | 'use') => txt(vul?.counts?.[t]?.[k])`, 1],
  /* 🎯 M24 — 1.9가 3.5와 **다른 행**을 집으면(공유를 깬다) 두 시트가 갈라진다. */
  ['M24 1.9만 다른 행을 집는다(공유를 깬다) → [19] D-7 항등이 빨강이어야',
    VALUES, `    v.set(\`vul9_\${i}_type\`, txt(p?.type))`, `    v.set(\`vul9_\${i}_type\`, txt(vulPlans[i + 1]?.type))`, 1],
  /* 🚨 M25 — 1.9 성명 칸에 유형을 넣는다(축 없는 칸을 남는 값으로 채우는 유혹). */
  ['M25 1.9 성명 칸을 배선한다 → [19] 음성 단언이 빨강이어야',
    ANCHORS, `  ['N', 'type', 'N21'],    // 피난약자 유형`,
    `  ['A', 'type2', 'A21'],\n  ['N', 'type', 'N21'],    // 피난약자 유형`, 1],
  /* 🎯 M26 — **아홉째 갈래가 은신처가 되지 않는가.** 선언만 해 두고 값을 안 넣으면
   *   백지 불변식은 초록인데 칸은 영영 예시문이다. [20] ①이 물어야 한다. */
  ['M26 예시문칸을 선언만 하고 값을 안 넣는다 → [20] 「덮인다」가 빨강이어야',
    VALUES, `  v.set('evac34_false_alarm', placeholderCell(EVAC34_SHEET, 'G4', d.evacFalseAlarm))`,
    `  v.set('evac34_false_alarm', placeholderCell(EVAC34_SHEET, 'G4', ''))`, 1],
  /* 🚨 M27 — 반대 방향. 값이 없을 때 예시를 지워 버리면 빈 서식이 뜻을 잃는다. */
  ['M27 값이 없을 때 예시를 지운다 → [20] 「예시가 남는다」가 빨강이어야',
    VALUES, `  v.set('evac34_assembly', placeholderCell(EVAC34_SHEET, 'T13', assembly34))`,
    `  v.set('evac34_assembly', assembly34)`, 1],
  /* 🚨 M28 — 집결지를 한 칸만 고친다(한 장 안에서 갈라진다). */
  ['M28 집결지를 경로표에만 넣는다 → [20] 「두 칸이 서로 같다」가 빨강이어야',
    VALUES, `  v.set('evac34_assembly_row', placeholderCell(EVAC34_SHEET, 'AT10', assembly34))`,
    `  v.set('evac34_assembly_row', placeholderCell(EVAC34_SHEET, 'AT10', ''))`, 1],
  /* 🚨 M29 — 3.6 유형을 라벨이 아니라 **손목록**에서 읽으면 순서가 어긋나도 모른다. */
  ['M29 3.6 유형 순서를 뒤집는다 → [21] 「라벨과 같다」가 빨강이어야',
    ANCHORS, `  ['A3', 'K3'], ['A4', 'K4'], ['A5', 'K5'], ['A6', 'K6'],`,
    `  ['A3', 'K6'], ['A4', 'K5'], ['A5', 'K4'], ['A6', 'K3'],`, 1],
  /* 🚨 M30 — 양식 4종 밖 유형을 세지 않으면 영유아·기타가 조용히 사라진다. */
  ['M30 갈 줄 없는 유형을 안 센다 → [21] 계수 단언이 빨강이어야',
    VALUES, `  return Object.keys(m).filter(t => txt(m[t]) && !VUL36_TYPES.includes(t))`,
    `  return []`, 1],
]

/** 🚨 파일의 줄끝에 맞춰 needle을 바꾼다.
 *
 *  리베이스·stash 복원이 git autocrlf로 파일을 **CRLF**로 되돌려 놓으면 개행이 든 패턴이
 *  **0건 치환**된다. 가드가 「변이가 안 돌았다」로 잡아 주긴 했지만, 매번 손으로 고칠 일이
 *  아니라 프로브가 알아서 맞춰야 한다 — 이 저장소가 CRLF 함정에 **네 번째** 빠진 자리다.
 */
const NL = String.fromCharCode(10)
const CRNL = String.fromCharCode(13, 10)
const eolFit = (src, s) => (src.includes(CRNL) ? s.split(NL).join(CRNL) : s)

const runTest = () => {
  try { execFileSync('npx', ['tsx', TEST], { cwd: resolve(HERE, '..'), stdio: 'pipe', shell: true }); return 0 }
  catch (e) { return e.status ?? 1 }
}

const base = runTest()
console.log(`대조군(무변이): exit ${base} ${base === 0 ? '✔ 초록' : '✘ 이미 빨강 — 변이 결과를 못 믿는다'}`)
if (base !== 0) process.exit(1)

let caught = 0
for (const [label, file, find, repl, expectHits] of MUTANTS) {
  const orig = readFileSync(file, 'utf8')
  const needle = eolFit(orig, find)
  const hits = orig.split(needle).length - 1
  if (hits !== expectHits) {
    console.log(`  ✘ ${label}\n      🚨 치환 대상 ${hits}건(기대 ${expectHits}) — 변이가 안 돌았다. 실패로 친다`)
    continue
  }
  writeFileSync(file, orig.split(needle).join(eolFit(orig, repl)), 'utf8')
  const code = runTest()
  writeFileSync(file, orig, 'utf8')
  if (code !== 0) caught++
  console.log(`  ${code !== 0 ? '✔' : '✘'} ${label}  (exit ${code})`)
}

console.log(`\n=== 변이 ${caught}/${MUTANTS.length} 잡음 ===`)
process.exit(caught === MUTANTS.length ? 0 : 1)
