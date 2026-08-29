/** 판정자 D — S7-0: 1,100줄 파일 수술이 **심볼 유실·리바인딩 없이** 이뤄졌는가.
 *
 *  ⚠ 기준을 `HEAD:`로 잡지 않는다 — 추출이 이미 커밋돼 HEAD에는 원문이 없다(1회용 검사가 된다).
 *     추출 **직전** 리비전을 상수로 박는다.
 *  축: 기준 리비전의 report9-actions.ts에서 최상위 선언을 전부 뽑아,
 *      각 심볼이 지금 (현 actions | 추출 lib) 중 **정확히 한 곳**에 있고 본문이 자구 동일한지 본다.
 *      한 곳에도 없으면 유실, 두 곳에 있으면 중복 정의(리바인딩 위험).
 *  실행: npx tsx scripts/_judge27g-d-extract.mts */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const GIT = 'F:/AI/tools/MinGit/cmd/git.exe'
const REPO = 'F:/AI/ERP'
/** 추출 직전 고정 리비전 — 추출 커밋 37403f8의 부모 계열. 상수로 박아 회귀 가치를 유지한다 */
const BASE_SHA = '131af61'
const ACTIONS = 'erp/src/app/(dashboard)/inspections/report9-actions.ts'
const show = (sha: string, path: string) =>
  execFileSync(GIT, ['-C', REPO, 'show', `${sha}:${path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const base = show(BASE_SHA, ACTIONS)
const curActions = readFileSync('src/app/(dashboard)/inspections/report9-actions.ts', 'utf8')
const curLib = readFileSync('src/lib/report9-assemble.ts', 'utf8')

/** 최상위 선언 구간 추출 — 열 0에서 시작하는 선언만 본다(중첩 함수는 부모 본문에 포함된다) */
const DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|type|interface|class)\s+([A-Za-z_$][\w$]*)/
function decls(src: string): Map<string, string> {
  const lines = src.split(/\r?\n/)
  const starts: Array<[number, string]> = []
  lines.forEach((l, i) => { const m = DECL.exec(l); if (m) starts.push([i, m[1]]) })
  const out = new Map<string, string>()
  starts.forEach(([i, name], k) => {
    const end = k + 1 < starts.length ? starts[k + 1][0] : lines.length
    // ⚠ 구간의 꼬리에는 **다음 심볼의 JSDoc**이 붙는다 — 그대로 두면 남의 주석 변경이
    //   내 심볼의 '자구 변경'으로 둔갑한다(첫 시도에서 실제로 그랬다). 꼬리 주석·공백을 벗긴다.
    const span = lines.slice(i, end)
    while (span.length && /^\s*$|^\s*(\/\/|\/\*|\*)/.test(span[span.length - 1])) span.pop()
    out.set(name, span.join('\n').replace(/\s+$/, ''))
  })
  return out
}
const B = decls(base), A = decls(curActions), L = decls(curLib)

const OUT: string[] = []
const say = (s = '') => OUT.push(s)
say(`[기준] ${BASE_SHA}:${ACTIONS} — ${base.split('\n').length}줄 · 최상위 선언 ${B.size}`)
say(`[현재] actions ${curActions.split('\n').length}줄(선언 ${A.size}) · lib report9-assemble ${curLib.split('\n').length}줄(선언 ${L.size})`)
say('')

const lost: string[] = [], dup: string[] = [], movedSame: string[] = [], movedDiff: string[] = []
const stayedSame: string[] = [], stayedDiff: string[] = []
for (const [name, body] of B) {
  const inA = A.get(name), inL = L.get(name)
  if (inA !== undefined && inL !== undefined) { dup.push(name); continue }
  if (inA === undefined && inL === undefined) { lost.push(name); continue }
  if (inL !== undefined) (inL === body ? movedSame : movedDiff).push(name)
  else (inA === body ? stayedSame : stayedDiff).push(name)
}
say(`[유실] 어느 쪽에도 없는 심볼 ${lost.length}${lost.length ? ': ' + lost.join(', ') : ''}`)
say(`[중복 정의] 양쪽에 있는 심볼 ${dup.length}${dup.length ? ': ' + dup.join(', ') : ''}`)
say(`[이동·자구 동일] ${movedSame.length}: ${movedSame.join(', ')}`)
say(`[이동·자구 변경] ${movedDiff.length}: ${movedDiff.join(', ')}`)
say(`[잔류·자구 동일] ${stayedSame.length}`)
say(`[잔류·자구 변경] ${stayedDiff.length}: ${stayedDiff.join(', ')}`)
say('')
// ★ 추출 자체의 충실도는 **추출 커밋 시점**의 lib과 대조해야 한다 — HEAD의 차이는 그 뒤 5일간의
//   정당한 후속 커밋(S3-5 2차·소방계획서_32 D트랙)까지 섞인다. 두 축을 갈라 센다.
{
  const EXTRACT_SHA = '37403f8'
  const libAt = decls(show(EXTRACT_SHA, 'erp/src/lib/report9-assemble.ts'))
  const strip = (s: string) => s.replace(/^export\s+/, '')
  const same: string[] = [], diff: string[] = []
  for (const name of [...movedSame, ...movedDiff]) {
    const was = B.get(name)!, then = libAt.get(name)
    if (then === undefined) { diff.push(`${name}(추출본에 없음)`); continue }
    ;(strip(then) === strip(was) ? same : diff).push(name)
  }
  say(`[추출 시점 대조 ${BASE_SHA} → ${EXTRACT_SHA}] export 키워드만 빼면 자구 동일 ${same.length}: ${same.join(', ')}`)
  say(`  자구가 다른 심볼 ${diff.length}: ${diff.join(', ')}`)
  const drift = [...movedSame, ...movedDiff].filter(n => libAt.get(n) !== L.get(n))
  say(`[그 뒤 HEAD까지 변경된 심볼] ${drift.length}: ${drift.join(', ')}`)
}
say('')
say('── (참고) 기준 대비 자구가 바뀐 심볼의 첫 차이 지점 ──')
for (const name of [...movedDiff, ...stayedDiff]) {
  const now = (L.get(name) ?? A.get(name))!, was = B.get(name)!
  let i = 0; while (i < now.length && i < was.length && now[i] === was[i]) i++
  say(`  ${name}: 길이 ${was.length}→${now.length} · 첫 차이 @${i}`)
  say(`    기준: ${JSON.stringify(was.slice(Math.max(0, i - 30), i + 60))}`)
  say(`    현재: ${JSON.stringify(now.slice(Math.max(0, i - 30), i + 60))}`)
}
say('')
// 배선 확인 — actions가 lib을 import하고, 재export(공개 엔드포인트화)는 하지 않는가
const imp = /import\s*\{([\s\S]*?)\}\s*from\s*'@\/lib\/report9-assemble'/.exec(curActions)
say(`[배선] actions의 report9-assemble import: ${imp ? imp[1].replace(/\s+/g, ' ').trim() : '**없음**'}`)
say(`[규약] actions가 재export 하는가: ${/export\s*\{[^}]*\}\s*from\s*'@\/lib\/report9-assemble'/.test(curActions) ? '**예(위반)**' : '아니오'}`)
say(`[규약] lib이 'use server'인가: ${/^['"]use server['"]/m.test(curLib) ? '**예(위반)**' : '아니오'}`)
say(`[문서대조] lib에 server-only import가 있는가: ${/import\s+'server-only'/.test(curLib) ? '예' : '아니오 (기준 문구는 server-only lib이라고 적혀 있다)'}`)

// 반증 가능성 — 기준 본문을 한 글자 바꾸면 비교기가 반드시 다르다고 해야 한다
{
  const [name, body] = [...B].find(([n]) => L.has(n))!
  const mutated = body.replace(/[a-z]/, 'Z')
  say('')
  say(`[반증] 기준 심볼 '${name}'의 한 글자를 바꾸면 비교 결과: ${L.get(name) === mutated ? '**같다고 함(검사 무력)**' : '다르다고 함(정상)'}`)
}

writeFileSync('F:/AI/ERP/_j27d-extract.txt', OUT.join('\n') + '\n', 'utf8')
console.log(OUT.join('\n'))
