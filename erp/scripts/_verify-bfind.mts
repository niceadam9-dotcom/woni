/** 판정 B 발견 재실측 — 판정 결과도 실측해서 받는다(판정자도 틀린다).
 *  판정자의 프로브를 쓰지 않고 **배포 자산 + 실제 주입 산출물**을 직접 읽어 확인한다. */
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'
import JSZip from 'jszip'
import { injectWorkbook, sheetFileMap } from '../src/lib/xlsx-inject.ts'
import { SCRUB_NEEDLES, ANCHORS, validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const out: string[] = []
const log = (s: string) => out.push(s)

const TPL = 'templates/report-workbook-full.xlsx'
const bytes = new Uint8Array(readFileSync(TPL))

// ── 주입 산출물을 만든다: 표본과 **전혀 다른 답** ─────────────────────
const official: OfficialData = {
  company: { name: '㈜테스트소방', address: '주소', phone: '031-000-0000', fax: '031-000-0001' },
  docNo: '승 진 2608-9', sendDate: '2026년 8월', recipient: '재실측빌딩', reference: '관계인',
  sender: '㈜테스트소방', senderSign: { name: '주식회사 테스트소방', title: '대표이사', rep: '홍대표' },
  year: 2026, typeLabel: '작동점검',
}
const delegation: DelegationData = {
  typeLabel: '작동점검',
  owner: { name: '박관계', position: '소방안전관리자', phone: '010-1111-2222', birth: '1980.01.02' },
  agent: { name: '김점검', position: '과장', phone: '010-3333-4444', birth: '1990.03.04' },
  periodLabel: '2026.08.20 부터 ~ 2026.08.21 까지', daysLabel: '1일', submitDate: '2026년 8월 21일', station: '양평',
}
const v = validateAnchors(bytes)
if (!v.ok) throw new Error(v.failures.join(' · '))
const { targets } = toInjectTargets(buildWorkbookValues({
  official, delegation, customerAddress: '경기도 양평군 재실측로 9',
  startISO: '2026-08-20', endISO: '2026-08-21', useApprovalISO: '2011-06-25',
  building: {
    purpose: '업무시설', totalArea: 500, buildingArea: 200, floorsAbove: 3, floorsBelow: 1,
    height: 12, households: 0, buildingCount: 1, permitDateISO: '2009-04-25',
  },
  report9: {
    ckOp: true, ckInitial: false, ckCompEtc: false, consent: true, repRole: '소유자',
    managerGrade: '3급', mgrEduDate: '2026년 1월 2일', rampCount: '1',
    main: { name: '주된재실측', grade: '소방시설관리사', licenseNo: '제2026-9호' }, assistants: [],
    mgrAppointType: '겸직', hasFirePlan: true, firePlanStored: true,
    prevOpDone: true, prevCompDone: false, eduDone: true, drillDone: true,
    insuranceJoined: true, insCompany: '한화손보', insPeriod: '2026년 1월 1일 ~ 2026년 12월 31일',
    insPerson: '2000', insProperty: '20000',
    multiUseNone: true, multiUseCounts: {},
    stCon: true, stSteel: false, stBrick: false, stWood: false, stEtc: false,
    rfSlab: true, rfTile: false, rfSlate: false, rfEtc: false,
    stairsCount: '2', specialStairCount: '', elvR: '', elvE: '', elvV: '',
    pkIn: false, pkMech: false, pkRoof: false, pkOut: true,
  },
}), v.anchors)
const r = await injectWorkbook(bytes, targets, { forbidden: SCRUB_NEEDLES })
log(`주입: missed ${r.missed.length} · scrubbed ${r.scrubbed.length} · 전파 ${r.propagated}`)

const wb = XLSX.read(r.bytes, { cellFormula: true })
const cell = (s: string, c: string) => wb.Sheets[s]?.[c] as XLSX.CellObject | undefined
const val = (s: string, c: string) => String(cell(s, c)?.v ?? '')
const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))

// ── HIGH-1: 점검 구분이 표본의 '종합점검(최초점검)'으로 고정되는가 ────
log('\n### HIGH-1 점검 구분(대상물 G2/G3/L3 · 위임장 D1~D3)')
log(`  대상처!B7 (앵커 coverTitle) = ${JSON.stringify(val('대상처', 'B7'))}`)
for (const [s, c, labelCell] of [['대상물', 'G2', 'E2'], ['대상물', 'G3', 'E3'], ['대상물', 'L3', 'H3']] as const) {
  log(`  ${s}!${c} = ${JSON.stringify(val(s, c))}  라벨 ${labelCell}=${JSON.stringify(val(s, labelCell))}` +
    `  ${anchored.has(`${s}!${c}`) ? '[앵커]' : '**앵커없음**'}${cell(s, c)?.f ? ` f=${cell(s, c)!.f}` : ''}`)
}
for (const c of ['D1', 'D2', 'D3']) {
  log(`  위임장!${c} = ${JSON.stringify(val('위임장', c))}${cell('위임장', c)?.f ? ` f=${cell('위임장', c)!.f}` : ''}`)
}

// ── HIGH-2: 설비 설치·판정 (현황 5칸 + 파생 캐시) ────────────────────
log('\n### HIGH-2 설비 설치·판정(현황)')
for (const [c, lab] of [['C6', 'E6'], ['D7', 'F7'], ['Y13', 'AA13'], ['C28', 'E28'], ['Y28', 'AA28']] as const) {
  log(`  현황!${c} = ${JSON.stringify(val('현황', c))}  라벨 ${lab}=${JSON.stringify(val('현황', lab))}` +
    `  ${anchored.has(`현황!${c}`) ? '[앵커]' : '**앵커없음**'}`)
}
// 판정 캐시 '○'(양호)가 몇 칸인가 — 전 시트
let markO = 0, markSlash = 0
const oCells: string[] = []
for (const s of wb.SheetNames) {
  const ws = wb.Sheets[s]
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue
    const cc = ws[k] as XLSX.CellObject
    if (!cc.f) continue
    const t = String(cc.v ?? '')
    if (t === '○') { markO++; if (oCells.length < 12) oCells.push(`${s}!${k}`) }
    else if (t === '/' || t === '／') markSlash++
  }
}
log(`  수식 캐시 판정 마크: '○' **${markO}칸** · '/' ${markSlash}칸`)
log(`  '○' 표본: ${oCells.join(' ')}`)

// ── HIGH-3: 표본 고객 실내 위치 ──────────────────────────────────────
log('\n### HIGH-3 세부현황(현3) 표본 위치')
for (const c of ['C8', 'C9', 'C10', 'C12', 'C34', 'C35']) {
  const t = val('현3', c)
  if (t) log(`  현3!${c} = ${JSON.stringify(t.slice(0, 88))}`)
}
log(`  '직원실' 전 시트 출현: ${wb.SheetNames.filter(s => JSON.stringify(wb.Sheets[s]).includes('직원실')).join(', ') || '없음'}`)

// ── HIGH-4: 불량 세부(현5) 표본 소견 ─────────────────────────────────
log('\n### HIGH-4 불량 세부(현5) 표본 소견')
for (const c of ['C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10']) {
  const t = val('현5', c)
  if (t) log(`  현5!${c} = ${JSON.stringify(t)}  ${anchored.has(`현5!${c}`) ? '[앵커]' : '**앵커없음**'}`)
}

// ── MEDIUM-2: 기저 목차가 정적인가 ──────────────────────────────────
log('\n### MEDIUM-2 기저 목차 시트')
const tocRows: string[] = []
for (let i = 1; i <= 36; i++) { const t = val('목차', `A${i}`); if (t) tocRows.push(`A${i}=${JSON.stringify(t.slice(0, 40))}`) }
log(`  목차 값 칸 ${tocRows.length}개: ${tocRows.slice(0, 6).join(' · ')} …`)
log(`  '목 차'(도너) 첫 칸 = ${JSON.stringify(val('목 차', 'A2'))}`)

// ── LOW-1 ────────────────────────────────────────────────────────────
log(`\n### LOW-1 완료보고서!B20 = ${JSON.stringify(val('완료보고서', 'B20'))}`)

// ── 시트가 실제로 산출물에 남아 있는가(항상 나감 주장 확인) ──────────
const zip = await JSZip.loadAsync(r.bytes)
const files = await sheetFileMap(zip)
log(`\n### 산출물 시트 ${files.size}개 — 문제 시트 존재 여부`)
for (const s of ['대상물', '대상물2', '현황', '현1', '현3', '현5', '다수동', '목차', '완료보고서', '위임장'])
  log(`  ${s}: ${files.has(s) ? '있음' : '없음'}`)

writeFileSync('scripts/_verify-bfind.txt', out.join('\n'), 'utf8')
console.log('wrote scripts/_verify-bfind.txt')
