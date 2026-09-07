// 소방계획서_35 DEF-B3 — 한 화면이 **두 축으로 갈라지지 않는가**.
//
// 왜 필요한가: 35가 화면 글자 크기를 text-form-*(= --fs-scale에 반응) 토큰으로 옮겼는데,
//   같은 파일 안에 하드코딩 크기(text-[11px] · text-xs …)가 섞여 남으면 사용자가 배율을
//   lg/xl로 올렸을 때 **한 화면의 절반만 커진다**. 독립 판정이 inspection-sheet-client.tsx에서
//   토큰 11 + 하드코딩 24의 혼합 상태를 찾아냈고(DEF-B3), 그때 가드가 없었다.
//
// 판정 규칙: text-form-*을 **쓰는** 파일은 하드코딩 크기 클래스를 쓰지 않는다.
//   범위를 파일 목록으로 박지 않고 '토큰을 쓰는가'로 자기정의하므로, 토큰이 새 파일로
//   퍼져도 가드가 자동으로 따라간다(확산 자체는 막지 않는다 — 갈라지는 것만 막는다).
//
// ⚠ 2026-09-07 전역 배율 도입으로 **HARD의 범위가 좁아졌다.** globals.css의 @theme inline이
//   Tailwind 기본 text-xs~text-3xl에 --fs-scale을 곱하면서, 그 클래스들은 더 이상 크기를
//   '고정'하지 않는다 — 배율을 타므로 같은 파일에 섞여도 화면이 갈라지지 않는다.
//   좁히지 않으면 이 가드가 전건 빨강이 되는데, 그건 결함이 아니라 **가드가 낡은 것**이다.
//   남은 위반은 `text-[11px]` 같은 **px 리터럴**뿐이다(그건 여전히 배율 밖).
//   그래서 아래 A-1이 그 전역 배선의 실재를 단언한다 — 배선이 사라지면 HARD를 좁힌 근거도
//   함께 사라지므로, 두 검사는 반드시 한 쌍으로 읽혀야 한다.
//
// 실행: npx tsx scripts/test-35-scale-axis.mts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const SRC = join(process.cwd(), 'src')
const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? walk(p) : (/\.tsx?$/.test(n) ? [p] : [])
})
const rel = (f: string) => f.replace(process.cwd(), '.')
/** 화면 글자 크기를 **고정**하는 클래스 — 배율을 안 탄다.
 *  text-xs·text-sm… 은 전역 배선(A-1) 이후 배율을 타므로 여기서 빠졌다. */
const HARD = /text-\[\d+(\.\d+)?px\]/g

console.log('— 소방계획서_35 배율 축 정합')

// ── A-1. 전역 배율 배선 실재 ────────────────────────────────────────────────
// 위 HARD를 좁힌 근거 그 자체다. 이게 죽으면 text-xs가 다시 크기 고정이 되는데
// HARD는 그걸 못 보므로, 가드 전체가 조용히 공허해진다. 그래서 **여기서 먼저** 막는다.
// ⚠ @theme **inline** 블록 안이어야 한다 — 밖이면 var()가 :root에서 풀려
//   [data-fs-boost] 하위 스코프 배율이 죽는다(globals.css 주석 참조).
const CSS = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')
const themeInline = CSS.match(/@theme inline \{[\s\S]*?\n\}/)?.[0] ?? ''
check('전역 배선 — @theme inline 블록을 찾았다', themeInline.length > 0, `${themeInline.length}자`)
const SIZE_KEYS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl']
const wired = SIZE_KEYS.filter(k =>
  new RegExp(`--text-${k}:\\s*calc\\([^;]*var\\(--fs-scale\\)`).test(themeInline))
check('전역 배선 — Tailwind 기본 크기가 --fs-scale을 곱한다',
  wired.length === SIZE_KEYS.length, `${wired.length}/${SIZE_KEYS.length} (${wired.join(',')})`)
// 짝이 되는 line-height도 함께 있어야 한다 — 크기만 키우고 행간이 고정이면 겹친다
const lh = SIZE_KEYS.filter(k => new RegExp(`--text-${k}--line-height:`).test(themeInline))
check('전역 배선 — line-height 짝이 전부 명시돼 있다',
  lh.length === SIZE_KEYS.length, `${lh.length}/${SIZE_KEYS.length}`)

const files = walk(SRC)
const tokenFiles = files.filter(f => readFileSync(f, 'utf8').includes('text-form-'))

// ⚠ 모집단 단언 — 토큰 파일이 0이면 아래 '혼합 0'은 공허 통과다
check('모집단 — text-form-*을 쓰는 파일이 충분히 있다', tokenFiles.length >= 15, `${tokenFiles.length}개`)

const mixed: string[] = []
for (const f of tokenFiles) {
  const n = (readFileSync(f, 'utf8').match(HARD) ?? []).length
  if (n > 0) mixed.push(`${rel(f)}(${n})`)
}
check('배율 축 파일에 px 리터럴 크기 0건 (한 화면이 두 축으로 안 갈라진다)',
  mixed.length === 0, mixed.join(' · '))

// ⚠ 양성 대조군 — 검출기가 눈멀지 않았음을 증명한다. 이게 없으면 위 '위반 0'은
//   "정규식이 아무것도 못 잡는다"와 구별되지 않는다.
//
// ⚠⚠ **대조군을 저장소에서 재지 않는다.** 종전엔 "px 리터럴만 쓰는 파일이 실재하는가"로
//   쟀는데, 2026-09-07 전역 코드모드가 596곳을 토큰으로 옮기면서 그 모집단이 92파일 → 2파일로
//   말라붙었다. 남은 것까지 옮기면 대조군은 **0이 되어 가드가 거짓 빨강**이 된다.
//   즉 종전 대조군은 "이 작업이 끝나지 않았음"에 의존하고 있었다 — 성공하면 깨지는 검사다.
//   합성 표본으로 바꾼다. 저장소 상태와 무관하게 언제나 같은 답을 준다.
const SAMPLE_HARD = 'className="px-2 text-[11px] font-bold" · <b class="text-[9px]"> · text-[10.5px]'
const SAMPLE_SOFT = 'className="text-form-xs text-form-2xs text-xs text-sm text-base"'
check('[양성 대조군] 검출기가 px 리터럴을 잡는다',
  (SAMPLE_HARD.match(HARD) ?? []).length === 3, `합성 표본에서 ${(SAMPLE_HARD.match(HARD) ?? []).length}/3 검출`)
check('[음성 대조군] 배율을 타는 클래스는 안 잡는다',
  (SAMPLE_SOFT.match(HARD) ?? []).length === 0, `오검출 ${(SAMPLE_SOFT.match(HARD) ?? []).length}건`)

// 참고 수치(판정 아님) — 아직 옮기지 않은 파일이 얼마나 남았는지 보여준다
let hardOnlyFiles = 0, hardOnlyHits = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (src.includes('text-form-')) continue
  const n = (src.match(HARD) ?? []).length
  if (n > 0) { hardOnlyFiles++; hardOnlyHits += n }
}
console.log(`  · (참고) 아직 토큰 미사용 + px 리터럴 보유: ${hardOnlyFiles}파일 ${hardOnlyHits}건`)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
