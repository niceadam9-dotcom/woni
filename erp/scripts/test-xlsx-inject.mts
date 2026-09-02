/** 갑지 워크북 주입 검증 (소방계획서_27 S6-2·S6-3 — 무서버)
 *  실행: npx tsx scripts/test-xlsx-inject.mts
 *
 *  고정하는 것:
 *  ① 서식 무손상 — 주입 후 병합 총수 불변 · xl/styles.xml **바이트 동일** · 인쇄여백 동일 ·
 *     셀(<c>) 총수 불변. JSZip 패치의 존재 이유가 이 넷이다.
 *  ② 값 정확성 — 픽스처를 주입하고 SheetJS로 **읽어**(읽기는 안전) 기대값 대조.
 *  ③ 폐포 전파(D-9) — 허브만 넣어도 스포크(공문 수신·계약서 상호·완료보고서 상호)의
 *     캐시가 함께 바뀐다. LibreOffice가 fullCalcOnLoad를 무시하는 실측 위에 세운 규약이다.
 *  ④ 명시적 공란 — 값 없는 앵커(null)는 캐시를 지운다(잔재도 조용한 생략도 없다). */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { injectWorkbook, isoToSerial, sheetFileMap } from '../src/lib/xlsx-inject.ts'
import { SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets, DEFECT_ROWS_PER_GROUP, defectOverflow } from '../src/lib/xlsx-workbook.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const TPL = 'templates/report-workbook.xlsx'
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const template = new Uint8Array(readFileSync(TPL))

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

const report9 = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  consent: true, repRole: '관리자',
  managerGrade: '2급', mgrEduDate: '2024년 5월 2일',
  rampCount: '2',
  main: { name: '김주된', grade: '소방시설관리사', licenseNo: '제2026-1호' },
  assistants: [
    { name: '이보조', grade: '점검자경력수첩', licenseNo: '수첩-77', period: '2026.08.20 부터 ~ 2026.08.21 까지' },
  ],
  // 정보 시트 12칸(별지 9호 2쪽) — 표본과 **다른** 답을 골라 둔다: 표본 잔재가 살아 있으면
  // 아래 [2]의 정보 시트 단언이 붉어진다(2026-08-23 F세대 판정 §1-②)
  mgrAppointType: '소방기술자격',
  hasFirePlan: true, firePlanStored: false, firePlanUnstored: true,
  prevOpDone: false, prevOpNone: true, prevCompDone: true,
  eduDone: true, drillDone: false, drillNone: true,
  insuranceJoined: true, insCompany: '현대해상', insPeriod: '2026년 4월 1일 ~ 2027년 3월 31일',
  insPerson: '5000', insProperty: '50000',
  multiUseNone: false, multiUseCounts: { '일반음식점영업': '2', '비디오물감상실업': '1' },
  stCon: false, stSteel: true, stBrick: false, stWood: false, stEtc: false,
  rfSlab: true, rfTile: false, rfSlate: false, rfEtc: false,
  stairsCount: '3', specialStairCount: '1',
  elvR: '2', elvE: '', elvV: '',
  pkIn: true, pkInUg: true, pkInGround: false, pkInPiloti: false,
  pkMech: false, pkRoof: false, pkOut: false,
}
const values = buildWorkbookValues({
  official, delegation, customerAddress: '경기도 양평군 검증로 1',
  startISO: '2026-08-20', endISO: '2026-08-21',
  useApprovalISO: '2011-06-25',
  // 별지 4호 1쪽 설치 축 — 이 파일의 관심사는 '주입이 서식을 깨지 않는가'라 목록 내용은 임의다.
  // 다만 설치/미설치를 섞어 두 분기(√·[  ] / 공란·'/')가 모두 실제로 쓰이게 한다
  installedCodes: ['옥내소화전설비', '유도등'], evacTypes: ['완강기'],
  building: {
    purpose: '근린생활시설', totalArea: 999.99, buildingArea: 300.5, floorsAbove: 5, floorsBelow: 2,
    height: 21.5, households: 12, buildingCount: 2, permitDateISO: '2009-04-25',
  },
  report9,
})
const { targets, unmapped } = toInjectTargets(values)
check('앵커-값 매핑 누락 0', unmapped.length === 0, unmapped.map(a => a.field).join(', '))

const result = await injectWorkbook(template, targets)
check('주입 대상 미발견 0', result.missed.length === 0, result.missed.join(', '))
console.log(`  · 폐포 전파 ${result.propagated}칸`)

// ── ① 서식 무손상 ────────────────────────────────────────────────────
console.log('[1] 서식 무손상')
{
  const before = XLSX.read(template, { cellStyles: true })
  const after = XLSX.read(result.bytes, { cellStyles: true })
  const m = (wb: XLSX.WorkBook) => wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]['!merges'] ?? []).length), 0)
  check('병합 총수 불변', m(before) === m(after), `${m(before)} → ${m(after)}`)
  check('개요 인쇄여백 동일',
    JSON.stringify(before.Sheets['개요']['!margins']) === JSON.stringify(after.Sheets['개요']['!margins']))

  const zb = await JSZip.loadAsync(template)
  const za = await JSZip.loadAsync(result.bytes)
  check('styles.xml 바이트 동일',
    (await zb.file('xl/styles.xml')!.async('string')) === (await za.file('xl/styles.xml')!.async('string')))
  // 셀 총수 불변 — 주입은 교체지 추가·삭제가 아니다
  let cb = 0, ca = 0
  for (const f of Object.keys(zb.files).filter(f => f.startsWith('xl/worksheets/') && f.endsWith('.xml'))) {
    cb += ((await zb.file(f)!.async('string')).match(/<c r="/g) ?? []).length
    ca += ((await za.file(f)!.async('string')).match(/<c r="/g) ?? []).length
  }
  check('셀(<c>) 총수 불변', cb === ca, `${cb} → ${ca}`)
}

// ── ② 값 정확성 ─────────────────────────────────────────────────────
console.log('[2] 주입 값 정확성(SheetJS 읽기)')
const wb = XLSX.read(result.bytes, { cellFormula: true })
const cellV = (sheet: string, cell: string) => (wb.Sheets[sheet]?.[cell] as XLSX.CellObject | undefined)?.v
check('개요!B14 상호', cellV('개요', 'B14') === '검증대상빌딩', String(cellV('개요', 'B14')))
check('개요!B9 년도(숫자)', cellV('개요', 'B9') === 2026)
check('개요!B10 발신일자(시리얼 — 날짜 서식 보존)', cellV('개요', 'B10') === isoToSerial('2026-08-21'),
  String(cellV('개요', 'B10')))
check('개요!B11 문서번호(접두 제거 — 공문 B6와 안 겹침)', cellV('개요', 'B11') === '2608-7', String(cellV('개요', 'B11')))
check('개요!B17 관계인', cellV('개요', 'B17') === '박관계')
check('위임장!N6 대리인 성명(깨진 참조 → 값 대체)', cellV('위임장', 'N6') === '김점검', String(cellV('위임장', 'N6')))
check('위임장!N6 수식 제거됨', (wb.Sheets['위임장']['N6'] as XLSX.CellObject).f === undefined)
check('계약서!D29 대표자', cellV('계약서', 'D29') === '홍대표', String(cellV('계약서', 'D29')))
check('개요!F1 일수(닫는 괄호 포함 — 위임장 S10 여는 괄호와 짝)', cellV('개요', 'F1') === '2일   )', String(cellV('개요', 'F1')))
check('대상처!B7 표지 제목 점검종류 가변(S7-3 — 종전 종합점검 리터럴)',
  cellV('대상처', 'B7') === '소방시설 작동점검 결과보고서', String(cellV('대상처', 'B7')))
// S7-1·S7-2 — 보고서 1·2쪽 √ 통문자열 + 주된 점검인력 리터럴 교체
check('보고서!A2 점검 구분 — 작동 √', String(cellV('보고서', 'A2')).startsWith('[√] 작동점검, 종합점검(［  ］최초점검'),
  String(cellV('보고서', 'A2')).slice(0, 40))
check('보고서!C13 전자우편 동의 √', cellV('보고서', 'C13') === '[√] 동의함      [  ] 동의하지 않음',
  String(cellV('보고서', 'C13')))
check('정보!B5 대표자 구분 — 관리자 √', cellV('정보', 'B5') === '[  ]소유자, [√]관리자, [  ]점유자',
  String(cellV('정보', 'B5')))
// 정보 시트 12칸 — **주입 축**(test-xlsx-anchors [7]은 조립 문자열만 본다. 여기는 실제 바이트를
// 왕복해 읽으므로, XML 이스케이프·개행 손실 같은 주입 층 결함이 여기서 잡힌다:
// '열리는가'와 '텍스트가 사는가'는 다른 검사다 — 2026-08-23 판정의 이중 이스케이프 67칸 교훈)
{
  const t = (c: string) => String(cellV('정보', c) ?? '')
  check('정보!B8 선임구분 — 소방기술자격 √(표본 수첩 √ 소거)',
    t('B8').startsWith('[√]소방기술자격,') && !t('B8').includes('[√]소방안전관리자수첩'), t('B8'))
  check('정보!B10 소방계획서 — 작성 √ + 미보관 √', t('B10') === '[√]작성 ([  ]보관 [√]미보관),          [  ]미작성', t('B10'))
  check('정보!B11 전년도 — 작동 미실시 √ · 종합 실시 √',
    t('B11') === '작동기능점검 ([  ]실시 [√]미실시),     종합정밀점검 ([√]실시 [  ]미실시)', t('B11'))
  check('정보!B12 교육훈련 — 교육 실시 √ · 훈련 미실시 √',
    t('B12') === '소방안전교육 ([√]실시 [  ]미실시),      소방훈련 ([  ]실시 [√]미실시)', t('B12'))
  // 개행 3줄 구조 + 표본 2024년 날짜 소거 + 가입금액 줄은 원문 유지(단위 불일치로 미주입)
  const b13 = t('B13').split('\n')
  check('정보!B13 화재보험 — 3줄 구조 유지·개행 생존', b13.length === 3, `${b13.length}줄`)
  // ⚠ 기대 문자열을 손으로 조립하지 않는다 — 슬롯 가운데 맞춤의 좌우 배분을 눈대중하게 된다
  //   (실제로 한 번 그렇게 틀렸다). 값 반영·표본 소거·**폭 불변**을 속성으로 단언한다
  check('정보!B13 보험사·가입기간 반영 + 표본 2024년 소거',
    b13[1].includes('현대해상') && b13[1].includes('2026년 4월 1일 ~ 2027년 3월 31일') && !b13[1].includes('2024년'),
    JSON.stringify(b13[1]))
  check('정보!B13 줄2 폭 불변(원문과 같은 길이)', b13[1].length === 58, `${b13[1].length}자`)
  // 가입금액 — 단위 만원 통일(2026-08-24). 값이 슬롯 폭 18칸을 지키며 들어간다
  check('정보!B13 가입금액 주입 + 만원 단위',
    /대인\( +5000 +만원 \) {4}대물\( +50000 +만원 \)$/.test(b13[2]) && !b13[2].includes('천만원'),
    JSON.stringify(b13[2]))
  // 다중이용업소 — 표본 '[√]해당없음'이 전 고객에게 찍히던 칸
  check('정보!B14 해당없음 √ 소거 + 개소 반영(2줄 쪼개진 업종)',
    t('B14').includes('[  ]해당없음') && t('B14').includes('[√]비디오물감상실업\n    ( 1 개소)'), t('B14').slice(0, 60))
  check('정보!I14 3열 개소 반영', t('I14').includes('[√]일반음식점영업( 2 개소)'), t('I14').slice(0, 40))
  check('정보!I14 꼬리 빈 줄 3개 유지(서식 높이)', /\n\n\n$/.test(t('I14')), JSON.stringify(t('I14').slice(-6)))
  check('정보!B19 구조 — 철골 √(표본 철근콘크리트 소거)',
    t('B19') === ' [  ]철근콘크리트구조, [√]철골구조, [  ]조적조, [  ]목구조, [  ]기타', t('B19'))
  check('정보!B20 지붕 — 슬라브 √(표본 기타 소거)',
    t('B20') === ' [√]슬라브, [  ]기와, [  ]슬레이트, [  ]기타', t('B20'))
  check('정보!B21 계단 — 3개소·특별 1개소(표본 1개소 소거)',
    t('B21') === ' [√]직통(또는 피난계단) ( 3 개소 ), [√]특별피난계단 ( 1 개소)', t('B21'))
  check('정보!B22 승강기 — 승용 2대만 √',
    t('B22') === ' [√]승용( 2 대 ), [  ]비상용(    대), [  ]피난용(    대)', t('B22'))
  check('정보!B23 주차장 — 옥내·지하 √(표본 옥외 소거)',
    t('B23') === ' [√]옥내([√]지하 [  ]지상 [  ]필로티 [  ]기계식), [  ]옥상, [  ]옥외', t('B23'))
  // 경사로(개요!D21 → 정보!J20 폐포) — F세대 §1-① 수리분 회귀
  check('정보!J20 경사로(개요!D21 경유 — 종전 전 고객 0)', cellV('정보', 'J20') === '2', String(cellV('정보', 'J20')))

  // 이중 XML 이스케이프 — 개행이 리터럴 `&#10;`로 인쇄되던 부류(2026-08-23 판정 67칸).
  // SheetJS 왕복만 보면 못 잡는 경우가 있으므로 **원시 바이트**에서 직접 금한다
  const zi = await JSZip.loadAsync(result.bytes)
  const ifiles = await sheetFileMap(zi)
  const infoXml = await zi.file(ifiles.get('정보')!)!.async('string')
  check('정보 시트 XML에 이중 이스케이프(&amp;#10;) 0건', !infoXml.includes('&amp;#10;'))
  check('주입한 개행이 원시 XML에서 실개행으로 살아 있다',
    /<is><t[^>]*>[^<]*\n[^<]*<\/t><\/is>/.test(infoXml))
}
check('보고서!C17 주된 성명(표본 김흥준 교체)', cellV('보고서', 'C17') === '김주된', String(cellV('보고서', 'C17')))
check('보고서!D17 자격구분', cellV('보고서', 'D17') === '소방시설관리사', String(cellV('보고서', 'D17')))
check('보고서!E17 자격번호(표본 제2005-60호 교체)', cellV('보고서', 'E17') === '제2026-1호', String(cellV('보고서', 'E17')))
// S3-5 2차 — 등급·교육이수일·보조 명단(허브)
check('개요!B18 소방안전관리등급', cellV('개요', 'B18') === '2급', String(cellV('개요', 'B18')))
check('개요!B20 교육이수일(;@ 서식 — 문자열 그대로)', cellV('개요', 'B20') === '2024년 5월 2일', String(cellV('개요', 'B20')))
check('개요!B2 보조 성명', cellV('개요', 'B2') === '이보조', String(cellV('개요', 'B2')))
check('개요!D2 보조 자격번호', cellV('개요', 'D2') === '수첩-77', String(cellV('개요', 'D2')))
// S3-5 1차 확장 — 건축물 현황 축(용도·면적·층수·날짜 시리얼)
check('개요!B15 대상물 구분(용도)', cellV('개요', 'B15') === '근린생활시설', String(cellV('개요', 'B15')))
check('개요!D17 연면적(숫자)', cellV('개요', 'D17') === 999.99, String(cellV('개요', 'D17')))
check('개요!D19 사용승인일(시리얼 — 날짜 서식 보존)', cellV('개요', 'D19') === isoToSerial('2011-06-25'),
  String(cellV('개요', 'D19')))
check('개요!D20 건축허가일(시리얼)', cellV('개요', 'D20') === isoToSerial('2009-04-25'), String(cellV('개요', 'D20')))
check('개요!B22 지상 층수', cellV('개요', 'B22') === 5, String(cellV('개요', 'B22')))

// ── ③ 폐포 전파 ─────────────────────────────────────────────────────
console.log('[3] 폐포 전파 — 허브만 넣어도 스포크 캐시가 바뀐다')
check('공문!B8 수신', cellV('공문', 'B8') === '검증대상빌딩', String(cellV('공문', 'B8')))
check('공문!B8 수식 보존(Excel에서 수정하면 살아 움직인다)',
  (wb.Sheets['공문']['B8'] as XLSX.CellObject).f !== undefined)
check('계약서!A3 상호', cellV('계약서', 'A3') === '검증대상빌딩')
check('계약서!D24 상호(같은 시트 참조 사슬 A3→D24)', cellV('계약서', 'D24') === '검증대상빌딩', String(cellV('계약서', 'D24')))
check('완료보고서!B5 상호(스포크→스포크 사슬 계획서!B5 경유)', cellV('완료보고서', 'B5') === '검증대상빌딩')
check('위임장!C6 관계인(개요!D10 경유)', cellV('위임장', 'C6') === '박관계', String(cellV('위임장', 'C6')))
check('위임장!C10 점검일자(개요!E1 경유)', cellV('위임장', 'C10') === delegation.periodLabel)
// S3-5 1차 확장의 스포크 — 정보 시트가 단일 참조로 끌어간다(실측: 정보!B17='개요'!D17)
check('정보!B17 연면적(개요!D17 경유)', cellV('정보', 'B17') === 999.99, String(cellV('정보', 'B17')))
check('정보!C18 지상 층수(개요!B22 경유)', cellV('정보', 'C18') === 5, String(cellV('정보', 'C18')))
check('위임장!P19 관할소방서',cellV('위임장', 'P19') === '양평')
// S3-5 2차의 스포크 — 보고서 점검인력 보조 행(18행~)이 개요!B2~E8을 수식으로 끌어간다
check('보고서!C18 보조 성명(개요!B2 경유)', cellV('보고서', 'C18') === '이보조', String(cellV('보고서', 'C18')))
check('보고서!F18 보조 기간(개요!E2 경유)', cellV('보고서', 'F18') === report9.assistants[0].period,
  String(cellV('보고서', 'F18')))
// 빈 보조 행 — 명시적 공란 전파가 표본 캐시('0'·'점검자경력수첩')를 지운다
const c19 = cellV('보고서', 'C19')
check('보고서!C19 빈 보조 행 성명 공란(캐시 0 잔재 소거)', c19 === undefined || String(c19).trim() === '',
  JSON.stringify(c19))
const d19 = cellV('보고서', 'D19')
check('보고서!D19 빈 보조 행 자격구분 공란(점검자경력수첩 잔재 소거)', d19 === undefined || String(d19).trim() === '',
  JSON.stringify(d19))

// ── ④ 명시적 공란 ───────────────────────────────────────────────────
console.log('[4] 값 없는 앵커 = 명시적 공란')
{
  const blankDelegation = { ...delegation, agent: { name: '', position: '', phone: '', birth: '' } }
  const v2 = buildWorkbookValues({
    official, delegation: blankDelegation, customerAddress: '', startISO: null, endISO: null,
    useApprovalISO: null, installedCodes: [], evacTypes: [], building: null,
    report9: {
      ...report9,
      ckOp: false, consent: null, repRole: '', managerGrade: '', mgrEduDate: '', rampCount: '',
      main: null, assistants: [],
      // 정보 12칸도 '답 없음'으로 — 전부 ☐ + 빈 슬롯이 정상(부정을 단정하지 않는다, A9-6)
      mgrAppointType: '', hasFirePlan: false, firePlanStored: false, firePlanUnstored: false,
      prevOpDone: false, prevOpNone: false, prevCompDone: false,
      eduDone: false, drillDone: false, drillNone: false,
      insuranceJoined: null, insCompany: '', insPeriod: '',
      multiUseNone: false, multiUseCounts: {},
      stSteel: false, rfSlab: false,
      stairsCount: '', specialStairCount: '', elvR: '',
      pkIn: false, pkInUg: false,
    },
  })
  const r2 = await injectWorkbook(template, toInjectTargets(v2).targets)
  const wb2 = XLSX.read(r2.bytes)
  const n6 = (wb2.Sheets['위임장']?.['N6'] as XLSX.CellObject | undefined)?.v
  check('위임장!N6 공란(잔재 없음)', n6 === undefined || String(n6).trim() === '', JSON.stringify(n6))

  // ── 보조 점검인력이 없는 행의 점검기간 (2026-09-01 사용자 신고) ──────────────
  // 개요 E2~E8은 `=E1`→`=E2`→… **수식 사슬**이라, 캐시만 비우면 Excel이 열면서 재계산해
  // **사람 없는 행에 점검기간을 되살린다**. LibreOffice는 재계산을 안 해(D-9) PDF에선 안 보였고,
  // 기존 104단정이 전부 초록인 채 이 결함이 나갔다 — 사용자의 도구가 Excel이라 드러난 축이다.
  // ⚠ 판정은 원시 XML로 — SheetJS는 캐시 없는 수식 셀을 건너뛴다(840→679 실측).
  {
    const zr2 = await JSZip.loadAsync(r2.bytes)
    const hubXml = await zr2.file((await sheetFileMap(zr2)).get('개요')!)!.async('string')
    const cx = (ref: string) =>
      new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(hubXml)?.[0] ?? ''
    for (const ref of ['E2', 'E5', 'E8']) {
      check(`보조 없음 — 개요!${ref}에 =E 사슬이 남지 않는다(Excel 재계산 부활 차단)`,
        !/<f[^>]*>/.test(cx(ref)), cx(ref) || '(셀 없음)')
      // 빈 셀이 아니라 **공백 1칸**이어야 한다 — 보고서!F18~F24가 단일 참조하므로
      // 빈 셀이면 거울이 `0`을 인쇄한다(_probe-empty-repr 5종 왕복: 살아남는 건 공백 1칸과 `=""`)
      check(`보조 없음 — 개요!${ref}는 공백 1칸(빈 셀이면 거울이 0을 찍는다)`,
        /<t[^>]*> <\/t>/.test(cx(ref)), cx(ref) || '(셀 없음)')
    }
  }
}

// ── ④b 현1 3-1 소화기구 체크 7칸 (Phase 4 / S9-1 착수분) ─────────────
// 현1~현4는 여태 통째로 미배선이라 PDF는 제원을 인쇄하는데 엑셀만 빈칸이었다(D-7 파손).
// **대조군을 먼저 보인다** — specs가 없으면 7칸이 전부 `[  ]`여야 한다(값을 지어내지 않는다).
console.log('[4b] 현1 3-1 소화기구 체크')
{
  const CELLS = { J3: '간이소화용구', O3: '자동확산소화기', R3: '자동소화장치',
                  B4: '소화기(분말)', G4: '소화기(기타)', I4: '투척용', L4: '간이(기타)' } as const
  const mk = async (specs: Record<string, unknown> | null) => {
    const v = buildWorkbookValues({
      official, delegation, customerAddress: '', startISO: null, endISO: null,
      useApprovalISO: null, installedCodes: [], evacTypes: [], building: null,
      report9: { ...report9, specs },
    })
    const r = await injectWorkbook(template, toInjectTargets(v).targets)
    const z = await JSZip.loadAsync(r.bytes)
    const xml = await z.file((await sheetFileMap(z)).get('현1')!)!.async('string')
    return (ref: string) => {
      const c = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(xml)?.[0] ?? ''
      return /<t[^>]*>([\s\S]*?)<\/t>/.exec(c)?.[1] ?? /<v>([\s\S]*?)<\/v>/.exec(c)?.[1] ?? ''
    }
  }
  // 대조군 — 세부제원이 없으면 전부 빈 마크
  const ctl = await mk(null)
  for (const ref of Object.keys(CELLS)) {
    check(`대조군 — specs 없으면 현1!${ref}는 빈 마크`, ctl(ref) === '[  ]', JSON.stringify(ctl(ref)))
  }
  // 실값 — 분말·투척용·자동소화장치만 켠다. 상위 '간이소화용구'는 하위 합집합이라 함께 켜지고,
  // 자동확산소화기는 꺼진 채여야 한다(켜지면 '설치하지도 않은 설비'가 법정 서식에 찍힌다).
  const got = await mk({ s31_extinguisher: { summary: {
    types: ['소화기(분말)', '간이소화용구(투척용)', '자동소화장치'],
  } } })
  const ON = '[√]', OFF = '[  ]'
  const EXPECT: Record<string, string> = {
    B4: ON, I4: ON, R3: ON,   // 직접 켠 3종
    J3: ON,                   // 상위 = 하위 합집합(투척용이 켜졌으므로)
    G4: OFF, L4: OFF, O3: OFF, // 안 켠 것은 꺼진 채
  }
  for (const [ref, want] of Object.entries(EXPECT)) {
    check(`현1!${ref} ${CELLS[ref as keyof typeof CELLS]} = ${want === ON ? '√' : '빈칸'}`,
      got(ref) === want, JSON.stringify(got(ref)))
  }
}

// ── ④c 현1 3-2 수계소화설비 25칸 (Phase 4 / S9-1) ────────────────────
// **자구 왕복이 이 블록의 본체다.** 통문자열을 손으로 재조립하므로 공백 런이 한 칸만 어긋나도
// 서식이 밀린다 — 그런데 인쇄물은 멀쩡해 보인다. 그래서 '빈 값 조립 = 서식 원문'을 단언한다.
// ⚠ G25는 **일부러 다르다** — 갑지가 구판(`유효수량 …㎥`)이고 현행판 원문은 `유효낙차 …m`다.
//   그 한 칸만 달라야 하고, 나머지 24칸은 원문과 동일해야 한다.
console.log('[4c] 현1 3-2 자구 왕복·값 착지')
{
  const CELLS = ['G16', 'G17', 'G18', 'G19', 'G20', 'G21', 'B22', 'G22', 'G23', 'G24', 'G25',
    'B26', 'G26', 'G27', 'G28', 'G29', 'G30', 'G31',
    'B32', 'G32', 'G33', 'G34', 'G35', 'G36', 'G37']
  const textOf = (xml: string, ref: string) => {
    const c = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(xml)?.[0] ?? ''
    const raw = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c)?.[1] ?? ''
    return raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(+d)).replace(/&amp;/g, '&')
  }
  const sheetXml = async (bytes: Uint8Array) => {
    const z = await JSZip.loadAsync(bytes)
    return await z.file((await sheetFileMap(z)).get('현1')!)!.async('string')
  }
  const mk = async (specs: Record<string, unknown> | null) => sheetXml(
    (await injectWorkbook(template, toInjectTargets(buildWorkbookValues({
      official, delegation, customerAddress: '', startISO: null, endISO: null,
      useApprovalISO: null, installedCodes: [], evacTypes: [], building: null,
      report9: { ...report9, specs },
    })).targets)).bytes)

  // 원본(주입 전) — 공유문자열도 풀어야 해서 시트 XML만으론 부족하다. 라벨 프로브와 같은 축으로
  // 템플릿을 직접 읽어 비교 대상을 만든다.
  const tplZip = await JSZip.loadAsync(template)
  const sst = await tplZip.file('xl/sharedStrings.xml')!.async('string')
  const shared = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))
  const tplXml = await sheetXml(template)
  const tplText = (ref: string) => {
    const c = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(tplXml)?.[0] ?? ''
    const t = /t="([^"]+)"/.exec(c)?.[1]
    const raw = t === 's'
      ? (shared[+(/<v>(\d+)<\/v>/.exec(c)?.[1] ?? -1)] ?? '')
      : (/<t[^>]*>([\s\S]*?)<\/t>/.exec(c)?.[1] ?? '')
    return raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(+d)).replace(/&amp;/g, '&')
  }

  const blank = await mk(null)
  let same = 0
  for (const ref of CELLS) {
    if (ref === 'G25') continue
    const a = tplText(ref), b = textOf(blank, ref)
    if (a === b) { same++; continue }
    check(`자구 왕복 현1!${ref}`, false, `원문 ${JSON.stringify(a)} vs 조립 ${JSON.stringify(b)}`)
  }
  check(`자구 왕복 — 빈 값 조립이 서식 원문과 동일(G25 제외 24칸)`, same === CELLS.length - 1, `${same}/${CELLS.length - 1}`)
  // G25만 현행판으로 정정된다 — 구판을 그대로 두면 틀린 법정 서식 문구가 인쇄된다
  check('현1!G25는 구판(유효수량 ㎥)이 아니라 현행판(유효낙차 m)',
    /유효낙차/.test(textOf(blank, 'G25')) && /\)m$/.test(textOf(blank, 'G25')),
    JSON.stringify(textOf(blank, 'G25')))
  check('대조군 — 갑지 자산의 G25는 아직 구판이다(우리가 덮는 것이 맞다)',
    /유효수량/.test(tplText('G25')), JSON.stringify(tplText('G25')))

  // 값 착지 — 압력수조에 값을 넣고 마크·슬롯·수조용량이 함께 사는지
  const gotXml = await mk({ s32_water_common: {
    main_water: { systems: ['옥내소화전설비', '포소화설비'], dong: '본관', ground: '지하', floor: '2', room: '기계실', intake: '부압', capacity: '12.5' },
    pump_pressure: { systems: ['스프링클러설비'], tank_volume: '300', tank_pressure: '0.7' },
  } })
  const got = (ref: string) => textOf(gotXml, ref)
  check('현1!G16 — 켠 설비만 √(옥내 O, 옥외 X)',
    got('G16').includes('[√]옥내소화전설비') && got('G16').includes('[  ]옥외소화전설비'), JSON.stringify(got('G16')))
  check('현1!G18 — 3행째의 포소화설비도 √', got('G18').includes('[√]포소화설비'), JSON.stringify(got('G18')))
  check('현1!G19 — 동명·지하·층·실명이 한 줄에',
    got('G19').includes('본관') && got('G19').includes('[√]지하') && got('G19').includes('[  ]지상')
      && got('G19').includes('기계실'), JSON.stringify(got('G19')))
  check('현1!G20 — 부압 √ + 유효수량', got('G20').includes('[√]부압') && got('G20').includes('12.5'), JSON.stringify(got('G20')))
  check('현1!B26 — 값만 있고 used 없어도 압력수조가 켜진다',
    got('B26') === '[√]압력수조', JSON.stringify(got('B26')))
  check('현1!B22 — 값이 없는 고가수조는 꺼진 채', got('B22') === '[  ]고가수조', JSON.stringify(got('B22')))
  check('현1!G30 — 수조용량·가압압력', got('G30').includes('300') && got('G30').includes('0.7'), JSON.stringify(got('G30')))
}

// ── ④d 현2 3-2 후반(펌프방식·송수구·비상전원) 22칸 ───────────────────
// 현1과 같은 축 — 빈 값 조립이 서식 원문과 한 글자도 다르지 않아야 한다.
// ⚠ D2~D5·C16~C18은 서식이 **수식**이라 캐시값이 원문이다. 여기에 dropFormula로 자기 값을
//   넣으므로, 조립이 원문과 같은지와 **수식이 실제로 끊겼는지**를 함께 본다 — 안 끊으면
//   Excel이 재계산해 남의 블록 값(주된수원·펌프방식)을 되살린다(fullCalcOnLoad="1").
console.log('[4d] 현2 3-2 후반 자구 왕복·수식 절단')
{
  const CELLS = ['C2', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10',
    'D11', 'D12', 'D13', 'D14', 'D15', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21', 'C22',
    // 3-3 수계 개별사항 · 3-4 가스계 — 층 범위(rangeLine)가 반복되는 구간이라
    // 자구 드리프트가 나면 여러 칸에서 한꺼번에 터진다(그래서 전수로 본다)
    'C24', 'C25', 'C26', 'C27', 'C28', 'C29', 'C30', 'C31', 'C32', 'C33', 'C34', 'C35',
    'C36', 'C37', 'C38', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45', 'C46', 'C47']
  const FORMULA_CELLS = ['D2', 'D3', 'D4', 'D5', 'C16', 'C17', 'C18']
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(+d)).replace(/&amp;/g, '&')
  const zTpl = await JSZip.loadAsync(template)
  const sstTpl = await zTpl.file('xl/sharedStrings.xml')!.async('string')
  const sharedTpl = [...sstTpl.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))
  const h2Tpl = await zTpl.file((await sheetFileMap(zTpl)).get('현2')!)!.async('string')
  const cellOfXml = (xml: string, ref: string) =>
    new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml)?.[0] ?? ''
  const textIn = (c: string, shared: string[]) => {
    const t = /t="([^"]+)"/.exec(c)?.[1]
    if (t === 's') return unesc(shared[+(/<v>(\d+)<\/v>/.exec(c)?.[1] ?? -1)] ?? '')
    return unesc(/<t[^>]*>([\s\S]*?)<\/t>/.exec(c)?.[1] ?? /<v>([\s\S]*?)<\/v>/.exec(c)?.[1] ?? '')
  }
  const blankBytes = (await injectWorkbook(template, toInjectTargets(buildWorkbookValues({
    official, delegation, customerAddress: '', startISO: null, endISO: null,
    useApprovalISO: null, installedCodes: [], evacTypes: [], building: null,
    report9: { ...report9, specs: null },
  })).targets)).bytes
  const zB = await JSZip.loadAsync(blankBytes)
  const h2B = await zB.file((await sheetFileMap(zB)).get('현2')!)!.async('string')

  let same = 0
  for (const ref of CELLS) {
    const a = textIn(cellOfXml(h2Tpl, ref), sharedTpl)
    const b = textIn(cellOfXml(h2B, ref), [])
    if (a === b) { same++; continue }
    check(`자구 왕복 현2!${ref}`, false, `원문 ${JSON.stringify(a)} vs 조립 ${JSON.stringify(b)}`)
  }
  check('자구 왕복 — 현2 빈 값 조립이 서식 원문과 동일(45칸)', same === CELLS.length, `${same}/${CELLS.length}`)

  // 수식 절단 — 안 끊으면 Excel 재계산이 남의 블록 값을 되살린다
  const stillFormula = FORMULA_CELLS.filter(r => /<f[^>]*>/.test(cellOfXml(h2B, r)))
  check('현2 D2~D5·C16~C18의 복사 수식이 끊겼다', stillFormula.length === 0,
    stillFormula.length ? `남은 수식: ${stillFormula.join(',')}` : '7칸 전부 절단')
  // 대조군 — 템플릿에는 그 수식이 실재한다(끊을 것이 정말 있었다)
  const tplHadFormula = FORMULA_CELLS.filter(r => /<f[^>]*>/.test(cellOfXml(h2Tpl, r)))
  check('대조군 — 템플릿의 그 7칸은 원래 수식이었다', tplHadFormula.length === FORMULA_CELLS.length,
    `${tplHadFormula.length}/${FORMULA_CELLS.length}`)

  // 값 착지 — 펌프방식·송수구·비상전원이 **각자** 블록을 읽는지(수식 복사가 아니라)
  const gotBytes = (await injectWorkbook(template, toInjectTargets(buildWorkbookValues({
    official, delegation, customerAddress: '', startISO: null, endISO: null,
    useApprovalISO: null, installedCodes: [], evacTypes: [], building: null,
    report9: { ...report9, specs: { s32_water_common: {
      main_water: { systems: ['옥내소화전설비'] },
      pump_type: { systems: ['포소화설비'], main_head: '55', main_flow: '900', starter: ['ON/OFF 방식'] },
      inlet: { systems: ['스프링클러설비'], place: '정문', twin_count: '2' },
      emergency_power: { types: ['축전지설비'], gen_type: '소방전용' },
    } } },
  })).targets)).bytes
  const zG = await JSZip.loadAsync(gotBytes)
  const h2G = await zG.file((await sheetFileMap(zG)).get('현2')!)!.async('string')
  const g = (ref: string) => textIn(cellOfXml(h2G, ref), [])
  check('★현2!D4 펌프방식은 **자기** systems를 쓴다(주된수원 복사 아님)',
    g('D4').includes('[√]포소화설비'), JSON.stringify(g('D4')))
  check('★현2!D2 주된수원의 옥내소화전이 새어 들어오지 않는다',
    g('D2').includes('[  ]옥내소화전설비'), JSON.stringify(g('D2')))
  check('★현2!C16 송수구도 **자기** systems',
    g('C16').includes('[√]스프링클러설비') && g('C16').includes('[  ]옥내소화전설비'), JSON.stringify(g('C16')))
  check('현2!D6 주펌프 전양정·토출량', g('D6').includes('55') && g('D6').includes('900'), JSON.stringify(g('D6')))
  check('현2!D12 기동장치 ON/OFF만 √',
    g('D12').includes('[  ]기동용수압개폐장치') && g('D12').includes('[√]ON/OFF 방식'), JSON.stringify(g('D12')))
  check('현2!C19 송수구 설치장소·쌍구형', g('C19').includes('정문') && g('C19').includes('[√]쌍구형'), JSON.stringify(g('C19')))
  check('현2!C21 축전지설비만 √',
    g('C21').includes('[√]축전지설비') && g('C21').includes('[  ]전기저장장치'), JSON.stringify(g('C21')))
  check('현2!D7 대응 필드 없는 전동기 줄은 빈 서식 그대로',
    g('D7') === `  [  ]전동기 [  ]내연기관(연료:[  ]경유 [  ]기타`, JSON.stringify(g('D7')))

  // ── 3-3·3-4 값 착지 ──
  const bytes34 = (await injectWorkbook(template, toInjectTargets(buildWorkbookValues({
    official, delegation, customerAddress: '', startISO: null, endISO: null,
    useApprovalISO: null, installedCodes: [], evacTypes: [], building: null,
    report9: { ...report9, specs: {
      s33_water_each: {
        indoor_hydrant: { dong: '본', coverage: '일부층', from_ground: '지하', from_floor: '2', to_ground: '지상', to_floor: '5', max_count: '7' },
        sprinkler: { type: '준비작동식' },
        foam: { system: ['포헤드설비'], agent: ['수성막포'] },
      },
      s34_gas: { gas_system: {
        discharge: ['전역방출'], pressure_class: '고압식', charge_type: '가압식',
        storage_ground: '지하', storage_floor: '1', storage_room: '전용실',
        qty_amount: '45', qty_unit: '㎏', agent: ['할론1301', 'IG-541'],
      } },
    } },
  })).targets)).bytes
  const z34 = await JSZip.loadAsync(bytes34)
  const h34 = await z34.file((await sheetFileMap(z34)).get('현2')!)!.async('string')
  const q = (ref: string) => textIn(cellOfXml(h34, ref), [])
  check('현2!C24 옥내소화전 층 범위 — 지하2 ~ 지상5, 일부층',
    q('C24').includes('[√]일부층') && q('C24').includes('[  ]전체층')
      && q('C24').includes(' 2 )층 ~ ') && q('C24').includes(' 5 )층'), JSON.stringify(q('C24')))
  check('현2!C26 설치개수 최다층', q('C26').includes('( 7 )개'), JSON.stringify(q('C26')))
  check('현2!C28 스프링클러 종류 — 준비작동식만 √',
    q('C28').includes('[√]준비작동식') && q('C28').includes('[  ]습식'), JSON.stringify(q('C28')))
  check('현2!C37 포 소화약제 — 수성막포만 √',
    q('C37').includes('[√]수성막포') && q('C37').includes('[  ]단백포'), JSON.stringify(q('C37')))
  check('현2!C40 가스계 방출·압력·가압 방식',
    q('C40').includes('[√]전역방출') && q('C40').includes('[√]고압식') && q('C40').includes('[√]가압식')
      && q('C40').includes('[  ]축압식'), JSON.stringify(q('C40')))
  check('★현2!C43 단위 대괄호는 폭 1(`[ ]`)이고 ㎏만 √',
    q('C43').includes('[√]㎏,[ ]㎥') && q('C43').includes('( 45 )'), JSON.stringify(q('C43')))
  check('현2!C44·C46 약제는 여러 줄에 걸쳐 각자 √',
    q('C44').includes('[√]할론1301') && q('C46').includes('[√]IG-541')
      && q('C44').includes('[  ]이산화탄소'), `${JSON.stringify(q('C44'))} / ${JSON.stringify(q('C46'))}`)
  check('현2!C27 값 없는 옥외소화전은 빈 서식 그대로',
    q('C27') === '◦ 설치개수: (   )개', JSON.stringify(q('C27')))
}

// ── ⑤ 안전망(S2-7/D-10) — 주입이 안 닿은 표본 흔적 캐시를 비운다 ────
console.log('[5] 안전망 — 니들 캐시 소거·주입값은 보호')
{
  // 오염된 템플릿을 연출: 폐포 밖 셀(완료보고서!I12 — 수식 없음·어떤 앵커의 폐포에도 없음)에
  // 표본 상호를 심는다. 템플릿 갱신이 표본 값을 복합 수식 캐시에 되살리는 상황의 대역이다
  const stain = await injectWorkbook(template, [
    { sheet: '완료보고서', cell: 'I12', value: '표본 잔존 정내과의원' },
  ])
  check('오염 연출 성공', stain.missed.length === 0)

  const r5 = await injectWorkbook(stain.bytes, targets, { forbidden: SCRUB_NEEDLES })
  check('니들 캐시 소거 1칸', r5.scrubbed.length === 1 && r5.scrubbed[0] === '완료보고서!I12',
    r5.scrubbed.join(', '))
  const wb5 = XLSX.read(r5.bytes)
  const i12 = (wb5.Sheets['완료보고서']?.['I12'] as XLSX.CellObject | undefined)?.v
  check('완료보고서!I12 비워짐', i12 === undefined || String(i12).trim() === '', JSON.stringify(i12))
  // 소거도 바이트 패치다 — 서식 무손상 축이 그대로 성립해야 한다
  const zb5 = await JSZip.loadAsync(template)
  const za5 = await JSZip.loadAsync(r5.bytes)
  check('소거 후에도 styles.xml 바이트 동일',
    (await zb5.file('xl/styles.xml')!.async('string')) === (await za5.file('xl/styles.xml')!.async('string')))

  // 표본과 같은 이름의 실고객(정내과의원 본인) — 이번 주입이 쓴 값은 지우면 안 된다
  const asSample = buildWorkbookValues({
    official: { ...official, recipient: '정내과의원' }, delegation,
    customerAddress: '경기도 양평군 용문로 376-1', startISO: '2026-08-20', endISO: '2026-08-21',
    useApprovalISO: null, installedCodes: [], evacTypes: [], building: null, report9,
  })
  const r6 = await injectWorkbook(template, toInjectTargets(asSample).targets, { forbidden: SCRUB_NEEDLES })
  const wb6 = XLSX.read(r6.bytes)
  check('주입 셀은 보호 — 개요!B14 유지', (wb6.Sheets['개요']['B14'] as XLSX.CellObject).v === '정내과의원')
  check('폐포 전파 셀도 보호 — 공문!B8 유지', (wb6.Sheets['공문']['B8'] as XLSX.CellObject).v === '정내과의원',
    String((wb6.Sheets['공문']['B8'] as XLSX.CellObject | undefined)?.v))
  check('깨끗한 템플릿에선 소거 0칸', r6.scrubbed.length === 0, r6.scrubbed.join(', '))
}

// ── ⑥ 안전망 사각 축 — t="s"·분할 런·원시 바이트 (2026-08-22 판정이 잡은 우회로) ──
console.log('[6] 안전망 — 공유문자열 인덱스·분할 런까지 본다')
{
  // 오염 연출: sharedStrings에 **서식 런으로 쪼개진** 표본 상호를 추가하고('정내'+'과의원' —
  // 첫 <t>만 보는 검사는 못 잡는다), 완료보고서!I12를 그 항목을 가리키는 t="s" 셀로 바꾼다
  const zip = await JSZip.loadAsync(template)
  const files = await sheetFileMap(zip)
  let sst = await zip.file('xl/sharedStrings.xml')!.async('string')
  const siIndex = [...sst.matchAll(/<si>/g)].length
  sst = sst.replace('</sst>', '<si><r><t>정내</t></r><r><t>과의원</t></r></si></sst>')
  zip.file('xl/sharedStrings.xml', sst)
  const path = files.get('완료보고서')!
  let xml = await zip.file(path)!.async('string')
  xml = xml.replace(/<c r="I12"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/, `<c r="I12" t="s"><v>${siIndex}</v></c>`)
  zip.file(path, xml)
  const stained = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))

  const r = await injectWorkbook(stained, targets, { forbidden: SCRUB_NEEDLES })
  check('t="s" 셀 소거(인덱스 너머의 원문 대조)', r.scrubbed.includes('완료보고서!I12'), r.scrubbed.join(', '))
  check('공유문자열 텍스트 자체 소거(분할 런 연결 판정)', r.scrubbed.includes(`sharedStrings!si${siIndex}`))
  const za = await JSZip.loadAsync(r.bytes)
  const sstAfter = await za.file('xl/sharedStrings.xml')!.async('string')
  const joined = [...sstAfter.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
  check('소거 후 공유문자열 원문에 니들 0', joined.every(t => !SCRUB_NEEDLES.some(n => t.includes(n))))
}

// ── ⑦ 주입 견고성 — 치환 패턴·타깃 순서 (판정 실측 결함의 회귀 고정) ──
console.log('[7] 주입 견고성')
{
  // $' 같은 치환 패턴이 값에 있으면 종전 구현은 문서 꼬리를 셀 안으로 복제하고 값을 유실했다(무음)
  const odd = "가$'나$&다$`라"
  const r7 = await injectWorkbook(template, [{ sheet: '개요', cell: 'B14', value: odd }])
  const wb7 = XLSX.read(r7.bytes)
  check("값의 $'·$&·$` 무해(치환 소독)", (wb7.Sheets['개요']['B14'] as XLSX.CellObject).v === odd,
    String((wb7.Sheets['개요']['B14'] as XLSX.CellObject | undefined)?.v))

  // 템플릿에 B10→B11 간선이 있어 발신일자 전파가 문서번호 칸을 지나간다 — 직접 타깃이
  // 배열 순서와 무관하게 이겨야 한다(종전엔 ANCHORS 순서 덕에 우연히 맞았다)
  const rev = await injectWorkbook(template, [...targets].reverse())
  const wbRev = XLSX.read(rev.bytes)
  check('타깃 순서 뒤집어도 개요!B11 = 문서번호', (wbRev.Sheets['개요']['B11'] as XLSX.CellObject).v === '2608-7',
    String((wbRev.Sheets['개요']['B11'] as XLSX.CellObject | undefined)?.v))

  // 비대상 무변경 — 주입·전파가 닿지 않은 셀은 원시 <c> 문자열까지 동일(S6-2 '대상 셀 외 diff 0')
  const touched = new Set(result.touched)
  const zb = await JSZip.loadAsync(template)
  const za = await JSZip.loadAsync(result.bytes)
  const filesB = await sheetFileMap(zb)
  const cellMap = (x: string) => {
    const m = new Map<string, string>()
    for (const c of x.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) m.set(c[1], c[0])
    return m
  }
  const diffs: string[] = []
  for (const [s, p] of filesB) {
    const before = cellMap(await zb.file(p)!.async('string'))
    const after = cellMap(await za.file(p)!.async('string'))
    for (const [ref, rawB] of before) {
      if (touched.has(`${s}!${ref}`)) continue
      if (after.get(ref) !== rawB) diffs.push(`${s}!${ref}`)
    }
  }
  check(`비대상 셀 diff 0 (touched ${touched.size}칸 외 전수)`, diffs.length === 0, diffs.slice(0, 5).join(', '))
}

// ── ⑧ 구조 안전망 — 참조 0인 공유문자열(고아 si) ────────────────────
// 2026-08-30 독립 판정 C·D가 **서로 다른 축에서** 같은 결함에 도달했다: 앵커가 셀을 덮어도
// 그 셀이 가리키던 si는 참조 0인 고아로 파트에 남아 압축만 풀면 읽혔다(직원 9명 성명·자격번호
// 7건·표본 소견·'( 3 )층 실명( 직원실 )'·표본 답 15종). ⑤⑥의 니들 축이 전부 초록이었던 이유는
// **니들이 표본 고객 하나만 인코딩**하기 때문이다 — 직원 이름은 어떤 니들에도 없다.
// 그래서 여기는 내용이 아니라 **구조**로 단언한다(externalLinks를 '파트 존재 금지'로 닫은 규약).
console.log('[8] 구조 안전망 — 고아 공유문자열')
{
  const orphansOf = async (bytes: Uint8Array) => {
    const z = await JSZip.loadAsync(bytes)
    const sstXml = await z.file('xl/sharedStrings.xml')?.async('string')
    if (!sstXml) return []
    const referenced = new Set<number>()
    for (const name of Object.keys(z.files)) {
      if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) continue
      const wx = await z.file(name)!.async('string')
      for (const m of wx.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (!/\st="s"/.test(m[1] ?? '')) continue
        const v = /<v>(\d+)<\/v>/.exec(m[2] ?? '')
        if (v) referenced.add(Number(v[1]))
      }
    }
    const out: string[] = []
    let at = 0
    for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const i = at++
      const text = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
      if (referenced.has(i) || !text) continue
      out.push(`si${i}='${text.slice(0, 30)}'`)
    }
    return out
  }

  // 대조군 먼저 — 판정기가 실제로 붉어지는가. 참조되지 않는 si를 하나 심는다.
  // 이게 없으면 아래 '0건'이 '검사가 아무것도 못 본다'와 구별되지 않는다.
  const zc = await JSZip.loadAsync(template)
  let sstC = await zc.file('xl/sharedStrings.xml')!.async('string')
  sstC = sstC.replace('</sst>', '<si><t>ZZ고아판정용문자열ZZ</t></si></sst>')
  zc.file('xl/sharedStrings.xml', sstC)
  const planted = new Uint8Array(await zc.generateAsync({ type: 'uint8array' }))
  const ctl = await orphansOf(planted)
  check('대조군 — 심은 고아 si를 판정기가 잡는다',
    ctl.some(o => o.includes('ZZ고아판정용문자열ZZ')), `고아 ${ctl.length}건`)

  // 본검사 — 심은 고아가 주입을 거치면 사라진다(구조 안전망이 실제로 지운다)
  const rp = await injectWorkbook(planted, targets)
  const after = await orphansOf(rp.bytes)
  check('심은 고아 si가 주입 후 소멸', !after.some(o => o.includes('ZZ고아판정용문자열ZZ')),
    after.slice(0, 3).join(' · '))
  check('주입 산출물에 고아 공유문자열 0건', after.length === 0,
    `${after.length}건: ${after.slice(0, 4).join(' · ')}`)
  check('고아 소거는 니들 축과 분리 보고', rp.scrubbedOrphans.length > 0 && rp.scrubbed.length === 0,
    `orphans=${rp.scrubbedOrphans.length} needles=${rp.scrubbed.length}`)

  // si 개수 불변 — 자리를 유지한 채 텍스트만 비워야 한다. 개수가 밀리면 전 시트의 t="s"가 어긋난다
  const nSi = async (b: Uint8Array) => [...(await (await JSZip.loadAsync(b))
    .file('xl/sharedStrings.xml')!.async('string')).matchAll(/<si>/g)].length
  check('소거가 si 개수를 바꾸지 않는다(인덱스 보존)', await nSi(planted) === await nSi(rp.bytes),
    `${await nSi(planted)} → ${await nSi(rp.bytes)}`)
}

// ── ⑨ 현5 불량 세부 7행 + 계획서 폐포 (S9-1 슬라이스 · Phase 3 선행 조건) ──
// 계획서!H12~H24{=현5!C4..C10}이라 이 시트가 비면 이행계획서 내용이 통째로 공란으로 인쇄된다.
// PDF page8()은 그룹당 N행을 rowspan으로 펼치지만 엑셀은 그룹당 1행 고정이라 **접는다**(행 높이
// 77.25pt ≈ 5줄 실측). B열 점검번호와 C열 불량내용은 **같은 인덱스로** 잘라야 짝이 안 어긋난다.
console.log('[9] 현5 불량 세부 · 계획서 폐포')
{
  const mkValues = (defectRows?: Array<{ group: string; code: string; content: string }>) =>
    buildWorkbookValues({
      official, delegation, customerAddress: '경기도 양평군 검증로 1',
      startISO: '2026-08-20', endISO: '2026-08-21', useApprovalISO: '2011-06-25',
      installedCodes: ['옥내소화전설비'], evacTypes: [],
      building: {
        purpose: '근린생활시설', totalArea: 999.99, buildingArea: 300.5, floorsAbove: 5,
        floorsBelow: 2, height: 21.5, households: 12, buildingCount: 2, permitDateISO: '2009-04-25',
      },
      report9: { ...report9, defectRows },
    })
  const cellOf = (bytes: Uint8Array, sheet: string, ref: string) => {
    const wb = XLSX.read(bytes, { cellFormula: true })
    return (wb.Sheets[sheet]?.[ref] as XLSX.CellObject | undefined)
  }

  // 대조군 먼저 — defectRows 없이 주입하면 7행이 비어야 하고, **계획서는 '0'을 인쇄하면 안 된다**
  // (빈 셀로 두면 복제 수식이 0을 읽는다: 이미 한 번 밟은 함정이라 keepFormulaWhenEmpty로 막았다)
  // ⚠ 판정은 **원시 XML**로 한다 — SheetJS는 캐시 `<v>`가 없는 수식 셀을 통째로 건너뛰므로
  //   `=""`만 있는 칸이 '수식 없음'으로 보인다(이 저장소가 이미 실측한 사각: 840→679).
  //   보는 층과 고치는 층을 맞추지 않으면 멀쩡한 코드가 붉게 나온다.
  const rawOf = async (bytes: Uint8Array, sheet: string) => {
    const z = await JSZip.loadAsync(bytes)
    return await z.file((await sheetFileMap(z)).get(sheet)!)!.async('string')
  }
  const cellXml = (xml: string, ref: string) =>
    new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml)?.[0] ?? ''

  const ctl = await injectWorkbook(template, toInjectTargets(mkValues(undefined)).targets)
  const ctlRaw = await rawOf(ctl.bytes, '현5')
  check('대조군 — defectRows 없으면 현5!C4는 =""가 살아 있다', /<f[^>]*>""<\/f>/.test(cellXml(ctlRaw, 'C4')),
    cellXml(ctlRaw, 'C4') || '(셀 없음)')
  check('대조군 — 계획서!H12가 "0"을 인쇄하지 않는다', String(cellOf(ctl.bytes, '계획서', 'H12')?.v ?? '') !== '0',
    String(cellOf(ctl.bytes, '계획서', 'H12')?.v ?? '(공란)'))

  // 본검사 — 그룹 2종에 값, 그중 하나는 상한(5) 초과로 접기·자르기를 함께 태운다
  const many = Array.from({ length: 7 }, (_, i) => ({ group: '소화설비', code: `1-${i + 1}`, content: `불량${i + 1}` }))
  const rows = [...many, { group: '경보설비', code: '2-1', content: '수신기 표시등 불량' }]
  const r9 = await injectWorkbook(template, toInjectTargets(mkValues(rows)).targets)
  const c4 = String(cellOf(r9.bytes, '현5', 'C4')?.v ?? '')
  const b4 = String(cellOf(r9.bytes, '현5', 'B4')?.v ?? '')
  check('현5!C4 — 같은 그룹 불량을 줄바꿈으로 접는다', c4.split('\n').length === DEFECT_ROWS_PER_GROUP,
    JSON.stringify(c4))
  check('현5!B4·C4 짝 정렬 — 같은 인덱스로 잘렸다',
    b4.split('\n').length === c4.split('\n').length && b4.split('\n')[0] === '1-1' && c4.split('\n')[0] === '불량1',
    `B4=${JSON.stringify(b4)}`)
  check('상한 초과분은 조용히 버리지 않는다(defectOverflow)',
    defectOverflow(rows).some(o => o.group === '소화설비' && o.dropped === 7 - DEFECT_ROWS_PER_GROUP),
    JSON.stringify(defectOverflow(rows)))
  check('현5!C5 — 다른 그룹은 자기 값만 받는다',
    String(cellOf(r9.bytes, '현5', 'C5')?.v ?? '') === '수신기 표시등 불량',
    String(cellOf(r9.bytes, '현5', 'C5')?.v ?? ''))
  const r9Raw = await rawOf(r9.bytes, '현5')
  check('값이 없는 그룹은 =""가 남는다(계획서 0 인쇄 방지)', /<f[^>]*>""<\/f>/.test(cellXml(r9Raw, 'C6')),
    cellXml(r9Raw, 'C6') || '(셀 없음)')

  // ★ 폐포 — 계획서!H12{=현5!C4}는 단일 참조라 이행 폐포가 캐시를 옮겨야 한다.
  //   LibreOffice는 재계산하지 않으므로(D-9) 캐시가 안 오면 **인쇄물이 빈다**.
  const h12 = cellOf(r9.bytes, '계획서', 'H12')
  check('계획서!H12 — 폐포가 현5!C4 값을 캐시로 옮겼다', String(h12?.v ?? '') === c4,
    `v=${JSON.stringify(String(h12?.v ?? ''))}`)
  check('계획서!H12 — 수식 <f>는 보존됐다', typeof h12?.f === 'string' && h12.f.includes('현5!C4'),
    `f=${h12?.f ?? '(없음)'}`)

  // 이중 이스케이프 회귀(2026-08-23 결함: 줄바꿈 67칸이 리터럴 '&#10;'로 인쇄됐다)
  check('원시 XML에 이중 이스케이프(&amp;#10;) 0건', !r9Raw.includes('&amp;#10;'))
}

// ── ⑩ 이행조치 기간 4칸 — 복합 수식 캐시가 실리는가 (Phase 3 본체) ──
// 계획서!B26{=개요!G9}·J26{=개요!I9}·P26{=개요!J9}, 완료보고서!I20{=개요!G10}이 전부 이 4칸에서 온다.
// 🚨 `I9{=G9+J9-1}`은 **산술 복합 수식**이라 단일 참조 폐포가 못 따라간다. LO는 재계산을 안 하므로
// 캐시를 안 실으면 날짜가 빈 채로 인쇄된다 — 2026-08-22에 같은 부류로 실결함이 났던 자리다.
console.log('[10] 이행조치 기간 4칸 · 복합 수식 캐시')
{
  const mk = (actionPeriod: { startISO: string; endISO: string; days: number } | null) =>
    buildWorkbookValues({
      official, delegation, customerAddress: '경기도 양평군 검증로 1',
      startISO: '2026-08-20', endISO: '2026-08-21', useApprovalISO: '2011-06-25',
      installedCodes: ['옥내소화전설비'], evacTypes: [],
      building: {
        purpose: '근린생활시설', totalArea: 999.99, buildingArea: 300.5, floorsAbove: 5,
        floorsBelow: 2, height: 21.5, households: 12, buildingCount: 2, permitDateISO: '2009-04-25',
      },
      report9: { ...report9, actionPeriod },
    })
  const rawOf2 = async (bytes: Uint8Array, sheet: string) => {
    const z = await JSZip.loadAsync(bytes)
    return await z.file((await sheetFileMap(z)).get(sheet)!)!.async('string')
  }
  const cellXml2 = (xml: string, ref: string) =>
    new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml)?.[0] ?? ''
  const vOf = (xml: string, ref: string) => /<v>([\s\S]*?)<\/v>/.exec(cellXml2(xml, ref))?.[1] ?? ''

  // 대조군 먼저 — 기간이 없으면 G9는 서식의 `=B10`(발신일자 기본값)이 살아 있어야 한다
  const ctlRaw = await rawOf2(
    (await injectWorkbook(template, toInjectTargets(mk(null)).targets)).bytes, '개요')
  check('대조군 — 기간 미산출이면 개요!G9에 =B10이 살아 있다', /<f[^>]*>B10<\/f>/.test(cellXml2(ctlRaw, 'G9')),
    cellXml2(ctlRaw, 'G9') || '(셀 없음)')

  // 본검사 — 2026-09-01 ~ 2026-09-10 (양끝 포함 10일)
  const period = { startISO: '2026-09-01', endISO: '2026-09-10', days: 10 }
  const r10 = await injectWorkbook(template, toInjectTargets(mk(period)).targets)
  const hub = await rawOf2(r10.bytes, '개요')
  const sStart = isoToSerial(period.startISO), sEnd = isoToSerial(period.endISO)
  check('개요!J9 = 총 일수', vOf(hub, 'J9') === String(period.days), vOf(hub, 'J9'))
  check('개요!G9 = 실제 시작일 시리얼(발신일자 아님)', vOf(hub, 'G9') === String(sStart),
    `${vOf(hub, 'G9')} vs ${sStart}`)
  check('★ 개요!I9 — 복합 수식이지만 캐시가 실렸다', vOf(hub, 'I9') === String(sEnd),
    `${vOf(hub, 'I9')} vs ${sEnd}`)
  check('개요!I9 — 수식 <f>는 보존됐다(엑셀에서 일수 고치면 따라온다)',
    /<f[^>]*>G9\+J9-1<\/f>/.test(cellXml2(hub, 'I9')), cellXml2(hub, 'I9'))
  check('서식 규약 정합 — G9 + J9 - 1 === I9', sStart + period.days - 1 === sEnd,
    `${sStart} + ${period.days} - 1 = ${sStart + period.days - 1} vs ${sEnd}`)
  check('개요!G10 = 이행완료일자(=I9)', vOf(hub, 'G10') === String(sEnd), vOf(hub, 'G10'))

  // ★ 스포크 도달 — 계획서·완료보고서가 실제로 날짜를 받는가(여기가 인쇄되는 자리다)
  const plan = await rawOf2(r10.bytes, '계획서')
  check('계획서!B26 — 시작일 도달', vOf(plan, 'B26') === String(sStart), vOf(plan, 'B26'))
  check('계획서!J26 — 종료일 도달', vOf(plan, 'J26') === String(sEnd), vOf(plan, 'J26'))
  check('계획서!P26 — 총 일수 도달', vOf(plan, 'P26') === String(period.days), vOf(plan, 'P26'))
  const done = await rawOf2(r10.bytes, '완료보고서')
  check('완료보고서!I20 — 이행완료일자 도달', vOf(done, 'I20') === String(sEnd), vOf(done, 'I20'))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
