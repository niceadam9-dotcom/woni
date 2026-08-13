// 편입 항목명이 고시 원문과 축자 일치하는지 — 마이그레이션 132 값 vs 원문
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const D = 'F:/AI/ERP/erp_goal/_doc01'
const f = readdirSync(D).find(x => x.startsWith('[별지 4]') && x.endsWith('.xml'))
const lines = readFileSync(join(D, f), 'utf8')
  .replace(/<\/P>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .split('\n').map(s => s.trim()).filter(Boolean)

const all = []
lines.forEach((l, i) => {
  const m = /^(\d{1,2})\.\s*(.+?)\s*점검표$/.exec(l)
  if (m) all.push({ no: Number(m[1]), at: i })
})
const last = new Map()
for (const h of all) last.set(h.no, h)
const heads = [...last.values()].sort((a, b) => a.at - b.at)
const sec = no => {
  const i = heads.findIndex(h => h.no === no)
  return lines.slice(heads[i].at, i + 1 < heads.length ? heads[i + 1].at : lines.length)
}

// 마이그레이션 132가 넣는 값 (다른 세션 작성분)
const MIG = [
  [2, '2-H-021', '앞면은 적색으로 하고,“옥내소화전설비용 동력제어반”표지 설치 여부'],
  [3, '3-K-031', '앞면은 적색으로 하고,“스프링클러설비용 동력제어반”표지 설치 여부'],
  [13, '13-G-031', '앞면은 적색으로 하고,“옥외소화전설비용 동력제어반”표지 설치 여부'],
  [2, '2-H-018', '감시제어반 전용실 적정 설치 및 관리 여부'],
  [3, '3-K-023', '감시제어반과 수신기 간 상호 연동 여부(별도로 설치된 경우)'],
  [3, '3-L-001', '헤드 설치 제외 적정 여부(설치 제외된 경우)'],
]

const show = s => s.replace(/ /g, '·')   // 공백을 눈에 보이게
let diff = 0
for (const [no, code, mig] of MIG) {
  const body = sec(no).map(l => l.replace(/^[●○]\s*/, '').replace(/\s+$/, ''))
  // 원문에서 같은 뜻의 줄 찾기 — 공백·따옴표를 지운 형태로 매칭
  const norm = s => s.replace(/[\s"“”]/g, '')
  const hit = body.find(l => norm(l) === norm(mig))
  if (!hit) { console.log(`${code}  ⚠ 원문에서 못 찾음`); continue }
  const same = hit === mig
  if (!same) diff++
  console.log(`${code}  ${same ? '✅ 축자 일치' : '⚠ 표기 차이'}`)
  if (!same) {
    console.log(`   원문 : ${show(hit)}`)
    console.log(`   132  : ${show(mig)}`)
  }
}
console.log(`\n표기 차이 ${diff}건 / 검사 ${MIG.length}건`)
