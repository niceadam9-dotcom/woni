/** 소방계획서_27 Phase 5(S10) 실측 — 워크북 시트 제거·이식이 성립하는가
 *  실행: npx tsx scripts/_probe-sheet-transplant.mts     (로컬 LibreOffice 필요)
 *
 *  Phase 5는 두 수술이 필요하다:
 *  ① [제거] 고객 미설치 설비의 점검표 시트를 워크북에서 뺀다(경복빌딩 실물 = 갑지 - 2시트 + 설비 6시트)
 *  ② [이식] 전체 보고서.xls(43시트)의 설비별 점검표 시트를 갑지 워크북에 붙인다
 *  ①은 zip 항목 삭제 + 목록 3곳 정리로 끝나지만, ②는 styles.xml·sharedStrings 병합·재번호가
 *  걸린다 — 성립 여부를 코드 쓰기 전에 실측한다. 실패하면 Phase 5 설계를 바꾼다
 *  (예: 빌드 타임에 LibreOffice로 병합본을 만들어 두고 런타임엔 제거만). */
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { sheetFileMap } from '../src/lib/xlsx-inject.ts'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const TPL = 'templates/report-workbook.xlsx'
const dir = mkdtempSync(join(tmpdir(), 'x27p5-'))
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}
function toPdf(src: string, outDir: string): string | null {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  try {
    execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, src],
      { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
  } catch (e) {
    console.log(`     soffice: ${String((e as { message?: string }).message ?? e).split('\n')[0]}`)
    return null
  }
  const out = join(outDir, basename(src).replace(/\.xlsx$/, '.pdf'))
  return existsSync(out) ? out : null
}
const pageCount = (p: string) => (readFileSync(p).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

// ── ① 시트 제거 — 다수동일때·다수동을 빼 본다 ────────────────────────
console.log('[1] 시트 제거 — 다수동일때·다수동(경복빌딩 실물에 없는 2시트)')
{
  const bytes = new Uint8Array(readFileSync(TPL))
  const zip = await JSZip.loadAsync(bytes)
  let wbXml = await zip.file('xl/workbook.xml')!.async('string')
  let relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  let ctXml = await zip.file('[Content_Types].xml')!.async('string')

  for (const name of ['다수동일때', '다수동']) {
    const sm = new RegExp(`<sheet[^>]*name="${name}"[^>]*r:id="(rId\\d+)"[^>]*/>`).exec(wbXml)
    if (!sm) { check(`${name} 시트 항목 발견`, false); continue }
    const rid = sm[1]
    const tm = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"[^>]*/>`).exec(relsXml)
    if (!tm) { check(`${name} rels 발견`, false); continue }
    const part = `xl/${tm[1].replace(/^\.\//, '')}`
    wbXml = wbXml.replace(sm[0], '')
    relsXml = relsXml.replace(tm[0], '')
    ctXml = ctXml.replace(new RegExp(`<Override[^>]*PartName="/${part.replace(/\//g, '\\/')}"[^>]*/>`), '')
    zip.remove(part)
    console.log(`     ${name} → ${part} 제거`)
  }
  zip.file('xl/workbook.xml', wbXml)
  zip.file('xl/_rels/workbook.xml.rels', relsXml)
  zip.file('[Content_Types].xml', ctXml)
  const outPath = join(dir, 'removed.xlsx')
  writeFileSync(outPath, await zip.generateAsync({ type: 'nodebuffer' }))

  const wb = XLSX.read(readFileSync(outPath), { cellStyles: true })
  check('24시트로 열림(SheetJS)', wb.SheetNames.length === 24, `${wb.SheetNames.length}`)
  const merges = wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]['!merges'] ?? []).length), 0)
  console.log(`     잔여 병합 ${merges}`)
  const pdf = toPdf(outPath, join(dir, 'p1'))
  check('LibreOffice가 연다(PDF 변환)', !!pdf, pdf ? `${pageCount(pdf)}쪽` : '')
  // 제거 시트를 참조하던 definedNames가 남아 깨질 수 있다 — 개수만 기록(치명 아님, LO가 열면 성립)
  const namesLeft = ((await (await JSZip.loadAsync(readFileSync(outPath))).file('xl/workbook.xml')!.async('string'))
    .match(/<definedName /g) ?? []).length
  console.log(`     definedNames 잔존 ${namesLeft} (제거 시트 참조분은 #REF!화 — 인쇄에는 무영향 추정, Excel 육안 시 확인)`)
}

// ── ② 시트 이식 — 전체 보고서의 '소' 시트를 갑지에 붙여 본다 ─────────
console.log('\n[2] 시트 이식 — 전체 보고서.xls의 설비별 점검표 1시트(스타일 충돌 실측)')
{
  // 전체 보고서를 xlsx로 변환(LibreOffice — SheetJS 변환은 서식 전멸)
  execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'xlsx', '--outdir', dir, 'F:/AI/ERP/erp/전체 보고서.xls'],
    { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
  const srcPath = join(dir, '전체 보고서.xlsx')
  check('전체 보고서 변환', existsSync(srcPath))

  const src = await JSZip.loadAsync(readFileSync(srcPath))
  const srcFiles = await sheetFileMap(src)
  const donorName = [...srcFiles.keys()].find(n => n === '소' || n.startsWith('소')) ?? [...srcFiles.keys()][2]
  const donorPart = srcFiles.get(donorName)!
  let donorXml = await src.file(donorPart)!.async('string')
  const srcStyles = await src.file('xl/styles.xml')!.async('string')
  const srcSst = src.file('xl/sharedStrings.xml') ? await src.file('xl/sharedStrings.xml')!.async('string') : null
  console.log(`     기증 시트: ${donorName} (${donorPart}) · 원본 styles cellXfs=${/<cellXfs count="(\d+)"/.exec(srcStyles)?.[1]} · sharedStrings ${srcSst ? '있음' : '없음(inline)'}`)

  // 난점 실측 — 기증 시트가 참조하는 축을 센다
  const styleRefs = new Set([...donorXml.matchAll(/ s="(\d+)"/g)].map(m => Number(m[1])))
  const sstRefs = [...donorXml.matchAll(/t="s"><v>(\d+)<\/v>/g)].length
  console.log(`     기증 시트의 스타일 인덱스 종류 ${styleRefs.size} · 공유문자열 참조 ${sstRefs}건`)

  // 최소 이식: 공유문자열은 인라인으로 풀고, 스타일은 **대상 워크북의 기본(0)으로 강등**해 본다.
  // 서식이 죽는 건 알고 시작한다 — 이 프로브의 질문은 '워크북이 성립하는가'다.
  // (성립하면 다음 단계는 styles 병합·재번호. 성립 자체가 안 되면 설계를 빌드타임 병합으로 튼다)
  if (srcSst) {
    const texts = [...srcSst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
      (m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join(''))
    donorXml = donorXml.replace(/<c([^>]*) t="s"><v>(\d+)<\/v><\/c>/g, (_m, attrs: string, idx: string) => {
      const v = texts[Number(idx)] ?? ''
      const esc = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${esc}</t></is></c>`
    })
  }
  donorXml = donorXml.replace(/ s="\d+"/g, '')   // 스타일 강등(실험용)

  const tgt = await JSZip.loadAsync(readFileSync(TPL))
  let wbXml = await tgt.file('xl/workbook.xml')!.async('string')
  let relsXml = await tgt.file('xl/_rels/workbook.xml.rels')!.async('string')
  let ctXml = await tgt.file('[Content_Types].xml')!.async('string')
  const newPart = 'xl/worksheets/sheetX1.xml'
  const maxRid = Math.max(...[...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1])))
  const maxSheetId = Math.max(...[...wbXml.matchAll(/sheetId="(\d+)"/g)].map(m => Number(m[1])))
  const rid = `rId${maxRid + 1}`
  tgt.file(newPart, donorXml)
  relsXml = relsXml.replace('</Relationships>',
    `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheetX1.xml"/></Relationships>`)
  wbXml = wbXml.replace('</sheets>', `<sheet name="이식검증" sheetId="${maxSheetId + 1}" state="visible" r:id="${rid}"/></sheets>`)
  ctXml = ctXml.replace('</Types>',
    `<Override PartName="/${newPart}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
  tgt.file('xl/workbook.xml', wbXml)
  tgt.file('xl/_rels/workbook.xml.rels', relsXml)
  tgt.file('[Content_Types].xml', ctXml)
  const outPath = join(dir, 'transplanted.xlsx')
  writeFileSync(outPath, await tgt.generateAsync({ type: 'nodebuffer' }))

  const wb = XLSX.read(readFileSync(outPath), { cellStyles: true })
  check('27시트로 열림(이식 포함)', wb.SheetNames.length === 27, `${wb.SheetNames.length}`)
  check('이식 시트에 값 실림', Object.keys(wb.Sheets['이식검증'] ?? {}).filter(k => !k.startsWith('!')).length > 10,
    `${Object.keys(wb.Sheets['이식검증'] ?? {}).filter(k => !k.startsWith('!')).length}셀`)
  const pdf = toPdf(outPath, join(dir, 'p2'))
  check('LibreOffice가 연다', !!pdf, pdf ? `${pageCount(pdf)}쪽` : '')
}

console.log(`\n임시: ${dir}`)
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
