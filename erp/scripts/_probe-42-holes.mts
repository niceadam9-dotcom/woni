/** 소방계획서_42 — ①씨앗 구멍 배선용 자산 격자 ②표본 답 잔재 재탐지.
 *
 *  ① manifest는 **글자가 있는 칸만** 담는다. 앵커를 세우려면 '비어 있는 칸'의 좌표가 필요하므로
 *     자산 sheet XML을 직접 읽어 전 셀(빈 칸 포함)과 병합을 격자로 찍는다.
 *  ② F-14(강순기 대조가 잡은 표본 답 7칸)와 **같은 부류**를 규칙으로 다시 훑는다.
 *     강순기 대조는 '두 문서 값이 다르면 값 칸'이라 **두 문서가 같은 답을 쓴 칸은 못 본다**.
 *     여기서는 다른 축을 쓴다 — **형제 칸은 비어 있는데 이 칸만 내용을 이고 있는가**.
 *
 *  ⚠ 산출은 %TEMP% 로만 쓴다(R-2).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out: string[] = []

const colOf = (ref: string) => /^([A-Z]+)/.exec(ref)?.[1] ?? ''

/* ══════════════ ① 자산 격자 ══════════════ */

const bytes = readFileSync(join(ROOT, 'templates', 'fire-plan-workbook.xlsx'))
const zip = await JSZip.loadAsync(bytes)

const wb = await zip.file('xl/workbook.xml')!.async('string')
const wbRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map<string, string>()
for (const m of wbRels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap.set(m[1], m[2])
const sheetFile = new Map<string, string>()
for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) {
  sheetFile.set(m[1].replace(/&amp;/g, '&'), relMap.get(m[2]) ?? '')
}

const GRID_TARGETS = (process.env.FP_SHEETS ?? '1.1 건축물 일반현황|1.2.1 구역별 세부현황|1.15 피해 복구').split('|')

for (const name of GRID_TARGETS) {
  const target = sheetFile.get(name)
  if (!target) { out.push(`\n### ${name} — workbook.xml 에 없음`); continue }
  const xml = await zip.file(`xl/${target.replace(/^\/?xl\//, '')}`)!.async('string')
  out.push(`\n${'='.repeat(84)}\n### [격자] ${name}   (${target})\n${'='.repeat(84)}`)

  const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map(m => m[1])
  out.push(`병합 ${merges.length}개: ${merges.join(' ')}`)
  out.push('')

  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNo = rm[1]
    const cells: string[] = []
    for (const cm of rm[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cm[1]
      const inner = cm[4] ?? ''
      const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1]
      const val = t === undefined ? '' : t.replace(/&#10;/g, '\\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      cells.push(`${colOf(ref)}=${val === '' ? '·' : JSON.stringify(val)}`)
    }
    out.push(`  r${rowNo.padStart(2)}  ${cells.join('  ')}`)
  }
}

/* ══════════════ ② 표본 답 잔재 — 형제 축 ══════════════ */

out.push(`\n\n${'='.repeat(84)}\n### [잔재 재탐지] 형제 칸은 비었는데 혼자 내용을 이고 있는 칸\n${'='.repeat(84)}`)
out.push('규칙 A — 「상자 라벨 + 단위 칸」 계열에서 단위 앞에 숫자가 붙은 칸')
out.push('규칙 B — 괄호/대괄호 안이 비어 있지 않은 라벨 칸')
out.push('두 규칙 다 손목록이 아니라 문서 전체에 같은 식을 적용한다.\n')

const UNIT_RE = /^\s*(\d[\d,.]*)\s*(명|대|개소|㎡|천원|원|층|m|회)\s*$/
const PAREN_RE = /[(（[]([^)）\]]*)[)）\]]/g

let hitA = 0, hitB = 0
for (const s of FIRE_PLAN_MANIFEST.sheets) {
  // 규칙 A: 같은 시트에서 '단위만 든 칸'이 존재하는 단위에 대해, '숫자+같은 단위' 칸을 잡는다
  const bareUnits = new Set<string>()
  for (const v of Object.values(s.labels)) {
    const m = /^\s*(명|대|개소|㎡|천원|원|층|m|회)\s*$/.exec(v)
    if (m) bareUnits.add(m[1])
  }
  for (const [ref, v] of Object.entries(s.labels)) {
    const m = UNIT_RE.exec(v)
    if (m && bareUnits.has(m[2])) {
      out.push(`  [A] ${s.name}!${ref}  =${JSON.stringify(v)}   ← 같은 시트에 빈 "${m[2]}" 칸이 있다`)
      hitA++
    }
  }
  // 규칙 B: 괄호 안이 채워진 라벨
  for (const [ref, v] of Object.entries(s.labels)) {
    for (const pm of v.matchAll(PAREN_RE)) {
      const inside = pm[1]
      if (inside.trim() === '') continue
      if (/^[\s\d.,·\-~]*$/.test(inside)) continue          // 번호·기호만이면 서식이다
      if (/^(입주사|연락처|관리부서|바닥|주간\/야간|관계인 기록할 사항|책임자|월|일|년|명|대|개소)/.test(inside.trim())) continue
      out.push(`  [B] ${s.name}!${ref}  괄호안=${JSON.stringify(inside)}   전문=${JSON.stringify(v.slice(0, 60))}`)
      hitB++
    }
  }
}
out.push(`\n규칙 A ${hitA}건 · 규칙 B ${hitB}건`)

const dest = join(process.env.TEMP ?? '.', '_probe-42-holes.txt')
writeFileSync(dest, out.join('\n'), 'utf8')
console.log(`wrote ${dest}  (규칙A ${hitA} · 규칙B ${hitB})`)
