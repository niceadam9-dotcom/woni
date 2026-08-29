/** 소방계획서_35 S2 — 소방계획서 화면 16파일의 글자 크기 클래스를 시맨틱 토큰으로 치환.
 *
 *  ⭐ 이 코드모드는 **항등(identity)** 이다. globals.css의 --fs-* 초기값이 구 값과 같으므로
 *     치환 전후 화면의 computed font-size가 **하나도 달라지지 않는다**. 그게 수용 기준이고,
 *     test-plan-readability --identity 가 기계로 증명한다.
 *     확대는 그 다음 단계(S3)에서 CSS 변수 6줄만 올려서 켠다.
 *
 *  왜 컨테이너 상속이나 명시도 덮기가 아닌가:
 *    - 상속: 259곳 전부가 자식에 명시적 font-size 유틸리티를 갖고 있어 도달하지 않는다.
 *    - 명시도 덮기([data-fs] .text-\[11px\]): 'text-[11px]이라는 문자열이 곧 의미'인
 *      암묵 결합을 만든다. 새로 text-[11.5px]을 쓰면 조용히 배율에서 빠지고, 남의 화면
 *      코드를 복사해 오면 의도치 않게 커진다. 무엇보다 **치환과 확대를 분리할 수 없어**
 *      위의 항등 증명이 불가능하다.
 *
 *  매핑은 전단사다 — --undo로 정확히 되돌아간다.
 *
 *  실행:
 *    node scripts/codemod-35-font-tokens.mjs --dry-run
 *    node scripts/codemod-35-font-tokens.mjs
 *    node scripts/codemod-35-font-tokens.mjs --undo
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const UNDO = argv.includes('--undo')

const DIR = 'src/components/customers'
/** 소방계획서 탭이 실제로 그리는 화면 — plan-form* 12개가 아니라 **16개**다.
 *  1.1·2장·3장·목차 트리가 별도 파일이라, 12개만 고치면 목차를 옮길 때마다 크기가 어긋난다. */
const FILES = [
  'plan-form-cover.tsx', 'plan-form110.tsx', 'plan-form111.tsx', 'plan-form12.tsx',
  'plan-form1215.tsx', 'plan-form13.tsx', 'plan-form14.tsx', 'plan-form14-specs.tsx',
  'plan-form15.tsx', 'plan-form16.tsx', 'plan-form17.tsx', 'plan-form18.tsx',
  'fire-plan-info-panel.tsx', 'plan-ch2.tsx', 'plan-ch3.tsx', 'plan-tab-view.tsx',
].map(f => join(DIR, f))

const MAP = [
  ['text-[9px]',  'text-form-3xs'],
  ['text-[10px]', 'text-form-2xs'],
  ['text-[11px]', 'text-form-xs'],
  ['text-xs',     'text-form-sm'],
  ['text-sm',     'text-form-base'],
  ['text-base',   'text-form-lg'],
  ['h-6',         'h-form-6'],
  ['h-7',         'h-form-7'],
  ['h-8',         'h-form-8'],
]
// text-2xl(표지 제목 1건)은 대상이 아니다 — 서식 본문 크기 축이 아니라 문서 제목이다.

/** 클래스 경계. `!text-xs`(important)도 잡고, `text-xs-foo`·`bg-text-xs` 같은 오탐은 막는다.
 *  §2-2 실측: 대상 16파일의 폰트 크기 클래스에 변형 접두사(sm:/print:/hover:)는 0건이라
 *  순수 문자열 치환이 안전하다. (dark:는 색상에만 붙어 있어 이 축과 무관) */
function boundary(token) {
  return new RegExp(`(?<![\\w-])(!?)${token.replace(/[[\]]/g, '\\$&')}(?![\\w-])`, 'g')
}

let totalHits = 0
const missing = []
const perFile = []

for (const f of FILES) {
  if (!existsSync(f)) { missing.push(f); continue }
  let src = readFileSync(f, 'utf8')
  const before = src
  let hits = 0
  for (const [oldC, newC] of MAP) {
    const [from, to] = UNDO ? [newC, oldC] : [oldC, newC]
    src = src.replace(boundary(from), (_m, bang) => { hits++; return `${bang}${to}` })
  }
  totalHits += hits
  perFile.push({ f, hits, changed: src !== before })
  if (!DRY && src !== before) writeFileSync(f, src, 'utf8')
}

// ── 보고 ──────────────────────────────────────────────────────────────────────
console.log(`${UNDO ? '되돌리기' : '치환'}${DRY ? ' (dry-run)' : ''} — 대상 ${FILES.length}파일\n`)
for (const p of perFile) console.log(`  ${String(p.hits).padStart(4)}  ${p.f}`)
console.log(`\n합계 ${totalHits}곳`)

// ⚠ 항진 차단 — 파일 목록이 비면 0곳이라 "성공"으로 보인다.
if (missing.length) {
  console.log(`\n❌ 못 찾은 파일 ${missing.length}개: ${missing.join(', ')}`)
  console.log('   범위 전제(16파일)가 깨졌다 — 타 세션이 파일을 옮겼는지 확인할 것')
  process.exit(1)
}
if (perFile.length !== 16) {
  console.log(`\n❌ 스캔한 파일이 ${perFile.length}개 — 16개여야 한다`)
  process.exit(1)
}
if (totalHits === 0) {
  console.log(`\n${UNDO ? '되돌릴' : '치환할'} 것이 없다 (이미 적용된 상태로 보인다)`)
}
process.exitCode = 0
