/** 판정자 G-A — S0-4b 독립 축: 캐시값 동시 주입 + 이행 폐포.
 *
 *  구현자 게이트(_probe-xlsx-gate.mts S0-4b)와 다른 점:
 *   ① 의존 그래프를 SheetJS(cellFormula)가 아니라 **시트 XML의 <f> 원문**으로 만든다.
 *      게이트는 SheetJS로 간선을 세는데, 이 저장소의 S2-6 근거 자체가
 *      "SheetJS는 캐시 없는 수식 셀을 통째로 건너뛴다(840→679)"이다. 그러면 게이트의
 *      '폐포 8건 · 옛 값 0회'는 **못 본 간선이 없다는 보장이 없다**. 두 축의 차이를 실측한다.
 *   ② 렌더 판정을 HTML 본문 문자열이 아니라 **soffice xlsx 왕복 후 셀 단위 값**으로 본다
 *      (좌표가 남아 어디서 새는지 특정된다). HTML도 함께 본다.
 *   ③ <f> 보존을 원시 XML에서 직접 확인한다(주장: 수식은 남긴다).
 *   ④ 대조군 3종을 **먼저** 만든다: (무전파) (1단계만) (폐포에서 1칸 누락).
 *      각각이 실제로 붉어지는 것을 보인 뒤에야 본검사 초록을 의미 있다고 본다.
 *
 *  읽기 전용. 산출물은 .judge27g/ 아래 임시본.
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
const CONV = join(WORK, 'conv', '보고서 갑지.xlsx')     // _judge27g-a-convert가 만든 변환본
const HUB = '개요', HUB_CELL = 'B14'
const SENTINEL = 'QQ판정자G상호QQ'
const OLD = '정내과의원'                                  // 표본 고객 상호(옛 캐시값)

mkdirSync(WORK, { recursive: true })
const log: string[] = []
let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => { log.push(`${ok ? 'PASS' : 'FAIL'} | ${n}${d ? ` | ${d}` : ''}`); ok ? pass++ : fail++; return ok }
const info = (s: string) => log.push(`  .. ${s}`)

function convert(src: string, to: string, outDir: string): string | null {
  mkdirSync(outDir, { recursive: true })
  for (let a = 1; a <= 3; a++) {
    try {
      execFileSync(SOFFICE, [`-env:UserInstallation=${PROFILE}`, '--headless', '--norestore',
        '--convert-to', to, '--outdir', outDir, src], { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
      break
    } catch (e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string }
      info(`soffice 시도 ${a} 실패: ${((err.stderr ?? err.stdout ?? Buffer.from('')).toString().trim() || err.message || '').split('\n')[0]}`)
      if (a === 3) return null
    }
  }
  const out = join(outDir, src.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, `.${to.split(':')[0]}`))
  return existsSync(out) ? out : null
}

async function sheetMap(zip: JSZip) {
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const rel = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rel.set(m[1], m[2])
  const files = new Map<string, string>()
  for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const t = rel.get(m[2]) ?? ''
    files.set(m[1], t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`)
  }
  return files
}

// ── 그래프 축 A: 원시 XML <f> 파싱 ────────────────────────────────────
type Node = { sheet: string; cell: string }
async function graphFromXml(zip: JSZip, files: Map<string, string>) {
  const edges = new Map<string, Node[]>()
  let formulaCells = 0
  for (const [sheet, path] of files) {
    const f = zip.file(path); if (!f) continue
    const xml = await f.async('string')
    // 자기닫힘 <c/>도 받아야 다음 셀 수식이 엉뚱한 좌표로 귀속되지 않는다
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const inner = m[3] ?? ''
      const fm = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)
      if (!fm) continue
      formulaCells++
      const raw = fm[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()
      const x = /^'?([^'!]+)'?!(\$?[A-Z]+\$?\d+)$/.exec(raw)
      const local = /^(\$?[A-Z]+\$?\d+)$/.exec(raw)
      if (!x && !local) continue
      const from = x ? `${x[1]}!${x[2].replace(/\$/g, '')}` : `${sheet}!${local![1].replace(/\$/g, '')}`
      const arr = edges.get(from) ?? []; arr.push({ sheet, cell: m[1] }); edges.set(from, arr)
    }
  }
  return { edges, formulaCells }
}

// ── 그래프 축 B: 게이트와 동일한 SheetJS 경로 (대조용) ────────────────
function graphFromSheetJs(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { cellFormula: true })
  const edges = new Map<string, Node[]>()
  let formulaCells = 0
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const f = String((ws[k] as { f?: string }).f ?? ''); if (!f) continue
      formulaCells++
      const x = /^'?([^'!]+)'?!(\$?[A-Z]+\$?\d+)$/.exec(f)
      const local = /^(\$?[A-Z]+\$?\d+)$/.exec(f)
      if (!x && !local) continue
      const from = x ? `${x[1]}!${x[2].replace(/\$/g, '')}` : `${s}!${local![1].replace(/\$/g, '')}`
      const arr = edges.get(from) ?? []; arr.push({ sheet: s, cell: k }); edges.set(from, arr)
    }
  }
  return { edges, formulaCells }
}

const closureOf = (edges: Map<string, Node[]>, root: string) => {
  const out: Node[] = []; const seen = new Set<string>(); const q = [root]
  while (q.length) for (const d of edges.get(q.shift()!) ?? []) {
    const k = `${d.sheet}!${d.cell}`
    if (seen.has(k)) continue
    seen.add(k); out.push(d); q.push(k)
  }
  return out
}
const edgeCount = (e: Map<string, Node[]>) => [...e.values()].reduce((n, a) => n + a.length, 0)

// ── 패치기 (게이트와 같은 의미, 독립 구현) ────────────────────────────
function patchValue(xml: string, ref: string, v: string) {
  const re = new RegExp(`(<c r="${ref}"[^>]*?)(/>|>[\\s\\S]*?</c>)`)
  const m = re.exec(xml); if (!m) return { xml, hit: false }
  return { xml: xml.replace(re, `${m[1].replace(/\st="[^"]*"/, '')} t="inlineStr"><is><t>${v}</t></is></c>`), hit: true }
}
function patchCache(xml: string, ref: string, v: string) {
  const re = new RegExp(`<c r="${ref}"([^>]*)>([\\s\\S]*?)</c>`)
  const m = re.exec(xml); if (!m) return { xml, hit: false }
  const f = /<f[^>]*>[\s\S]*?<\/f>|<f[^>]*\/>/.exec(m[2])?.[0] ?? ''
  return { xml: xml.replace(re, `<c r="${ref}"${m[1].replace(/\st="[^"]*"/, '')} t="str">${f}<v>${v}</v></c>`), hit: true }
}

// ══════════════════════════════════════════════════════════════════════
if (!existsSync(CONV)) { console.log('선행 필요: _judge27g-a-convert.mts'); process.exit(2) }
const tplBytes = new Uint8Array(readFileSync(CONV))

// 여백 복원본을 템플릿으로 (게이트 절차와 동일)
const origWb = XLSX.read(readFileSync(SRC), { cellStyles: true })
const zT = await JSZip.loadAsync(tplBytes)
const files = await sheetMap(zT)
for (const [s, p] of files) {
  const m = (origWb.Sheets[s] as Record<string, unknown>)?.['!margins'] as Record<string, number> | undefined
  const f = zT.file(p); if (!m || !f) continue
  const xml = await f.async('string')
  if (!/<pageMargins[^>]*\/>/.test(xml)) continue
  zT.file(p, xml.replace(/<pageMargins[^>]*\/>/,
    `<pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="${m.header}" footer="${m.footer}"/>`))
}
const TPL = join(WORK, 'g-tpl.xlsx')
writeFileSync(TPL, Buffer.from(await zT.generateAsync({ type: 'uint8array' })))
const tpl = new Uint8Array(readFileSync(TPL))

// ── [1] 두 축의 그래프 비교 ───────────────────────────────────────────
log.push('[1] 의존 그래프 — 원시 XML 축 vs 게이트의 SheetJS 축')
const zg = await JSZip.loadAsync(tpl)
const gx = await graphFromXml(zg, files)
const gs = graphFromSheetJs(tpl)
info(`원시 XML: 수식 셀 ${gx.formulaCells} · 단일참조 간선 ${edgeCount(gx.edges)}`)
info(`SheetJS  : 수식 셀 ${gs.formulaCells} · 단일참조 간선 ${edgeCount(gs.edges)}`)
const cx = closureOf(gx.edges, `${HUB}!${HUB_CELL}`)
const cs = closureOf(gs.edges, `${HUB}!${HUB_CELL}`)
info(`원시 XML 폐포(${HUB}!${HUB_CELL}) ${cx.length}건: ${cx.map(d => `${d.sheet}!${d.cell}`).join(', ')}`)
info(`SheetJS  폐포(${HUB}!${HUB_CELL}) ${cs.length}건: ${cs.map(d => `${d.sheet}!${d.cell}`).join(', ')}`)
const setS = new Set(cs.map(d => `${d.sheet}!${d.cell}`))
const missedBySheetJs = cx.filter(d => !setS.has(`${d.sheet}!${d.cell}`)).map(d => `${d.sheet}!${d.cell}`)
check('게이트의 SheetJS 축이 원시 XML 축의 폐포를 빠짐없이 포함',
  missedBySheetJs.length === 0, missedBySheetJs.length ? `SheetJS가 놓친 ${missedBySheetJs.length}: ${missedBySheetJs.join(',')}` : `양축 ${cx.length}건 동일`)
check('구현자 주장 "폐포 8건" 재현', cx.length === 8, `원시 XML 축 ${cx.length}건`)
info(`구현자 주장 간선 755 vs 내 실측(원시 XML) ${edgeCount(gx.edges)} / (SheetJS) ${edgeCount(gs.edges)}`)

// ── 변형본 생성기 ─────────────────────────────────────────────────────
async function build(name: string, deps: Node[]) {
  const z = await JSZip.loadAsync(tpl)
  const hubPath = files.get(HUB)!
  const r = patchValue(await z.file(hubPath)!.async('string'), HUB_CELL, SENTINEL)
  if (!r.hit) throw new Error('허브 셀 패치 실패')
  z.file(hubPath, r.xml)
  let n = 0
  for (const d of deps) {
    const p = files.get(d.sheet); if (!p) continue
    const rr = patchCache(await z.file(p)!.async('string'), d.cell, SENTINEL)
    if (rr.hit) { z.file(p, rr.xml); n++ }
  }
  const out = join(WORK, `g-${name}.xlsx`)
  writeFileSync(out, Buffer.from(await z.generateAsync({ type: 'uint8array' })))
  return { path: out, patched: n }
}

/** LO에게 다시 읽혀 **셀 단위**로 관찰한다(HTML 문자열 축과 다른 관찰) */
async function observe(xlsxPath: string, tag: string) {
  rmSync(join(WORK, `rt-${tag}`), { recursive: true, force: true })
  const rt = convert(xlsxPath, 'xlsx', join(WORK, `rt-${tag}`))
  const cells: { sentinel: string[]; old: string[] } = { sentinel: [], old: [] }
  if (rt) {
    const wb = XLSX.read(readFileSync(rt))
    for (const s of wb.SheetNames) {
      const ws = wb.Sheets[s]
      for (const k of Object.keys(ws)) {
        if (k.startsWith('!')) continue
        const v = String((ws[k] as { v?: unknown }).v ?? '')
        if (v.includes(SENTINEL)) cells.sentinel.push(`${s}!${k}`)
        if (v.includes(OLD)) cells.old.push(`${s}!${k}`)
      }
    }
  }
  const htmlDir = join(WORK, `html-${tag}`)
  rmSync(htmlDir, { recursive: true, force: true })
  const html = convert(xlsxPath, 'html', htmlDir)
  const body = html ? readFileSync(html, 'utf8') : ''
  return {
    roundTripped: !!rt, cells,
    htmlSentinel: (body.match(new RegExp(SENTINEL, 'g')) ?? []).length,
    htmlOld: (body.match(new RegExp(OLD, 'g')) ?? []).length,
  }
}

// ── [2] 대조군 (붉어져야 정상) ────────────────────────────────────────
log.push('[2] 대조군 — 검사가 실제로 붉어지는가')
const ctrl0 = await build('ctrl-none', [])                       // 허브만, 전파 0
const o0 = await observe(ctrl0.path, 'none')
info(`(무전파) 왕복 셀 — 주입값 ${o0.cells.sentinel.length}곳 / 옛 값 ${o0.cells.old.length}곳: ${o0.cells.old.slice(0, 10).join(',')}`)
info(`(무전파) HTML — 주입값 ${o0.htmlSentinel}회 / 옛 값 ${o0.htmlOld}회`)
check('(대조군1) 전파를 안 하면 옛 값이 살아남는다 — 검사가 눈멀지 않았다', o0.cells.old.length > 0 && o0.htmlOld > 0,
  `왕복 ${o0.cells.old.length}곳 · HTML ${o0.htmlOld}회`)

const oneStep = (gx.edges.get(`${HUB}!${HUB_CELL}`) ?? [])
const ctrl1 = await build('ctrl-1step', oneStep)                 // 1단계만
const o1 = await observe(ctrl1.path, '1step')
info(`(1단계만 ${oneStep.length}건) 왕복 옛 값 ${o1.cells.old.length}곳: ${o1.cells.old.join(',')} · HTML ${o1.htmlOld}회`)
check('(대조군2) 1단계 전파만으로는 옛 값이 남는다 — 폐포가 필요하다는 근거',
  o1.cells.old.length > 0 || o1.htmlOld > 0, `왕복 ${o1.cells.old.length}곳 · HTML ${o1.htmlOld}회`)

const dropped = cx.slice(0, cx.length - 1)
const ctrl2 = await build('ctrl-drop1', dropped)                 // 폐포에서 1칸 누락
const o2 = await observe(ctrl2.path, 'drop1')
info(`(폐포-1칸: ${cx[cx.length - 1].sheet}!${cx[cx.length - 1].cell} 누락) 왕복 옛 값 ${o2.cells.old.length}곳: ${o2.cells.old.join(',')} · HTML ${o2.htmlOld}회`)
check('(대조군3) 폐포에서 1칸만 빼도 붉어진다 — 판정이 항진명제가 아니다',
  o2.cells.old.length > 0 || o2.htmlOld > 0, `왕복 ${o2.cells.old.length}곳 · HTML ${o2.htmlOld}회`)

// ── [3] 본검사 — 전 폐포 전파 ─────────────────────────────────────────
log.push('[3] 본검사 — 이행 폐포 전건 전파')
const main = await build('closure', cx)
check('폐포 전건이 실제로 패치됨', main.patched === cx.length, `${main.patched}/${cx.length}`)
const om = await observe(main.path, 'closure')
info(`(폐포) 왕복 주입값 ${om.cells.sentinel.length}곳: ${om.cells.sentinel.join(',')}`)
check('LO 왕복 후 주입값이 셀에 살아 있다', om.cells.sentinel.length >= 1 + cx.length,
  `${om.cells.sentinel.length}곳 (허브1 + 폐포${cx.length} 기대)`)
check('LO 왕복 후 옛 값이 어느 셀에도 없다', om.cells.old.length === 0,
  om.cells.old.length ? `잔존 ${om.cells.old.length}: ${om.cells.old.join(',')}` : '0곳')
check('LO 렌더(HTML)에 주입값 존재', om.htmlSentinel > 0, `${om.htmlSentinel}회 (구현자 주장 18회)`)
check('LO 렌더(HTML)에 옛 값 0회', om.htmlOld === 0, `${om.htmlOld}회`)

// ── [4] <f> 보존 — 원시 XML 확인 ──────────────────────────────────────
log.push('[4] <f> 보존 — 캐시만 갈고 수식은 남겼는가(원시 XML)')
{
  const zBefore = await JSZip.loadAsync(tpl)
  const zAfter = await JSZip.loadAsync(new Uint8Array(readFileSync(main.path)))
  const lost: string[] = []; const kept: string[] = []
  for (const d of cx) {
    const p = files.get(d.sheet)!
    const cellRe = new RegExp(`<c r="${d.cell}"[^>]*>([\\s\\S]*?)</c>`)
    const b = cellRe.exec(await zBefore.file(p)!.async('string'))?.[1] ?? ''
    const a = cellRe.exec(await zAfter.file(p)!.async('string'))?.[1] ?? ''
    const hadF = /<f[\s>]/.test(b), hasF = /<f[\s>]/.test(a)
    if (hadF && !hasF) lost.push(`${d.sheet}!${d.cell}`); else if (hadF && hasF) kept.push(`${d.sheet}!${d.cell}`)
  }
  check('폐포 셀의 <f>가 전건 보존됨', lost.length === 0,
    lost.length ? `유실 ${lost.length}: ${lost.join(',')}` : `보존 ${kept.length}/${cx.length}`)
  // 변이 자기검사: <f>를 일부러 지운 뒤 같은 판정기가 잡는가
  const zMut = await JSZip.loadAsync(new Uint8Array(readFileSync(main.path)))
  const d0 = cx[0]; const p0 = files.get(d0.sheet)!
  const x0 = await zMut.file(p0)!.async('string')
  const re0 = new RegExp(`(<c r="${d0.cell}"[^>]*>)([\\s\\S]*?)(</c>)`)
  const m0 = re0.exec(x0)!
  zMut.file(p0, x0.replace(re0, `${m0[1]}${m0[2].replace(/<f[^>]*>[\s\S]*?<\/f>/, '')}${m0[3]}`))
  const zChk = await JSZip.loadAsync(new Uint8Array(await zMut.generateAsync({ type: 'uint8array' })))
  const after = new RegExp(`<c r="${d0.cell}"[^>]*>([\\s\\S]*?)</c>`).exec(await zChk.file(p0)!.async('string'))?.[1] ?? ''
  check('변이 자기검사 — <f> 삭제를 같은 판정기가 잡는다', !/<f[\s>]/.test(after), `${d0.sheet}!${d0.cell}`)
}

// ── [5] 페이지 수 불변 ────────────────────────────────────────────────
log.push('[5] 주입이 쪽 나눔을 흔들지 않는가')
{
  const pc = (p: string) => (readFileSync(p).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
  const pdfTpl = convert(TPL, 'pdf', join(WORK, 'pdf-tpl'))
  const pdfMain = convert(main.path, 'pdf', join(WORK, 'pdf-main'))
  if (pdfTpl && pdfMain) check('페이지 수 동일', pc(pdfTpl) === pc(pdfMain), `템플릿 ${pc(pdfTpl)}쪽 vs 주입본 ${pc(pdfMain)}쪽`)
  else check('PDF 변환', false)
}

writeFileSync(join(WORK, 'a-closure.txt'), log.join('\n') + `\n\n결과: ${pass} 통과 / ${fail} 실패\n`, 'utf8')
console.log(`RESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
