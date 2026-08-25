/** ⭐ LibreOffice **재변환(재계산) 축** — 소방계획서_27 별지 4호 점검결과 칸 (2026-08-25)
 *  실행: npx tsx scripts/_probe-xlsx-recalc.mts      (로컬 LibreOffice 필요)
 *
 *  왜 이 축이 따로 필요한가 —
 *  종전 검사(SheetJS·XML 축)는 **캐시 층**만 잰다. `<f>`를 남긴 채 `<v>`만 지우면 그 층에서는
 *  '판정 마크 0칸'으로 초록인데, LibreOffice가 파일을 여는 순간 수식이 **재계산되어 되살아난다**
 *  (2026-08-25 실측 — 저장소 주석의 D-9 공리 'LO가 fullCalcOnLoad를 무시한다'는 이 부류에
 *  성립하지 않는다). 캐시를 지우는 것과 수식을 없애는 것은 다른 일이다.
 *
 *  그래서 여기서는 **주입 산출물을 soffice로 왕복**시킨 뒤(= 사용자가 여는 것과 같은 상태)
 *  값을 읽는다. 프로필은 격리한다(남의 세션과 겹치면 ETIMEDOUT — risk_soffice_profile_lock). */
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { FORM4_ROWS, FORM4_UNWIRED, isForm4Installed } from '../src/lib/xlsx-form4.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const TPL = process.argv[2] ?? 'templates/report-workbook-full.xlsx'
const dir = mkdtempSync(join(tmpdir(), 'wbrecalc-'))
const profile = mkdtempSync(join(tmpdir(), 'loprof-'))
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

/** 프로필 격리 왕복 — 첫 1~2회는 LO 초기화로 실패할 수 있어 재시도한다 */
function roundTrip(bytes: Uint8Array, name: string): string | null {
  const src = join(dir, name)
  writeFileSync(src, bytes)
  const out = join(dir, `out-${name.replace(/\.xlsx$/, '')}`)
  for (let i = 0; i < 3; i++) {
    try {
      execFileSync(SOFFICE, [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        '--headless', '--norestore', '--convert-to', 'xlsx', '--outdir', out, src,
      ], { timeout: 600_000, windowsHide: true, stdio: 'pipe' })
    } catch { /* 초기화 실패 — 재시도 */ }
    const p = join(out, name)
    if (existsSync(p)) return p
  }
  return null
}

// ── 픽스처: 설치 6종 + 피난기구 종류 1종. '설치인데 결과가 ○로 자동 인쇄'와
//    '미설치인데 ／가 아닌' 두 방향을 한 파일에서 본다
const INSTALLED = [
  '소화기구 및 자동소화장치', '소화기(소화기·자동확산·간이)',
  '옥내소화전설비', '자동화재탐지설비 및 시각경보기', '유도등', '피난기구',
]
const EVAC = ['완강기']

const official: OfficialData = {
  company: { name: '㈜테스트소방', address: '주소', phone: '031-000-0000', fax: '031-000-0001' },
  docNo: '승 진 2608-7', sendDate: '2026년 8월', recipient: '검증대상빌딩', reference: '소방안전관리자 및 관계인',
  sender: '㈜테스트소방', senderSign: { name: '주식회사 테스트소방', title: '대표이사', rep: '홍대표' },
  year: 2026, typeLabel: '작동점검',
}
const delegation: DelegationData = {
  typeLabel: '작동점검',
  owner: { name: '박관계', position: '소방안전관리자', phone: '010-1111-2222', birth: '1980.01.02' },
  agent: { name: '김점검', position: '과장', phone: '010-3333-4444', birth: '1990.03.04' },
  periodLabel: '2026.08.20 부터 ~ 2026.08.21 까지', daysLabel: '2일', submitDate: '2026년 8월 21일', station: '양평',
}
const values = buildWorkbookValues({
  official, delegation, customerAddress: '경기도 양평군 검증로 1',
  startISO: '2026-08-20', endISO: '2026-08-21', useApprovalISO: '2011-06-25',
  installedCodes: INSTALLED, evacTypes: EVAC,
  building: {
    purpose: '근린생활시설', totalArea: 999.99, buildingArea: 300.5, floorsAbove: 5, floorsBelow: 2,
    height: 21.5, households: 12, buildingCount: 2, permitDateISO: '2009-04-25',
  },
  report9: {
    ckOp: true, ckInitial: false, ckCompEtc: false, consent: true, repRole: '관리자',
    managerGrade: '2급', mgrEduDate: '2024년 5월 2일', rampCount: '2',
    main: { name: '김주된', grade: '소방시설관리사', licenseNo: '제2026-1호' }, assistants: [],
    mgrAppointType: '소방기술자격',
    hasFirePlan: true, firePlanStored: true,
    prevOpDone: true, prevCompDone: false, eduDone: true, drillDone: true,
    insuranceJoined: true, insCompany: '현대해상', insPeriod: '2026년 4월 1일 ~ 2027년 3월 31일',
    insPerson: '5000', insProperty: '50000',
    multiUseNone: true, multiUseCounts: {},
    stCon: true, stSteel: false, stBrick: false, stWood: false, stEtc: false,
    rfSlab: true, rfTile: false, rfSlate: false, rfEtc: false,
    stairsCount: '3', elvR: '2', elvE: '', elvV: '',
    pkIn: false, pkMech: false, pkRoof: false, pkOut: true,
  },
})
const template = new Uint8Array(readFileSync(TPL))
const result = await injectWorkbook(template, toInjectTargets(values).targets, { forbidden: SCRUB_NEEDLES })
check('주입 대상 미발견 0', result.missed.length === 0, result.missed.slice(0, 5).join(', '))

console.log(`[0] LibreOffice 왕복(${TPL})`)
const rt = roundTrip(result.bytes, 'injected.xlsx')
check('주입본 → soffice → xlsx 왕복 성공', rt !== null, rt ?? '변환 실패')
if (!rt) { console.log('\n결과: 왕복 실패 — 이후 축 판정 불가'); process.exit(1) }

const rtBytes = new Uint8Array(readFileSync(rt))
const wb = XLSX.read(rtBytes, { cellFormula: true })
const cell = (sheet: string, ref: string) =>
  String((wb.Sheets[sheet]?.[ref] as XLSX.CellObject | undefined)?.v ?? '').trim()

// ── [1] 설치 설비의 점검결과가 ○로 자동 채워지지 않는가 ────────────────
console.log('[1] 설치 설비 — 점검결과 자동 ○ 없음(사람이 채우는 칸)')
{
  const on = FORM4_ROWS.filter(r => r.verdictCell && isForm4Installed(r, INSTALLED, EVAC))
  const bad = on.filter(r => cell('현황', r.verdictCell!) !== '')
  check(`설치 ${on.length}행의 점검결과 칸 전부 공란`, bad.length === 0,
    bad.map(r => `${r.verdictCell}(${r.label})='${cell('현황', r.verdictCell!)}'`).join(', '))
  // 설치 체크는 반대로 반드시 √ (공란으로 달성되면 안 된다 — 반대 방향 단언)
  const noCheck = on.filter(r => !cell('현황', r.cell).includes('√'))
  check(`설치 ${on.length}행의 설치 체크칸이 [√]`, noCheck.length === 0,
    noCheck.map(r => `${r.cell}(${r.label})='${cell('현황', r.cell)}'`).join(', '))
}

// ── [2] 미설치 설비 ─────────────────────────────────────────────────
console.log('[2] 미설치 설비 — 체크 없음 + 점검결과 ／(해당없음)')
{
  const off = FORM4_ROWS.filter(r => r.verdictCell && !isForm4Installed(r, INSTALLED, EVAC))
  const checked = off.filter(r => cell('현황', r.cell).includes('√'))
  check(`미설치 ${off.length}행의 설치 체크칸이 빈 마크`, checked.length === 0,
    checked.map(r => `${r.cell}(${r.label})`).join(', '))
  const notNa = off.filter(r => !['/', '／'].includes(cell('현황', r.verdictCell!)))
  check(`미설치 ${off.length}행의 점검결과가 해당없음`, notNa.length === 0,
    notNa.slice(0, 8).map(r => `${r.verdictCell}(${r.label})='${cell('현황', r.verdictCell!)}'`).join(', '))
}

// ── [3] 미배선 칸은 **비어 있다** — 모르는 것을 지어내지 않았다는 단언 ──
console.log('[3] 미배선 칸 — ／도 ○도 찍지 않는다(값 지어내기 금지)')
{
  const dirty = FORM4_UNWIRED.filter(u => cell('현황', u.verdictCell) !== '')
  check(`미배선 ${FORM4_UNWIRED.length}칸 점검결과 전부 공란`, dirty.length === 0,
    dirty.slice(0, 8).map(u => `${u.verdictCell}(${u.label})='${cell('현황', u.verdictCell)}'`).join(', '))
}

// ── [3b] 복제칸(대상물·대상물2) — 빈 셀 참조가 0이 되던 축 ─────────────
// 별지 4호 점검결과 64칸은 전부 `대상물`·`대상물2`에 `=현황!S7` 같은 복제칸을 하나씩 갖는다
// (실측 _probe-form4-mirrors). 원본을 **통째로** 비우면 복제칸이 재계산으로 `0`이 된다 —
// 계획서!H12와 같은 함정이라, 여기서 '복제칸 = 원본'을 직접 단언한다.
// ⚠ 복제 관계는 손으로 적지 않고 **템플릿의 참조 그래프에서 실측**한다(손목록은 다음 칸을 못 본다)
console.log('[3b] 복제칸이 원본과 같다(빈 셀 참조 → 0 없음)')
{
  const tz = await JSZip.loadAsync(template)
  const { sheetFileMap, buildRefGraph, transitiveClosure } = await import('../src/lib/xlsx-inject.ts')
  const edges = await buildRefGraph(tz, await sheetFileMap(tz))
  const allVerdicts = [
    ...FORM4_ROWS.map(r => r.verdictCell).filter(Boolean) as string[],
    ...FORM4_UNWIRED.map(u => u.verdictCell),
  ]
  const mismatched: string[] = []
  let n = 0
  for (const vc of allVerdicts) {
    const src = cell('현황', vc)
    for (const d of transitiveClosure(edges, '현황', vc)) {
      n++
      const got = cell(d.sheet, d.cell)
      if (got !== src) mismatched.push(`${d.sheet}!${d.cell}='${got}' ≠ 현황!${vc}='${src}'`)
    }
  }
  check(`점검결과 복제 ${n}칸이 원본과 일치`, mismatched.length === 0, mismatched.slice(0, 8).join(', '))
}

// ── [4] 계획서 H열 회귀 — 빈 셀 참조가 "0"으로 인쇄되던 것 ─────────────
console.log('[4] 계획서 H12~H24 — 빈 셀 참조 "0" 인쇄 없음')
{
  const cells = ['H12', 'H14', 'H16', 'H18', 'H20', 'H22', 'H24']
  const zeros = cells.filter(c => cell('계획서', c) === '0')
  check(`${cells.length}칸 중 "0" 인쇄 0건`, zeros.length === 0,
    zeros.map(c => `계획서!${c}='${cell('계획서', c)}'`).join(', '))
}

// ── [5] 셀 메모(내부 업무 지시) — 배포본에 실리면 LO가 렌더한다 ─────────
console.log('[5] 셀 메모 파트 0')
{
  const z = await JSZip.loadAsync(result.bytes)
  const parts = Object.keys(z.files).filter(n => /xl\/(threadedComments\/)?comments\d*\.xml$/.test(n))
  const vml = Object.keys(z.files).filter(n => /vmlDrawing/.test(n))
  check('주입 산출물에 comments 파트 0', parts.length === 0, parts.join(', '))
  check('주입 산출물에 vmlDrawing 파트 0', vml.length === 0, vml.join(', '))
}

// ── [6] 왕복본에 판정 마크를 되살릴 수식이 남아 있지 않은가 ─────────────
console.log('[6] 판정 수식 잔존 0 — 재계산으로 되살아날 씨앗 자체가 없다')
{
  const z = await JSZip.loadAsync(result.bytes)
  const { sheetFileMap } = await import('../src/lib/xlsx-inject.ts')
  const files = await sheetFileMap(z)
  const alive: string[] = []
  for (const [sheet, path] of files) {
    const xml = await z.file(path)!.async('string')
    // ⚠ 자기닫힘 <c …/>을 함께 받지 않으면 수식이 앞 빈 셀 좌표로 귀속된다(xlsx-inject.ts:86)
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2] ?? '')?.[1]
      if (f && /&quot;[○×X\/／]&quot;|"[○×X\/／]"/.test(f)) alive.push(`${sheet}!${m[1]}`)
    }
  }
  check('판정 마크를 산출하는 수식 0칸', alive.length === 0, alive.slice(0, 8).join(', '))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패   (왕복본: ${rt})`)
process.exit(fail ? 1 : 0)
