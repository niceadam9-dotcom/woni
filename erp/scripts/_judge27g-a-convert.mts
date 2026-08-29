/** 판정자 G-A — S0-1 · S0-1b 독립 축 ②: soffice 실왕복 + **원시 XML** 측정.
 *
 *  구현자 게이트와 다른 점:
 *   - 시트 수를 SheetJS SheetNames가 아니라 xl/workbook.xml의 <sheet name=…> 실개수로 센다
 *   - 병합을 SheetJS !merges가 아니라 각 시트 XML의 <mergeCell ref=…> 실개수로 센다
 *     (+ <mergeCells count="N"> 선언값과의 자기정합까지 본다 — 선언만 맞고 실체가 없는 경우 적발)
 *   - 여백을 SheetJS !margins가 아니라 <pageMargins .../> **원문 속성 문자열**로 본다
 *   - 원본 기준값은 SheetJS가 아니라 **BIFF 바이트**(_judge27g-a-biff)와 교차 확인된 값을 쓴다
 *   - 대조군: 여백 복원을 **하지 않은** 산출물에 같은 검사를 걸어 실제로 붉어지는지 먼저 보인다
 *   - 변이 자기검사: <mergeCell> 하나 삭제 / pageMargins 한 속성 1바이트 변경이 잡히는지 본다
 *
 *  soffice는 -env:UserInstallation으로 프로필을 격리한다(타 세션 경합 회피).
 *  읽기 전용 — 저장소 파일을 고치지 않는다.
 */
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const WORK = 'F:/AI/ERP/erp/.judge27g'
const PROFILE = 'file:///F:/AI/ERP/erp/.judge27g/loprofile'
const OUT = join(WORK, 'a-convert.json')

mkdirSync(WORK, { recursive: true })
const log: string[] = []
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  log.push(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`)
  ok ? pass++ : fail++
  return ok
}
const info = (s: string) => log.push(`  .. ${s}`)

function convert(src: string, to: string, outDir: string): string | null {
  mkdirSync(outDir, { recursive: true })
  const t0 = Date.now()
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execFileSync(SOFFICE, [`-env:UserInstallation=${PROFILE}`, '--headless', '--norestore',
        '--convert-to', to, '--outdir', outDir, src],
        { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
      break
    } catch (e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string }
      const msg = ((err.stderr ?? err.stdout ?? Buffer.from('')).toString().trim() || err.message || '').split('\n')[0]
      info(`soffice 시도 ${attempt} 실패: ${msg}`)
      if (attempt === 3) return null
    }
  }
  const base = src.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, `.${to.split(':')[0]}`)
  const out = join(outDir, base)
  info(`convert ${src.split(/[\\/]/).pop()} -> ${to} : ${Date.now() - t0}ms : ${existsSync(out) ? 'OK' : 'MISSING'}`)
  return existsSync(out) ? out : null
}

// ── 원시 XML 측정기 (SheetJS 미사용) ─────────────────────────────────
type SheetMeasure = {
  mergeElems: number; mergeDeclared: number | null
  marginsRaw: string | null; margins: Record<string, number> | null
  cellRefs: number
}
async function measure(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const rel = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rel.set(m[1], m[2])
  const names: string[] = []
  const files = new Map<string, string>()
  for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const t = rel.get(m[2]) ?? ''
    names.push(m[1])
    files.set(m[1], t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`)
  }
  const per = new Map<string, SheetMeasure>()
  for (const [name, path] of files) {
    const f = zip.file(path)
    if (!f) { per.set(name, { mergeElems: 0, mergeDeclared: null, marginsRaw: null, margins: null, cellRefs: 0 }); continue }
    const xml = await f.async('string')
    const mergeElems = (xml.match(/<mergeCell\s+ref="/g) ?? []).length
    const decl = /<mergeCells[^>]*count="(\d+)"/.exec(xml)
    const pmRaw = /<pageMargins[^>]*\/>/.exec(xml)?.[0] ?? null
    const margins = pmRaw
      ? Object.fromEntries([...pmRaw.matchAll(/(\w+)="([^"]+)"/g)].map(x => [x[1], Number(x[2])])) as Record<string, number>
      : null
    per.set(name, {
      mergeElems, mergeDeclared: decl ? Number(decl[1]) : null,
      marginsRaw: pmRaw, margins,
      cellRefs: (xml.match(/<c r="/g) ?? []).length,
    })
  }
  return { zip, names, files, per, sheetCount: names.length,
    mergeTotal: [...per.values()].reduce((n, m) => n + m.mergeElems, 0) }
}

// ── 원본 기준값(BIFF 교차확인 완료) ───────────────────────────────────
const origWb = XLSX.read(readFileSync(SRC), { cellStyles: true })
const ORIG: Record<string, Record<string, number>> = {}
for (const s of origWb.SheetNames) {
  const m = (origWb.Sheets[s] as Record<string, unknown>)['!margins'] as Record<string, number> | undefined
  if (m) ORIG[s] = m
}
const KEYS = ['left', 'right', 'top', 'bottom', 'header', 'footer'] as const
const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9

/** 여백 일치 판정기 — 어긋난 시트·키 목록을 준다 */
function marginDiff(per: Map<string, SheetMeasure>, only?: Set<string>) {
  const bad: string[] = []
  let checked = 0
  for (const [name, orig] of Object.entries(ORIG)) {
    if (only && !only.has(name)) continue
    const got = per.get(name)?.margins
    if (!got) { bad.push(`${name}:(pageMargins 없음)`); continue }
    checked++
    for (const k of KEYS) if (!eq(got[k] ?? NaN, orig[k])) bad.push(`${name}.${k}=${got[k]} != ${orig[k]}`)
  }
  return { bad, checked }
}

// ══ [1] S0-1 — soffice .xls → .xlsx ═══════════════════════════════════
log.push('[1] S0-1 — soffice 변환(프로필 격리) · 원시 XML 측정')
const convDir = join(WORK, 'conv')
rmSync(convDir, { recursive: true, force: true })
const xlsxPath = convert(SRC, 'xlsx', convDir)
if (!check('변환 산출물 생성', !!xlsxPath)) {
  writeFileSync(OUT, JSON.stringify({ pass, fail, log }, null, 2), 'utf8'); process.exit(1)
}
const conv = await measure(new Uint8Array(readFileSync(xlsxPath!)))
check('시트 26 (workbook.xml <sheet> 실개수)', conv.sheetCount === 26, `${conv.sheetCount}`)
check('원본 시트명과 순서까지 동일',
  JSON.stringify(conv.names) === JSON.stringify(origWb.SheetNames),
  conv.names.length === origWb.SheetNames.length ? '순서 일치' : `${conv.names.join(',')}`)
check('병합 1586 (<mergeCell ref=> 실개수)', conv.mergeTotal === 1586, `${conv.mergeTotal}`)
{
  const mismatch = [...conv.per.entries()].filter(([, m]) => m.mergeDeclared !== null && m.mergeDeclared !== m.mergeElems)
  check('mergeCells count 선언 = 실개수 (자기정합)', mismatch.length === 0,
    mismatch.map(([n, m]) => `${n}:${m.mergeDeclared}!=${m.mergeElems}`).join(',') || `선언 있는 시트 ${[...conv.per.values()].filter(m => m.mergeDeclared !== null).length}`)
}
info(`변환본 셀 <c r=> 총 ${[...conv.per.values()].reduce((n, m) => n + m.cellRefs, 0)}`)

// 파일 열림 — soffice가 산출물을 다시 읽어 PDF로 낼 수 있는가
const pdfPath = convert(xlsxPath!, 'pdf', join(WORK, 'convpdf'))
const pageCount = (p: string) => (readFileSync(p).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
check('변환본이 열린다 (soffice가 PDF로 재출력)', !!pdfPath,
  pdfPath ? `${pageCount(pdfPath)}쪽 · ${(readFileSync(pdfPath).length / 1024).toFixed(0)}KB` : '')

// ══ [2] S0-1b 대조군 — 복원하지 않은 산출물은 붉어져야 한다 ═══════════
log.push('[2] S0-1b 대조군 — 복원 없는 변환본에 같은 판정기를 건다(붉어져야 정상)')
{
  const d = marginDiff(conv.per)
  info(`대조군 어긋남 ${d.bad.length}건 / 검사 시트 ${d.checked}`)
  info(`샘플: ${d.bad.slice(0, 6).join(' ; ')}`)
  check('대조군이 실제로 붉어진다 (판정기가 눈멀지 않았다)', d.bad.length > 0, `어긋남 ${d.bad.length}건`)
  // LO가 무엇을 바꾸는가 — 축 규명
  const changedKeys = new Set(d.bad.map(s => s.split('=')[0].split('.')[1]).filter(Boolean))
  info(`LO가 바꾼 키: ${[...changedKeys].join(',')}`)
  const hf = [...conv.per.values()].map(m => m.margins).filter(Boolean) as Record<string, number>[]
  info(`변환본 header 고유값: ${[...new Set(hf.map(m => m.header))].join(',')}`)
  info(`변환본 footer 고유값: ${[...new Set(hf.map(m => m.footer))].join(',')}`)
  info(`원본 header 고유값: ${[...new Set(Object.values(ORIG).map(m => m.header))].join(',')}`)
}

// ══ [3] S0-1b 본검사 — 커밋 자산의 여백 ════════════════════════════════
log.push('[3] S0-1b 본검사 — 커밋 자산 report-workbook.xlsx / report-workbook-full.xlsx')
const baseBytes = new Uint8Array(readFileSync('templates/report-workbook.xlsx'))
const base = await measure(baseBytes)
check('기저 자산 시트 26', base.sheetCount === 26, `${base.sheetCount}`)
check('기저 자산 병합 1586', base.mergeTotal === 1586, `${base.mergeTotal}`)
{
  const d = marginDiff(base.per)
  check(`기저 자산 — 26시트 여백이 원본(.xls)과 전 키 일치`, d.bad.length === 0,
    d.bad.length ? `어긋남 ${d.bad.length}: ${d.bad.slice(0, 8).join(' ; ')}` : `시트 ${d.checked} · 키 ${KEYS.length}`)
}
const fullBytes = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
const full = await measure(fullBytes)
info(`배포 자산(full) 시트 ${full.sheetCount} · 병합 ${full.mergeTotal}`)
{
  const only = new Set(Object.keys(ORIG).filter(n => full.per.has(n)))
  const d = marginDiff(full.per, only)
  check(`배포 자산(full) — 갑지 유래 ${only.size}시트 여백이 원본과 일치`, d.bad.length === 0,
    d.bad.length ? `어긋남 ${d.bad.length}: ${d.bad.slice(0, 8).join(' ; ')}` : `시트 ${d.checked}`)
  const missing = Object.keys(ORIG).filter(n => !full.per.has(n))
  info(`full에서 사라진 갑지 시트: ${missing.length ? missing.join(',') : '(없음)'}`)
  const noPm = [...full.per.entries()].filter(([, m]) => m.marginsRaw === null).map(([n]) => n)
  check('배포 자산 전 시트에 <pageMargins> 존재', noPm.length === 0, noPm.length ? noPm.join(',') : `${full.sheetCount}시트`)
  // 기증 시트가 LO 기본값 0.511811로 남아 있는지 (복원 축이 도너에도 걸렸는가)
  const donors = [...full.per.entries()].filter(([n]) => !ORIG[n])
  const donorHF = donors.map(([, m]) => `${m.margins?.header}/${m.margins?.footer}`)
  const hist: Record<string, number> = {}
  for (const v of donorHF) hist[v] = (hist[v] ?? 0) + 1
  info(`기증 시트 ${donors.length}개 header/footer 분포: ${JSON.stringify(hist)}`)
}

// ══ [4] 변이 자기검사 — 판정기가 실제로 민감한가 ═══════════════════════
log.push('[4] 변이 자기검사 — 같은 판정기에 인위적 변이를 먹인다')
{
  // (a) 병합 1개 삭제
  const z = await JSZip.loadAsync(baseBytes)
  const path = base.files.get('개요')!
  let xml = await z.file(path)!.async('string')
  const before = (xml.match(/<mergeCell\s+ref="/g) ?? []).length
  xml = xml.replace(/<mergeCell\s+ref="[^"]+"\s*\/>/, '')
  z.file(path, xml)
  const mutated = await measure(new Uint8Array(await z.generateAsync({ type: 'uint8array' })))
  check('(a) <mergeCell> 1개 삭제를 병합 총수 검사가 잡는다',
    mutated.mergeTotal === 1585, `${before} -> ${mutated.per.get('개요')!.mergeElems} · 총 ${mutated.mergeTotal}`)
  check('(a2) 같은 변이를 count 자기정합 검사도 잡는다',
    mutated.per.get('개요')!.mergeDeclared !== mutated.per.get('개요')!.mergeElems,
    `선언 ${mutated.per.get('개요')!.mergeDeclared} vs 실 ${mutated.per.get('개요')!.mergeElems}`)

  // (b) pageMargins header 1바이트 변경
  const z2 = await JSZip.loadAsync(baseBytes)
  let xml2 = await z2.file(path)!.async('string')
  const pm = /<pageMargins[^>]*\/>/.exec(xml2)![0]
  const pm2 = pm.replace(/header="([\d.]+)"/, (_s, v) => `header="${(Number(v) + 0.0001).toFixed(4)}"`)
  z2.file(path, xml2.replace(pm, pm2))
  const mut2 = await measure(new Uint8Array(await z2.generateAsync({ type: 'uint8array' })))
  const d2 = marginDiff(mut2.per)
  check('(b) header 여백 0.0001in 변조를 여백 판정기가 잡는다', d2.bad.length === 1,
    `${d2.bad.join(';')} | ${pm} -> ${pm2}`)

  // (c) 시트 1개 제거
  const z3 = await JSZip.loadAsync(baseBytes)
  let wx = await z3.file('xl/workbook.xml')!.async('string')
  wx = wx.replace(/<sheet[^>]*name="계약서"[^>]*\/>/, '')
  z3.file('xl/workbook.xml', wx)
  const mut3 = await measure(new Uint8Array(await z3.generateAsync({ type: 'uint8array' })))
  check('(c) 시트 1개 제거를 시트 수 검사가 잡는다', mut3.sheetCount === 25, `${mut3.sheetCount}`)
}

writeFileSync(OUT, JSON.stringify({ pass, fail, log }, null, 2), 'utf8')
writeFileSync(join(WORK, 'a-convert.txt'), log.join('\n') + `\n\n결과: ${pass} 통과 / ${fail} 실패\n`, 'utf8')
console.log(`RESULT pass=${pass} fail=${fail}  -> ${OUT}`)
process.exit(fail ? 1 : 0)
