import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"; import { tmpdir } from "node:os"; import { execFileSync } from "node:child_process"
import XLSX from "xlsx"
const SOFFICE = "C:\\Program Files\\LibreOffice\\program\\soffice.com"
const dir = mkdtempSync(join(tmpdir(), "rtchk-"))
const prof = `file:///${join(dir,"p").replace(/\\/g,"/")}`
const src = join(dir, "asset.xlsx"); writeFileSync(src, readFileSync("templates/report-workbook.xlsx"))
let ok = false
for (let i=0;i<3 && !ok;i++){ try{ execFileSync(SOFFICE,[`-env:UserInstallation=${prof}`,"--headless","--norestore","--convert-to","xlsx","--outdir",join(dir,"o"),src],{timeout:300000,windowsHide:true,stdio:"pipe"}) }catch{}
  ok = existsSync(join(dir,"o","asset.xlsx")) }
const out:string[] = [`LO 왕복 성공=${ok}`]
if (ok) { const wb = XLSX.read(readFileSync(join(dir,"o","asset.xlsx")), { cellFormula: true })
  const g=(s:string,c:string)=>{const x=wb.Sheets[s]?.[c] as XLSX.CellObject|undefined; return `${s}!${c} v=${JSON.stringify(String(x?.v??""))}${x?.f?` f=${x.f}`:""}`}
  out.push("### HIGH-1 판정 마크가 LO 재계산으로 되살아나는가")
  for (const c of ["S7","AO13","S28","AO28"]) out.push("  "+g("현황",c))
  let mk=0; for(const s of wb.SheetNames){const ws=wb.Sheets[s];for(const k of Object.keys(ws)){if(k.startsWith("!"))continue;const t=String((ws[k] as XLSX.CellObject).v??"").trim(); if(["○","×","X","/","／"].includes(t))mk++}}
  out.push(`  전 시트 판정 마크 재계산 결과: ${mk}칸`)
  out.push("### HIGH-2 계획서가 0으로 인쇄되는가")
  for (const c of ["H12","H14","H16"]) out.push("  "+g("계획서",c))
  out.push("  "+g("현5","C4"))
}
writeFileSync("scripts/_verify-dfind.txt", out.join("\n"), "utf8")
