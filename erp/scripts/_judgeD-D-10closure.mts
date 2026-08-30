/** 판정자 D — D10(a) '앵커 누락 0건' 역방향 폐포:
 *  buildWorkbookValues가 만드는 키 중 **앵커가 없는 것**(=조용히 버려지는 값)을 찾는다.
 *  toInjectTargets는 앵커를 돌기 때문에 값만 있고 앵커가 없으면 아무 경고 없이 사라진다. */
import fs from 'node:fs'
import path from 'node:path'
import { ANCHORS } from '../src/lib/xlsx-anchors.ts'

const OUT = path.resolve(process.cwd(), 'scripts/_out/_judgeD-D10closure.txt')
const L: string[] = []
const say = (s: string) => L.push(s)

const src = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/xlsx-workbook.ts'), 'utf8')

// 값 맵 구성부의 키: ['fieldName', ...] / [`assist${n}Name`, ...] 두 형태
const literalKeys = new Set<string>()
for (const m of src.matchAll(/\[\s*'([A-Za-z][A-Za-z0-9_]*)'\s*,/g)) literalKeys.add(m[1])
const templKeys = [...src.matchAll(/\[\s*`([^`]+)`\s*,/g)].map(m => m[1])

const anchorFields = new Set(ANCHORS.map(a => a.field))
say(`ANCHORS ${ANCHORS.length} · unique fields ${anchorFields.size}`)
say(`xlsx-workbook.ts literal value keys ${literalKeys.size} · template keys ${templKeys.length}: ${templKeys.join(' ')}`)

const valuesNoAnchor = [...literalKeys].filter(k => !anchorFields.has(k)).sort()
const anchorsNoLiteral = [...anchorFields].filter(k => !literalKeys.has(k) && !/^assist\d/.test(k)).sort()
say('')
say(`VALUE KEY WITHOUT ANCHOR (조용히 버려질 후보) ${valuesNoAnchor.length}:`)
for (const k of valuesNoAnchor) say('  ' + k)
say('')
say(`ANCHOR FIELD WITHOUT LITERAL KEY (템플릿 키·동적 생성 가능) ${anchorsNoLiteral.length}:`)
for (const k of anchorsNoLiteral) say('  ' + k)

// 앵커 좌표 중복 — 두 필드가 같은 칸을 노리면 뒤가 이긴다(조용한 덮어쓰기)
const byCell = new Map<string, string[]>()
for (const a of ANCHORS) {
  const k = `${a.sheet}!${a.cell}`
  byCell.set(k, [...(byCell.get(k) ?? []), a.field])
}
say('')
const dupCell = [...byCell].filter(([, v]) => v.length > 1)
say(`ANCHOR CELL COLLISIONS ${dupCell.length}`)
for (const [k, v] of dupCell) say(`  ${k} <- ${v.join(', ')}`)

// 앵커 필드 중복
const byField = new Map<string, number>()
for (const a of ANCHORS) byField.set(a.field, (byField.get(a.field) ?? 0) + 1)
const dupField = [...byField].filter(([, n]) => n > 1)
say(`ANCHOR FIELD DUPLICATES ${dupField.length}: ${dupField.map(([k, n]) => `${k}x${n}`).join(' ')}`)

// 시트별 앵커 분포
const bySheet = new Map<string, number>()
for (const a of ANCHORS) bySheet.set(a.sheet, (bySheet.get(a.sheet) ?? 0) + 1)
say('')
say('ANCHORS per sheet: ' + [...bySheet].map(([s, n]) => `${s}:${n}`).join(' '))

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, L.join('\n'), 'utf8')
console.log('wrote ' + OUT + ' lines=' + L.length)
