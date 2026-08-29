/** 판정자 D — S7-6: **산출물**(런타임 주입 후 바이트)을 만든다.
 *
 *  템플릿이 깨끗한 것과 배포되는 파일이 깨끗한 것은 다른 명제다. 라우트의 순수 구간
 *  (시트 선별 → 앵커 검증 → 값 조립 → 목차 2장 재작성 → injectWorkbook)을 그대로 재현해
 *  산출물 바이트를 파일로 떨어뜨린다. 그 파일을 _judge27g-d-marks.mts로 다시 스캔한다.
 *
 *  DB는 건드리지 않는다 — 값은 '새 고객'을 가정한 픽스처(표본과 겹치지 않는 이름·주소).
 *  실행: npx tsx scripts/_judge27g-d-runtime.mts <설비프로필: min|multi>
 *  산출: F:/AI/ERP/_j27d-out-<프로필>.xlsx */
import { readFileSync, writeFileSync } from 'node:fs'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import { injectWorkbook, type InjectTarget } from '../src/lib/xlsx-inject.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { donorGroupsToKeep, allDonorSheets, DONOR_TOC_SHEET, BASE_TOC_SHEET, DONOR_TOC_BODY_CELLS } from '../src/lib/xlsx-donors.ts'
import { removeSheets } from '../src/lib/xlsx-sheet-surgery.ts'
import { sheetMatchesFacilities } from '../src/lib/sheet-facility-map.ts'
import { SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'

const PROFILE = process.argv[2] ?? 'min'
// '소화기 하나만 설치한 고객' — S7-6 ⑤가 지목한 바로 그 시나리오
const installedCodes = PROFILE === 'none' ? []
  : PROFILE === 'min'
    ? ['소화기구 및 자동소화장치']
    : ['소화기구 및 자동소화장치', '옥내소화전설비', '자동화재탐지설비', '유도등']

let template = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
const keptGroups = donorGroupsToKeep(k => sheetMatchesFacilities(k, installedCodes), false)
const keptSheets = new Set(keptGroups.flatMap(g => g.sheets))
template = (await removeSheets(template,
  allDonorSheets().filter(s => s !== DONOR_TOC_SHEET && !keptSheets.has(s)))).bytes

const check = validateAnchors(template)
if (!check.ok) { console.error('앵커 검증 실패:', check.failures.join(' · ')); process.exit(1) }

// 새 고객 픽스처 — 표본(정내과의원)과 한 글자도 겹치지 않는다
const values = buildWorkbookValues({
  official: {
    company: { name: '승진소방', address: '경기도 수원시', phone: '031-000-0000', fax: '031-000-0001' },
    docNo: '승 진 2608-9', sendDate: '2026년 8월 30일', recipient: '수원소방서장', reference: '예방과',
    sender: '승진소방', senderSign: { name: '승진소방', title: '대표', rep: '홍길동' },
    year: 2026, typeLabel: '작동점검',
  },
  delegation: {
    typeLabel: '작동점검',
    owner: { name: '박판정', position: '관리소장', phone: '010-1111-2222', birth: '800101' },
    agent: { name: '이대리', position: '과장', phone: '010-3333-4444', birth: '850505' },
    periodLabel: '2026.8.1~2026.8.2', daysLabel: '2일', submitDate: '2026년 8월 30일', station: '수원소방서',
  },
  customerAddress: '경기도 수원시 팔달구 판정로 1',
  startISO: '2026-08-01', endISO: '2026-08-02', useApprovalISO: '2015-03-02',
  installedCodes, evacTypes: [],
  building: {
    purpose: '근린생활시설', totalArea: 1234.5, buildingArea: 400, floorsAbove: 5, floorsBelow: 1,
    height: 20, households: 0, buildingCount: 1, permitDateISO: '2013-01-01',
  },
  report9: {
    ckOp: true, ckInitial: false, ckCompEtc: false, consent: true, repRole: '관리자',
    managerGrade: '2급', mgrEduDate: '2026년 3월 3일', rampCount: '2',
    main: { name: '판정주된', grade: '소방시설관리사', licenseNo: '제2026-1호', period: '' },
    assistants: [{ name: '판정보조', grade: '초급', licenseNo: '2026-01-00001E', period: '2026.8.1~8.2' }],
    hasFirePlan: true, prevOpDone: true, prevCompDone: false, eduDone: true, drillDone: true,
    insuranceJoined: true, insCompany: '판정화재', insPeriod: '2026년 1월 1일 ~ 2026년 12월 31일',
    insPerson: '100', insProperty: '200',
    multiUseNone: true, multiUseCounts: {},
    stCon: true, stSteel: false, stBrick: false, stWood: false, stEtc: false,
    rfSlab: true, rfTile: false, rfSlate: false, rfEtc: false,
    stairsCount: '2', elvR: '1', elvE: '', elvV: '',
    pkIn: true, pkMech: false, pkRoof: false, pkOut: false,
    resultMarks: {},
  } as Parameters<typeof buildWorkbookValues>[0]['report9'],
})
const { targets, unmapped } = toInjectTargets(values, check.anchors)
if (unmapped.length) { console.error('값 맵 누락:', unmapped.map(a => a.field).join(', ')); process.exit(1) }

const tocTitles = keptGroups.map(g => g.tocLabel)
const tocTargets: InjectTarget[] = [DONOR_TOC_SHEET, BASE_TOC_SHEET].flatMap(sheet =>
  DONOR_TOC_BODY_CELLS.map((cell, i) => ({ sheet, cell, value: tocTitles[i] ?? null })))
targets.push(...tocTargets)

const result = await injectWorkbook(template, targets, { forbidden: SCRUB_NEEDLES })
if (result.missed.length) { console.error('미발견:', result.missed.join(', ')); process.exit(1) }
const out = `F:/AI/ERP/_j27d-out-${PROFILE}.xlsx`
writeFileSync(out, Buffer.from(result.bytes))
console.log(`프로필=${PROFILE} · 남은 도너 그룹 ${keptGroups.length} · 목차 항목 ${tocTitles.length}`)
console.log(`주입 ${targets.length}칸 · 폐포 ${result.propagated} · 안전망 소거 ${result.scrubbed.length}`)
console.log(`산출: ${out}`)
