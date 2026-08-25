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
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
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

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
