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
 *    node scripts/codemod-35-font-tokens.mjs --verify-bijection   # S2-7 정적 항등 재증명
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const UNDO = argv.includes('--undo')
const VERIFY = argv.includes('--verify-bijection')

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

/** ── S2-7 정적 항등 재증명 (--verify-bijection) ───────────────────────────────
 *
 *  독립 판정(2026-08-30 판정자 B)은 S2-7의 "픽셀이 하나도 안 변했다"를 FAIL로 봤고,
 *  그 근거 중 하나가 구현자의 **"항등 재현 불가"라는 주장이 사실이 아니라는 것**이었다.
 *  판정자가 옳다. 코드모드 커밋 4ccda41과 그 부모가 저장소에 그대로 있으므로,
 *  치환이 전단사였다는 것은 **지금도 언제든 기계로 다시 증명된다**. 이 모드가 그것이다.
 *
 *  ⚠ 기준을 HEAD나 작업트리로 잡지 않는다 — 그러면 뒤이은 커밋(fbe8e95 등)이 16파일을
 *    건드릴 때마다 조용히 썩는다. **sha를 상수로 박는다**(feedback_probe_baseline_pin).
 *    git 히스토리는 불변이므로 아래 기대값들은 영원히 같은 답을 준다.
 *
 *  ⚠ 줄 단위 diff로 판정하면 안 된다. 4ccda41은 클래스 치환 **말고도** 세 가지를 함께
 *    했고(TableWrap 삽입·colgroup calc·배율 토글 삽입), 그 삽입이 뒤 줄을 통째로 밀어
 *    "잔차 458줄" 같은 무의미한 수를 낸다. 그래서 오프셋에 흔들리지 않는
 *    **클래스 다중집합**을 축으로 삼는다. */
const BIJECTION = {
  sha: '4ccda41',                 // 코드모드 커밋 (부모 1f19a09)
  total: 471,                     // 판정자 B가 독립 계수한 수와 같아야 한다
  perToken: {                     // 매핑별 곳수 — 합계만 맞고 내역이 어긋나는 경우를 막는다
    'text-[9px]': 2, 'text-[10px]': 53, 'text-[11px]': 170,
    'text-xs': 135, 'text-sm': 7, 'text-base': 1,
    'h-6': 26, 'h-7': 52, 'h-8': 25,
  },
  // 클래스 치환만 한 파일은 바이트까지 같다. 같지 않은 셋은 4ccda41이 함께 한 다른 변경분이다.
  byteIdentical: 13,
  residual: ['plan-form14.tsx', 'plan-form14-specs.tsx', 'plan-tab-view.tsx'],
}

if (VERIFY) {
  let bad = 0
  const fail = (m, d) => { console.log(`❌ ${m}${d ? `\n   ${d}` : ''}`); bad++ }
  const ok = m => console.log(`✅ ${m}`)

  // git 실행기 — PATH의 git이 죽어 있을 수 있다(reference_git_path). **찾지 못하면 FAIL이다**;
  // 조용히 건너뛰면 이 검사 전체가 항진명제가 된다.
  const gitExe = ['git', 'F:\\AI\\tools\\MinGit\\cmd\\git.exe'].find(g => {
    try { execFileSync(g, ['--version'], { stdio: 'ignore' }); return true } catch { return false }
  })
  if (!gitExe) { fail('git 실행기를 찾지 못했다 — 전단사 축을 돌릴 수 없다(건너뛰지 않는다)'); process.exit(1) }

  // ⚠ FILES는 path.join으로 만들어져 Windows에서 역슬래시다. git은 슬래시만 받는다.
  const show = (rev, f) =>
    execFileSync(gitExe, ['show', `${rev}:erp/${f.replace(/\\/g, '/')}`], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const count = (src, t) => (src.match(boundary(t)) ?? []).length

  const S = BIJECTION.sha
  const pOld = {}, cNew = {}
  const perFile = []          // 파일별 내역 — 전역 합계만 보면 상쇄가 숨는다(판정 DEF-A1)
  let staleNew = 0, staleOld = 0, byteSame = 0, undoSame = 0
  const notIdentical = [], notUndone = []
  try {
    for (const f of FILES) {
      const name = f.split(/[/\\]/).pop()
      const parent = show(`${S}^`, f), child = show(S, f)
      // 정방향: 부모에 코드모드를 적용하면 자식이 되는가
      let fwd = parent, rev = child
      for (const [o, n] of MAP) fwd = fwd.replace(boundary(o), (_m, b) => `${b}${n}`)
      for (const [o, n] of MAP) rev = rev.replace(boundary(n), (_m, b) => `${b}${o}`)
      if (fwd === child) byteSame++; else notIdentical.push(name)
      if (rev === parent) undoSame++; else notUndone.push(name)
      const fo = {}, fn = {}
      for (const [o, n] of MAP) {
        fo[o] = count(parent, o); fn[n] = count(child, n)
        pOld[o] = (pOld[o] ?? 0) + fo[o]
        cNew[n] = (cNew[n] ?? 0) + fn[n]
        staleNew += count(parent, n)   // 부모에 신 토큰이 미리 있으면 '치환'이 아니다
        staleOld += count(child, o)    // 자식에 구 클래스가 남으면 완전 치환이 아니다
      }
      perFile.push({ name, fo, fn })
    }
  } catch (e) {
    fail(`${S} 또는 그 부모를 읽지 못했다 — 히스토리가 없으면 이 축은 성립하지 않는다`, e.message)
    process.exit(1)
  }

  // ⚠ 항진 차단 — 아무것도 못 세고 "다 같다"가 되는 길을 먼저 막는다.
  const total = Object.values(pOld).reduce((a, b) => a + b, 0)
  total === BIJECTION.total
    ? ok(`치환 규모가 고정 기대값과 같다 (${total}곳 @ ${S})`)
    : fail(`치환 규모 ${total} ≠ 기대 ${BIJECTION.total}`, '리비전 고정 값이라 달라질 수 없다 — MAP이나 FILES가 바뀌었다')

  // 매핑별 내역을 **고정 기대값**과 대조 — 합계만 맞고 내역이 어긋나는 경우를 막는다.
  //  ⚠ 이 상수는 한때 정의만 되고 **한 번도 읽히지 않았다**(판정 DEF-A2). 판정자가
  //    `'text-xs': 135`를 999로 위조해도 전건 초록임을 실증했다. 주석이 약속한 가드가
  //    코드에 없으면 그 주석은 문서가 아니라 거짓말이다.
  const tokenMismatch = MAP.filter(([o]) => (pOld[o] ?? 0) !== BIJECTION.perToken[o])
    .map(([o]) => `${o} 실측 ${pOld[o] ?? 0} ≠ 기대 ${BIJECTION.perToken[o]}`)
  tokenMismatch.length === 0
    ? ok(`매핑별 곳수가 고정 기대값과 전건 일치 (${MAP.map(([o, n]) => `${o}→${n}:${pOld[o]}`).join(' · ')})`)
    : fail('매핑별 내역이 기대와 어긋난다', tokenMismatch.join(' / '))

  // 본 축 — 구 클래스 다중집합이 신 토큰 다중집합으로 **정확히** 옮겨갔는가.
  //  ⚠⚠ **파일별로 본다.** 전역 합계만 보면 두 오치환이 서로를 상쇄해 통과한다 —
  //     판정자 A가 실증했다(DEF-A1): 잔차 3파일에서 한 곳을 text-form-xs→text-form-sm으로,
  //     다른 곳을 text-form-sm→text-form-xs로 바꾸면 합계가 그대로라 6/6 전건 초록인데
  //     **화면의 두 칸은 실제로 크기가 다르게 렌더된다**(--fs-3 vs --fs-4).
  //     그 구멍이 컸던 이유는 바이트 동일 단언이 13파일만 덮고, 나머지 3파일에 사는
  //     120곳(471의 25.5%)이 오직 전역 합계로만 검증됐기 때문이다.
  const mismatch = perFile.flatMap(p =>
    MAP.filter(([o, n]) => p.fo[o] !== p.fn[n]).map(([o, n]) => `${p.name}: ${o} ${p.fo[o]} → ${n} ${p.fn[n]}`))
  mismatch.length === 0
    ? ok(`폰트 클래스 다중집합이 **파일별로** 매핑 9종 전건 일치 (16파일 × 9매핑 = 144쌍) — 치환은 전단사였다`)
    : fail('파일별 다중집합이 어긋난다 — 그 파일 안에서 크기가 바뀐 곳이 있다', mismatch.join(' / '))

  staleNew === 0 ? ok('부모에 신 토큰이 0건 (치환 전 상태가 맞다)')
                 : fail(`부모에 신 토큰 ${staleNew}건 — 부모가 이미 치환된 상태다(대조군이 아니다)`)
  staleOld === 0 ? ok('자식에 구 클래스가 0건 (완전 치환)')
                 : fail(`자식에 구 클래스 ${staleOld}건 — 치환이 일부만 됐다`)

  // 역방향 — --undo가 정말 되돌리는가(전단사의 나머지 절반).
  //  ⚠ 여기서 16/16을 요구하면 **틀린 단언**이다(처음에 그렇게 썼다가 걸렸다). 잔차 세 파일은
  //    클래스 말고 다른 것도 함께 바뀌었으므로 되돌려도 부모와 바이트로 같아질 수 없다.
  //    맞는 요구는 **정방향과 같은 집합**이라는 것 — 그래야 차이의 원인이 폰트 축 밖임이 확정된다.
  const undoSetOk = notUndone.length === notIdentical.length && notUndone.every(f => notIdentical.includes(f))
  undoSame === byteSame && undoSetOk
    ? ok(`역방향(--undo)도 같은 ${undoSame}파일을 부모와 바이트 동일로 되돌린다 — 매핑이 양방향 단사다`)
    : fail(`역방향 ${undoSame}파일 (정방향 ${byteSame}) · 되돌지 않은 [${notUndone.join(', ')}]`,
        '정방향과 다른 집합이면 매핑이 단사가 아니다 — 두 클래스가 한 토큰으로 합쳐졌을 수 있다')

  // 바이트 동일 — 클래스 말고 아무것도 안 건드린 파일 수. 나머지 셋은 4ccda41이 함께 한 변경분.
  const residualOk = notIdentical.length === BIJECTION.residual.length
    && BIJECTION.residual.every(r => notIdentical.includes(r))
  byteSame === BIJECTION.byteIdentical && residualOk
    ? ok(`${byteSame}/${FILES.length}파일은 바이트까지 동일 — 나머지 셋은 폰트 축 밖의 동반 변경이다 (${notIdentical.join(', ')})`)
    : fail(`바이트 동일 ${byteSame} (기대 ${BIJECTION.byteIdentical}) · 잔차 [${notIdentical.join(', ')}] (기대 [${BIJECTION.residual.join(', ')}])`,
        '역시 리비전 고정 값이다 — 달라졌다면 이 검사 쪽이 틀린 것이다')

  // CSS 축 — 9개 신 토큰이 **서로 다른** CSS 변수에 묶였는가.
  //  소스 축만으로는 "두 구 클래스가 다른 이름의 토큰으로 갔다"까지만 말한다. 그 두 토큰이
  //  같은 변수를 가리키면 이름만 다르고 크기는 합쳐진 것이다 — 소스 축이 구조적으로 못 보는 구멍.
  //  여기서 값(9px 등)을 단언하지는 않는다. 4ccda41 시점엔 이미 S3 신 값이라 구 값이 없기 때문이고,
  //  그 사실을 숨기지 않는다. 이 축이 닫는 것은 **단사성**이지 값 보존이 아니다.
  try {
    const css = show(S, 'src/app/globals.css')
    const bind = {}
    for (const [, n] of MAP) {
      const m = css.match(new RegExp(`@utility\\s+${n}\\s*\\{[^}]*?var\\((--fs-[a-z0-9-]+)\\)`))
      if (m) bind[n] = m[1]
    }
    const found = Object.keys(bind).length
    const distinct = new Set(Object.values(bind)).size
    found === MAP.length && distinct === MAP.length
      ? ok(`CSS 축: 신 토큰 9종이 서로 다른 변수 9개에 묶였다 (${MAP.map(([, n]) => `${n}=${bind[n]}`).join(' · ')})`)
      : fail(`CSS 축: 바인딩 ${found}/${MAP.length} · 서로 다른 변수 ${distinct}/${MAP.length}`,
          '두 토큰이 같은 변수를 가리키면 이름만 다르고 크기는 합쳐진 것이다')
  } catch (e) {
    fail(`${S}의 globals.css를 읽지 못했다 — CSS 축을 건너뛰지 않는다`, e.message)
  }

  console.log(`\n${bad === 0
    ? `S2-7 정적 전단사 ✅ — 471곳 치환이 **소스 축에서 전단사**였음이 ${S}에서 재증명된다.\n`
      + `   ⚠ 이것은 "크기가 하나도 안 바뀌었다"와 **다른(더 좁은) 명제다**. 이 검사는 각 토큰이\n`
      + `     어떤 값에 묶였는지를 재지 않는다 — 단사성(서로 다른 변수)까지만 본다.\n`
      + `     크기 보존 축은 test-plan-readability --identity(회귀 잠금)와 --print(구 값 복원)가 잰다.\n`
      + `   ⚠ 헤드라인이 한때 "크기를 하나도 안 바꿨다가 재증명된다"였고 그것은 과장이었다\n`
      + `     (판정 DEF-A3). 검사가 증명하지 않는 것을 검사가 선언하면 안 된다.`
    : `❌ ${bad}건 실패`}`)
  process.exit(bad === 0 ? 0 : 1)
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
