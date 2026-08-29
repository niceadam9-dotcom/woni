/** 판정자 C — S7-4·S7-5 판정: **산출물 원시 바이트** 축
 *  구현자의 soffice HTML 충실도 축을 쓰지 않는다. 산출물 xlsx를 zip으로 열어
 *  worksheets/*.xml · sharedStrings.xml · 전 파트를 직접 파싱해 표본 답이 남는지 본다.
 *
 *  대조군을 먼저 낸다 — 같은 스캐너를 **주입 전 템플릿**에 돌려 붉어지는 것을 보인다.
 *  그래야 '산출물 0건'이 '스캐너가 아무것도 못 본다'와 구별된다. */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS, validateAnchors, SCRUB_NEEDLES, MARK_CHECKED_RE } from '../src/lib/xlsx-anchors.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const OUT: string[] = []
const log = (s = '') => OUT.push(s)
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

// ── 독립 파서(구현 코드의 sheetFileMap을 쓰지 않는다) ──
const unesc = (s: string) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

type Parsed = {
  cells: Array<{ sheet: string; ref: string; text: string; isFormula: boolean }>
  si: string[]
  orphans: Array<[number, string]>
  sheets: string[]
}
async function parse(bytes: Uint8Array): Promise<Parsed> {
  const zip = await JSZip.loadAsync(bytes)
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const rels = new Map<string, string>()
  for (const m of relXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g))
    rels.set(m[1], 'xl/' + m[2].replace(/^\/?xl\//, '').replace(/^\.\//, ''))
  const sstXml = await zip.file('xl/sharedStrings.xml')?.async('string') ?? ''
  const si: string[] = []
  for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let t = ''
    for (const tm of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += unesc(tm[1])
    si.push(t)
  }
  const cells: Parsed['cells'] = []
  const used = new Set<number>()
  const sheets: string[] = []
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = unesc(/name="([^"]*)"/.exec(m[1])?.[1] ?? '')
    const path = rels.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '')
    sheets.push(name)
    const xml = path ? await zip.file(path)?.async('string') : undefined
    if (!xml) continue
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? ''
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '?'
      const t = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
      let text = ''
      if (t === 's') {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '-1')
        if (i >= 0) { used.add(i); text = si[i] ?? '' }
      } else if (t === 'inlineStr') {
        for (const tm of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += unesc(tm[1])
      } else text = unesc(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '')
      if (text !== '') cells.push({ sheet: name, ref, text, isFormula: /<f[\s>]/.test(body) })
    }
  }
  return { cells, si, orphans: si.map((t, i) => [i, t] as [number, string]).filter(([i]) => !used.has(i)), sheets }
}
/** 전 zip 파트의 **원시 문자열**(고아 si·머리글·도형까지 포함하는 진짜 바이트 축) */
async function rawParts(bytes: Uint8Array): Promise<Array<[string, string]>> {
  const zip = await JSZip.loadAsync(bytes)
  const out: Array<[string, string]> = []
  for (const n of Object.keys(zip.files)) {
    if (zip.files[n].dir) continue
    if (/\.(png|jpe?g|gif|emf|wmf|bin)$/i.test(n)) continue
    out.push([n, unesc(await zip.file(n)!.async('string'))])
  }
  return out
}

const FULL = 'templates/report-workbook-full.xlsx'
const template = new Uint8Array(readFileSync(FULL))
const tpl = await parse(template)

// ── 표본 답 니들을 **자산에서 뽑는다**(손으로 타이핑하지 않는다 = 오타로 공허참이 되지 않게) ──
const INFO_CELLS = ['B5', 'B8', 'B10', 'B11', 'B12', 'B13', 'B14', 'E14', 'I14', 'B19', 'B20', 'B21', 'B22', 'B23']
const MB_CELLS = [0, 10, 20].flatMap(o => [6, 7, 8, 9, 10].map(r => `B${r + o}`))
const cellText = (p: Parsed, s: string, r: string) => p.cells.find(c => c.sheet === s && c.ref === r)?.text ?? ''

/** 표본 답 조각 — 체크된 마크에 붙은 라벨(`[√]철근콘크리트구조`)과 채워진 숫자·날짜 슬롯 */
const fragments = new Map<string, string>()   // 조각 → 출처
const addFrag = (frag: string, src: string) => { if (frag.trim().length >= 3) fragments.set(frag, src) }
for (const [sheet, refs] of [['정보', INFO_CELLS], ['다수동일때', MB_CELLS]] as Array<[string, string[]]>)
  for (const ref of refs) {
    const t = cellText(tpl, sheet, ref)
    for (const m of t.matchAll(/\[\s*√\s*\][^,\n[\]]{0,24}/g)) addFrag(m[0].trim(), `${sheet}!${ref}`)
  }
// 숫자·날짜가 채워진 슬롯(빈 슬롯은 공백뿐이라 자동으로 걸러진다)
addFrag('( 1 개소 )', '정보!B21 · 다수동일때 3블록')
addFrag('2024년  1월  1일', '정보!B13')
addFrag('2024년  12월  31일', '정보!B13')

log(`# 표본 답 조각 ${fragments.size}종(자산에서 추출)`)
for (const [f, src] of fragments) log(`  ${JSON.stringify(f)}   ← ${src}`)

// ── 픽스처: 표본과 **모든 칸에서 다른** 답 (판정자 C가 직접 고른 값 — 구현자 픽스처 재사용 안 함) ──
type R9 = Parameters<typeof buildWorkbookValues>[0]['report9']
const report9 = {
  ckOp: false, ckInitial: true, ckCompEtc: false, consent: false,
  repRole: '점유자',                         // 표본: 관리자
  managerGrade: '1급', mgrEduDate: '2025년 9월 9일', rampCount: '4',
  main: { name: '판정주된', grade: '소방시설관리사', licenseNo: '제9999-1호' },
  assistants: [{ name: '판정보조', grade: '소방기술사', licenseNo: 'X-1', period: '2026.08.30' }],
  mgrAppointType: '업무대행감독',            // 표본: 소방안전관리자수첩
  hasFirePlan: false, firePlanNone: true, firePlanStored: false, firePlanUnstored: false,
  prevOpDone: false, prevOpNone: true, prevCompDone: true,   // 표본: 작동 실시
  eduDone: false, eduNone: true, drillDone: false, drillNone: true,  // 표본: 둘 다 실시
  insuranceJoined: false,                    // 표본: 가입
  insCompany: '한화손해보험', insPeriod: '2027년 5월 5일 ~ 2028년 5월 4일',
  insPerson: '77', insProperty: '888',
  multiUseNone: false, multiUseCounts: { '단란주점영업': '4' },   // 표본: 해당없음
  stCon: false, stSteel: false, stBrick: true, stWood: false, stEtc: false,  // 표본: 철근콘크리트
  rfSlab: true, rfTile: false, rfSlate: false, rfEtc: false,      // 표본: 기타
  stairsCount: '9', specialStairCount: '3',  // 표본: 직통 1개소
  elvR: '5', elvE: '2', elvV: '',
  pkIn: false, pkInUg: false, pkInGround: false, pkInPiloti: false,
  pkMech: false, pkRoof: true, pkOut: false, // 표본: 옥외
  resultMarks: {},
} as unknown as R9

const official: OfficialData = {
  company: { name: '판정소방', address: '판정주소', phone: '031-1', fax: '031-2' },
  docNo: '승 진 2608-9', sendDate: '2026년 8월', recipient: '판정빌딩', reference: '관계인',
  sender: '판정소방', senderSign: { name: '판정소방', title: '대표', rep: '판정대표' },
  year: 2026, typeLabel: '작동점검',
}
const delegation: DelegationData = {
  typeLabel: '작동점검',
  owner: { name: '판정관계', position: '소방안전관리자', phone: '010-9', birth: '1980.01.01' },
  agent: { name: '판정대리', position: '차장', phone: '010-8', birth: '1990.01.01' },
  periodLabel: '2026.08.30 ~ 2026.08.30', daysLabel: '1일', submitDate: '2026년 8월 30일', station: '양평',
}

const chk = validateAnchors(template)
if (!chk.ok) { log('앵커 검증 실패: ' + chk.failures.join(' · ')); writeFileSync('scripts/_judge27g-c-b-output.txt', OUT.join('\n'), 'utf8'); process.exit(2) }
const values = buildWorkbookValues({
  official, delegation, customerAddress: '경기 양평 판정로 9',
  startISO: '2026-08-30', endISO: '2026-08-30', useApprovalISO: '2010-01-01',
  installedCodes: ['옥내소화전설비'], evacTypes: ['완강기'],
  building: {
    purpose: '판정용도', totalArea: 111.11, buildingArea: 50, floorsAbove: 3, floorsBelow: 1,
    height: 9.9, households: 4, buildingCount: 3, permitDateISO: '2008-08-08',
  },
  report9,
})
const { targets, unmapped } = toInjectTargets(values, chk.anchors)
check('앵커-값 매핑 누락 0', unmapped.length === 0, unmapped.map(a => a.field).join(', '))
const res = await injectWorkbook(template, targets, { forbidden: SCRUB_NEEDLES })
check('주입 미발견 0', res.missed.length === 0, res.missed.join(', '))
log(`  · 전파 ${res.propagated}칸 · 안전망 소거 ${res.scrubbed.length}칸`)
const out = await parse(res.bytes)
const outRaw = await rawParts(res.bytes)
const tplRaw = await rawParts(template)

// ── ① 대조군 — 같은 스캐너를 주입 전 템플릿에 돌린다 ──────────────────────────
log('\n## ① 대조군(주입 전 템플릿) — 스캐너가 실제로 본다는 증명')
const scanCells = (p: Parsed) => {
  const hits: string[] = []
  for (const c of p.cells) for (const [f] of fragments) if (c.text.includes(f)) hits.push(`${c.sheet}!${c.ref}⊃${JSON.stringify(f)}`)
  return hits
}
const scanRaw = (parts: Array<[string, string]>) => {
  const hits: string[] = []
  for (const [n, raw] of parts) for (const [f] of fragments) if (raw.includes(f)) hits.push(`${n}⊃${JSON.stringify(f)}`)
  return hits
}
const ctlCells = scanCells(tpl), ctlRaw = scanRaw(tplRaw)
check('대조군: 템플릿 셀 축에서 표본 답이 검출된다(0이면 스캐너 무효)', ctlCells.length > 0, `${ctlCells.length}건 예: ${ctlCells.slice(0, 4).join(' ')}`)
check('대조군: 템플릿 원시 파트 축에서도 검출된다', ctlRaw.length > 0, `${ctlRaw.length}건`)

// ── ② 산출물 셀 축 ────────────────────────────────────────────────────────
log('\n## ② 산출물 — 셀 축(전 시트)')
const outCells = scanCells(out)
check(`산출물 ${out.sheets.length}시트 셀에 표본 답 조각 0건`, outCells.length === 0, outCells.slice(0, 10).join(' | '))

// 반영 축 — 0건이 '전부 공란'으로 달성되지 않았다는 반대 방향 단언
log('\n## ②b 반영 축 — 내 픽스처 답이 실제로 찍혔는가')
const mustInfo: Array<[string, string]> = [
  ['B5', '[√]점유자'], ['B8', '[√]업무대행감독'], ['B10', '[√]미작성'],
  ['B11', '종합정밀점검 ([√]실시'], ['B12', '소방안전교육 ([  ]실시'], ['B13', '한화손해보험'],
  ['B13', '2027년 5월 5일'], ['B14', '[√]단란주점영업( 4 개소)'], ['B19', '[√]조적조'],
  ['B20', '[√]슬라브'], ['B21', '( 9 개소 )'], ['B22', '[√]승용( 5 대 )'], ['B23', '[√]옥상'],
]
const notApplied = mustInfo.filter(([ref, needle]) => !cellText(out, '정보', ref).includes(needle))
check(`정보 ${mustInfo.length}건 픽스처 답 반영`, notApplied.length === 0,
  notApplied.map(([r, n]) => `${r}⊅${JSON.stringify(n)} (실제 ${JSON.stringify(cellText(out, '정보', r).slice(0, 70))})`).join(' | '))

// ── ③ 다수동일때 15칸 ─────────────────────────────────────────────────────
log('\n## ③ 다수동일때 15칸 — 백지 서식인가')
const mbBad = MB_CELLS.filter(r => {
  const t = cellText(out, '다수동일때', r)
  return t === '' || MARK_CHECKED_RE.test(t) || /\( 1 /.test(t)
})
check('다수동일때 15칸 전부 비어 있지 않고 체크 마크 0', mbBad.length === 0,
  mbBad.map(r => `${r}=${JSON.stringify(cellText(out, '다수동일때', r).slice(0, 50))}`).join(' | '))
for (const r of MB_CELLS.slice(0, 5)) log(`    B${r.slice(1)} → ${JSON.stringify(cellText(out, '다수동일때', r))}`)

// ── ④ 산출물 마크 덮개 — 앵커 없는 √가 있는가(내 축으로 재측정) ────────────
log('\n## ④ 산출물 전 시트 — 앵커 없는 체크 마크')
const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))
const marks = out.cells.filter(c => MARK_CHECKED_RE.test(c.text))
const unan = marks.filter(c => !anchored.has(`${c.sheet}!${c.ref}`))
log(`  체크 마크 보유 ${marks.length}칸 · 앵커 없음 ${unan.length}칸`)
for (const c of unan.slice(0, 12)) log(`    ${c.sheet}!${c.ref}${c.isFormula ? '(캐시)' : ''} ${JSON.stringify(c.text.slice(0, 60))}`)
check('산출물에 앵커 없는 체크 마크 0칸', unan.length === 0, `${unan.length}칸`)

// ── ⑤ 🚨 원시 바이트 축 — 셀이 아닌 곳(고아 sharedStrings 등) ──────────────
log('\n## ⑤ 산출물 원시 바이트 — 셀 축이 구조적으로 못 보는 곳')
const outRawHits = scanRaw(outRaw)
check('산출물 전 zip 파트에 표본 답 조각 0건', outRawHits.length === 0, outRawHits.slice(0, 12).join(' | '))

log(`\n  고아 si — 템플릿 ${tpl.orphans.length}개 → 산출물 ${out.orphans.length}개`)
const orphanMark = out.orphans.filter(([, t]) => MARK_CHECKED_RE.test(t))
const orphanFrag = out.orphans.filter(([, t]) => [...fragments.keys()].some(f => t.includes(f)))
check('산출물 고아 si에 체크 마크 0건', orphanMark.length === 0,
  orphanMark.map(([i, t]) => `si#${i}=${JSON.stringify(t.slice(0, 70))}`).join(' | '))
check('산출물 고아 si에 표본 답 조각 0건', orphanFrag.length === 0,
  orphanFrag.map(([i, t]) => `si#${i}=${JSON.stringify(t.slice(0, 70))}`).join(' | '))
log('  고아 si 전문:')
for (const [i, t] of out.orphans) log(`    si#${i} ${JSON.stringify(t.slice(0, 110))}`)

// ── ⑥ 반증 가능성 — 스캐너에 결함을 심어 붉어지는지 ────────────────────────
log('\n## ⑥ 반증 가능성 — 산출물 바이트에 표본 답을 심으면 ⑤가 잡는가')
{
  const zip = await JSZip.loadAsync(res.bytes)
  const sst = await zip.file('xl/sharedStrings.xml')!.async('string')
  zip.file('xl/sharedStrings.xml', sst.replace('</sst>', '<si><t> [√]철근콘크리트구조, 심은것</t></si></sst>'))
  const planted = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  const hits = scanRaw(await rawParts(planted))
  const pcells = scanCells(await parse(planted))
  check('심은 고아 si를 원시 축이 잡는다', hits.length > 0, `${hits.length}건`)
  check('심은 고아 si를 **셀 축은 못 잡는다**(두 축이 다르다는 증명)', pcells.length === 0, `${pcells.length}건`)
}

log(`\n결과: ${pass} 통과 / ${fail} 실패`)
writeFileSync('scripts/_judge27g-c-b-output.txt', OUT.join('\n'), 'utf8')
console.log(`${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
