/** 두 경로가 「근생」으로 **한 목소리를 내는지** 확인한다 (2026-09-08 사용자 결정).
 *  ① ERP 생성 경로 산출물 ② 독립 생성기 산출물 ③ 강순기 원본(정답지) 을 나란히 본다. */
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

const FILES: [string, string][] = [
  ['① ERP 생성 경로', 'F:\\AI\\sjfire\\_강순기_형식비교\\_e2e_소방계획서.xlsx'],
  ['② 독립 생성기(신)', 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서_v7.xlsx'],
  ['③ 독립 생성기(구)', 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서_v6.xlsx'],
]

for (const [label, path] of FILES) {
  let wb: XLSX.WorkBook
  try { wb = XLSX.read(readFileSync(path), { sheetStubs: true }) } catch { console.log(`${label}: 파일 없음`); continue }
  const hits: string[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    for (const ref of Object.keys(ws)) {
      if (ref.startsWith('!')) continue
      const v = ws[ref]?.v
      if (typeof v !== 'string') continue
      if (v === '근생' || v.includes('근린생활시설')) hits.push(`${name}!${ref} «${v}»`)
    }
  }
  console.log(`${label}  —  ${hits.length}칸`)
  for (const h of hits) console.log(`   ${h}`)
  console.log()
}
