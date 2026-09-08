/** 앵커 69개를 매니페스트 토큰에서 **파생할 수 있는가** — Q-9 2번 갈래의 실현 가능성 실측.
 *
 *  앵커 파일은 좌표를 손으로 들고 있다. 그것을 매니페스트 파생으로 바꾸면 격자 교체가 싸진다.
 *  다만 앵커 파일 스스로가 「자동 생성만으로는 나올 수 없는 앵커」가 있다고 적어 뒀다
 *  (씨앗의 `{{owner_phone}}`을 `manager_phone`으로 **고쳤다**). 그 규모를 센다.
 *
 *  판정: 앵커의 (sheet, cell)에 매니페스트가 **같은 이름의 토큰**을 갖고 있는가.
 *   · 있으면 → 파생 가능
 *   · 토큰이 없으면 → 라벨 축으로 사람이 세운 자리(파생 불가)
 *   · 토큰이 있는데 **이름이 다르면** → 사람이 고친 자리(파생하면 **회귀**)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json'), 'utf8')) as {
  sheets: Array<{ name: string; tokenCells?: Record<string, string>; labels?: Record<string, string>; boxes?: Record<string, string> }>
}
const bySheet = new Map(manifest.sheets.map(s => [s.name, s]))

/* 앵커 파일에서 (field, sheet, cell)을 뽑는다 — 소스를 파싱한다(런타임 import는 manifest 검증이 걸린다) */
const src = readFileSync(resolve(HERE, '../src/lib/fire-plan-anchors.ts'), 'utf8')
const sheetConst = new Map<string, string>()
for (const m of src.matchAll(/(\w+):\s*'([^']+)',/g)) sheetConst.set(m[1], m[2])

const rows = [...src.matchAll(/\{\s*field:\s*'([^']+)',\s*sheet:\s*(?:FP_SHEET\.(\w+)|'([^']+)'),\s*cell:\s*'([^']+)'/g)]
  .map(m => ({ field: m[1], sheet: m[2] ? (sheetConst.get(m[2]) ?? m[2]) : m[3], cell: m[4] }))
console.log(`앵커 ${rows.length}개 추출\n`)

let derivable = 0, noToken = 0, mismatched = 0
const noTokenList: string[] = [], mismatchList: string[] = []
for (const r of rows) {
  const sh = bySheet.get(r.sheet)
  const tok = sh?.tokenCells?.[r.cell]
  if (!tok) { noToken++; noTokenList.push(`${r.sheet}!${r.cell} ← ${r.field}`); continue }
  const names = [...tok.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1])
  if (names.includes(r.field)) derivable++
  else { mismatched++; mismatchList.push(`${r.sheet}!${r.cell}: 앵커=${r.field} vs 양식토큰=${names.join(',') || '(없음)'}`) }
}

console.log(`✅ 토큰에서 그대로 파생 가능   ${derivable}`)
console.log(`⚠ 양식에 토큰이 없다(사람이 라벨 축으로 세운 자리)  ${noToken}`)
console.log(`🚨 토큰이 있는데 이름이 다르다(사람이 고친 자리)     ${mismatched}`)
if (mismatchList.length) { console.log('\n— 고친 자리 —'); mismatchList.forEach(l => console.log('   ' + l)) }
if (noTokenList.length) { console.log(`\n— 토큰 없는 자리 ${noTokenList.length}개 (앞 20) —`); noTokenList.slice(0, 20).forEach(l => console.log('   ' + l)) }

console.log(`\n→ 판정: 파생만으로 세울 수 있는 앵커는 ${derivable}/${rows.length}`)
console.log(`   나머지 ${noToken + mismatched}개는 **사람의 판단이 들어간 자리**라 파생으로 바꾸면 그 판단이 사라진다`)
