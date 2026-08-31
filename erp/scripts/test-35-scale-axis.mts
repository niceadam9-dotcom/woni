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
/** 화면 글자 크기를 **고정**하는 클래스 — 배율을 안 탄다 */
const HARD = /text-\[\d+(\.\d+)?px\]|\btext-(xs|sm|base|lg|xl)\b/g

console.log('— 소방계획서_35 배율 축 정합')

const files = walk(SRC)
const tokenFiles = files.filter(f => readFileSync(f, 'utf8').includes('text-form-'))

// ⚠ 모집단 단언 — 토큰 파일이 0이면 아래 '혼합 0'은 공허 통과다
check('모집단 — text-form-*을 쓰는 파일이 충분히 있다', tokenFiles.length >= 15, `${tokenFiles.length}개`)

const mixed: string[] = []
for (const f of tokenFiles) {
  const n = (readFileSync(f, 'utf8').match(HARD) ?? []).length
  if (n > 0) mixed.push(`${rel(f)}(${n})`)
}
check('배율 축 파일에 하드코딩 크기 0건 (한 화면이 두 축으로 안 갈라진다)',
  mixed.length === 0, mixed.join(' · '))

// ⚠ 양성 대조군 — 검출기가 눈멀지 않았음을 증명한다. 하드코딩만 쓰는(토큰 미사용) 파일이
//   저장소에 실재하고 그것을 HARD가 실제로 잡아내는지 본다. 이게 0이면 위 '혼합 0'은
//   "정규식이 아무것도 못 잡는다"와 구별되지 않는다.
let hardOnlyFiles = 0, hardOnlyHits = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (src.includes('text-form-')) continue
  const n = (src.match(HARD) ?? []).length
  if (n > 0) { hardOnlyFiles++; hardOnlyHits += n }
}
check('[양성 대조군] 검출기가 하드코딩을 실제로 잡는다',
  hardOnlyFiles > 0 && hardOnlyHits > 0, `토큰 미사용 파일 ${hardOnlyFiles}개에서 ${hardOnlyHits}건 검출`)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
