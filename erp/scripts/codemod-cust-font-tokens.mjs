/** 고객 상세 화면(/customers/[id])의 글자 크기 클래스를 배율 토큰으로 치환.
 *
 *  왜 필요한가: 소방계획서_35가 **소방계획서 탭 16파일만** 토큰으로 옮겨 확대·배율을 켰다.
 *  같은 고객 화면인데 기본정보·관계인·건물·청구·이력 탭은 그 축 밖이라 혼자 구 값(9~14px)으로
 *  남았다 — 탭을 옮기면 글씨 크기가 바뀐다. 이 코드모드가 그 15파일을 같은 축에 태운다.
 *
 *  ⚠ 35의 codemod-35-font-tokens.mjs를 고치지 않는다. 그쪽은 커밋 4ccda41의 전단사를
 *    **리비전 고정으로 재증명**하는 도구라 FILES를 건드리면 그 증명이 죽는다.
 *
 *  ⚠ 35와 달리 이건 **항등이 아니다**. --fs-* 초기값이 이미 확대된 신 값이므로 치환하는 순간
 *    9/10/11/12/14/16/20px → 11/12/13/14/15/17/21px로 커진다. 그게 이 작업의 목적이다.
 *    되돌리려면 --undo (전단사라 정확히 복원된다).
 *
 *  ⚠ 제목 태그(h1~h6)는 `-title` 변형을 쓴다. 보통 text-form-*은 letter-spacing까지
 *    var(--fs-tracking)으로 덮는데, h1~h6은 -0.02em을 상속하므로 그걸 덮으면 제목 자간이
 *    조용히 바뀐다. 그래서 크기만 배율에 태우는 변형이 따로 있고, 코드모드가 <hN 태그 안인지
 *    보고 자동으로 고른다.
 *
 *  실행:
 *    node scripts/codemod-cust-font-tokens.mjs --dry-run
 *    node scripts/codemod-cust-font-tokens.mjs
 *    node scripts/codemod-cust-font-tokens.mjs --undo
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const UNDO = argv.includes('--undo')

const DIR = 'src/components/customers'
/** 고객 상세가 실제로 그리는 화면 — 소방계획서 탭(plan-*, fire-plan-info-panel)은 **제외**한다.
 *  그쪽은 이미 35가 토큰화했고, 법정 서식이라 인쇄 규격에 묶여 있어 축이 다르다. */
const FILES = [
  'edit-customer-info-client.tsx', 'customer-summary-panel.tsx', 'assign-employee-inline.tsx',
  'edit-contacts-client.tsx', 'fire-safety-manager-panel.tsx', 'edit-inspection-type-client.tsx',
  'fire-plans-client.tsx', 'customer-assets-client.tsx', 'billing-client.tsx',
  'customer-tabs.tsx', 'building-inline-panel.tsx', 'customer-prev-next.tsx',
  'recommend-assign-client.tsx', 'anchor-change-preview.tsx',
].map(f => join(DIR, f))
FILES.push(join('src', 'app', '(dashboard)', 'customers', '[id]', 'page.tsx'))

/** 구 클래스 → 토큰. 값은 globals.css :root의 --fs-* 한 곳에서만 온다. */
const MAP = [
  ['text-[9px]',  'text-form-3xs'],   // 9  → 11
  ['text-[10px]', 'text-form-2xs'],   // 10 → 12
  ['text-[11px]', 'text-form-xs'],    // 11 → 13
  ['text-xs',     'text-form-sm'],    // 12 → 14
  ['text-sm',     'text-form-base'],  // 14 → 15
  ['text-base',   'text-form-lg'],    // 16 → 17
  ['text-xl',     'text-form-xl'],    // 20 → 21
  // 컨트롤 높이 — 글자를 키운 상자는 **함께** 키운다. 안 그러면 배율 lg/xl에서 글자만 자라
  // 입력칸을 뚫는다(35가 --fs-h6 주석에 남긴 계산: 13×1.3×1.5 = 25.4px > 24px).
  // ⚠ 실측으로 범위를 정했다: 이 15파일의 h-7/8/9/10 60곳 중 57곳이 같은 줄에 글자 토큰을
  //   갖고 있고, 나머지 3곳 중 2곳은 주석의 'H-10'(오탐), 1곳은 점검유형 칸의 높이 맞춤
  //   컨테이너라 어차피 형제 입력과 같이 커져야 한다 — 그래서 조건 없이 전건 치환한다.
  ['h-7',  'h-form-7'],   // 28 → 32
  ['h-8',  'h-form-8'],   // 32 → 36
  ['h-9',  'h-form-9'],   // 36 → 40
  ['h-10', 'h-form-10'],  // 40 → 44
]
/** 제목 태그 안에서만 쓰는 변형 — 크기만 배율에 태우고 자간은 상속을 지킨다. */
const TITLE_OF = { 'text-form-lg': 'text-form-lg-title', 'text-form-xl': 'text-form-xl-title' }

/** 클래스 경계. `!text-xs`(important)도 잡고, `text-xs-foo`·`bg-text-xs` 오탐은 막는다.
 *  변형 접두사(sm:/hover:/dark:)가 붙어도 `:`는 [\w-]가 아니라 그대로 통과한다. */
function boundary(token) {
  return new RegExp(`(?<![\\w-])(!?)${token.replace(/[[\]]/g, '\\$&')}(?![\\w-])`, 'g')
}

/** 이 오프셋이 <h1>~<h6> 여는 태그 **안**인가.
 *  앞쪽에서 가장 가까운 `<`를 찾아 그것이 hN 태그이고, 그 사이에 `>`가 없으면 태그 안이다. */
function insideHeadingTag(src, idx) {
  const open = src.lastIndexOf('<', idx)
  if (open < 0) return false
  if (src.slice(open, idx).includes('>')) return false
  return /^<h[1-6]\b/.test(src.slice(open, open + 4))
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
    const titleC = TITLE_OF[newC]
    if (UNDO) {
      // 되돌릴 땐 -title 변형을 **먼저** 지운다 — 뒤에 하면 경계 규칙상 접미사가 남는다
      for (const from of [titleC, newC].filter(Boolean)) {
        src = src.replace(boundary(from), (_m, bang) => { hits++; return `${bang}${oldC}` })
      }
    } else {
      // ⚠ 콜백 안의 src·off는 **치환 전** 문자열 기준이다(우변이 먼저 평가된다) — 짝이 맞다
      src = src.replace(boundary(oldC), (_m, bang, off) => {
        hits++
        const pick = titleC && insideHeadingTag(src, off) ? titleC : newC
        return `${bang}${pick}`
      })
    }
  }
  totalHits += hits
  perFile.push({ f, hits, changed: src !== before })
  if (!DRY && src !== before) writeFileSync(f, src, 'utf8')
}

console.log(`${UNDO ? '되돌리기' : '치환'}${DRY ? ' (dry-run)' : ''} — 대상 ${FILES.length}파일\n`)
for (const p of perFile) console.log(`  ${String(p.hits).padStart(4)}  ${p.f}`)
console.log(`\n합계 ${totalHits}곳`)

// ⚠ 항진 차단 — 파일 목록이 비거나 경로가 어긋나면 0곳이라 "성공"으로 보인다.
if (missing.length) {
  console.log(`\n❌ 못 찾은 파일 ${missing.length}개: ${missing.join(', ')}`)
  process.exit(1)
}
if (perFile.length !== 15) {
  console.log(`\n❌ 스캔한 파일이 ${perFile.length}개 — 15개여야 한다`)
  process.exit(1)
}
if (totalHits === 0) {
  console.log(`\n${UNDO ? '되돌릴' : '치환할'} 것이 없다 (이미 적용된 상태로 보인다)`)
}
process.exitCode = 0
