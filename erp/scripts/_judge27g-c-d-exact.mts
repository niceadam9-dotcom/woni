/** 판정자 C — 정밀 재측정. 앞 프로브의 조각 스캔이 애매한 니들('[√]실시')로 오탐 1건을 냈으므로
 *  **셀 원문 전체 일치**(애매함 0)로 다시 잰다. 그리고 라우트의 실제 경로(시트 선별 포함)에서
 *  고아 sharedStrings가 몇 개가 되는지, 표본 답이 어느 파트에 남는지 확정한다. */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS, validateAnchors, SCRUB_NEEDLES, MARK_CHECKED_RE, SAMPLE_OPINION_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { removeSheets } from '../src/lib/xlsx-sheet-surgery.ts'
import { allDonorSheets, donorGroupsToKeep, DONOR_TOC_SHEET } from '../src/lib/xlsx-donors.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const OUT: string[] = []
const log = (s = '') => OUT.push(s)
let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => { log(`  ${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++ }

const unesc = (s: string) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

type P = { cells: Map<string, { text: string; f: boolean }>; si: string[]; orphans: Array<[number, string]>; sheets: string[] }
async function parse(bytes: Uint8Array): Promise<P> {
  const zip = await JSZip.loadAsync(bytes)
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const rels = new Map<string, string>()
  for (const m of relXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g))
    rels.set(m[1], 'xl/' + m[2].replace(/^\/?xl\//, '').replace(/^\.\//, ''))
  const sstXml = await zip.file('xl/sharedStrings.xml')?.async('string') ?? ''
  const si: string[] = []
  for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let t = ''; for (const tm of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += unesc(tm[1]); si.push(t)
  }
  const cells = new Map<string, { text: string; f: boolean }>(); const used = new Set<number>(); const sheets: string[] = []
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = unesc(/name="([^"]*)"/.exec(m[1])?.[1] ?? ''); sheets.push(name)
    const xml = await zip.file(rels.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '') ?? '')?.async('string')
    if (!xml) continue
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1], b = c[2] ?? '', ref = /r="([A-Z]+\d+)"/.exec(a)?.[1] ?? '?', t = /t="([^"]+)"/.exec(a)?.[1] ?? 'n'
      let text = ''
      if (t === 's') { const i = Number(/<v>([\s\S]*?)<\/v>/.exec(b)?.[1] ?? '-1'); if (i >= 0) { used.add(i); text = si[i] ?? '' } }
      else if (t === 'inlineStr') { for (const tm of b.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += unesc(tm[1]) }
      else text = unesc(/<v>([\s\S]*?)<\/v>/.exec(b)?.[1] ?? '')
      if (text !== '') cells.set(`${name}!${ref}`, { text, f: /<f[\s>]/.test(b) })
    }
  }
  return { cells, si, orphans: si.map((t, i) => [i, t] as [number, string]).filter(([i]) => !used.has(i)), sheets }
}

const FULL = 'templates/report-workbook-full.xlsx'
const template = new Uint8Array(readFileSync(FULL))
const tpl = await parse(template)

const INFO = ['B5', 'B8', 'B10', 'B11', 'B12', 'B13', 'B14', 'E14', 'I14', 'B19', 'B20', 'B21', 'B22', 'B23']
const MB = [0, 10, 20].flatMap(o => [6, 7, 8, 9, 10].map(r => `B${r + o}`))
/** 표본 답 = 자산 원문 **전체 문자열**(부분일치 아님 → 오탐 0) */
const SAMPLE: Array<[string, string]> = [
  ...INFO.map(r => [`정보!${r}`, tpl.cells.get(`정보!${r}`)?.text ?? ''] as [string, string]),
  ...MB.map(r => [`다수동일때!${r}`, tpl.cells.get(`다수동일때!${r}`)?.text ?? ''] as [string, string]),
].filter(([, t]) => t !== '')
log(`# 표본 답 원문 ${SAMPLE.length}건(정보 ${INFO.length} + 다수동일때 ${MB.length})`)

type R9 = Parameters<typeof buildWorkbookValues>[0]['report9']
const report9 = {
  ckOp: false, ckInitial: true, ckCompEtc: false, consent: false, repRole: '점유자',
  managerGrade: '1급', mgrEduDate: '2025년 9월 9일', rampCount: '4',
  main: { name: '판정주된', grade: '소방시설관리사', licenseNo: '제9999-1호' },
  assistants: [{ name: '판정보조', grade: '소방기술사', licenseNo: 'X-1', period: '2026.08.30' }],
  mgrAppointType: '업무대행감독',
  hasFirePlan: false, firePlanNone: true, firePlanStored: false, firePlanUnstored: false,
  prevOpDone: false, prevOpNone: true, prevCompDone: true,
  eduDone: false, eduNone: true, drillDone: false, drillNone: true,
  insuranceJoined: false, insCompany: '한화손해보험', insPeriod: '2027년 5월 5일 ~ 2028년 5월 4일',
  insPerson: '77', insProperty: '888',
  multiUseNone: false, multiUseCounts: { '단란주점영업': '4' },
  stCon: false, stSteel: false, stBrick: true, stWood: false, stEtc: false,
  rfSlab: true, rfTile: false, rfSlate: false, rfEtc: false,
  stairsCount: '9', specialStairCount: '3', elvR: '5', elvE: '2', elvV: '',
  pkIn: false, pkInUg: false, pkInGround: false, pkInPiloti: false, pkMech: false, pkRoof: true, pkOut: false,
  resultMarks: {},
} as unknown as R9
const official: OfficialData = {
  company: { name: '판정소방', address: '판정주소', phone: '031-1', fax: '031-2' },
  docNo: '승 진 2608-9', sendDate: '2026년 8월', recipient: '판정빌딩', reference: '관계인',
  sender: '판정소방', senderSign: { name: '판정소방', title: '대표', rep: '판정대표' }, year: 2026, typeLabel: '작동점검',
}
const delegation: DelegationData = {
  typeLabel: '작동점검', owner: { name: '판정관계', position: '소방안전관리자', phone: '010-9', birth: '1980.01.01' },
  agent: { name: '판정대리', position: '차장', phone: '010-8', birth: '1990.01.01' },
  periodLabel: '2026.08.30 ~ 2026.08.30', daysLabel: '1일', submitDate: '2026년 8월 30일', station: '양평',
}

/** 라우트와 같은 순서: 시트 선별 → 앵커 검증 → 주입 */
async function produce(withSheetCut: boolean) {
  let t = template
  if (withSheetCut) {
    const kept = new Set(donorGroupsToKeep(k => k === 'always' || k === '소화기구 및 자동소화장치', false).flatMap(g => g.sheets))
    t = (await removeSheets(t, allDonorSheets().filter(s => s !== DONOR_TOC_SHEET && !kept.has(s)))).bytes
  }
  const chk = validateAnchors(t)
  if (!chk.ok) throw new Error(chk.failures.join(' · '))
  const values = buildWorkbookValues({
    official, delegation, customerAddress: '경기 양평 판정로 9',
    startISO: '2026-08-30', endISO: '2026-08-30', useApprovalISO: '2010-01-01',
    installedCodes: ['옥내소화전설비'], evacTypes: ['완강기'],
    building: { purpose: '판정용도', totalArea: 111.11, buildingArea: 50, floorsAbove: 3, floorsBelow: 1, height: 9.9, households: 4, buildingCount: 3, permitDateISO: '2008-08-08' },
    report9,
  })
  const { targets } = toInjectTargets(values, chk.anchors)
  return injectWorkbook(t, targets, { forbidden: SCRUB_NEEDLES })
}

for (const cut of [false, true]) {
  const label = cut ? '라우트 실경로(설비 시트 선별 후)' : '전 시트 유지'
  log(`\n## ${label}`)
  const res = await produce(cut)
  const out = await parse(res.bytes)
  const zip = await JSZip.loadAsync(res.bytes)
  const parts: Array<[string, string]> = []
  for (const n of Object.keys(zip.files)) {
    if (zip.files[n].dir || /\.(png|jpe?g|gif|emf|wmf|bin)$/i.test(n)) continue
    parts.push([n, unesc(await zip.file(n)!.async('string'))])
  }
  log(`  시트 ${out.sheets.length}장 · si ${out.si.length} · 고아 si ${out.orphans.length}개(템플릿 ${tpl.orphans.length})`)

  // ① 셀 축 — 표본 답 원문이 어느 셀에도 없는가
  const cellHit = SAMPLE.filter(([, t]) => [...out.cells].some(([, c]) => c.text === t))
    .map(([k]) => k)
  check(`[셀 축] 표본 답 원문 ${SAMPLE.length}건이 어느 셀에도 없다`, cellHit.length === 0, cellHit.join(', '))

  // ② 원시 바이트 축 — 같은 문자열이 파트 바이트에 있는가
  const rawHit: string[] = []
  for (const [k, t] of SAMPLE) for (const [n, raw] of parts) if (raw.includes(t)) rawHit.push(`${k}⊂${n}`)
  check(`[바이트 축] 같은 ${SAMPLE.length}건이 zip 파트 바이트에도 없다`, rawHit.length === 0,
    `${rawHit.length}건: ${[...new Set(rawHit)].slice(0, 30).join(' ')}`)

  // ③ 고아 si — 새로 생긴 것(템플릿에 없던 것) 중 표본 답
  const tplOrphanTexts = new Set(tpl.orphans.map(([, t]) => t))
  const newOrphans = out.orphans.filter(([, t]) => !tplOrphanTexts.has(t))
  const newSampleOrphans = newOrphans.filter(([, t]) => SAMPLE.some(([, s]) => s === t))
  log(`  주입이 **새로 만든** 고아 si ${newOrphans.length}개 · 그중 표본 답 ${newSampleOrphans.length}개`)
  check('주입이 표본 답을 고아 si로 남기지 않는다', newSampleOrphans.length === 0,
    newSampleOrphans.map(([i]) => `si#${i}`).join(', '))

  // ④ 안전망(SCRUB_NEEDLES)이 이 부류를 못 보는 이유 실측 — 니들 대조
  const needleInOrphan = out.orphans.filter(([, t]) => SCRUB_NEEDLES.some(n => t.includes(n)))
  log(`  고아 si 중 SCRUB_NEEDLES 매치: ${needleInOrphan.length}개 (안전망은 이 목록만 본다)`)
  const opinionOrphan = out.orphans.filter(([, t]) => SAMPLE_OPINION_NEEDLES.some(n => t.includes(n)))
  const piiish = out.orphans.filter(([, t]) => /^\d{4}-\d{2}-\d{5}E$/.test(t) || /^[가-힣]{2,4}$/.test(t))
  log(`  고아 si 중 표본 소견(SAMPLE_OPINION_NEEDLES) 매치: ${opinionOrphan.length}개 ${opinionOrphan.map(([i, t]) => `si#${i}=${JSON.stringify(t)}`).join(' ')}`)
  log(`  고아 si 중 사람이름·자격번호꼴: ${piiish.length}개 ${piiish.map(([, t]) => JSON.stringify(t)).join(' ')}`)

  // ⑤ 산출물의 앵커 없는 체크 마크 — 템플릿과 비교해 출처를 밝힌다
  const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))
  const unan = [...out.cells].filter(([k, c]) => MARK_CHECKED_RE.test(c.text) && !anchored.has(k))
  const tplUnan = [...tpl.cells].filter(([k, c]) => MARK_CHECKED_RE.test(c.text) && !anchored.has(k))
  log(`  앵커 없는 체크 마크 — 템플릿 ${tplUnan.length}칸 → 산출물 ${unan.length}칸`)
  for (const [k, c] of unan) log(`    ${k}${c.f ? '(수식캐시=전파)' : '(리터럴)'} ${JSON.stringify(c.text.slice(0, 40))}`)
  check('산출물의 앵커 없는 마크는 전부 전파된 수식 캐시(리터럴 잔재 0)', unan.every(([, c]) => c.f),
    unan.filter(([, c]) => !c.f).map(([k]) => k).join(', '))
}

log(`\n결과: ${pass} 통과 / ${fail} 실패`)
writeFileSync('scripts/_judge27g-c-d-exact.txt', OUT.join('\n'), 'utf8')
console.log(`${pass} pass / ${fail} fail`)
