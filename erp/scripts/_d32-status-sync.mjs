// 32.json D트랙 criteria status를 독립 판정(S12) 결과로 갱신한다. 1회용.
// 실행: cd F:\AI\ERP\erp; node scripts/_d32-status-sync.mjs
import { readFileSync, writeFileSync } from 'fs'

const P = 'F:/AI/ERP/erp_goal/소방계획서_32.json'
const doc = JSON.parse(readFileSync(P, 'utf8'))

const VERDICT = {
  D4: 'implemented',   // 판정 A — F-1~F-7 변이 전건 이빨 확인
  D5: 'implemented',   // 판정 A — 수치 8/8 일치 + 인과(209↔208)까지
  D7: 'implemented',   // 판정 B — 순수 추가·호출부 3곳 무변경·243==243 (note 사유만 X-7로 정정)
  D8: 'partial',       // 판정 B — 분류·keptSheets·500 양방향은 실증, 절단 수치 거짓(F-D2)·X-6 단정 오류
  D9: 'implemented',   // 판정 C — 수치·변이 전건 재현, 기대가 독립 축
  D11: 'partial',      // 판정 C — 테스트·라이브는 implemented급, 렌더 축이 항진명제였다(F-D3·F-D4)
}

const s11 = doc.sections.find(s => s.id === 'S11')
if (!s11) throw new Error('S11 없음')
let n = 0
for (const c of s11.criteria) {
  if (VERDICT[c.id] && c.status !== VERDICT[c.id]) {
    console.log(`  ${c.id}: ${c.status} -> ${VERDICT[c.id]}`)
    c.status = VERDICT[c.id]
    c.judged = { date: '2026-08-30', by: '독립 판정 4인(S12)', see: 'S13 결함 목록 · S14 문서 오류 정정' }
    n++
  }
}
writeFileSync(P, JSON.stringify(doc, null, 2) + '\n', 'utf8')
console.log(`갱신 ${n}건`)

// 재파싱 + 상태 집계
const back = JSON.parse(readFileSync(P, 'utf8'))
const st = {}
for (const sec of back.sections) for (const c of (sec.criteria ?? [])) st[c.status] = (st[c.status] ?? 0) + 1
console.log('JSON OK ·', JSON.stringify(st))
