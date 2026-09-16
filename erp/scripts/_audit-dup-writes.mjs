/** 중복저장 감사 — **같은 컬럼을 두 곳 이상에서 쓰는가**.
 *
 *  「고치면 관련된 곳이 모두 바뀐다」는 값이 **한 곳에만 저장될 때만** 성립한다. 복제해 두고
 *  동기화하면 반드시 어긋난다. 이 저장소는 이미 그걸로 크게 데였다 — 1.1 저장이 payload에 남은
 *  빈 값으로 `manager_selected_at`을 **지우고 있었다**(2026-09-14).
 *
 *  판정: `.update({...})` / `.upsert({...})` / `.insert({...})` 안의 **snake_case 키**를 세고,
 *  서로 다른 파일에서 쓰이는 컬럼을 드러낸다.
 *
 *  ⚠ 이건 **목록을 내는 도구**이지 합격/불합격 판정기가 아니다 — 두 곳에서 쓰는 것이 늘 결함은
 *    아니다(신규 생성과 수정은 갈라져도 된다). 사람이 읽고 소유자를 정하는 것이 목적이다.
 *
 *  실행: node scripts/_audit-dup-writes.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../src/app')

const files = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = resolve(dir, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(e)) files.push(p)
  }
})(ROOT)

/** 소방계획서 값이 사는 테이블만 본다.
 *  감사로그(`audit_logs`)·조인키(`customer_id`)·`created_by` 류는 여러 곳에서 쓰는 것이 정상이라
 *  섞어 놓으면 **진짜 중복이 소음에 묻힌다**(처음 돌렸을 때 상위 4개가 전부 그것이었다). */
const TABLES = new Set(['customers', 'buildings'])
/** 소유권 다툼이 있을 수 없는 칸 — 조인키·감사 흔적 */
const IGNORE = new Set([
  'customer_id', 'building_id', 'created_by', 'updated_by', 'created_at', 'updated_at',
  'actor_id', 'entity_type', 'entity_id', 'org_id', 'user_id',
])

/** `table.column` → Set<파일> */
const writers = new Map()
// `.from('t')` … `.update(…)` — payload는 **리터럴이거나 변수**다.
// 🚨 리터럴만 보면 안 된다: 실측 35건 중 **10건이 변수 payload**(`.update(patch)` 등)라
//   리터럴만 훑는 판본은 그 10건을 통째로 못 보고 「중복 1건」이라 **오보**했다.
// 🚨 `.from('t')`와 쓰기 사이에 **다른 `.from(`이 끼면 안 된다**. 안 끊었더니
//   `.from('customers').select(…)` 다음 줄의 `activity_logs.insert({…})`를 물어
//   「timeline-actions가 customer_name을 쓴다」는 **거짓 양성**을 냈다.
const WRITE_RE = /\.from\(\s*'([a-z_]+)'\s*\)((?:(?!\.from\()[\s\S]){0,400}?)\.(?:update|upsert|insert)\(\s*(\{|[A-Za-z_$][\w$]*)/g
const KEY_RE = /(^|[{\s,])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*:/g

/** `{`에서 시작해 짝이 맞는 `}`까지 — 중첩 객체가 있어도 payload를 통째로 집는다 */
const braceBlock = (src, openIdx) => {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(openIdx, i + 1)
  }
  return src.slice(openIdx, openIdx + 2000)
}

/** 변수 payload를 선언까지 따라가 객체 리터럴을 얻는다(같은 파일 안) */
const resolveVar = (src, name) => {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\b[^=]{0,120}=\\s*\\{`).exec(src)
  return decl ? braceBlock(src, decl.index + decl[0].length - 1) : null
}

for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(WRITE_RE)) {
    const table = m[1]
    if (!TABLES.has(table)) continue
    const openIdx = m.index + m[0].length - m[3].length
    const block = m[3] === '{' ? braceBlock(src, openIdx) : resolveVar(src, m[3])
    if (!block) continue          // 못 따라간 변수는 아래 [커버리지]가 드러낸다
    for (const k of block.matchAll(KEY_RE)) {
      const col = k[2]
      if (IGNORE.has(col)) continue
      const id = `${table}.${col}`
      if (!writers.has(id)) writers.set(id, new Set())
      writers.get(id).add(relative(resolve(HERE, '..'), f).replace(/\\/g, '/'))
    }
  }
}

const multi = [...writers.entries()]
  .filter(([, s]) => s.size > 1)
  .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))

console.log(`대상 테이블 ${[...TABLES].join('·')} — 쓰이는 컬럼 ${writers.size}개`)
console.log(`그중 **두 곳 이상**에서 쓰는 것 ${multi.length}개\n`)
for (const [col, set] of multi) {
  console.log(`  ${String(set.size)}곳  ${col}`)
  for (const f of [...set].sort()) console.log(`         ${f}`)
}
if (multi.length === 0) console.log('  (없음) — 소유자가 전부 하나다')
