// [+ 건물 등록] 복원(2026-09-15)의 변이 프로브 — 「검사가 실제로 무는가」를 제품 소스로 실측한다.
//
// 왜 필요한가: test-49-building-always의 H3·H4·H6·H7은 **소스 모양만 보는 단언**이다. 그런 단언은
// 값이 빈 채로도, 심지어 한 줄도 안 바뀐 채로도 초록이 되는 부류다(45·48·52차 교훈). 그래서
// 제품 파일을 실제로 되돌려 보고 **빨강으로 전환되는지**를 센다.
//
// 🚨 치환 건수를 반드시 가드한다. 이 저장소는 CRLF라 정규식이 조용히 0건 치환되고, 그러면
//    「변이했는데 초록」이 아니라 **「변이가 아예 안 돌았는데 초록」**이 된다(구별 불가).
//
// 실행: node scripts/_probe-49-restore-mutants.mjs   (erp/ 에서)
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const PANEL = 'src/components/customers/building-inline-panel.tsx'
const ORIG = readFileSync(PANEL, 'utf8')

/** 변이를 넣고 검사를 돌린다. 기대: exit != 0 (빨강). */
const MUTANTS = [
  {
    id: 'M1',
    why: '버튼 JSX를 통째로 제거 (cf139d0 상태로 되돌림) → H3가 물어야 한다',
    expect: 'H3',
    apply: s => {
      const re = /\{canManage && \(\r?\n\s*<button onClick=\{openNew\}[\s\S]*?<\/button>\r?\n\s*\)\}\r?\n/
      const hits = (s.match(re) ?? []).length
      return { out: s.replace(re, ''), hits }
    },
  },
  {
    id: 'M2',
    why: "렌더 조건에 `editing !== 'new'`를 붙여 **숨김**을 되살림 → H6가 물어야 한다",
    expect: 'H6',
    apply: s => {
      const re = /\{canManage && \(\r?\n(\s*)<button onClick=\{openNew\}/
      // 🚨 건수는 **캡처 그룹 없는 전역 정규식**으로 센다. `s.match(비전역)`은 match[0]에 이어
      //    캡처 그룹까지 담은 배열이라 `.length`가 「치환 건수」가 아니다 — 여기서 2가 나와
      //    멀쩡한 변이를 「안 돌았다」로 읽었다(2026-09-15 실측). 계측기가 먼저 틀린 자리다.
      const hits = (s.match(/\{canManage && \(\r?\n\s*<button onClick=\{openNew\}/g) ?? []).length
      return { out: s.replace(re, "{canManage && editing !== 'new' && (\n$1<button onClick={openNew}"), hits }
    },
  },
  {
    id: 'M3',
    why: 'disabled 가드를 떼어 입력 중 초기화를 되살림 → H7이 물어야 한다',
    expect: 'H7',
    apply: s => {
      const re = / disabled=\{editing === 'new'\}/
      const hits = (s.match(re) ?? []).length
      return { out: s.replace(re, ''), hits }
    },
  },
  {
    id: 'M4',
    why: 'lucide import에서 Plus를 다시 뺌 → H4가 물어야 한다',
    expect: 'H4',
    apply: s => {
      const re = /^import \{ Building2, Plus, /m
      const hits = (s.match(re) ?? []).length
      return { out: s.replace(re, 'import { Building2, '), hits }
    },
  },
]

function runSuite() {
  try {
    const out = execFileSync('npx', ['tsx', 'scripts/test-49-building-always.mts'], { encoding: 'utf8', shell: true })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

console.log('— 기준선(변이 없음): 초록이어야 한다')
const base = runSuite()
console.log(`  기준선 exit=${base.code} · ${base.out.trim().split('\n').pop()}`)
if (base.code !== 0) { console.log('🚨 기준선이 이미 빨강 — 변이 판정 불가'); process.exit(1) }

let killed = 0, total = 0
for (const m of MUTANTS) {
  total++
  const { out: mutated, hits } = m.apply(ORIG)
  if (hits !== 1) {
    console.log(`  ❌ ${m.id} 치환 ${hits}건 (1이어야 한다) — **변이가 안 돌았다**, 초록으로 읽지 말 것`)
    continue
  }
  if (mutated === ORIG) { console.log(`  ❌ ${m.id} 내용이 그대로다`); continue }
  writeFileSync(PANEL, mutated)
  const r = runSuite()
  writeFileSync(PANEL, ORIG)
  const bit = r.code !== 0
  // 기대한 그 단언이 빨강인가 — 다른 게 빨개져도 exit != 0이라 구별해야 한다
  const rightOne = new RegExp(`❌ \\[${m.expect}`).test(r.out)
  if (bit && rightOne) { killed++; console.log(`  ✅ ${m.id} 죽였다 — ${m.expect} 빨강 · ${m.why}`) }
  else console.log(`  ❌ ${m.id} 생존(exit=${r.code}, ${m.expect} 빨강=${rightOne}) — ${m.why}`)
}

// 원본 복구 확인 — 프로브가 제품을 망가뜨린 채 끝나면 안 된다
const restored = readFileSync(PANEL, 'utf8') === ORIG
console.log(`\n원본 복구: ${restored ? '✅' : '🚨 실패'}`)
console.log(`결과: 변이 ${killed}/${total} 사살`)
process.exit(killed === total && restored ? 0 : 1)
