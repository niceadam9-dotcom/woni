/** 정보 시트 리터럴 12칸 원문 실측 (소방계획서_27 F세대 §1-② 수리 준비)
 *
 *  주입값 조립은 이 원문과 **자구 일치**해야 한다. 세 축을 함께 본다:
 *   ① 원본 `보고서 갑지.xls` — 고객이 손으로 쓰던 정본(파생본 아님, feedback_legal_form_source)
 *   ② 배포 자산 `templates/report-workbook-full.xlsx` — 실제로 라우트가 쓰는 것
 *   ③ 해당 칸이 XML에 `<c r>`로 실재하는가(없는 셀엔 주입 불가 — S0-5 실질 축)
 *  출력은 UTF-8 파일로 직접 쓴다(PS 5.1 리다이렉트가 한글을 깨므로). */
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'
import JSZip from 'jszip'

const CELLS = ['B5', 'B8', 'B10', 'B11', 'B12', 'B13', 'B14', 'E14', 'I14', 'B19', 'B20', 'B21', 'B22', 'B23']

const out: string[] = []
const log = (s: string) => out.push(s)

const orig = XLSX.read(readFileSync('보고서 갑지.xls'))
const tplBytes = readFileSync('templates/report-workbook-full.xlsx')
const tpl = XLSX.read(tplBytes)

log('### 정보 시트 리터럴 — 원본(갑지.xls) vs 배포자산(-full.xlsx)')
for (const c of CELLS) {
  const o = orig.Sheets['정보']?.[c] as XLSX.CellObject | undefined
  const t = tpl.Sheets['정보']?.[c] as XLSX.CellObject | undefined
  const os = o?.v === undefined ? null : String(o.v)
  const ts = t?.v === undefined ? null : String(t.v)
  log(`\n정보!${c}`)
  log(`  원본 : ${JSON.stringify(os)}`)
  log(`  자산 : ${JSON.stringify(ts)}`)
  log(`  동일 : ${os === ts ? 'YES' : '*** NO ***'}${t?.f ? ` (자산에 수식 f=${t.f})` : ''}`)
}

// ③ XML 실재
const zip = await JSZip.loadAsync(tplBytes)
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rel = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const fileOf = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) fileOf.set(m[1], `xl/${rel.get(m[2])}`)
const xml = await zip.file(fileOf.get('정보')!)!.async('string')
const absent = CELLS.filter(c => !new RegExp(`<c r="${c}"[ />]`).test(xml))
log(`\n### XML 실재: ${CELLS.length}칸 중 부재 ${absent.length ? absent.join(',') : '0'}`)

// 라벨 칸(A열) — 앵커 검증축으로 쓸 값
log('\n### 라벨 칸 실값(앵커 labelCell 후보)')
for (const c of ['A5', 'A8', 'A10', 'A11', 'A12', 'A13', 'A14', 'A19', 'A20', 'A21', 'A22', 'A23']) {
  const t = tpl.Sheets['정보']?.[c] as XLSX.CellObject | undefined
  log(`  정보!${c} = ${JSON.stringify(t?.v === undefined ? null : String(t.v))}`)
}

// E14·I14는 라벨이 없다(A14 하나가 3열을 덮는 병합) — 병합 실측
const merges = (tpl.Sheets['정보'] as XLSX.WorkSheet)['!merges'] ?? []
const near14 = merges.filter(m => m.s.r === 13 || m.e.r === 13).map(m => XLSX.utils.encode_range(m))
log(`\n### 14행 병합: ${near14.join(' ') || '(없음)'}`)

writeFileSync('scripts/_probe-info-raw-literals.txt', out.join('\n'), 'utf8')
console.log('wrote scripts/_probe-info-raw-literals.txt')
