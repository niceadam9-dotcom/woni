import { readFileSync, writeFileSync } from "node:fs"
import XLSX from "xlsx"
import { MARK_CHECKED_RE } from "../src/lib/xlsx-anchors.ts"
import { allDonorSheets } from "../src/lib/xlsx-donors.ts"
const wb = XLSX.read(readFileSync("templates/report-workbook-full.xlsx"), { cellFormula: true })
const donor = new Set(allDonorSheets())
const out: string[] = []
let fmlMark = 0, litMark = 0
const V = ["○","×","X","/","／","●"]
const verdictHits: string[] = []
const wordHits: string[] = []
for (const s of wb.SheetNames) { const ws = wb.Sheets[s]
  for (const k of Object.keys(ws)) { if (k.startsWith("!")) continue
    const c = ws[k] as XLSX.CellObject; const t = String(c.v ?? "")
    if (MARK_CHECKED_RE.test(t)) { if (c.f) { fmlMark++; out.push(`FMLMARK ${s}!${k} f=${c.f} v=${JSON.stringify(t.slice(0,40))}`) } else litMark++ }
    if (V.includes(t.trim())) verdictHits.push(`${s}!${k}='${t.trim()}'${donor.has(s)?"(도너)":""}`)
    for (const w of ["양호","적합","특이사항 없음","해당없음"]) if (t.includes(w)) wordHits.push(`${s}!${k}⊃${w}${donor.has(s)?"(도너)":""}`)
  } }
out.unshift(`### 수식 캐시에 체크마크: ${fmlMark}칸 · 리터럴: ${litMark}칸`)
out.push(`\n### 판정마크(6종) 잔존 ${verdictHits.length}칸: ${verdictHits.slice(0,14).join(" ")}`)
out.push(`\n### 소견 어휘 ${wordHits.length}칸: ${wordHits.slice(0,14).join(" ")}`)
writeFileSync("scripts/_verify-efind.txt", out.join("\n"), "utf8")
