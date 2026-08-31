// 소방계획서_36 S7-3·S7-4 — 대비 축의 **정적** 규약 (서버 불필요 → pre-push에도 얹을 수 있다)
//
// 왜 별도 파일인가: 대비 래칫(_probe-36-contrast.mts)은 브라우저가 필요해 서버 없으면 못 돈다.
// 그런데 S7-3(print: 불간섭)·S7-4(신규 hex 0)는 **소스만 보면 판정되는** 규약이라,
// 서버에 기대면 상시성이 떨어진다. 독립 판정이 "규약은 있는데 고정하는 검사가 없다"고
// 지적한 자리를 여기서 닫는다.
//
// 실행: npx tsx scripts/test-36-contrast-static.mts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const SRC = join(process.cwd(), 'src')
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : (/\.(tsx?|css)$/.test(n) ? [p] : [])
})
const files = walk(SRC)
const rel = (f: string) => f.replace(process.cwd(), '.')
/** 컴포넌트(.tsx) className에 남아 있는 hex 리터럴 수의 상한 — **실측 129(2026-08-30)**.
 *
 *  ⚠ 이건 성취가 아니라 **동결**이다. 종전 표기 '≤7'은 범위가 'ink-meta를 쓰는 파일'로
 *  좁혀져 있어 작아 보였을 뿐, 저장소 실제 잔여는 129건이다. 작은 수를 적어 두면
 *  "거의 다 정리됐다"는 **거짓 인상**을 준다 — 29 코드모드의 실제 잔여를 그대로 싣는다.
 *  줄이는 것은 29의 몫이고, 이 검사의 몫은 **늘지 않게** 막는 것뿐이다. */
const HEX_RATCHET = 129

console.log('— 소방계획서_36 대비 정적 규약')

// ── S7-3: print: 변형은 화면 토큰을 건드리지 않는다 (소방계획서_29 규약)
//    인쇄물은 법정 서식 규격이라 화면 대비 개선이 새면 안 된다.
{
  const hits: string[] = []
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/print:[^\s"'`]*ink-(meta|faint|soft|sub)/.test(line)) hits.push(`${rel(f)}:${i + 1}`)
    })
  }
  check('S7-3 print: 변형에 ink-* 토큰 0건', hits.length === 0, hits.join(' · '))
}

// ── S7-4: ink-meta를 쓰는 화면 파일에 **신규 hex 리터럴**이 없다 (29 규약: var(--t-*) 경유만)
//    ⚠ 범위를 '컴포넌트'로 좁힌 이유: globals.css는 토큰 **정의부**라 hex가 있는 게 정상이고,
//      프로브 스크립트도 오라클 상수로 hex를 쓴다. 종전 evidence가 이 구분 없이
//      'diff에 hex 0건'이라 적어 거짓이 됐다(독립 판정 지적).
{
  const comp = files.filter(f => /\.tsx$/.test(f))
  // ① 내가 넣은 줄에는 hex가 없어야 한다 — ink-meta와 hex가 **같은 줄**에 있으면 위반
  const sameLine: string[] = []
  // ② 저장소 전체의 기존 hex는 래칫으로 묶는다(줄이는 건 29의 코드모드 몫, 여기선 늘지만 않게)
  //
  // 🐛 **지표를 한 번 잘못 설계했다(2026-08-30).** 최초안은 `if (!src.includes('text-ink-meta')) continue`
  //    로 **ink-meta를 쓰는 파일 안에서만** hex를 셌다. 그러면 ink-meta를 넓힐수록 **분모가 따라
  //    커져** 새 hex가 한 줄도 안 늘었는데 7→11로 붉어진다. 측정 대상이 측정 행위에 따라
  //    변하는 지표는 래칫이 아니다 — 전체 컴포넌트로 분모를 **고정**한다.
  //
  // 🐛 **스코프 버그를 한 번 더 냈다(2026-08-31, 독립 판정 지적).** ①이 ②와 같은 술어
  //    (`className=[^\n]*#hex`)를 쓰는 바람에 **`className=`이 같은 줄에 있을 때만** 셌다.
  //    className이 삼항으로 여러 줄에 흐르면 가지 줄에는 `className=`이 없다 —
  //    그래서 이 커밋이 만든 반례(overdue-resolve-modal.tsx:112,
  //    `text-[#d0d0d0] dark:text-ink-meta`)를 검사가 **초록으로 통과시켰다**.
  //    → className= 요구를 뗀다.
  //
  //    ⚠ **정정(2026-08-31 재판정)**: 한때 여기에 "①의 판정 단위는 줄이 아니라 '클래스
  //    문자열'"이라 적었는데 **구현과 다르다**. 판정자가 한 클래스 문자열을 여러 줄로 쪼갠
  //    변이(`className={['text-ink-meta', 'shadow-[0_0_0_1px_#d0d0d0]'].join(' ')}`)로 반증했다 —
  //    단위는 여전히 **줄**이고 `className=` 요구만 제거된 것이다. 사각지대가 좁아졌을 뿐
  //    같은 계열의 구멍이 남아 있다. 주석이 코드보다 큰 약속을 하면 그 주석이 거짓말이 된다.
  //
  //    🕳 **알려진 구멍 2개(침묵시키지 않는다)**
  //      ⓐ ①은 줄 단위라 한 클래스 문자열이 여러 줄로 나뉘면 ink-meta+hex 공존을 놓친다.
  //      ⓑ ②(래칫)는 `className=`이 같은 줄에 있는 hex만 센다 — 넓힌 술어로는 143건이라
  //         **17건을 못 본다**. 그 17에 이 사달의 원인이 된 형태(overdue-resolve-modal의
  //         다중행 삼항 가지)가 포함된다. 그래서 'ink-meta 없는 다중행 클래스 문자열에
  //         새 hex를 넣는' 경로는 ①②' 어느 쪽도 안 잡는다.
  //         분모를 넓히면 기준선을 다시 재야 하고 그건 이미 한 번(7→11) 데인 축이라
  //         **의도적으로 유지**한다 — 다만 구멍으로 기록해 둔다.
  //
  //    ⚠ 거짓 양성 면(판정자 변이로 실증): className= 요구를 떼면 **주석**에 ink-meta와 hex를
  //      함께 적기만 해도 붉어진다. 이 파일 자신의 위 주석이 그 패턴의 실물 표본이다.
  //      그래서 주석 줄은 모집단에서 뺀다 — 규약은 코드에 거는 것이지 설명에 거는 게 아니다.
  const isComment = (l: string) => /^\s*(\/\/|\/\*|\*)/.test(l)
  let legacy = 0
  for (const f of comp) {
    const src = readFileSync(f, 'utf8')
    src.split('\n').forEach((line, i) => {
      // ① — className= 유무와 무관하게, ink-meta와 hex가 같은 줄에 있으면 위반(주석 줄 제외)
      if (!isComment(line) && line.includes('text-ink-meta') && /#[0-9a-fA-F]{6}/.test(line)) {
        sameLine.push(`${rel(f)}:${i + 1}`)
      }
      // ② — 래칫 분모(범위 고정: className= 리터럴이 같은 줄에 있는 hex).
      //     ⚠ 여기엔 주석 제외를 걸지 않는다 — 술어를 바꾸면 분모가 흔들려 기준선 129를
      //       다시 재야 한다. 두 검사는 목적이 다르므로 술어도 따로 둔다.
      if (/className=[^\n]*#[0-9a-fA-F]{6}/.test(line)) legacy++
    })
  }
  check('S7-4 ink-meta를 넣은 줄에 hex 0건(신규 코드 규약)', sameLine.length === 0, sameLine.join(' · '))
  // ⚠ 이 수는 **이미 있던** 리터럴이다 — 36이 만든 것이 아니라 29 코드모드가 남긴 잔여라
  //   여기선 늘지만 않게 막는다. '0건'이라 적으면 또 거짓 근거가 된다(독립 판정이 한 번 잡았다).
  check(`S7-4 컴포넌트 전체 hex 래칫 ≤ ${HEX_RATCHET}`, legacy <= HEX_RATCHET, `${legacy}건`)
}

// ── S5-1: 토큰이 두 모드 다 정의돼 있다(한쪽만 넣으면 그 모드에서 상속돼 조용히 틀린다)
{
  const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8')
  const defs = (css.match(/--t-ink-meta:\s*#[0-9a-fA-F]{6}/g) ?? [])
  check('S5-1 --t-ink-meta가 라이트·다크 2곳에 정의', defs.length === 2, `${defs.length}곳: ${defs.join(' / ')}`)
  check('S5-1 @theme inline에 --color-ink-meta 등록', /--color-ink-meta:\s*var\(--t-ink-meta\)/.test(css))
  // 기존 토큰 값 불변(29 D-3) — 라이트 ink 5종은 종전 hex 그대로여야 한다
  for (const [tok, hex] of [['--t-ink', '#090c1d'], ['--t-ink-sub', '#514b81'], ['--t-ink-faint', '#b0acd6']] as const) {
    check(`29 D-3 ${tok} 라이트 값 불변(${hex})`, new RegExp(`${tok}:\\s*${hex}`).test(css))
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
