/** 갑지 → 워크북 템플릿 자산 빌드 (소방계획서_27 S1 — 전처리 1회, 재실행 가능)
 *  실행: npx tsx scripts/build-workbook-template.mts     (로컬 LibreOffice 필요)
 *  산출: templates/report-workbook.xlsx + src/lib/xlsx-template-manifest.json
 *
 *  갑지 서식이 갱신되면 이 스크립트를 다시 돌린다(Q-4: 재변환). 그러면 manifest의 지문이 바뀌어
 *  test-xlsx-anchors가 먼저 붉어지고, 그때 앵커 좌표를 재실측해 재승인한다.
 *
 *  하는 일:
 *  ① .xls → .xlsx 변환 — 반드시 LibreOffice로. SheetJS로 변환하면 빈 서식 셀 9,162개가
 *     소멸해 서식이 전멸한다(2026-08-21 실측, lib/xlsx-inject.ts 머리 주석).
 *  ② 인쇄여백 복원 — LibreOffice가 header/footer를 0.3in → 1.3cm로 정규화한다(실측).
 *     법정 서식은 인쇄물이 곧 결과라 원본 값으로 되돌린다.
 *  ③ 🚨 샘플 실고객 데이터 전면 스크럽 — 템플릿에 정내과의원·김미진·전화·생년월일이 **리터럴로**
 *     박혀 있다(_probe-pii-scrub.mjs). 개요의 입력 칸 전부(HUB_INPUT_CELLS)를 비우고, 이행 폐포로
 *     스포크의 캐시값까지 비운다. 주입 누락 시 다른 고객 문서에 남의 값이 인쇄되는 것을 원천 차단.
 *  ④ 깨진 외부 참조 처리 — '1번 입력'!·'입력'! 시트는 워크북에 없다. 재계산을 안 켜면 #REF!로
 *     드러나지도 않는 부류라, <f>를 지우고 (회사 고정값은 값 유지 / 나머지는 공란) 처리한다.
 *     **알 수 없는 깨진 참조가 새로 발견되면 빌드를 실패시킨다** — 조용히 지나치지 않는다.
 *  ⑤ fullCalcOnLoad 부여 — 값 반영 수단이 아니라(D-4 폐기: LibreOffice가 무시) 사용자가
 *     Excel에서 허브를 고쳤을 때 수식이 살아 움직이게 하는 보조다. */
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { injectWorkbook, sheetFileMap } from '../src/lib/xlsx-inject.ts'
import { HUB_INPUT_CELLS } from '../src/lib/xlsx-anchors.ts'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const OUT = 'templates/report-workbook.xlsx'
const MANIFEST = 'src/lib/xlsx-template-manifest.json'
const HUB = '개요'

/** 깨진 참조의 **알려진** 처리 방침 — 여기 없는 깨진 참조가 나오면 빌드 실패 */
const KNOWN_BROKEN: Record<string, { keepValue: boolean; why: string }> = {
  '위임장!N6': { keepValue: false, why: '대리인 성명 — 런타임 앵커(agentName)가 채운다' },
  '위임장!N7': { keepValue: false, why: '대리인 직위 — agentPosition' },
  '위임장!N8': { keepValue: false, why: '대리인 연락처 — agentPhone' },
  '위임장!N9': { keepValue: false, why: '대리인 생년월일 — agentBirth' },
  '계약서!D29': { keepValue: false, why: '대표자 — repName 앵커가 company_profile에서 채운다' },
  '완료보고서!I12': { keepValue: true, why: '회사 사업자번호(고정값) — 값 그대로 두고 수식만 제거' },
  // '[21]1번 입력'! — 외부 통합문서 참조(경로가 이 PC에 없다). 전부 회사 고정 정보라 값 유지
  '완료보고서!B12': { keepValue: true, why: '회사 상호(고정값)' },
  '완료보고서!C14': { keepValue: true, why: '대표자(고정값)' },
  '완료보고서!F14': { keepValue: true, why: '회사 전화(고정값)' },
  '완료보고서!B16': { keepValue: true, why: '회사 주소(고정값)' },
}

/** LibreOffice가 파괴한 수식 복원 — NUMBERSTRING(한국어 Excel 전용)은 LO가 몰라 #REF!로
 *  바꿔 버린다(2026-08-21 실측: 원본 .xls엔 멀쩡히 있었다). 사용자의 실제 도구는 Excel이므로
 *  원본 수식을 되살린다 — J11·J14에 금액을 넣으면 한글 금액("일금 … 원정")이 자동으로 산다. */
const RESTORE_FORMULAS: Array<{ sheet: string; cell: string; formula: string }> = [
  { sheet: '계약서', cell: 'E11', formula: 'NUMBERSTRING(J11,1)&" 원정"' },
  { sheet: '계약서', cell: 'E14', formula: 'NUMBERSTRING(J14,1)&" 원정"' },
]

const dir = mkdtempSync(join(tmpdir(), 'wbtpl-'))
console.log(`임시: ${dir}`)

// ── ① .xls → .xlsx (LibreOffice) ─────────────────────────────────────
console.log('① .xls → .xlsx 변환')
execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'xlsx', '--outdir', dir, SRC],
  { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
const converted = join(dir, basename(SRC).replace(/\.xls$/, '.xlsx'))
if (!existsSync(converted)) throw new Error('LibreOffice 변환 실패')

const origWb = XLSX.read(readFileSync(SRC), { cellStyles: true })
const mergeCount = (wb: XLSX.WorkBook) => wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]['!merges'] ?? []).length), 0)
const origMerges = mergeCount(origWb)

let bytes = new Uint8Array(readFileSync(converted))

// ── ② 인쇄여백 복원 ──────────────────────────────────────────────────
console.log('② 인쇄여백 복원')
{
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  let restored = 0
  for (const [sheet, path] of files) {
    const m = origWb.Sheets[sheet]?.['!margins'] as Record<string, number> | undefined
    const f = zip.file(path)
    if (!m || !f) continue
    const xml = await f.async('string')
    if (!/<pageMargins[^>]*\/>/.test(xml)) continue
    zip.file(path, xml.replace(/<pageMargins[^>]*\/>/,
      `<pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="${m.header}" footer="${m.footer}"/>`))
    restored++
  }
  console.log(`   ${restored}/${files.size} 시트`)
  if (restored !== files.size) throw new Error('여백 복원 누락 — pageMargins 태그 형태 확인 필요')
  bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

// ── ④(선행) 깨진 외부 참조 전수 색출 — 모르는 것이 나오면 실패 ────────
console.log('③ 깨진 외부 참조 검사')
const scanWb = XLSX.read(bytes, { cellFormula: true })
const sheetSet = new Set(scanWb.SheetNames)
const brokenTargets: Array<{ sheet: string; cell: string; keepValue: boolean }> = []
{
  const unknown: string[] = []
  const restoreKeys = new Set(RESTORE_FORMULAS.map(r => `${r.sheet}!${r.cell}`))
  for (const s of scanWb.SheetNames) {
    const ws = scanWb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const f = String((ws[k] as XLSX.CellObject).f ?? '')
      const key = `${s}!${k}`
      if (restoreKeys.has(key)) continue                       // LO가 파괴한 수식 — 별도 복원
      // 외부 통합문서 참조('[21]시트'!)는 대괄호를 벗겨 시트명만 본다
      const m = /'?(?:\[\d+\])?([^'!=[\]]+)'?!/.exec(f)
      if (!m || sheetSet.has(m[1])) continue
      const known = KNOWN_BROKEN[key]
      if (!known) { unknown.push(`${key} = ${f}`); continue }
      brokenTargets.push({ sheet: s, cell: k, keepValue: known.keepValue })
    }
  }
  console.log(`   알려진 깨진 참조 ${brokenTargets.length}건 처리 예정`)
  if (unknown.length) {
    console.error(`   ❌ 알 수 없는 깨진 참조 ${unknown.length}건 — KNOWN_BROKEN에 방침을 정한 뒤 다시 빌드할 것`)
    for (const u of unknown) console.error(`      ${u}`)
    process.exit(1)
  }
}

// ── ③④ 스크럽 + 깨진 참조 처리 — 한 번의 injectWorkbook으로 ─────────
console.log('④ 샘플 데이터 스크럽(개요 전 입력 칸 + 이행 폐포) · 깨진 참조 수식 제거')
{
  const targets = [
    // 개요의 입력 칸 전부 공란 — 폐포 전파로 스포크 캐시까지 함께 비워진다
    ...HUB_INPUT_CELLS.map(cell => ({ sheet: HUB, cell, value: null as null })),
    // 깨진 참조: 수식 제거. 회사 고정값은 값 유지, 나머지는 공란
    ...brokenTargets.map(b => ({
      sheet: b.sheet, cell: b.cell, dropFormula: true,
      value: b.keepValue ? String((scanWb.Sheets[b.sheet][b.cell] as XLSX.CellObject).v ?? '') : null,
    })),
  ]
  const r = await injectWorkbook(bytes, targets)
  if (r.missed.length) throw new Error(`스크럽 대상 미발견: ${r.missed.join(', ')}`)
  console.log(`   대상 ${targets.length}칸 + 폐포 전파 ${r.propagated}칸`)
  bytes = r.bytes
}

// ── ④b LibreOffice가 파괴한 수식 복원 ────────────────────────────────
console.log('④b NUMBERSTRING 수식 복원(계약서 보수금액·잔금)')
{
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  for (const r of RESTORE_FORMULAS) {
    const path = files.get(r.sheet)!
    let xml = await zip.file(path)!.async('string')
    const re = new RegExp(`<c r="${r.cell}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
    const m = re.exec(xml)
    if (!m) throw new Error(`수식 복원 대상 미발견: ${r.sheet}!${r.cell}`)
    const attrs = (m[1] ?? '').replace(/\st="[^"]*"/, '')
    const esc = r.formula.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    xml = xml.replace(re, `<c r="${r.cell}"${attrs} t="str"><f>${esc}</f></c>`)
    zip.file(path, xml)
  }
  bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

// ── ⑤ fullCalcOnLoad ────────────────────────────────────────────────
console.log('⑤ fullCalcOnLoad 부여')
{
  const zip = await JSZip.loadAsync(bytes)
  let wbXml = await zip.file('xl/workbook.xml')!.async('string')
  if (!wbXml.includes('fullCalcOnLoad')) {
    wbXml = wbXml.includes('<calcPr')
      ? wbXml.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>')
      : wbXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')
    zip.file('xl/workbook.xml', wbXml)
  }
  bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

// ── 사후 검증 — 쓰기 전에 스스로 확인한다 ────────────────────────────
console.log('⑥ 사후 검증')
{
  const wb = XLSX.read(bytes, { cellStyles: true })
  const fails: string[] = []
  if (wb.SheetNames.length !== origWb.SheetNames.length)
    fails.push(`시트 수 ${origWb.SheetNames.length} → ${wb.SheetNames.length}`)
  if (mergeCount(wb) !== origMerges) fails.push(`병합 ${origMerges} → ${mergeCount(wb)}`)
  // 실고객 흔적 전수 부재 — 리터럴이든 캐시든 남으면 실패.
  // 주소·연면적도 표본 고객을 특정하는 값이다 — PII 4종만 보다가 폐포 결함(자기닫힘 셀 삼킴)이
  // 남긴 잔존을 놓칠 뻔했다(2026-08-21)
  const NEEDLES = ['정내과의원', '김미진', '010-7565-3271', '721227', '7565-3271', '용문로 376-1', '845.75']
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const v = String((ws[k] as XLSX.CellObject).v ?? '')
      for (const n of NEEDLES) if (v.includes(n)) fails.push(`실고객 흔적 잔존: ${s}!${k} = ${v}`)
    }
  }
  // 개요 입력 칸 전부 공란(완전 덮어쓰기 불변식의 템플릿 측).
  // ⚠ SheetJS로 보면 안 된다 — 캐시 없는 수식 셀을 v=0으로 돌려줘(실측: G9 등 6칸)
  //   '값 잔존'과 구별이 안 된다. XML에서 <v>·<is>의 실존 여부로 판정한다.
  {
    const zip = await JSZip.loadAsync(bytes)
    const files = await sheetFileMap(zip)
    const hubXml = await zip.file(files.get(HUB)!)!.async('string')
    for (const c of HUB_INPUT_CELLS) {
      const m = new RegExp(`<c r="${c}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(hubXml)
      const inner = m?.[1] ?? ''
      if (/<v>[\s\S]*?<\/v>|<is>/.test(inner)) fails.push(`개요!${c} 입력 칸에 값 잔존: ${inner.slice(0, 80)}`)
    }
  }
  if (fails.length) {
    for (const f of fails) console.error(`   ❌ ${f}`)
    process.exit(1)
  }
  console.log(`   시트 ${wb.SheetNames.length} · 병합 ${mergeCount(wb)} · 실고객 흔적 0 · 개요 입력 칸 전부 공란`)
}

// ── 산출 ─────────────────────────────────────────────────────────────
mkdirSync('templates', { recursive: true })
writeFileSync(OUT, bytes)
const finalWb = XLSX.read(bytes)
const manifest = {
  source: basename(SRC),
  builtAt: new Date().toISOString().slice(0, 10),
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sheetCount: finalWb.SheetNames.length,
  mergeTotal: mergeCount(XLSX.read(bytes, { cellStyles: true })),
  note: '갑지 서식 갱신 시 npx tsx scripts/build-workbook-template.mts 재실행(Q-4) — 지문이 바뀌면 test-xlsx-anchors가 먼저 붉어진다',
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.log(`\n✅ ${OUT} (${(bytes.length / 1024).toFixed(0)}KB) · ${MANIFEST}`)
console.log(`   sha256 ${manifest.sha256.slice(0, 16)}… · 시트 ${manifest.sheetCount} · 병합 ${manifest.mergeTotal}`)
