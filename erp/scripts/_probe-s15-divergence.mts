/* §15 제품 결정 재료 — 엑셀↔PDF 갈라짐 2건을 **실물로** 확정한다 (소방계획서_32 S15)
 *
 * 판정자 B·D가 각각 독립으로 찾았고 둘 다 "의도인지 결함인지 사용자만 안다"며 넘겼다.
 * 사용자가 판단하려면 '무엇이 어디에 나오고 어디에 안 나오는가'가 수치와 이름으로 있어야 한다.
 * 여기서는 고치지 않는다 — **재료만 만든다.**
 *
 * V-1 할로겐 27건 : 응답은 있는데 설비 대장에 없어 엑셀은 시트째 빠진다. PDF(별지4호)는 인쇄한다.
 * V-2 세부제원 10시트 : 현1~현5·세1~세5가 앵커 0이라 모든 고객 파일에 백지. PDF는 같은 값을 인쇄한다.
 *
 * 실행: cd F:\AI\ERP\erp; npx tsx scripts/_probe-s15-divergence.mts
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
// @ts-expect-error mjs 헬퍼 — .env.local을 읽어 service_role 클라이언트를 준다
import { raw } from './_e2e-helpers.mjs'
import { assembleReport9 } from '../src/lib/report9-assemble'
import { donorCellForItem } from '../src/lib/xlsx-donor-inject'
import { donorGroupsToKeep } from '../src/lib/xlsx-donors'
import { sheetMatchesFacilities } from '../src/lib/sheet-facility-map'
import { ANCHORS } from '../src/lib/xlsx-anchors'

const ASSET = 'templates/report-workbook-full.xlsx'
const CUST = 'c98d316f-21ba-463b-9493-62dacdf44f56'   // 서림사 C330
const INSP = '98e3a13b-881d-4e20-9e42-b68c7c3b88f4'   // 2026 1차

const admin = raw

// ── 대상 확정 ───────────────────────────────────────────────────────────────
const { data: insp, error: iErr } = await admin.from('inspections')
  .select('id, customer_id').eq('id', INSP).maybeSingle()
if (iErr) throw new Error(`점검 조회 실패: ${iErr.message}`)
if (!insp) throw new Error('점검 건 없음')
const customerId = (insp as { customer_id: string }).customer_id
const { data: cust } = await admin.from('customers').select('customer_name, customer_code').eq('id', customerId).maybeSingle()
console.log(`대상: ${(cust as { customer_name: string })?.customer_name} (${(cust as { customer_code: string })?.customer_code})  [${CUST === customerId ? '상수 일치' : '⚠상수와 다름'}]`)

const r9 = await assembleReport9(admin, customerId, INSP)

// ── V-1 : 응답은 있는데 엑셀에서 시트째 빠지는 코드 ──────────────────────────
console.log('\n═══ V-1  할로겐 축 — 엑셀은 빼고 PDF는 인쇄하는가 ═══')
const { data: blds } = await admin.from('buildings').select('id').eq('customer_id', customerId).eq('is_active', true)
const bldIds = (blds ?? []).map((b: { id: string }) => b.id)
const { data: facRaw, error: fErr } = bldIds.length
  ? await admin.from('fire_facilities').select('facility_code').in('building_id', bldIds).eq('installed', true)
  : { data: [], error: null }
if (fErr) throw new Error(`설비 조회 실패: ${fErr.message}`)
const installed = [...new Set((facRaw ?? []).map((f: { facility_code: string }) => f.facility_code))]
const keptGroups = donorGroupsToKeep(k => sheetMatchesFacilities(k, installed), false)
const keptSheets = new Set(keptGroups.flatMap(g => g.sheets))

// ⚠ `sheetResponses`는 **반환 최상위**에 있다(r9.data가 아니다) — route.ts:190과 같은 축
const responses = (r9 as { sheetResponses: Array<{ item_code: string; result: string; month: number }> }).sheetResponses
if (!Array.isArray(responses)) throw new Error('sheetResponses를 못 읽었다 — 조립 반환 모양을 볼 것')
const byCode = new Map<string, string>()
for (const r of responses) if (!byCode.has(r.item_code)) byCode.set(r.item_code, r.result)

const sheetRemoved: Array<{ code: string; sheet: string }> = []
for (const [code] of byCode) {
  const loc = donorCellForItem(code)
  if (loc && !keptSheets.has(loc.sheet)) sheetRemoved.push({ code, sheet: loc.sheet })
}
const bySheet = new Map<string, string[]>()
for (const s of sheetRemoved) (bySheet.get(s.sheet) ?? bySheet.set(s.sheet, []).get(s.sheet)!).push(s.code)

console.log(`  설치 설비 ${installed.length}종 · 동봉 시트 ${keptSheets.size}장`)
console.log(`  엑셀에서 시트째 빠지는 응답: ${sheetRemoved.length}건`)
for (const [sheet, codes] of bySheet) console.log(`    · ${sheet}: ${codes.length}건 (${codes.slice(0, 4).join(', ')}…)`)

// PDF(별지 4호) 쪽은 그 코드를 싣는가 — sheetSections는 '응답 있는 시트'를 구제한다
// ⚠ annex4도 **반환 최상위**다(:569) — r9.data 밑이 아니다
const secs = (r9 as { annex4?: { sheetSections?: Array<{ id: string; items?: Array<{ code: string }> }> } })
  .annex4?.sheetSections
if (!secs) {
  console.log('  ⚠ annex4.sheetSections를 못 읽었다 — PDF 축 미판정')
} else {
  const pdfCodes = new Set(secs.flatMap(s => (s.items ?? []).map(i => i.code)))
  const inPdf = sheetRemoved.filter(s => pdfCodes.has(s.code))
  console.log(`  그 ${sheetRemoved.length}건 중 **PDF(별지4호)에는 실리는 것: ${inPdf.length}건**`)
  console.log(`  → ${inPdf.length === sheetRemoved.length ? '전건 갈라진다(엑셀 없음 / PDF 있음)' : '일부만 갈라진다'}`)
}

// ── V-2 : 세부제원 시트가 앵커 0인가, 그리고 그 값이 DB에 있는가 ─────────────
console.log('\n═══ V-2  세부제원 축 — 엑셀은 백지, PDF는 인쇄하는가 ═══')
const SPEC_SHEETS = ['현1', '현2', '현3', '현4', '현5', '세1', '세2', '세3', '세4', '세5']
const anchorSheets = new Set(ANCHORS.map(a => a.sheet))
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(ASSET)))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const present = new Set([...wbXml.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]))

for (const s of SPEC_SHEETS) {
  const n = ANCHORS.filter(a => a.sheet === s).length
  console.log(`  ${s.padEnd(4)} 자산에 존재=${present.has(s)}  앵커 ${n}칸  ${n === 0 ? '← 백지로 나간다' : ''}`)
}
console.log(`  (참고) 앵커를 가진 시트: ${[...anchorSheets].join(', ')}`)

const { data: specs, error: sErr } = await admin.from('customer_facility_specs')
  .select('section_key, spec').eq('customer_id', customerId)
if (sErr) throw new Error(`세부현황 조회 실패: ${sErr.message}`)
console.log(`\n  이 고객이 실제로 채운 세부현황: ${(specs ?? []).length}행`)
for (const s of (specs ?? []) as Array<{ section_key: string; spec: unknown }>) {
  console.log(`    · ${s.section_key}: ${JSON.stringify(s.spec).slice(0, 110)}`)
}
console.log('\n  → 이 값들이 PDF(별지 9호 3쪽 계열)에는 인쇄되고 엑셀에는 받을 칸이 없다.')
console.log('     의도라면 32.json S15에 "의도된 동작"으로 적어야 하고, 아니면 앵커를 배선해야 한다.')
