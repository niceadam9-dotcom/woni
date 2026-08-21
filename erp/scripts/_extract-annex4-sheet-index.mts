/** F-1 Phase 0 — 고시 별지4 XML에서 점검표 번호↔설비명 색인과 항목 코드를 추출(읽기 전용).
 *  hwpx 추출 XML은 텍스트가 태그로 잘게 쪼개져 있을 수 있어, 태그를 벗겨 평문화한 뒤 훑는다.
 *  실행: npx tsx scripts/_extract-annex4-sheet-index.mts */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const XML = path.join(import.meta.dirname, '..', '..', 'erp_goal', '_doc01',
  '[별지 4] 소방시설등(작동점검¸ 종합점검(최초점검¸ 그 밖의 점검) 점검표(소방시설 자체점검사항 등에 관한 고시) (2).xml')
const raw = readFileSync(XML, 'utf8')
console.log(`원문 ${Math.round(raw.length / 1024)}KB`)

// 태그 제거 — hwpx XML은 문장 하나가 여러 텍스트 노드로 쪼개진다. 태그를 지우고 이어 붙인 평문에서 찾는다.
const flat = raw.replace(/<[^>]+>/g, '')
writeFileSync(path.join(import.meta.dirname, '_out', 'annex4-flat.txt'), flat, 'utf8')
console.log(`평문 ${Math.round(flat.length / 1024)}KB → scripts/_out/annex4-flat.txt`)

// 1) 항목 코드 패턴 — 고시 점검표는 '6-A-001' 꼴 번호를 쓴다(ERP item_code의 유래)
const codeRe = /(\d{1,2})-([A-Z])-(\d{3})/g
const byNum = new Map<number, Set<string>>()
for (const m of flat.matchAll(codeRe)) {
  const n = Number(m[1])
  if (!byNum.has(n)) byNum.set(n, new Set())
  byNum.get(n)!.add(`${m[1]}-${m[2]}-${m[3]}`)
}
console.log('\n=== 항목 코드가 존재하는 설비번호(고시 원문)')
for (const n of [...byNum.keys()].sort((a, b) => a - b)) {
  const codes = [...byNum.get(n)!].sort()
  console.log(`  ${String(n).padStart(2)}번: ${codes.length}개  (${codes[0]} ~ ${codes[codes.length - 1]})`)
}

// 2) 시트 제목 후보 — '숫자. 설비명 점검표' 또는 표머리 패턴
console.log('\n=== 제목 후보(번호 근처 문맥)')
const nums = [5, 6, 7, 8, 10, 12, 18, 24, 30]
for (const n of nums) {
  // 그 번호의 첫 항목 코드 위치 앞 200자에서 제목을 찾는다
  const first = flat.search(new RegExp(`(?<!\\d)${n}-A-001`))
  if (first < 0) { console.log(`  ${n}번: 항목 코드 없음`); continue }
  const ctx = flat.slice(Math.max(0, first - 260), first).replace(/\s+/g, ' ').trim()
  console.log(`  ${n}번 앞 문맥: …${ctx.slice(-180)}`)
}

// 3) 9종 설비명이 평문에 등장하는 위치 수
console.log('\n=== 9종 설비명 등장 횟수')
for (const name of ['물분무소화설비', '미분무소화설비', '포소화설비', '분말소화설비', '강화액소화설비',
  '고체에어로졸소화설비', '누전경보기', '거실제연', '제연설비', '연소방지설비', '화재조기진압용']) {
  const c = (flat.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
  console.log(`  ${name}: ${c}회`)
}
