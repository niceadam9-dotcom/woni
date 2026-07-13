// injectSheetResults 셀맵 자기검증: 실제 보고서 C열을 응답맵으로 역산 → 비우고 재주입 → 원본과 일치?
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'

const RESULT_SYMBOL = { O: '○', X: 'X', N: '/' }
const ITEM_CODE_RE = /^\s*\d{1,2}-[A-Z]-\d{3}\s*$/
const SYM_TO_RES = { '○': 'O', 'X': 'X', '/': 'N', '／': 'N' }

const wb = XLSX.read(readFileSync('강순기건물 작동보고서 - 25. 12. 01 주윤종.xls'), { type: 'buffer', cellFormula: true })

// 1) 원본 C열 → 응답맵 + 원본 스냅샷
const responses = {}
const original = {}
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) continue
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let r = range.s.r; r <= range.e.r; r++) {
    const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]
    if (!a || typeof a.v !== 'string' || !ITEM_CODE_RE.test(a.v)) continue
    const code = a.v.trim()
    const c = ws[XLSX.utils.encode_cell({ r, c: 2 })]
    const sym = c && typeof c.v === 'string' ? c.v.trim() : ''
    const res = SYM_TO_RES[sym]
    if (res) { responses[code] = res; original[`${name}!${r}`] = { code, sym } }
  }
}
console.log('역산된 응답 수:', Object.keys(responses).length)

// 2) C열 비우기
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) continue
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let r = range.s.r; r <= range.e.r; r++) {
    const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]
    if (a && typeof a.v === 'string' && ITEM_CODE_RE.test(a.v)) delete ws[XLSX.utils.encode_cell({ r, c: 2 })]
  }
}

// 3) 재주입 (injectSheetResults와 동일 로직)
let injected = 0
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) continue
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let r = range.s.r; r <= range.e.r; r++) {
    const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]
    if (!a || typeof a.v !== 'string' || !ITEM_CODE_RE.test(a.v)) continue
    const res = responses[a.v.trim()]; if (!res) continue
    ws[XLSX.utils.encode_cell({ r, c: 2 })] = { t: 's', v: RESULT_SYMBOL[res] }
    injected++
  }
}

// 4) 비교
let mismatch = 0
for (const [key, o] of Object.entries(original)) {
  const [name, rs] = key.split('!'); const r = parseInt(rs, 10)
  const c = wb.Sheets[name][XLSX.utils.encode_cell({ r, c: 2 })]
  const got = c ? c.v : ''
  const want = RESULT_SYMBOL[SYM_TO_RES[o.sym]]
  if (got !== want) { mismatch++; if (mismatch <= 5) console.log(`  불일치 ${key} ${o.code}: 원본 ${o.sym} → 재주입 ${got}`) }
}
console.log(`재주입: ${injected}건, 원본대비 불일치: ${mismatch}건`)
console.log(mismatch === 0 ? '✅ 셀맵 검증 통과 (원본 완전 재현)' : '❌ 불일치 존재')
