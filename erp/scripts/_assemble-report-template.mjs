// 결합 보고서 템플릿 조립 (P34-5): 보고서 갑지(개요 허브+현황+세+계획서+완료보고서)
//  + 전체 보고서의 설비 점검표 시트(A열 item_code 보유) → operational_v2026.xlsx
// 사용: node scripts/_assemble-report-template.mjs          (검증만, dist 파일 생성)
//       node scripts/_assemble-report-template.mjs --upload (스테이징 Storage 업로드)
import * as XLSX from 'xlsx'
import { readFileSync, writeFileSync } from 'fs'

const ITEM_CODE_RE = /^\s*\d{1,2}-[A-Z]-\d{3}\s*$/
const rd = (p) => XLSX.read(readFileSync(p), { type: 'buffer', cellFormula: true, cellStyles: true })

const base = rd('보고서 갑지.xls')          // 개요 허브 + 현황/현/세/계획서/완료보고서
const full = rd('전체 보고서.xls')          // 설비 점검표 시트 소스

// 설비 점검표 시트 = A열에 item_code가 1개 이상 있는 시트
function hasItemCodes(ws) {
  if (!ws || !ws['!ref']) return 0
  const range = XLSX.utils.decode_range(ws['!ref'])
  let n = 0
  for (let r = range.s.r; r <= range.e.r; r++) {
    const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]
    if (a && typeof a.v === 'string' && ITEM_CODE_RE.test(a.v)) n++
  }
  return n
}

const existing = new Set(base.SheetNames)
let added = 0, totalCodes = 0
for (const name of full.SheetNames) {
  const ws = full.Sheets[name]
  const codes = hasItemCodes(ws)
  if (codes === 0) continue
  // C열(점검결과) 초기화 — 템플릿은 빈 상태로 시작
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let r = range.s.r; r <= range.e.r; r++) {
    const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]
    if (a && typeof a.v === 'string' && ITEM_CODE_RE.test(a.v)) delete ws[XLSX.utils.encode_cell({ r, c: 2 })]
  }
  let sheetName = name
  if (existing.has(sheetName)) sheetName = `설비_${name}`.slice(0, 31)
  base.Sheets[sheetName] = ws
  base.SheetNames.push(sheetName)
  existing.add(sheetName)
  added++; totalCodes += codes
  console.log(`  + ${sheetName} (${codes} 항목)`)
}

console.log(`\n설비 점검표 ${added}시트 결합, item_code 총 ${totalCodes}개`)

// 검증 1: 개요 허브 수식 보존 (보고서!C4 = '개요'!B14 계열)
const rep = base.Sheets['보고서']
const hubCell = rep && (rep['C4'] || rep['C5'] || rep['B4'])
console.log('개요 허브 수식(보고서 시트) 예시:', hubCell?.f ? `=${hubCell.f}` : (hubCell ? `값 ${hubCell.v}` : '없음'))

// 검증 2: 최종 시트 수
const out = XLSX.write(base, { bookType: 'xlsx', type: 'array' })
console.log(`최종 워크북 시트 수: ${base.SheetNames.length}`)

// 검증 3: 쓰기→재읽기 후 설비 시트/item_code 유지 확인
const re = XLSX.read(out, { type: 'array', cellFormula: true })
let reCodes = 0
for (const n of re.SheetNames) reCodes += hasItemCodes(re.Sheets[n])
console.log(`재읽기 후 item_code 총 ${reCodes}개 (조립값과 일치: ${reCodes === totalCodes})`)

writeFileSync('scripts/dist_operational_v2026.xlsx', Buffer.from(out))
console.log('저장: scripts/dist_operational_v2026.xlsx')

if (process.argv.includes('--upload')) {
  const { createClient } = await import('@supabase/supabase-js')
  const url = 'https://nwflnzugwylhpdyodyog.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SB_SERVICE_KEY
  if (!key) { console.error('SUPABASE_SERVICE_KEY 미설정 — 업로드 생략'); process.exit(1) }
  const sb = createClient(url, key)
  const { error } = await sb.storage.from('reports')
    .upload('templates/operational_v2026.xlsx', Buffer.from(out), {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true,
    })
  console.log(error ? `업로드 실패: ${error.message}` : '✅ 업로드: templates/operational_v2026.xlsx')
}
