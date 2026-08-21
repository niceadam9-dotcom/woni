/** 소방계획서_23 S4-4 — MU(다중이용업소 안전시설등) 법정 순서 회귀 프로브. 읽기 전용(DB·파일 무변경).
 *
 *  muResultSection()을 직접 호출해 HTML을 만들고, 법정 원문(_별지4호_현행판_추출.txt:93-123)의
 *  라벨 순서열과 대조한다.
 *
 *  ⚠ 종전 주석은 '별지 9호 3쪽·별지 4호 2쪽이 같은 함수라 1회로 양쪽 커버'였는데 그 전제가 깨졌다
 *    (소방계획서_19 A4-6, 2026-08-20). 두 서식은 개정 단계가 달라 MU-007 표기가 다르고
 *    (4호 '피난안내도ㆍ…' / 9호 '피난안내도, …'), 이제 form 축으로 분기한다.
 *    여기 원천이 **4호 추출본**이므로 4호로 렌더해 대조하고, 9호 표기는 아래에서 따로 짚는다.
 *    순서와 나머지 15개 라벨은 양쪽이 같으므로 P-4·P-5 순서 회귀 고정은 그대로 유효하다.
 *
 *  원천은 2열 표를 행 우선으로 선형화했으므로(좌·우가 교차) 전체를 한 줄로 비교할 수 없다 —
 *  좌열 8라벨·우열 8라벨의 **열별 부분수열**이 각각 단조 증가하는지로 판정한다(P-4·P-5 회귀 고정).
 *  실행: npx tsx scripts/_probe-mu-order.mts */
import { readFileSync } from 'fs'
import r9mod from '../src/lib/doc-templates/report9.ts'

const { muResultSection } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// 공백·대괄호를 걷어낸 정규화 — txt는 '[ ]소화기…'·줄 분할, HTML은 태그·<br>가 섞인다
const norm = (s: string) => s.replace(/<[^>]+>/g, '').replace(/[\s[\]]/g, '')

/** 법정 순서(§3-1 — 원천 :93-123에서 확정). ㆍ는 U+318D 축자(P-8). */
const LEFT = [
  '소화기또는자동확산소화기', '간이스프링클러설비', '비상경보설비또는자동화재탐지설비', '가스누설경보기',
  '피난기구', '피난유도선', '유도등,유도표지또는비상조명등', '휴대용비상조명등',
]
const RIGHT = [
  '방화문', '비상구(비상탈출구)', '영업장내부피난통로', '영상음향차단장치', '누전차단기',
  '창문', '피난안내도ㆍ피난안내영상물', '방염대상물품',
]

function assertMonotone(label: string, hay: string, seq: string[]) {
  let prev = -1
  for (const s of seq) {
    const at = hay.indexOf(s, prev + 1)
    if (at < 0) {
      check(`${label} — "${s}"`, false, prev < 0 ? '미출현' : '순서 위반 또는 미출현(직전 라벨 뒤에서 못 찾음)')
      return
    }
    prev = at
  }
  check(`${label} — ${seq.length}라벨 순서 일치`, true)
}

// ── 1. 원천(:93-123) — 법정 순서열의 근거가 지금도 유효한지 고정 ──
console.log('=== 원천 _별지4호_현행판_추출.txt:93-123')
const lines = readFileSync('F:\\AI\\ERP\\erp_goal\\_form\\_별지4호_현행판_추출.txt', 'utf8').split(/\r?\n/)
const seg = norm(lines.slice(92, 123).join(''))
assertMonotone('원천 좌열', seg, LEFT)
assertMonotone('원천 우열', seg, RIGHT)
check('원천 ㆍ(U+318D) 축자', seg.includes('피난안내도ㆍ피난안내영상물'))

// ── 2. 렌더 HTML — muResultSection 실호출 ──
console.log('=== muResultSection() 렌더')
const muResults: Record<string, 'O' | 'X' | 'N'> = {}
for (let i = 1; i <= 16; i++) muResults[`MU-${String(i).padStart(3, '0')}`] = 'O'
const html = muResultSection({ muResults }, { form: 'annex4' })
const flat = norm(html)
assertMonotone('렌더 좌열', flat, LEFT)
assertMonotone('렌더 우열', flat, RIGHT)
check('렌더 ㆍ(U+318D) 축자 — 라벨 §3-3', flat.includes('피난안내도ㆍ피난안내영상물'))

// 별지 9호는 같은 자리를 쉼표로 적는다(A4-6) — 양방향으로 짚는다.
// 한쪽만 보면 '4호 표기가 9호에도 새어 있는' 종전 상태를 통과로 읽는다.
const flat9 = norm(muResultSection({ muResults }, { form: 'annex9' }))
check('별지9호 렌더 — MU-007은 쉼표 표기', flat9.includes('피난안내도,피난안내영상물'))
check('별지9호 렌더 — 4호 표기(ㆍ)가 남아 있지 않다', !flat9.includes('피난안내도ㆍ'))
assertMonotone('별지9호 렌더 좌열', flat9, LEFT)

// P-4·P-5 핵심 회귀 — 피난안내도·창문이 '기타'(우열)에 있고 피난구조설비(좌열)에 없다.
// 좌열은 좌 <td>가 우 <td>보다 앞이므로, 우열 첫 라벨(방화문)보다 앞 구간이 좌열 전체다.
const leftEnd = flat.indexOf('방화문')
check('P-4 — 피난안내도가 좌열(피난구조설비)에 없음', !flat.slice(0, leftEnd).includes('피난안내도'))
check('P-5 — 창문이 좌열(피난구조설비)에 없음', !flat.slice(0, leftEnd).includes('창문'))
check('P-4 — 기타 구분에서 창문 다음·방염 앞', (() => {
  const a = flat.indexOf('창문'), b = flat.indexOf('피난안내도'), c = flat.indexOf('방염대상물품')
  return a >= 0 && a < b && b < c
})())
// 라벨 중복 출현 방지 — 옮기면서 원위치를 안 지웠으면 두 번 나온다
check('피난안내도 1회만 출현', flat.indexOf('피난안내도') === flat.lastIndexOf('피난안내도'))
check('창문 1회만 출현', flat.indexOf('창문') === flat.lastIndexOf('창문'))

console.log(`\n=== 결과 — ${pass}/${pass + fail}${fail ? ` (실패 ${fail})` : ''}`)
process.exit(fail ? 1 : 0)
