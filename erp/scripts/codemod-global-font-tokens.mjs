// px 리터럴 크기 → 배율 토큰 (2026-09-07) — 개인설정 [화면 글자 크기]를 앱 전 화면으로.
//
// 배경: globals.css의 @theme inline이 Tailwind 기본 text-xs~3xl에 --fs-scale을 곱하면서
//   저장소 대부분이 자동으로 배율을 타게 됐다. 남은 구멍이 **임의값 리터럴**이다 —
//   `text-[11px]`은 @theme 축 밖이라 배율을 하나도 안 탄다. 실측(_probe-global-fs)에서
//   고객 목록이 48%에 멈춰 있던 정체가 이것이었다(같은 리터럴이 행마다 반복돼 수백 노드).
//
// 매핑은 소방계획서_35 토큰 그대로다 — 크기가 **함께 오른다**(9→11 · 10→12 · 11→13).
//   항등이 아니라 상향이므로 md 사용자에게도 보인다. 35·고객상세·달력이 모두 이 값으로
//   갔으므로 여기서 다른 값을 쓰면 같은 글자가 화면마다 달라진다.
//
// ⚠ **--undo를 두지 않았다.** 처음엔 넣었는데 dry run이 596이 아니라 **905곳**을 되돌리겠다고
//   보고했다 — 역방향 정규식이 내가 만든 토큰과 소방계획서_35·고객상세 코드모드가 **이미**
//   심어 둔 토큰을 구별하지 못하기 때문이다(text-form-xs는 양쪽 다 쓴다). 그대로 뒀으면
//   "되돌리기"가 서식 471곳까지 px로 되돌려 놓았을 것이다.
//   되돌리려면 git을 쓸 것: `git checkout -- <파일>`. 이 코드모드는 **단방향**이다.
// ⚠ 공유 작업트리 규약: 타 세션이 편집 중인 파일은 SKIP에 적어 **건드리지 않는다**.
//   남의 미커밋 위에 코드모드를 돌리면 그쪽 변경과 뒤엉켜 헌크 분리가 불가능해진다.
//
// 실행: node scripts/codemod-global-font-tokens.mjs [--dry]
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const MAP = [
  ['text-[9px]',  'text-form-3xs'],   //  9 → 11
  ['text-[10px]', 'text-form-2xs'],   // 10 → 12
  ['text-[11px]', 'text-form-xs'],    // 11 → 13
]

/** 타 세션 미커밋 파일 (2026-09-07 git status 실측). 커밋되면 이 목록을 비우고 재실행할 것. */
const SKIP = new Set([
  'src/app/(dashboard)/inspections/[id]/sheet/page.tsx',
  'src/app/(dashboard)/inspections/[id]/workbook/route.ts',
  'src/app/(dashboard)/inspections/sheet-actions.ts',
  'src/components/customers/customer-assets-client.tsx',
  'src/components/customers/plan-form14-specs.tsx',
  'src/components/inspections/inspection-defects-client.tsx',
  'src/components/inspections/inspection-sheet-client.tsx',
  'src/components/inspections/sheet-entry-client.tsx',
  'src/components/inspections/sheet-item-editor.tsx',
])

if (process.argv.includes('--undo')) {
  console.error('--undo는 없다(머리 주석 참조): 역방향은 35·고객상세 코드모드의 토큰까지 되돌린다. git을 쓸 것.')
  process.exit(2)
}
const dry = process.argv.includes('--dry')
const SRC = join(process.cwd(), 'src')

const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? walk(p) : (/\.tsx?$/.test(n) ? [p] : [])
})

let touched = 0, total = 0, skipped = 0
const per = Object.fromEntries(MAP.map(([a]) => [a, 0]))

for (const file of walk(SRC)) {
  const key = relative(process.cwd(), file).replace(/\\/g, '/')
  if (SKIP.has(key)) { skipped++; continue }
  const src = readFileSync(file, 'utf8')
  let out = src, n = 0
  for (const [a, b] of MAP) {
    const re = new RegExp(`${a.replace(/[[\]]/g, m => '\\' + m)}(?![\\w-])`, 'g')
    const hits = (out.match(re) ?? []).length
    if (hits) { out = out.replace(re, b); n += hits; per[a] += hits }
  }
  if (n && !dry) writeFileSync(file, out)
  if (n) { touched++; total += n }
}

console.log(`치환${dry ? '(dry)' : ''}: ${total}곳 / ${touched}파일 · 건너뜀 ${skipped}파일(타 세션)`)
for (const [k, v] of Object.entries(per)) console.log(`  ${k.padEnd(14)} ${v}`)
