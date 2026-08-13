// 제어반 면(3면)의 원문 순서 확인 — 엑셀 코드와 문장을 자리로 맞물리기 위한 근거
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const D = 'F:/AI/ERP/erp_goal/_doc01'
const f = readdirSync(D).find(x => x.startsWith('[별지 4]') && x.endsWith('.xml'))
const lines = readFileSync(join(D, f), 'utf8')
  .replace(/<\/P>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)

const all = []
lines.forEach((l, i) => {
  const m = /^(\d{1,2})\.\s*(.+?)\s*점검표$/.exec(l)
  if (m) all.push({ no: Number(m[1]), name: m[2], at: i })
})
const last = new Map()
for (const h of all) last.set(h.no, h)
const heads = [...last.values()].sort((a, b) => a.at - b.at)
const sec = no => {
  const i = heads.findIndex(h => h.no === no)
  return lines.slice(heads[i].at, i + 1 < heads.length ? heads[i + 1].at : lines.length)
}

// ① 펌프성능시험 표가 붙는 설비를 **원문 기준으로** 확정 (구현이 6개로 좁혀져 있어 교차 확인)
console.log('=== 펌프성능시험 표가 붙는 설비 (원문 기준)')
const withPump = heads.filter(h => sec(h.no).some(l => l.includes('펌프성능시험')))
console.log('  ' + withPump.map(h => `${h.no}(${h.name})`).join(' · '))
console.log(`  총 ${withPump.length}개 설비\n`)

// ② 제어반 면 원문 순서 — 코드↔문장 매핑 근거
for (const no of (process.argv[2] ? [Number(process.argv[2])] : [2, 3, 13])) {
  const s = sec(no)
  const p = s.findIndex(l => l.includes('펌프성능시험'))
  if (p < 0) { console.log(`=== 설비 ${no} — 펌프성능시험 표 없음\n`); continue }
  console.log(`=== 설비 ${no} — 펌프성능시험 표 직전 구간(제어반 면)`)
  s.slice(Math.max(0, p - 24), p).forEach(l => console.log('  ' + l.slice(0, 78)))
  console.log()
}
