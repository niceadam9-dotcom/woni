// 펌프성능시험 표 9회 출현의 앞뒤 문맥을 그대로 찍어 '설비 귀속'을 눈으로 확정한다 (읽기 전용).
// 자동 카운트만 믿지 않는다 — 이 리포는 계수 오류로 두 번 오판한 전력이 있다.
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const GOAL = 'F:\\AI\\ERP\\erp_goal'
const f = readdirSync(join(GOAL, '_doc01')).find(x => x.startsWith('[별지 4]') && x.endsWith('.xml'))
const text = readFileSync(join(GOAL, '_doc01', f), 'utf8')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/[ \t]+/g, ' ')

let i = -1, n = 0
while ((i = text.indexOf('펌프성능시험', i + 1)) !== -1) {
  n++
  const before = text.slice(Math.max(0, i - 900), i)
  // 직전 설비 제목
  const facs = [...before.matchAll(/(\d{1,2})\s*[.．]\s*([가-힣A-Za-z0-9()·\s]{2,28}설비)/g)]
  const last = facs[facs.length - 1]
  console.log(`\n[${n}] 위치 ${i}`)
  console.log(`   직전 설비 제목: ${last ? `${last[1]}. ${last[2].trim()}` : '(없음)'}`)
  console.log(`   문맥: …${text.slice(i - 70, i + 90).replace(/\s+/g, ' ').trim()}…`)
}
console.log(`\n총 ${n}회`)
