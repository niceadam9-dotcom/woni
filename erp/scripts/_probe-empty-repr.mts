/** '빈 칸'을 어떤 XML 표현으로 두어야 **복제칸(=단일 참조 수식)이 0이 되지 않는가** — LO 왕복 실측.
 *  vehicle: 현5!C4 → 계획서!H12,  현황!S7 → 대상물!G11 (둘 다 실측된 단일 참조 복제) */
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { sheetFileMap } from '../src/lib/xlsx-inject.ts'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const dir = mkdtempSync(join(tmpdir(), 'emptyrepr-'))
const profile = mkdtempSync(join(tmpdir(), 'loprof2-'))

/** 후보 표현 — 원본 셀(현5!C4 · 현황!S7)에 넣을 XML 본문. s= 스타일은 보존 */
const REPRS: Array<[name: string, body: (attrs: string, ref: string) => string]> = [
  ['A 빈 셀(자기닫힘)',      (a, r) => `<c r="${r}"${a}/>`],
  ['B inlineStr 빈 문자열',  (a, r) => `<c r="${r}"${a} t="inlineStr"><is><t xml:space="preserve"></t></is></c>`],
  ['C inlineStr 공백 1칸',   (a, r) => `<c r="${r}"${a} t="inlineStr"><is><t xml:space="preserve"> </t></is></c>`],
  ['D t="str" 빈 <v>',       (a, r) => `<c r="${r}"${a} t="str"><v></v></c>`],
  ['E 수식 =""',             (a, r) => `<c r="${r}"${a} t="str"><f>""</f><v></v></c>`],
]
const VEHICLES: Array<[src: string, mirror: string]> = [['현5!C4', '계획서!H12'], ['현황!S7', '대상물!G11']]

const base = new Uint8Array(readFileSync('templates/report-workbook.xlsx'))
for (const [name, body] of REPRS) {
  const zip = await JSZip.loadAsync(base)
  const files = await sheetFileMap(zip)
  for (const [src] of VEHICLES) {
    const [sheet, ref] = src.split('!')
    const path = files.get(sheet)!
    const xml = await zip.file(path)!.async('string')
    const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
    const m = re.exec(xml)
    if (!m) throw new Error(`대상 없음: ${src}`)
    const attrs = (m[1] ?? '').replace(/\st="[^"]*"/, '')
    zip.file(path, xml.replace(re, () => body(attrs, ref)))
  }
  const out = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  const file = join(dir, `r${REPRS.findIndex(x => x[0] === name)}.xlsx`)
  writeFileSync(file, out)
  const odir = join(dir, `out${REPRS.findIndex(x => x[0] === name)}`)
  let ok = false
  for (let i = 0; i < 3 && !ok; i++) {
    try {
      execFileSync(SOFFICE, [`-env:UserInstallation=${pathToFileURL(profile).href}`,
        '--headless', '--norestore', '--convert-to', 'xlsx', '--outdir', odir, file],
        { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
    } catch { /* 재시도 */ }
    ok = existsSync(join(odir, `r${REPRS.findIndex(x => x[0] === name)}.xlsx`))
  }
  if (!ok) { console.log(`${name.padEnd(24)} → 왕복 실패`); continue }
  const wb = XLSX.read(new Uint8Array(readFileSync(join(odir, `r${REPRS.findIndex(x => x[0] === name)}.xlsx`))))
  const res = VEHICLES.map(([src, mir]) => {
    const [ms, mr] = mir.split('!')
    const v = (wb.Sheets[ms]?.[mr] as XLSX.CellObject | undefined)?.v
    return `${mir}=${JSON.stringify(v ?? null)}`
  })
  console.log(`${name.padEnd(24)} → ${res.join('  ')}`)
}
