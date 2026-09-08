/** 공유 인덱스 스테일 스냅샷 탐지 — 커밋되면 남의 커밋을 되돌리는 스테이징을 가려낸다.
 *
 *  배경: 2026-09-08 `0e60f10`이 스테일 트리로 별지 10·11호 작업을 되돌려 복구 커밋 2건이 필요했다.
 *  유령 삭제(=인덱스가 '삭제됨'이라 말하는 실재 파일)는 정리했지만, **더 조용한 형태**가 남아 있다:
 *  인덱스가 **과거 리비전의 내용을 그대로 들고 있는** 경우다. 그대로 커밋하면 그 사이 커밋들이
 *  조용히 되돌아간다.
 *
 *  판정: 인덱스 blob이 HEAD blob과 다르면서, **최근 이력의 어떤 리비전 blob과 정확히 같으면**
 *  그건 사람이 새로 쓴 내용이 아니라 **과거 스냅샷**이다(우연히 같을 확률은 무시 가능).
 *  실행: npx tsx scripts/_probe-stale-index.mts   (저장소 루트에서 erp/ 기준)
 *  ⚠ 읽기 전용 — 아무것도 고치지 않는다. */
import { execFileSync } from 'node:child_process'

const GIT = 'F:\\AI\\tools\\MinGit\\cmd\\git.exe'
const git = (...a: string[]) =>
  execFileSync(GIT, a, { cwd: '..', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trimEnd()

// 스테이징된(삭제 아닌) 파일 목록
const staged = git('-c', 'core.quotepath=false', 'diff', '--cached', '--name-only', '--diff-filter=ACMR')
  .split('\n').filter(Boolean)
console.log(`스테이징 파일 ${staged.length}건 검사\n`)

const stale: Array<[string, string, number]> = []
const fresh: string[] = []

for (const path of staged) {
  let idxBlob: string, headBlob: string
  try { idxBlob = git('rev-parse', `:${path}`) } catch { continue }
  try { headBlob = git('rev-parse', `HEAD:${path}`) } catch { fresh.push(path); continue }
  if (idxBlob === headBlob) continue          // 인덱스 == HEAD (변화 없음)

  // 최근 60커밋에서 이 경로의 리비전 blob을 모아 인덱스와 대조
  const revs = git('log', '-n', '60', '--format=%H', '--', path).split('\n').filter(Boolean)
  let hit: string | null = null
  let depth = 0
  for (let i = 0; i < revs.length; i++) {
    let b: string
    try { b = git('rev-parse', `${revs[i]}:${path}`) } catch { continue }
    if (b === idxBlob) { hit = revs[i]; depth = i; break }
  }
  if (hit) stale.push([path, hit.slice(0, 7), depth])
  else fresh.push(path)
}

console.log(`🚨 스테일 스냅샷 ${stale.length}건 — 커밋되면 그 사이 커밋이 되돌아간다`)
for (const [p, sha, d] of stale) console.log(`   ${p}\n       인덱스 == ${sha} (해당 경로 기준 ${d}단계 과거)`)
console.log(`\n✅ 새 작업으로 보이는 스테이징 ${fresh.length}건 — 건드리면 안 된다`)
for (const p of fresh) console.log(`   ${p}`)
