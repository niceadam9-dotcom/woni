/* 32.json 상태 표기 감사 — "수리해 놓고 상태를 안 바꾼" 부류를 전수로 찾는다.
 *
 * 계기: F-D10을 implemented로 올리지 않고 pending_order로 남겨둔 것을 상태 조회에서 우연히 발견했다.
 * 우연히 하나를 찾았다면 같은 부류가 더 있을 수 있다 — 손으로 훑지 말고 술어로 센다.
 *
 * 보는 축(Json_Rule):
 *  A 과소표기 — status가 미완인데 fix/verified 블록이 있다(고쳐 놓고 안 올렸다)
 *  B 과대표기 — status=implemented인데 verified가 없다(규칙 2 위반)
 *  C 증거 실재 — verified.evidence가 가리키는 저장소 파일이 실제로 있는가
 *  D 부모-자식 — 자식이 전부 implemented인데 부모 섹션이 미완으로 남았는가(또는 그 반대)
 *
 * 실행: cd F:\AI\ERP\erp; node scripts/_audit-32-status.mjs [json경로]
 */
import { readFileSync, existsSync } from 'fs'

const P = process.argv[2] ?? 'F:/AI/ERP/erp_goal/소방계획서_32.json'
const ROOT = 'F:/AI/ERP/'
const doc = JSON.parse(readFileSync(P, 'utf8'))
const DONE = new Set(['implemented', 'confirmed'])

let issues = 0
const flag = (axis, id, msg) => { issues++; console.log(`  ⚠[${axis}] ${id}  ${msg}`) }

// criteria는 중첩될 수 있다(26 세션 교훈: criteria[].criteria를 놓치면 분모가 틀린다)
const walk = (list, out = []) => {
  for (const c of list ?? []) { out.push(c); if (Array.isArray(c.criteria)) walk(c.criteria, out) }
  return out
}

console.log('══ A 과소표기 — 미완 상태인데 fix/verified가 붙어 있다 ══')
// ⚠ partial 자체는 결함이 아니다. **왜 partial인지 적혀 있으면** 그것은 정직한 표기다
//   (why_partial·still_open·must_do_next). 그런 필드가 없는데 fix/verified만 있으면
//   '고쳐 놓고 상태를 안 올린' 부류다 — F-D10이 그랬다.
const EXCUSE = ['why_partial', 'still_open', 'must_do_next', 'blocker', 'decision']
for (const s of doc.sections) {
  for (const c of walk(s.criteria)) {
    if (DONE.has(c.status)) continue
    const has = []
    if (c.fix) has.push('fix')
    if (c.verified) has.push('verified')
    if (!has.length) continue
    const why = EXCUSE.filter(k => c[k])
    if (why.length) continue   // 사유가 명시돼 있다 — 정직한 미완
    flag('A', `${s.id}/${c.id}`, `status=${c.status} 인데 ${has.join('+')}만 있고 사유(${EXCUSE.join('/')}) 없음 — 고쳐 놓고 안 올린 것 아닌가`)
  }
}

console.log('\n══ B 과대표기 — implemented인데 verified가 없다 (Json_Rule 규칙 2) ══')
for (const s of doc.sections) {
  for (const c of walk(s.criteria)) {
    if (c.status !== 'implemented') continue
    // 부모가 verified를 들고 자식이 상속하는 구조도 있으므로 judged/fix도 근거로 인정
    if (!c.verified && !c.judged && !c.fix) flag('B', `${s.id}/${c.id}`, 'verified·judged·fix 전부 없음')
  }
}

console.log('\n══ C 증거 실재 — evidence가 가리키는 저장소 파일 ══')
const seen = new Set()
for (const s of doc.sections) {
  for (const c of walk(s.criteria)) {
    const ev = [...(c.verified?.evidence ?? []), ...(c.fix?.files ?? []), ...(c.files ?? [])]
    for (const e of ev) {
      // 'erp/...' 또는 'erp_goal/...' 로 시작하는 토큰만 파일로 본다. 줄번호·괄호는 벗긴다
      const m = /(?:^|\s)((?:erp|erp_goal)\/[^\s,·)]+)/.exec(String(e))
      if (!m) continue
      const path = m[1].replace(/[:(].*$/, '').replace(/[.,]$/, '')
      if (seen.has(path)) continue
      seen.add(path)
      if (!existsSync(ROOT + path)) flag('C', `${s.id}/${c.id}`, `증거 파일 부재: ${path}`)
    }
  }
}

console.log('\n══ D 부모-자식 정합 ══')
for (const s of doc.sections) {
  const kids = walk(s.criteria)
  if (!kids.length) continue
  const allDone = kids.every(c => DONE.has(c.status))
  const noneDone = kids.every(c => !DONE.has(c.status))
  if (allDone && !DONE.has(s.status)) flag('D', s.id, `자식 ${kids.length}건 전부 완료인데 섹션은 ${s.status}`)
  if (noneDone && DONE.has(s.status)) flag('D', s.id, `자식이 하나도 완료가 아닌데 섹션은 ${s.status}`)
}

console.log(`\n지적 ${issues}건 · 문서 ${P}`)
console.log(`criteria 총 ${doc.sections.reduce((n, s) => n + walk(s.criteria).length, 0)}건 (중첩 포함)`)
process.exit(issues ? 1 : 0)
