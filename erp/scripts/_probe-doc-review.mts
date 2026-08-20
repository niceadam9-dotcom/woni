/** 문서 5종(별지 4·9·10·11호 + 소방계획서) 인쇄 레이아웃 일괄 검토 프로브. 읽기 전용(DB 기록 없음).
 *
 *  실제 렌더 HTML을 Chromium(=Gotenberg와 같은 엔진)에 print 미디어로 올려 쪽 단위로 실측한다.
 *   P-1 쪽 넘침 — .page 내용이 A4 인쇄영역(297-15-15=267mm)을 넘으면 실제 인쇄가 2장으로 쪼개진다
 *   P-2 가로 넘침 — 인쇄영역(210-13-13=184mm) 밖으로 표·글이 삐져나감
 *   P-3 셀 넘침 — nowrap 등으로 글자가 칸 밖으로 나감
 *   P-4 좌·우 병렬 표(table.split) 바닥 불일치 — 가운데 괘선이 한쪽만 짧게 끊김
 *   P-5 빈 쪽 — 글자가 없는 유령 쪽
 *  각 쪽 스크린샷을 scripts/_out/review/ 에 저장한다(육안 검토용).
 *
 *  데이터는 두 벌: 'blank'(전 칸 공란 — 법정 빈 서식 충실도) / 'full'(긴 값·많은 행 — 넘침 스트레스).
 *  소방계획서는 스테이징 DB 실고객으로 조립(--conditions=react-server 필요).
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-doc-review.mts [문서명필터] */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

// .env.local(스테이징) 로드 — 소방계획서 조립에만 사용
for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}

async function load<T>(p: string): Promise<T> {
  const m = await import(p) as Record<string, unknown>
  return (m.default ?? m) as T
}
const r4 = await load<typeof import('../src/lib/doc-templates/report4.ts')>('../src/lib/doc-templates/report4.ts')
const r9 = await load<typeof import('../src/lib/doc-templates/report9.ts')>('../src/lib/doc-templates/report9.ts')
const r1011 = await load<typeof import('../src/lib/doc-templates/report1011.ts')>('../src/lib/doc-templates/report1011.ts')
const cov = await load<typeof import('../src/lib/doc-templates/cover.ts')>('../src/lib/doc-templates/cover.ts')
const off = await load<typeof import('../src/lib/doc-templates/official.ts')>('../src/lib/doc-templates/official.ts')
const dlg = await load<typeof import('../src/lib/doc-templates/delegation.ts')>('../src/lib/doc-templates/delegation.ts')
const ext = await load<typeof import('../src/lib/doc-templates/exterior.ts')>('../src/lib/doc-templates/exterior.ts')

const filter = process.argv[2] ?? ''
const outDir = path.join(import.meta.dirname, '_out', 'review')
mkdirSync(outDir, { recursive: true })

// ── 데이터 두 벌 ────────────────────────────────────────────────────────────
const LONG_NAME = '주식회사 대한종합건설 서울사업본부 제2공장 부속창고동'
const LONG_ADDR = '서울특별시 영등포구 여의대로 108, 파크원타워1 지하3층 기계실 옆 소방펌프실 (여의도동)'
const PERSON = { name: '홍길동', grade: '소방시설관리사', licenseNo: '제2019-0001호', period: '2026.8.1~8.2' }

const facilityAll = r9.FORM3_ITEMS
const marks = (items: string[], m: 'O' | 'X' | 'N') => Object.fromEntries(items.map(i => [i, m]))

const blank9 = {
  ckOp: false, ckInitial: false, ckCompEtc: false,
  customerName: '', purpose: '', address: '', inspPeriod: '', inspDays: '',
  companyName: '', companyPhone: '', consent: null, reportEmail: '',
  main: null, assistants: [], reportDate: '', submitTo: '',
  repRole: '', ownerName: '', ownerPhone: '', managerGrade: '', mgrName: '', mgrPhone: '', mgrEduDate: '',
  hasFirePlan: false, prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false,
  insuranceJoined: null, insCompany: '', insPeriod: '', insPerson: '', insProperty: '',
  multiUseNone: false, multiUseCounts: {},
  permitDate: '', useApprovalDate: '', totalArea: '', buildingArea: '', households: '',
  floorsAbove: '', floorsBelow: '', heightM: '', buildingCount: '',
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  elvR: '', elvE: '', elvV: '', pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
  rampCount: '', stairsCount: '',
  facilityChecks: [], resultMarks: {}, muResults: {}, defectRows: [],
}
const full9 = {
  ...blank9,
  ckOp: true, ckInitial: true,
  customerName: LONG_NAME, purpose: '복합건축물(판매시설ㆍ업무시설ㆍ근린생활시설)', address: LONG_ADDR,
  inspPeriod: '2026년 8월 1일 ~ 2026년 8월 2일', inspDays: '2',
  companyName: '승진소방엔지니어링 주식회사', companyPhone: '02-1234-5678',
  consent: true, reportEmail: 'manager@daehan-construction-group.co.kr',
  main: PERSON, assistants: Array.from({ length: 8 }, (_, i) => ({ ...PERSON, name: `보조인력${i + 1}` })),
  reportDate: '2026년 8월 20일', submitTo: '관계인ㆍ영등포소방서장',
  repRole: '관리자', ownerName: '김소유', ownerPhone: '010-1234-5678',
  managerGrade: '1급', mgrName: '박관리', mgrPhone: '010-8765-4321', mgrEduDate: '2026-03-15',
  hasFirePlan: true, prevOpDone: true, prevCompDone: true, eduDone: true, drillDone: true,
  insuranceJoined: true, insCompany: '한국화재보험협회', insPeriod: '2026.1.1~2026.12.31',
  insPerson: '1인당 1억5천만원', insProperty: '10억원',
  multiUseNone: false, multiUseCounts: { 휴게음식점영업: '3', 일반음식점영업: '12', 노래연습장업: '2' },
  permitDate: '2015-03-02', useApprovalDate: '2017-11-30', totalArea: '48,250.75',
  buildingArea: '3,120.40', households: '0', floorsAbove: '23', floorsBelow: '5',
  heightM: '98.4', buildingCount: '2',
  stCon: true, stSteel: true, rfSlab: true,
  elvR: '6', elvE: '2', elvV: '1', pkIn: true, pkMech: true, pkRoof: true, pkOut: true,
  pkInUg: true, pkInGround: true, pkInPiloti: true, mgrAppointType: '선임',
  rampCount: '2', stairsCount: '6', specialStairCount: '4',
  facilityChecks: facilityAll,
  resultMarks: { ...marks(facilityAll, 'O'), 옥내소화전설비: 'X', 유도등: 'X', 연결송수관설비: 'N' },
  muResults: Object.fromEntries(Array.from({ length: 16 }, (_, i) =>
    [`MU-${String(i + 1).padStart(3, '0')}`, i % 3 === 0 ? 'X' : i % 3 === 1 ? 'O' : 'N'])),
  etcMarks: { door: 'X', exit: 'O', flame: 'N' },
  ledgerCodes: facilityAll,
  defectRows: Array.from({ length: 14 }, (_, i) => ({
    group: ['소화설비', '경보설비', '피난구조설비', '소화활동설비', '기타'][i % 5],
    code: `${i + 1}-A-00${(i % 9) + 1}`,
    content: '가압송수장치의 펌프 토출측 압력계 및 흡입측 연성계(진공계) 설치 상태 불량 — 압력계 지시침 고착으로 교체 필요',
  })),
  note: '점검 당시 지하 3층 기계실 일부 구역은 공사 중으로 접근이 제한되어 육안 점검만 실시하였음',
}

const sheetSections = Array.from({ length: 3 }, (_, s) => ({
  no: s + 1, name: ['소화기구 및 자동소화장치', '옥내소화전설비', '자동화재탐지설비'][s],
  items: Array.from({ length: 18 }, (_, i) => ({
    code: `${s + 1}-A-${String(i + 1).padStart(3, '0')}`,
    name: '수신기 설치장소 상태 및 종합방재반 연동 여부, 예비전원(축전지) 시험 스위치 정상 동작 여부 확인',
    mark: (['O', 'X', 'N', null] as const)[i % 4],
    comprehensive: i % 5 === 0,
    group: i < 9 ? `${s + 1}-A. 첫 번째 중분류(법정 표기 그대로)` : `${s + 1}-B. 두 번째 중분류`,
    subgroup: i % 9 < 4 ? '주거용 주방 자동소화장치' : null,
  })),
}))

const blank4 = {
  ckOp: false, ckInitial: false, ckCompEtc: false,
  customerName: '', purpose: '', address: '', facilityChecks: [], resultMarks: {},
  muResults: {}, main: null, assistants: [], inspStart: '', inspEnd: '', inspDays: '',
  companyName: '', specs: {},
}
const full4 = {
  ...blank4, ckOp: true,
  customerName: LONG_NAME, purpose: '복합건축물', address: LONG_ADDR,
  facilityChecks: facilityAll, resultMarks: full9.resultMarks, etcMarks: full9.etcMarks,
  muResults: full9.muResults, main: PERSON,
  assistants: Array.from({ length: 8 }, (_, i) => ({ ...PERSON, name: `보조인력${i + 1}` })),
  inspStart: '2026년 8월 1일', inspEnd: '2026년 8월 2일', inspDays: '2',
  companyName: '승진소방엔지니어링 주식회사', companyRegNo: '서울-2019-0001',
  sheetSections, ledgerCodes: facilityAll,
  pumpRows: [{
    sheetNo: 2, pumpKind: '주' as const,
    shutoffFlow: 0, shutoffPress: 0.98, ratedFlow: 130, ratedPress: 0.85,
    overFlow: 195, overPress: 0.62, setStartPress: 0.6, setStopPress: 0.9,
    judges: ['O', 'O', 'X'] as Array<'O' | 'X' | null>, note: '체절압력 적정범위 초과',
  }],
}

const blank1011 = {
  customerName: '', purpose: '', address: '', ownerName: '', ownerPhone: '',
  mgrName: '', mgrPhone: '', rows: [], reportDate: '', submitTo: '',
}
const full1011 = {
  customerName: LONG_NAME, purpose: '복합건축물(판매시설ㆍ업무시설)', address: LONG_ADDR,
  ownerName: '김소유', ownerPhone: '010-1234-5678', mgrName: '박관리', mgrPhone: '010-8765-4321',
  rows: [
    { content: '2026년 작동점검 결과 불량 14건에 대한 일괄 정비 계획', period: '', isSummary: true },
    ...Array.from({ length: 7 }, (_, i) => ({
      content: `${i + 1}. 가압송수장치 압력계 교체 및 옥내소화전 방수압력 미달 구간(지하 3층~지하 1층) 배관 정비`,
      period: '2026. 9. 1. ~ 2026. 10. 15.',
    })),
  ],
  reportDate: '2026년 8월 20일', submitTo: '영등포소방서장',
  totalPeriod: '2026년 9월 1일 ~ 2026년 10월 15일', totalDays: '45',
  companyName: '승진소방엔지니어링 주식회사', companyBizno: '123-45-67890',
  companyRep: '이대표', companyPhone: '02-1234-5678',
  companyAddress: '서울특별시 금천구 가산디지털1로 168 우림라이온스밸리 A동 1204호',
  note: '이행조치 전ㆍ후 사진 및 공사 계약서를 첨부하여 제출함',
}

// base.ts CSS(word-break 등)는 별지 4·9·10·11호뿐 아니라 아래 4종도 함께 쓴다 — 같이 검사한다
const COMPANY = {
  name: '승진소방엔지니어링 주식회사', address: '서울특별시 금천구 가산디지털1로 168 우림라이온스밸리 A동 1204호',
  phone: '02-1234-5678', fax: '02-1234-5679', logoSrc: null,
}
const other = {
  cover: {
    year: 2026, typeLabel: '작동점검', buildingName: LONG_NAME, photoSrc: null,
    issueLabel: '2026년 8월', company: COMPANY,
  },
  official: {
    company: COMPANY, docNo: '승 진 2608-977', sendDate: '2026년 8월', recipient: LONG_NAME,
    reference: '소방안전관리자 및 관계인', sender: '㈜승진소방 ENG', year: 2026, typeLabel: '작동점검',
  },
  delegation: {
    typeLabel: '작동점검',
    owner: { name: '김소유', position: '대표이사', phone: '010-1234-5678', birth: '1970-01-01' },
    agent: { name: '이대표', position: '소방시설관리사', phone: '02-1234-5678', birth: '1980-05-05' },
    periodLabel: '2026.8.1 부터 ~ 2026.8.2 까지', daysLabel: '2일',
    submitDate: '2026년 8월 20일', station: '영등포',
  },
  exterior: {
    customerName: LONG_NAME, purpose: '복합건축물', address: LONG_ADDR,
    mgrTitle: '', mgrName: '박관리', mgrPhone: '010-8765-4321', year: '2026', months: [],
  },
}

type Doc = { name: string; html: string }
const docs: Doc[] = [
  { name: '별지4호-빈서식', html: r4.renderReport4(blank4 as never) },
  { name: '별지4호-가득', html: r4.renderReport4(full4 as never) },
  { name: '별지9호-빈서식', html: r9.renderReport9(blank9 as never) },
  { name: '별지9호-가득', html: r9.renderReport9(full9 as never) },
  { name: '별지10호-빈서식', html: r1011.renderReport10(blank1011 as never) },
  { name: '별지10호-가득', html: r1011.renderReport10(full1011 as never) },
  { name: '별지11호-빈서식', html: r1011.renderReport11(blank1011 as never) },
  { name: '별지11호-가득', html: r1011.renderReport11(full1011 as never) },
  { name: '표지', html: cov.renderCover(other.cover as never) },
  { name: '공문', html: off.renderOfficial(other.official as never) },
  { name: '위임장', html: dlg.renderDelegation(other.delegation as never) },
  { name: '외관점검표', html: ext.renderExterior(other.exterior as never) },
]

// ── 소방계획서 — 스테이징 실고객 조립 ────────────────────────────────────────
if (!filter || '소방계획서'.includes(filter)) {
  try {
    const adminMod = await load<typeof import('../src/lib/supabase/admin.ts')>('../src/lib/supabase/admin.ts')
    const genMod = await load<typeof import('../src/lib/fire-plan-generate.ts')>('../src/lib/fire-plan-generate.ts')
    const tplMod = await load<typeof import('../src/lib/fire-plan-template.ts')>('../src/lib/fire-plan-template.ts')
    const admin = adminMod.createAdminClient()
    const { data: forms } = await admin.from('fire_plan_forms')
      .select('customer_id, sections, updated_at').order('updated_at', { ascending: false }).limit(10)
    let target: string | null = null
    for (const f of (forms ?? []) as Array<{ customer_id: string; sections: Record<string, unknown> }>) {
      if (Object.keys(f.sections ?? {}).length >= 3) { target = f.customer_id; break }
    }
    target ??= ((forms ?? [])[0] as { customer_id: string } | undefined)?.customer_id ?? null
    if (target) {
      const asm = await genMod.assembleFirePlan(admin, target, 2026, '상가형') as {
        data: unknown; images: unknown[]; presetPairs?: unknown[]; missing: string[]
      }
      let html = tplMod.buildFirePlanHtml(asm.data as never, asm.images as never)
      if (asm.presetPairs) html = tplMod.applyPresetPairs(html, asm.presetPairs as never)
      docs.push({ name: '소방계획서-실데이터', html })
      console.log(`소방계획서 조립 — 고객 ${target}, 누락 ${asm.missing.length}건, ${(html.length / 1024).toFixed(0)}KB\n`)
    } else console.log('⚠ 소방계획서: 서식 입력 고객 없음 — 건너뜀\n')
  } catch (e) {
    console.log(`⚠ 소방계획서 조립 실패(DB 접근?) — 건너뜀: ${(e as Error).message}\n`)
  }
}

// ── 실측 ────────────────────────────────────────────────────────────────────
const MM = 3.779528
const PAGE_H = 267 * MM   // A4 297 - 상하 여백 15+15
const PAGE_W = 184 * MM   // A4 210 - 좌우 여백 13+13

// tsx(esbuild) keepNames가 __name을 주입해 함수 전달이 깨진다 → 문자열로 평가
const MEASURE = `(() => {
  const pages = Array.from(document.querySelectorAll('div.page'))
  return pages.map((p, idx) => {
    const r = p.getBoundingClientRect()
    // 가로 넘침 — 자식 중 컨테이너 오른쪽 밖으로 나간 것
    let maxRight = 0
    for (const el of p.querySelectorAll('*')) {
      const b = el.getBoundingClientRect()
      if (b.width > 0 && b.right > maxRight) maxRight = b.right
    }
    // 셀 넘침 — 글자가 칸보다 넓은 칸
    const overflowCells = []
    for (const c of p.querySelectorAll('th,td')) {
      if (c.scrollWidth > c.clientWidth + 1) {
        overflowCells.push((c.textContent || '').trim().slice(0, 30) + ' [' + c.scrollWidth + '>' + c.clientWidth + ']')
      }
    }
    // 좌·우 병렬 표 바닥
    const splits = Array.from(p.querySelectorAll('table.split')).map(s => {
      const t = Array.from(s.querySelectorAll(':scope > tbody > tr > td > table'))
      return t.length === 2 ? Math.abs(t[0].getBoundingClientRect().bottom - t[1].getBoundingClientRect().bottom) : -1
    })
    // 하이픈 없는 전화번호 — 0으로 시작하는 10~11자리 연속 숫자(사업자번호는 1·2로 시작해 안 걸린다)
    const bare = ((p.textContent || '').match(/(?<!\\d)0\\d{9,10}(?!\\d)/g) || [])
    // 한글 음절 끊김 방지 — 글자가 든 칸은 전부 keep-all이어야 한다.
    // break-all뿐 아니라 **normal도 한글은 음절 사이에서 끊는다**(CJK 기본 줄바꿈) — 둘 다 잡는다.
    // (표본 1개만 보면 글자 없는 바깥 컨테이너 칸을 집어 오탐한다)
    const badBreak = []
    for (const c of p.querySelectorAll('th,td')) {
      const t = (c.textContent || '').trim()
      if (!t || !/[가-힣]/.test(t)) continue
      const wb = getComputedStyle(c).wordBreak
      if (wb !== 'keep-all') badBreak.push(t.slice(0, 18) + ' [' + wb + ']')
    }
    return {
      idx, h: r.height, overRight: maxRight - r.left,
      text: (p.textContent || '').replace(/\\s/g, '').length,
      label: ((p.textContent || '').match(/제?\\s*\\d+\\s*쪽/) || [''])[0],
      overflowCells: overflowCells.slice(0, 5), overflowCellCount: overflowCells.length,
      splits, barePhones: bare.slice(0, 5),
      badBreak: badBreak.slice(0, 3), badBreakCount: badBreak.length,
    }
  })
})()`

type P = {
  idx: number; h: number; overRight: number; text: number; label: string
  overflowCells: string[]; overflowCellCount: number; splits: number[]
  barePhones: string[]; badBreak: string[]; badBreakCount: number
}

let pass = 0, fail = 0
const issues: string[] = []
const check = (name: string, cond: boolean, detail = '', verbose = false) => {
  if (cond) { pass++; if (verbose) console.log(`  ✅ ${name}`) }
  else { fail++; issues.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// P-6 탐지기 자체 검증 — 통과가 '검사가 무력해서'인지 '정말 깨끗해서'인지 구분한다.
// (수정 전 소방계획서 2쪽은 실제로 '01032162321'을 인쇄했고 이 검사에 걸린다)
{
  const re = /(?<!\d)0\d{9,10}(?!\d)/g
  const hit = (s: string) => (s.match(re) ?? []).length
  console.log('=== P-6 탐지기 자체 검증')
  check('P-6d 하이픈 없는 휴대폰을 잡는다', hit('연락처 01032162321 입니다') === 1, '', true)
  check('P-6d 하이픈 없는 지역번호를 잡는다', hit('0317980019') === 1, '', true)
  check('P-6d 포맷된 번호는 안 잡는다', hit('010-3216-2321 / 031-772-3019 / 1588-7500') === 0, '', true)
  check('P-6d 사업자번호·연도·면적은 안 잡는다', hit('1234567890 2026 48,250.75 586-86-00740') === 0, '', true)
  console.log('')
}

const browser = await chromium.launch()
// 뷰포트 = 인쇄 내용영역 폭(184mm) — 브라우저 창 폭으로 재면 @page 여백이 반영되지 않아 전부 오탐
const page = await browser.newPage({ viewport: { width: Math.round(PAGE_W), height: Math.round(PAGE_H) } })
await page.emulateMedia({ media: 'print' })

for (const d of docs) {
  if (filter && !d.name.includes(filter)) continue
  await page.setContent(d.html, { waitUntil: 'load' })
  // 돌연변이 주입 — BREAKALL=1이면 수정 전 상태(break-all)로 되돌려 P-7이 정말 잡는지 확인한다.
  // (검사가 무력해서 통과하는 것과 정말 깨끗해서 통과하는 것을 가르는 유일한 방법)
  if (process.env.BREAKALL) {
    await page.addStyleTag({ content: 'th,td{word-break:break-all !important}' })
  }
  const pages = await page.evaluate(MEASURE) as P[]
  // 진짜 인쇄 결과 — Gotenberg와 동일한 Chromium print-to-PDF. 쪽 수가 늘면 그게 곧 쪽 넘침이다.
  const pdfPath = path.join(outDir, `${d.name}.pdf`)
  const pdf = await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true })
  const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
  console.log(`=== ${d.name} — 정의 ${pages.length}쪽 / 실제 인쇄 ${pdfPages}쪽`)
  check(`P-0 ${d.name} 인쇄 쪽수 = 정의 쪽수`, pdfPages === pages.length,
    `정의 ${pages.length}쪽인데 ${pdfPages}장으로 인쇄됨(넘침으로 쪼개짐)`)
  for (const p of pages) {
    const tag = `${d.name} ${p.idx + 1}쪽${p.label ? `(${p.label})` : ''}`
    check(`P-1 ${tag} 쪽 넘침`, p.h <= PAGE_H + 1, `내용 ${(p.h / MM).toFixed(1)}mm > 인쇄영역 267mm`)
    check(`P-2 ${tag} 가로 넘침`, p.overRight <= PAGE_W + 1, `${(p.overRight / MM).toFixed(1)}mm > 184mm`)
    check(`P-3 ${tag} 셀 넘침`, p.overflowCellCount === 0, `${p.overflowCellCount}칸: ${p.overflowCells.join(' / ')}`)
    check(`P-4 ${tag} 좌·우 표 바닥`, p.splits.every(s => s < 1), `차 ${p.splits.map(s => s.toFixed(1)).join(',')}px`)
    check(`P-5 ${tag} 빈 쪽`, p.text > 20, `글자 ${p.text}자`)
    check(`P-6 ${tag} 하이픈 없는 전화번호`, p.barePhones.length === 0, p.barePhones.join(', '))
    check(`P-7 ${tag} 한글 음절 끊김(break-all) 칸`, p.badBreakCount === 0,
      `${p.badBreakCount}칸: ${p.badBreak.join(' / ')}`)
  }
  const dir = path.join(outDir, d.name)
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < pages.length; i++) {
    await page.locator('div.page').nth(i).screenshot({ path: path.join(dir, `${String(i + 1).padStart(2, '0')}.png`) })
  }
  console.log(`  스크린샷 → ${dir} · PDF → ${pdfPath}`)
}
await browser.close()

writeFileSync(path.join(outDir, 'issues.txt'), issues.join('\n'), 'utf8')
console.log(`\n=== 결과 — ${pass}/${pass + fail} (지적 ${issues.length}건)`)
