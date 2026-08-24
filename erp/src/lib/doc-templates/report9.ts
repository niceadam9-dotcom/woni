/** 별지 9호(소방시설등 자체점검 실시결과 보고서) HTML 템플릿 — 8쪽 전체 (소방계획서_7 H-5)
 *
 *  서식 원문: erp_goal/_form/별지9호-placeholder.hwpx section0.xml(개정 2025. 12. 1.) 추출(2026-08-03) —
 *  1~3쪽 문구·표 구성 동일 재현, 4~7쪽 세부 현황·8쪽 불량 세부는 _doc01 htm 0004~0008 표 구조 참조.
 *  기준 문서: erp_goal/_doc01/별지9호.MD. 렌더는 순수 함수(조회 없음) — 데이터 조립은 report9-actions.
 *  개선(MD §4): 8쪽 불량 세부 자동(defects+점검번호), 보조 점검인력 5명 초과 시 행 동적 추가.
 *  4~7쪽 세부 현황(3-1~3-8)은 customer_facility_specs 주입 — 공용 렌더 spec-sections(H-21,
 *  별지 4호 3~7쪽과 동일 원본). specs 미보유 시 빈 객체 → 종전 빈 서식과 동등 출력. */

import { renderDocument, pageHeader, pageFooter, esc, val, ck, resultMark } from './base'
import { renderSpecSections, specNoteTable, type SpecMap } from './spec-sections'
import { annexLabel, annexHasItem, type AnnexForm } from './annex-labels'
import { EVAC_FORM3_GROUPS, FIRE_SUB_ITEMS } from '../facility-codes'

/** 3쪽 1절 점검 결과 항목 — scripts/make-report9.py FORM3_ITEMS와 1:1 (순서 = 설비 구분 경계) */
export const FORM3_ITEMS: string[] = [
  // 소화설비 (0~14)
  '소화기구 및 자동소화장치', '옥내소화전설비', '스프링클러설비', '간이스프링클러설비',
  '화재조기진압용스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비', '이산화탄소소화설비',
  '할론소화설비', '할로겐화합물 및 불활성기체 소화설비', '분말소화설비', '강화액소화설비', '고체에어로졸소화설비',
  '옥외소화전설비',
  // 경보설비 (15~23)
  '단독경보형감지기', '비상경보설비', '자동화재탐지설비 및 시각경보기', '화재알림설비', '비상방송설비',
  '통합감시시설', '자동화재속보설비', '누전경보기', '가스누설경보기',
  // 피난구조설비 (24~30)
  '피난기구', '인명구조기구', '유도등', '유도표지', '피난유도선', '비상조명등', '휴대용비상조명등',
  // 소화용수설비 (31~32)
  '상수도소화용수설비', '소화수조 및 저수조',
  // 소화활동설비 (33~39)
  '거실제연설비', '부속실 등 제연설비', '연결송수관설비', '연결살수설비', '비상콘센트설비',
  '무선통신보조설비', '연소방지설비',
]

/** FORM3 항목 → 8쪽 설비 구분 (인덱스 경계 = 서식 3쪽 구분 배치) */
export function form3Group(item: string): string {
  const i = FORM3_ITEMS.indexOf(item)
  if (i < 0) return '기타'
  if (i < 15) return '소화설비'
  if (i < 24) return '경보설비'
  if (i < 31) return '피난구조설비'
  if (i < 33) return '소화용수설비'
  return '소화활동설비'
}

/** 8쪽 불량 세부 사항 구분 행 — 서식 원문 순서 고정(빈 구분도 행 유지) */
export const DEFECT_GROUPS = ['소화설비', '경보설비', '피난구조설비', '소화용수설비', '소화활동설비', '기타', '안전시설등'] as const

/** 2쪽 다중이용업소현황 업종 배열 — 서식 원문 3열 배치(doc-requirements MULTI_USE_CATEGORIES와 명칭 일치) */
/** 다중이용업 업종 — 3열 배치 순서까지 서식 그대로. 엑셀 갑지(정보!B14·E14·I14)도 같은 목록·같은
 *  순서를 쓰므로 export한다(어휘가 두 벌이면 한쪽만 갱신돼 조용히 갈라진다 — D-7) */
export const MULTI_USE_COLS: string[][] = [
  ['휴게음식점영업', '단란주점영업', '비디오물감상실업', '학원', '찜질방업', '복합유통게임제공업', '산후조리업', '가상체험 체육시설업', '화상대화방업'],
  ['제과점영업', '유흥주점영업', '비디오물소극장업', '독서실', '게임제공업', '노래연습장업', '고시원업', '안마시술소', '수면방업'],
  ['일반음식점영업', '영화상영관', '복합영상물제공업', '목욕장업', '인터넷컴퓨터게임시설제공업', '권총사격장', '전화방업', '콜라텍업'],
]

export type Report9Person = { name: string; grade: string; licenseNo: string; period: string }
export type Report9DefectRow = { group: string; code: string; content: string }

export type Report9Data = {
  // ── 1쪽 표지 ──
  ckOp: boolean               // 작동점검
  ckInitial: boolean          // 최초점검
  ckCompEtc: boolean          // 그 밖의 종합점검
  customerName: string
  purpose: string
  address: string
  inspPeriod: string          // 예: 2026년 8월 1일 ~ 2026년 8월 2일
  inspDays: string
  companyName: string         // 점검자 — 소방시설관리업자(항상 체크, §9-6①)
  companyPhone: string
  consent: boolean | null     // 전자우편 송달 동의 (null=공란)
  reportEmail: string
  main: Report9Person | null  // 주된 점검인력
  assistants: Report9Person[] // 보조 점검인력 — 기본 5행, 초과분 행 추가
  reportDate: string
  submitTo: string            // 예: 관계인ㆍ○○소방서장
  // ── 2쪽 1. 소방안전정보 ──
  repRole: string             // '소유자'|'관리자'|'점유자'|''
  ownerName: string
  ownerPhone: string
  managerGrade: string        // '특급'|'1급'|'2급'|'3급'|''
  mgrName: string
  mgrPhone: string
  mgrEduDate: string
  hasFirePlan: boolean        // true → 작성+보관 체크 (자동 판정은 미보관·미작성을 단정하지 않는다)
  prevOpDone: boolean         // 전년도 작동점검 실시
  prevCompDone: boolean       // 전년도 종합점검 실시
  eduDone: boolean
  drillDone: boolean
  /** A: 2쪽 부정 칸(미작성·미보관·미실시) — **③ 수동 확정 전용**.
   *  자동 판정은 여전히 부정을 단정하지 않는다(A9-6 유지). 종전엔 ck(false) 하드코딩이라
   *  실제로 미실시인 대상물도 서식에 √를 찍을 수 없어 양쪽이 공란으로 나갔다.
   *  미공급(구 호출·프로브)이면 종전과 동일하게 ☐ — 하위 호환. */
  firePlanNone?: boolean      // 미작성
  firePlanStored?: boolean    // 보관 √ (미공급 시 hasFirePlan을 따른다 — 종전 동작)
  firePlanUnstored?: boolean  // 미보관
  prevOpNone?: boolean        // 전년도 작동점검 미실시
  prevCompNone?: boolean      // 전년도 종합점검 미실시
  eduNone?: boolean           // 소방안전교육 미실시
  drillNone?: boolean         // 소방훈련 미실시
  insuranceJoined: boolean | null
  insCompany: string
  insPeriod: string
  insPerson: string
  insProperty: string
  multiUseNone: boolean                  // 해당없음 체크
  multiUseCounts: Record<string, string> // 업종명 → 개소수 (fire_plan_forms sections.multiUse)
  // ── 2쪽 2. 건축물 정보 ──
  permitDate: string
  useApprovalDate: string
  totalArea: string
  buildingArea: string
  households: string
  floorsAbove: string
  floorsBelow: string
  heightM: string
  buildingCount: string
  stCon: boolean; stSteel: boolean; stBrick: boolean; stWood: boolean; stEtc: boolean
  rfSlab: boolean; rfTile: boolean; rfSlate: boolean; rfEtc: boolean
  elvR: string; elvE: string; elvV: string  // 승용·비상용·피난용 대수 (체크 = 대수 존재)
  pkIn: boolean; pkMech: boolean; pkRoof: boolean; pkOut: boolean
  /** B-4c(소방계획서_19 A9-5): 옥내 하위(지하/지상/필로티) — parking_summary 문자열 매칭, 구 호출은 미공급(☐ 유지) */
  pkInUg?: boolean; pkInGround?: boolean; pkInPiloti?: boolean
  /** B-4d(소방계획서_19 A9-4, Q-2 확정): 선임 형태 — customers.manager_appointment_type(124), 없으면 전부 ☐ */
  mgrAppointType?: string
  rampCount: string      // 경사로(개소) — 1.1 일반현황 입력 (buildings.ramp_count)
  stairsCount: string    // 계단(개소) — 직통·피난계단 합계로 표기 (buildings.stairs_count)
  /** A9-3(소방계획서_15): 특별피난계단 개소 — 세부제원 3-8 전실(smoke_lobby.stair_count) 연결, 없으면 '' */
  specialStairCount?: string
  // ── 3쪽 ──
  facilityChecks: string[]                    // 설치 설비(√) — FORM3_ITEMS 명칭
  resultMarks: Record<string, 'O' | 'X' | 'N'>  // 항목 → 점검결과 (○/×//)
  muResults: Record<string, 'O' | 'X' | 'N'>    // MU-001~016 → 결과 (다중이용업 아님이면 전 칸 'N' = ／)
  /** 1.4 대장의 설치(√) 코드 **전체** — 표준 42종 + 소화기구 하위 5종. 3쪽 하위 체크칸 주입용
   *  (facilityChecks는 FORM3_ITEMS로 걸러진 목록이라 하위 코드가 들어오지 않는다) */
  ledgerCodes?: string[]
  /** B-3(소방계획서_19 K-3): '기타' 3항목 — 31번 기타사항 점검표 롤업(X>O>N), 무응답·미공급이면 종전 ☐+공란 */
  etcMarks?: { door?: 'O' | 'X' | 'N'; exit?: 'O' | 'X' | 'N'; flame?: 'O' | 'X' | 'N' }
  /** 건물 파생 필드(비상용승강기 수) 원천 — buildings 행 */
  building?: Record<string, number | string | null | undefined>
  // ── 4~7쪽 — 세부 현황(customer_facility_specs, H-21) — 미보유 시 빈 서식 동등 ──
  specs?: SpecMap
  // ── 8쪽 ──
  defectRows: Report9DefectRow[]
  // ── ③ 서식 고유 값 (annex_inputs, H-23) — 비고·보완 문구: 1쪽 유의사항 위 1줄, 없으면 미출력 ──
  note?: string
}

export type Report9RenderOpts = { highlight?: boolean } // 미리보기: 미입력 하이라이트 (§4-A-2c ③)

const CSS = `
  .sec-title { font-size: 10.5pt; font-weight: bold; margin: 7px 0 2px; }
  .pre { white-space: pre-wrap; }
  table.form.tight th, table.form.tight td { padding: 1.5px 3px; font-size: 8.5pt; line-height: 1.4; }
  table.form .lbl { width: 22mm; }
  table.split { width: 100%; border-collapse: collapse; table-layout: fixed; height: 1px; }
  table.split > tbody > tr > td { padding: 0; vertical-align: top; width: 50%; height: 100%; }
  /* 좌·우 표 바닥 맞춤 — 짧은 쪽이 셀 높이(=양쪽 중 큰 값)를 채워 가운데 괘선이 끊기지 않게 한다.
     남는 높이는 비고가 있는 표(.fill-last)면 마지막 비고 행이 통째로, 없으면 전 행이 고르게 흡수. */
  table.form.fill { height: 100%; }
  table.form.fill-last > tbody > tr { height: 1px; }
  table.form.fill-last > tbody > tr:last-child { height: 100%; }
  table.mu3 { width: 100%; border-collapse: collapse; }
  table.mu3 td { border: none; padding: 0 2px; vertical-align: top; font-size: 8.5pt; width: 33.3%; }
  .law { margin: 10px 2px 4px; }
  .sign { text-align: center; margin: 8px 0 2px; }
  .signer { text-align: right; margin: 4px 8px; white-space: pre-wrap; }
  .to { font-size: 12pt; margin: 8px 4px; }
  .notice th, .notice td { font-size: 8.5pt; }
  .p47 .sec-title { margin: 5px 0 2px; }
`

function person(p: Report9Person | null | undefined, h: boolean): string {
  return `<td class="center">${val(p?.name, { highlight: h })}</td>
    <td class="center">${val(p?.grade, { highlight: h })}</td>
    <td class="center">${val(p?.licenseNo, { highlight: h })}</td>
    <td class="center">${val(p?.period, { highlight: h })}</td>`
}

// ── 1쪽 — 보고서 표지 ──────────────────────────────────────────────────────
function page1(d: Report9Data, h: boolean): string {
  // 보조 점검인력 — 서식 기본 5행 유지, 초과분 동적 추가 (MD §4 개선)
  const assists: Array<Report9Person | null> = [...d.assistants]
  while (assists.length < 5) assists.push(null)
  const crewRows = 2 + assists.length // 헤더 + 주된 1 + 보조 n

  return `
${pageHeader('소방시설 설치 및 관리에 관한 법률 시행규칙 [별지 제9호서식] <개정 2025. 12. 1.>', '(8쪽 중 제1쪽)')}
<div class="small pre"> ${ck(d.ckOp)} 작동점검, 종합점검(${ck(d.ckInitial)}최초점검, ${ck(d.ckCompEtc)}그 밖의 종합점검)</div>
<h1 class="doc-title">소방시설등 자체점검 실시결과 보고서</h1>
<div class="small">※ [&nbsp;&nbsp;]에는 해당되는 곳에 √표를 합니다.</div>
<table class="form tight">
  <tr>
    <th rowspan="2" class="lbl">특정소방<br>대 상 물</th>
    <td class="pre" style="width:50%">명칭(상호) :  ${val(d.customerName, { highlight: h })}</td>
    <td class="pre">대상물 구분(용도) :  ${val(d.purpose, { highlight: h })}</td>
  </tr>
  <tr><td colspan="2" class="pre">소재지 :  ${val(d.address, { highlight: h })}</td></tr>
  <tr>
    <th class="lbl">점검기간</th>
    <td colspan="2" class="pre">  ${val(d.inspPeriod, { highlight: h })}  ( 총 점검일수: ${val(d.inspDays, { highlight: h })}일 )</td>
  </tr>
  <tr>
    <th class="lbl">점검자</th>
    <td colspan="2" class="pre"> ${ck(false)}관계인 (성명:                  , 전화번호:                  )<br> ${ck(false)}소방안전관리자    (성명:                  , 전화번호:                  )<br> ${ck(true)}소방시설관리업자  (업체명: ${val(d.companyName, { highlight: h })}, 전화번호: ${val(d.companyPhone, { highlight: h })})</td>
  </tr>
  <tr>
    <th rowspan="3" class="lbl">전자우편<br>송달 동의</th>
    <td colspan="2">「행정절차법」 제14조에 따라 정보통신망을 이용한 문서 송달에 동의합니다.</td>
  </tr>
  <tr>
    <td class="pre">${ck(d.consent === true)} 동의함    ${ck(d.consent === false)} 동의하지 않음</td>
    <td class="signer" style="margin:0">관계인                    (서명 또는 인)</td>
  </tr>
  <tr><td colspan="2" class="pre">전자우편 주소   ${val(d.reportEmail, { highlight: h })}</td></tr>
</table>
<table class="form tight" style="margin-top:-0.6pt">
  <colgroup><col class="lbl" style="width:22mm"><col style="width:24mm"><col style="width:22mm"><col style="width:26mm"><col style="width:30mm"><col></colgroup>
  <tr>
    <th rowspan="${crewRows}">점검인력</th>
    <th>구분</th><th>성명</th><th>자격구분</th><th>자격번호</th><th>점검참여일(기간)</th>
  </tr>
  <tr><td class="center nowrap">주된 점검인력</td>${person(d.main, h)}</tr>
  ${assists.map(a => `<tr><td class="center nowrap">보조 점검인력</td>${person(a, h)}</tr>`).join('\n  ')}
</table>
<p class="law">  「소방시설 설치 및 관리에 관한 법률」 제23조제3항 및 같은 법 시행규칙 제23조제1항 및 제2항에 따라 위와 같이 소방시설등 자체점검 실시결과 보고서를 제출합니다.</p>
<p class="sign">${esc(d.reportDate)}</p>
<p class="signer">소방시설관리업자ㆍ소방안전관리자ㆍ관계인:                          (서명 또는 인)</p>
<p class="to">${esc(d.submitTo)}  귀하</p>
<table class="form notice">
  <tr><th style="width:40mm">구분</th><th>첨부서류</th></tr>
  <tr>
    <td class="center">소방시설관리업자 또는<br>소방안전관리자가 관계인에게 제출</td>
    <td>소방청장이 정하여 고시하는 소방시설등점검표</td>
  </tr>
  <tr>
    <td class="center">관계인이 소방본부장 또는<br>소방서장에게 제출</td>
    <td>1. 점검인력 배치확인서(소방시설관리업자가 점검한 경우에만 제출합니다) 1부<br>2. 별지 제10호서식의 소방시설등의 자체점검 결과 이행계획서</td>
  </tr>
</table>
${d.note ? `<p class="small" style="margin:2px 4px">비고: ${esc(d.note)}</p>` : ''}
<table class="form notice" style="margin-top:4px">
  <tr>
    <th style="width:40mm">유의 사항</th>
    ${/* B-4a(소방계획서_19 A9-8): 근거 조문 병기 — 현행판 원문 대비 생략돼 있던 줄 복원 */''}
    <td>1. 특정소방대상물의 관계인이 소방시설등에 대한 자체점검을 하지 않거나 관리업자 등으로 하여금 정기적으로 점검하게 하지 않은 경우 1년 이하의 징역 또는 1천만원 이하의 벌금에 처합니다(「소방시설 설치 및 관리에 관한 법률」 제58조제1호).<br>2. 특정소방대상물의 관계인이 소방시설등의 점검 결과를 보고하지 않거나 거짓으로 보고한 경우 300만원 이하의 과태료를 부과합니다(「소방시설 설치 및 관리에 관한 법률」 제61조제1항제8호).</td>
  </tr>
</table>
${pageFooter()}`
}

// ── 2쪽 — 특정소방대상물 정보 ──────────────────────────────────────────────
function page2(d: Report9Data, h: boolean): string {
  const muLine = (cat: string) => {
    const cnt = d.multiUseCounts[cat] ?? ''
    return `${ck(!!cnt)}${esc(cat)}( ${cnt ? esc(cnt) : ' '}개소)`
  }
  const muCols = MULTI_USE_COLS.map((col, i) => {
    const lines = col.map(muLine)
    if (i === 0) lines.push(`${ck(d.multiUseNone)}해당없음`)
    return `<td>${lines.join('<br>')}</td>`
  }).join('\n      ')

  return `
${pageHeader(null, '(8쪽 중 제2쪽)')}
<h1 class="doc-title">특정소방대상물 정보</h1>
<div class="small">※ [&nbsp;&nbsp;]에는 해당되는 곳에 √ 표기를 합니다.</div>
<div class="sec-title"> 1. 소방안전정보</div>
<table class="form tight">
  <tr>
    <th class="lbl">대표자</th>
    <td class="pre"> ${ck(d.repRole === '소유자')}소유자, ${ck(d.repRole === '관리자')}관리자, ${ck(d.repRole === '점유자')}점유자 / 성명: ${val(d.ownerName, { highlight: h })}, 전화번호: ${val(d.ownerPhone, { highlight: h })}</td>
  </tr>
  <tr>
    <th class="lbl">소방안전<br>관리등급</th>
    <td class="pre"> ${ck(d.managerGrade === '특급')}특급, ${ck(d.managerGrade === '1급')}1급, ${ck(d.managerGrade === '2급')}2급, ${ck(d.managerGrade === '3급')}3급</td>
  </tr>
  <tr>
    <th class="lbl">소방안전<br>관리자</th>
    ${/* B-4d(소방계획서_19 A9-4): 선임 형태 — customers.manager_appointment_type(124), 미입력이면 종전 전부 ☐ */''}
    <td class="pre"> ${ck(d.mgrAppointType === '소방기술자격')}소방기술자격, ${ck(d.mgrAppointType === '소방안전관리자수첩')}소방안전관리자수첩, ${ck(d.mgrAppointType === '업무대행감독')}업무대행감독, ${ck(d.mgrAppointType === '겸직')}겸직, ${ck(d.mgrAppointType === '기타')}기타<br>성명: ${val(d.mgrName, { highlight: h })}, 전화번호: ${val(d.mgrPhone, { highlight: h })}, 최근 교육이수일: ${val(d.mgrEduDate, { highlight: h })}</td>
  </tr>
  <tr>
    <th class="lbl">소방계획서</th>
    <td class="pre"> ${ck(d.hasFirePlan)}작성 (${ck(d.firePlanStored ?? d.hasFirePlan)}보관 ${ck(!!d.firePlanUnstored)}미보관), ${ck(!!d.firePlanNone)}미작성</td>
  </tr>
  <tr>
    <th class="lbl">자체점검<br>(전년도)</th>
    <td class="pre"> 작동점검 (${ck(d.prevOpDone)}실시 ${ck(!!d.prevOpNone)}미실시), 종합점검 (${ck(d.prevCompDone)}실시 ${ck(!!d.prevCompNone)}미실시)</td>
  </tr>
  <tr>
    <th class="lbl">교육훈련</th>
    <td class="pre"> 소방안전교육 (${ck(d.eduDone)}실시 ${ck(!!d.eduNone)}미실시), 소방훈련 (${ck(d.drillDone)}실시 ${ck(!!d.drillNone)}미실시)</td>
  </tr>
  <tr>
    <th class="lbl">화재보험</th>
    <td class="pre"> ${ck(d.insuranceJoined === true)}가입, ${ck(d.insuranceJoined === false)}미가입<br>보험사: ${val(d.insCompany, { highlight: h })}, 가입기간: ${val(d.insPeriod, { highlight: h })}<br>가입금액:  대인( ${val(d.insPerson, { highlight: h })} 천만원)    대물( ${val(d.insProperty, { highlight: h })} 천만원)</td>
  </tr>
  <tr>
    <th class="lbl">다중이용<br>업소현황</th>
    <td><table class="mu3"><tr>
      ${muCols}
    </tr></table></td>
  </tr>
</table>
<div class="sec-title"> 2. 건축물 정보</div>
<table class="form tight">
  <colgroup><col style="width:20mm"><col><col style="width:20mm"><col><col style="width:20mm"><col></colgroup>
  <tr>
    <th>건축허가일</th><td class="pre"> ${val(d.permitDate, { highlight: h })}</td>
    <th>사용승인일</th><td colspan="3" class="pre"> ${val(d.useApprovalDate, { highlight: h })}</td>
  </tr>
  <tr>
    <th>연 면 적</th><td class="pre"> ${val(d.totalArea, { highlight: h })} ㎡</td>
    <th>건축면적</th><td class="pre"> ${val(d.buildingArea, { highlight: h })} ㎡</td>
    <th>세 대 수</th><td class="pre">${val(d.households, { highlight: h })}</td>
  </tr>
  <tr>
    <th>층수</th><td class="pre">  지상 ${val(d.floorsAbove, { highlight: h })} 층 / 지하 ${val(d.floorsBelow, { highlight: h })} 층</td>
    <th>높    이</th><td class="pre"> ${val(d.heightM, { highlight: h })} m</td>
    <th>건물동수</th><td class="pre"> ${val(d.buildingCount, { highlight: h })} 개동</td>
  </tr>
  <tr>
    <th>건축물구조</th>
    <td colspan="5" class="pre"> ${ck(d.stCon)}콘크리트구조, ${ck(d.stSteel)}철골구조, ${ck(d.stBrick)}조적조, ${ck(d.stWood)}목구조, ${ck(d.stEtc)}기타</td>
  </tr>
  <tr>
    <th>지붕구조</th>
    <td colspan="3" class="pre"> ${ck(d.rfSlab)}슬래브, ${ck(d.rfTile)}기와, ${ck(d.rfSlate)}슬레이트, ${ck(d.rfEtc)}기타</td>
    <th>경사로</th><td class="pre">${val(d.rampCount)}   개소</td>
  </tr>
  <tr>
    <th>계단</th>
    <td colspan="5" class="pre"> ${ck(!!d.stairsCount)}직통(또는 피난계단) (${val(d.stairsCount)}  개소), ${ck(!!d.specialStairCount)}특별피난계단 (${val(d.specialStairCount ?? '')}  개소)</td>
  </tr>
  <tr>
    <th>승강기</th>
    <td colspan="5" class="pre"> ${ck(!!d.elvR)}승용( ${val(d.elvR)} 대), ${ck(!!d.elvE)}비상용( ${val(d.elvE)} 대), ${ck(!!d.elvV)}피난용( ${val(d.elvV)} 대)</td>
  </tr>
  <tr>
    <th>주차장</th>
    ${/* B-4c(소방계획서_19 A9-5): 옥내 하위 — parking_summary 문자열 매칭(기계식과 동일 방식) */''}
    <td colspan="5" class="pre"> ${ck(d.pkIn)}옥내(${ck(!!d.pkInUg)}지하 ${ck(!!d.pkInGround)}지상 ${ck(!!d.pkInPiloti)}필로티 ${ck(d.pkMech)}기계식), ${ck(d.pkRoof)}옥상, ${ck(d.pkOut)}옥외</td>
  </tr>
</table>`
}

// ── 3쪽 — 소방시설등의 현황 ────────────────────────────────────────────────
type P3Item = { html: string; mark: string }
type P3Group = { name: string; items: P3Item[] }

/** 구분/해당설비/점검결과 3열 표 — 좌·우 병렬 배치용.
 *  fillLast: 마지막 행이 '비고'인 표 — 좌·우 높이 차를 그 행이 흡수해 바닥을 맞춘다.
 *  점검결과 열은 머리글 '점검결과'(8.5pt 4자 ≒ 12mm + 여백)가 한 줄에 들어가는 폭. */
function p3Table(groups: P3Group[], opts?: { fillLast?: boolean }): string {
  const body = groups.map(g => g.items.map((it, i) => `<tr>${
    i === 0 ? `<th rowspan="${g.items.length}">${g.name}</th>` : ''
    // class 'mk' = 점검결과 마크 칸 표식 — report4.ts와 동일 규약. lib/doc-overrides가 이 표식으로
    // 편집 금지(never) 등급을 준다(점검 사실 위조 방지). 이 표는 별지 4호 1쪽과 공용이다.
  }<td class="pre">${it.html}</td><td class="center mk">${it.mark}</td></tr>`).join('\n')).join('\n')
  return `<table class="form tight fill${opts?.fillLast ? ' fill-last' : ''}" style="width:100%">
  <colgroup><col style="width:10mm"><col><col style="width:16mm"></colgroup>
  <tr><th>구분</th><th>해  당  설  비</th><th class="nowrap">점검결과</th></tr>
  ${body}
</table>`
}

/** B-4c(소방계획서_19 A9-5): parking_summary 자유 텍스트 → 주차 체크 플래그.
 *  조립(assembleReport9)·프로브가 공용 — 매칭 규칙 사본을 만들지 말 것(드리프트).
 *  지하·필로티는 서식상 옥내의 하위 유형이라 상위(옥내)도 함께 체크해 모순 출력을 막고,
 *  '지상'은 옥외 문맥("옥외 지상 N대")에서도 쓰이므로 옥내 명시가 있을 때만 하위로 인정한다. */
export function parseParkingSummary(pk: string): Pick<Report9Data, 'pkIn' | 'pkInUg' | 'pkInGround' | 'pkInPiloti' | 'pkMech' | 'pkRoof' | 'pkOut'> {
  return {
    pkIn: pk.includes('옥내') || pk.includes('지하') || pk.includes('필로티'),
    pkInUg: pk.includes('지하'),
    pkInGround: pk.includes('옥내') && pk.includes('지상'),
    pkInPiloti: pk.includes('필로티'),
    pkMech: pk.includes('기계식'),
    pkRoof: pk.includes('옥상'),
    pkOut: pk.includes('옥외'),
  }
}

/** 1절 소방시설등 점검 결과(설비 √ + ○/×//) 2열 표 — 별지 9호 3쪽 = 별지 4호 1쪽 공용(H-21)
 *
 *  두 서식은 개정 단계가 달라 같은 항목의 표기가 다르다(A4-6) — form으로 분기한다.
 *  **조회 키는 언제나 FORM3_ITEMS(별지9호 표기)**이고 분기는 찍는 순간에만 건다.
 *  키까지 바꾸면 facilityChecks·resultMarks가 안 맞아 체크·결과가 조용히 빈칸이 된다. */
export function facilityResultSection(
  d: Pick<Report9Data, 'facilityChecks' | 'resultMarks'> & Partial<Pick<Report9Data, 'ledgerCodes' | 'specs' | 'etcMarks'>>,
  opts: { form?: AnnexForm } = {},
): string {
  const form = opts.form ?? 'annex9'
  const f3 = (item: string): P3Item => ({
    html: ` ${ck(d.facilityChecks.includes(item))}${esc(annexLabel(form, item))}`,
    mark: resultMark(d.resultMarks[item]),
  })
  /** 그 서식 원문에 행이 있는 항목만 — 별지4호엔 화재알림설비 행이 아예 없다 */
  const f3s = (from: number, to: number): P3Item[] =>
    FORM3_ITEMS.slice(from, to).filter(i => annexHasItem(form, i)).map(f3)
  // 2026-08-08: 소화기구·피난기구 하위 항목은 그동안 ck(false) 하드코딩이라 **입력해도 늘 빈 칸**으로 인쇄됐다.
  //   소화기구 하위 5종 → 1.4 대장(fire_facilities 개별 행)이 원천
  //   피난기구 하위     → 세부제원 통합 어휘 11종이 원천. 3쪽 원문은 그 11종을 체크박스 3칸으로 묶는다.
  const ledger = new Set(d.ledgerCodes ?? [])
  const evacTypes = new Set(
    (((d.specs?.['s36_evac'] as Record<string, unknown> | undefined)?.['evac_equipment'] as
      Record<string, unknown> | undefined)?.['types'] as string[] | undefined) ?? [],
  )
  // 2026-08-20(정정) — 하위 항목의 미해당은 **빈 체크박스**로 둔다(사용자 지시).
  //   잠시 이 자리에 [/]를 찍었으나, '/'는 점검결과 칸의 어휘(양호○·불량×·해당없음/)이지
  //   체크박스 어휘가 아니다. 서식 원문에서도 하위 줄은 부모와 똑같은 [ ] 칸이다
  //   (_form/_별지4호_현행판_추출.txt:23-37) — 원문에 없는 표기를 만들어 넣은 셈이었다.
  //   하위 줄에 자기 점검결과 칸이 없는 것은 사실이지만(부모와 한 칸을 공유), 그렇다고 체크박스를
  //   결과칸 대용으로 쓰지는 않는다. 해당없음은 부모의 점검결과 칸 '/'가 말한다.
  const grpOn = (i: number) => EVAC_FORM3_GROUPS[i].some(t => evacTypes.has(t))

  /** 부모 1행 + 하위 각 1행으로 편다 (2026-08-20 사용자 확정, 원본 서식 image-33).
   *
   *  종전엔 부모와 하위를 <br>로 **한 칸에 묶고 점검결과도 하나**만 줬다. 서식 원본은
   *  하위마다 자기 행과 자기 결과칸을 갖고, 부모 결과칸은 비어 있다.
   *
   *  결과칸 규칙(값을 지어내지 않는다 — 22 Q-8 '자동 기록 금지'를 지킨다):
   *    · 미설치 하위        → '/'(해당없음). 설비 대장이 말해 주는 사실이다.
   *    · 설치된 하위        → 부모 롤업 결과를 **첫 설치 행 하나에만** 내린다.
   *                          지금 부모에 찍히는 값이 곧 그 시트의 점검 결과이므로 새로 만든 값이 아니다.
   *                          나머지 설치 행은 공란(무응답 = 공란, B-6 규약).
   *    · 설치된 하위가 없으면 → 롤업을 부모 행에 그대로 둔다. 옮길 자리가 없다고 결과를 버리지 않는다.
   *
   *  라벨의 후속 줄(예: '(간이)완강기…')은 앞 항목이 두 줄로 접힌 것이라 같은 행에 둔다(원문 축자). */
  function subRows(parent: { label: string; checked: boolean; mark: string },
    subs: Array<{ label: string; installed: boolean }>): P3Item[] {
    const first = subs.findIndex(s => s.installed)
    const rows: P3Item[] = [{
      html: ` ${ck(parent.checked)}${parent.label}`,
      mark: first < 0 ? parent.mark : '',
    }]
    subs.forEach((s, i) => rows.push({
      html: `   ${ck(s.installed)}${s.label}`,
      mark: s.installed ? (i === first ? parent.mark : '') : resultMark('N'),
    }))
    return rows
  }

  const fireExtRows = subRows(
    {
      label: '소화기구 및 자동소화장치',
      checked: d.facilityChecks.includes('소화기구 및 자동소화장치'),
      mark: resultMark(d.resultMarks['소화기구 및 자동소화장치']),
    },
    [
      { label: annexLabel(form, '소화기구(소화기, 자확, 간이)'), installed: ledger.has(FIRE_SUB_ITEMS[0]) },
      { label: '주거용주방자동소화장치', installed: ledger.has(FIRE_SUB_ITEMS[1]) },
      { label: '상업용주방자동소화장치', installed: ledger.has(FIRE_SUB_ITEMS[2]) },
      { label: '캐비닛형자동소화장치', installed: ledger.has(FIRE_SUB_ITEMS[3]) },
      { label: annexLabel(form, '가스ㆍ분말ㆍ고체자동소화장치'), installed: ledger.has(FIRE_SUB_ITEMS[4]) },
    ])

  const escapeEquipRows = subRows(
    {
      label: '피난기구',
      checked: d.facilityChecks.includes('피난기구'),
      mark: resultMark(d.resultMarks['피난기구']),
    },
    [
      // 첫 줄 구분자는 양쪽 원문 모두 U+318D, 둘째 줄만 4호가 U+00B7이다(자리별 축자 — 전역 치환 금지)
      { label: `공기안전매트ㆍ피난사다리<br>       ${annexLabel(form, '(간이)완강기ㆍ미끄럼대ㆍ구조대')}`, installed: grpOn(0) },
      { label: '다수인피난장비', installed: grpOn(1) },
      { label: '승강식피난기<br>       하향식피난구용내림식사다리', installed: grpOn(2) },
    ])
  // B-3(소방계획서_19 K-3): '기타' 3항목 — 31번 기타사항 점검표 롤업 반영(별지4호 1쪽·별지9호 3쪽 공용).
  // ○/×는 체크(√)+결과, ／는 결과만(muResultSection 규약과 동일).
  //
  // 2026-08-20 사용자 확정 — **무응답도 ／로 채운다**(종전엔 공란). 2절 안전시설등의
  // fillNonApplicableMu와 같은 결정이되, 근거는 다르다: 2절은 '다중이용업소 비대상'이라는 사실이
  // 있었고 여기는 그냥 응답이 없는 것이다. 즉 이 ／는 "점검해 보니 해당없음"이 아니라
  // "표기 규약상 빈칸을 남기지 않는다"에 가깝다. 31번 점검표를 채우면 그 값(○/×)이 항상 이긴다.
  // (실측 2026-08-20: STD-31 시트 응답이 스테이징 전체 0건 — 자체점검 39건 모두 이 경로로 인쇄됐다)
  const etcItem = (key: 'door' | 'exit' | 'flame', label: string): P3Item => {
    const r = d.etcMarks?.[key] ?? 'N'
    return { html: ` ${ck(r === 'O' || r === 'X')}${esc(label)}`, mark: resultMark(r) }
  }

  const left1 = p3Table([
    { name: '소화<br>설비', items: [...fireExtRows, ...f3s(1, 15)] },
    { name: '경보<br>설비', items: f3s(15, 24) },
  ])
  const right1 = p3Table([
    { name: '피난구조설비', items: [...escapeEquipRows, ...f3s(25, 31)] },
    { name: '소화용수설비', items: f3s(31, 33) },
    { name: '소화활동설비', items: f3s(33, 40) },
    { name: '기타', items: [etcItem('door', '방화문, 자동방화셔터'), etcItem('exit', '비상구, 피난통로'), etcItem('flame', '방  염')] },
    { name: '비고', items: [{ html: '&nbsp;', mark: '' }] },
  ], { fillLast: true })
  return `<table class="split"><tr><td>${left1}</td><td>${right1}</td></tr></table>`
}

/** 2절 안전시설등 점검 결과(다중이용업소) 2열 표 — 별지 9호 3쪽 = 별지 4호 2쪽 공용(H-21).
 *  시트 MU-001~016(§9-6e) — ○/×는 체크(√)+결과, /는 결과만 (워커 _apply_mu 동일)
 *
 *  순서·구분은 법정 서식 축자(소방계획서_23 P-4·P-5 정정, 원천 _별지4호_현행판_추출.txt:93-123):
 *  MU-007 피난안내도는 피난구조설비가 아니라 **기타의 5번째**(창 문 다음·방염 앞)다.
 *  라벨 구분자 ㆍ는 U+318D 축자(P-8 — 전역 치환 금지, 마이그레이션 133 선례).
 *
 *  A4-6: MU-007만 두 서식의 표기가 다르다 — 4호 '피난안내도ㆍ피난안내영상물' / 9호 '피난안내도, 피난안내영상물'.
 *  종전엔 4호 표기 하나로 양쪽을 찍어 **9호 쪽이 틀려** 있었다(순서·구분 판정만 4호 원문으로 했던 탓). */
export function muResultSection(d: Pick<Report9Data, 'muResults'>, opts: { form?: AnnexForm } = {}): string {
  const form = opts.form ?? 'annex9'
  const mu = (code: string, label: string): P3Item => {
    const r = d.muResults[code]
    return { html: ` ${ck(r === 'O' || r === 'X')}${annexLabel(form, label)}`, mark: resultMark(r) }
  }
  const left2 = p3Table([
    { name: '소화설비', items: [mu('MU-001', '소화기 또는 자동확산소화기'), mu('MU-002', '간이스프링클러설비')] },
    { name: '경보설비', items: [mu('MU-003', '비상경보설비 또는<br>    자동화재탐지설비'), mu('MU-004', '가스누설경보기')] },
    {
      name: '피난구조설비',
      items: [mu('MU-005', '피난기구'), mu('MU-006', '피난유도선'),
        mu('MU-008', '유도등, 유도표지 또는 비상조명등'), mu('MU-009', '휴대용비상조명등')],
    },
  ])
  const right2 = p3Table([
    { name: '비상구', items: [mu('MU-011', '방화문'), mu('MU-012', '비상구(비상탈출구)')] },
    {
      name: '기타',
      items: [mu('MU-013', '영업장 내부 피난통로'), mu('MU-014', '영상음향차단장치'), mu('MU-015', '누전차단기'),
        mu('MU-010', '창 문'), mu('MU-007', '피난안내도, 피난안내영상물'), mu('MU-016', '방염대상물품')],
    },
    { name: '비고', items: [{ html: '&nbsp;', mark: '' }] },
  ], { fillLast: true })
  return `<table class="split"><tr><td>${left2}</td><td>${right2}</td></tr></table>`
}

function page3(d: Report9Data): string {
  return `
${pageHeader(null, '(8쪽 중 제3쪽)')}
<h1 class="doc-title">소방시설등의 현황</h1>
<div class="small">※ [&nbsp;]에는 해당 시설에 √ 표를 하고, 점검 결과란은 양호○. 불량×. 해당없는 항목은 /표시를 합니다.<span style="float:right">(1면)</span></div>
<div class="sec-title"> 1. 소방시설등 점검 결과</div>
${facilityResultSection(d)}
<div class="sec-title"> 2. 안전시설등 점검 결과(다중이용업소)</div>
${muResultSection(d)}`
}

// ── 4~7쪽 — 3. 소방시설등의 세부 현황 (customer_facility_specs 주입 — H-21) ──
// 공용 렌더 spec-sections(별지 4호 3~7쪽과 동일 원본, 카탈로그 s31~s38) — 쪽 묶음:
// 4쪽 = 3-1·3-2 + 비고, 5쪽 = 3-3·3-4, 6쪽 = 3-5~3-7, 7쪽 = 3-8. specs 없으면 빈 서식 동등.
function specPage(no: number, sections: string[], withHead = false): string {
  return `
${pageHeader(null, `(8쪽 중 제${no}쪽)`)}
<div class="p47">
${withHead ? '<div class="sec-title"> 3. 소방시설등의 세부 현황</div>\n' : ''}${sections.join('\n')}
${no === 4 ? specNoteTable() : ''}
</div>`
}

// ── 8쪽 — 4. 소방시설등 불량 세부 사항 (자동 — defects + 시트 X 항목 점검번호) ──
function page8(d: Report9Data): string {
  const body = DEFECT_GROUPS.map(g => {
    const rows = d.defectRows.filter(r => r.group === g)
    if (rows.length === 0) {
      // 빈 구분도 행 유지 — 서식 원문 동일
      return `<tr><td class="center">${g}</td><td>&nbsp;</td><td></td></tr>`
    }
    return rows.map((r, i) => `<tr>${
      i === 0 ? `<td class="center" rowspan="${rows.length}">${g}</td>` : ''
    }<td class="center">${esc(r.code)}</td><td>${esc(r.content)}</td></tr>`).join('\n  ')
  }).join('\n  ')
  return `
${pageHeader(null, '(8쪽 중 제8쪽)')}
<div class="sec-title"> 4. 소방시설등 불량 세부 사항</div>
<table class="form">
  <colgroup><col style="width:30mm"><col style="width:30mm"><col></colgroup>
  <tr><th>설비명</th><th>점검번호</th><th>불량내용</th></tr>
  ${body}
  <tr><th>비고</th><td colspan="2" class="pre"> 점검번호는 소방시설등 자체점검표의 점검항목별 번호를 기입합니다.</td></tr>
</table>`
}

/** 별지 9호 — 소방시설등 자체점검 실시결과 보고서 (8쪽) */
export function renderReport9(d: Report9Data, opts: Report9RenderOpts = {}): string {
  const h = !!opts.highlight
  const secs = renderSpecSections(d.specs ?? {}, {
    highlight: h, form: 'annex9',
    derived: { installed: d.ledgerCodes ?? [], building: d.building },
  })
  return renderDocument({
    title: `${d.customerName} 별지 9호 자체점검 실시결과 보고서`,
    css: CSS,
    pages: [
      page1(d, h), page2(d, h), page3(d),
      specPage(4, secs.slice(0, 2), true), specPage(5, secs.slice(2, 4)),
      specPage(6, secs.slice(4, 7)), specPage(7, secs.slice(7)),
      page8(d),
      page9(),
    ],
  })
}

// ── 9쪽 — 작성방법 (B-4b · 소방계획서_19 A9-12) ────────────────────────────
// 원문: erp_goal/_form/별지9호-placeholder.hwpx → Contents/section0.xml (개정 2025. 12. 1.).
//   ⚠ 종전엔 출처가 erp_goal/_doc01/…0009.htm이었는데 그 파생본이 구판이라 항목 4가 통째로 다른
//   문장이었고 ※ 1줄·항목 11·12가 빠져 있었다(2026-08-20 재판정). _doc01은 근거로 쓰지 말 것.
// 10쪽 작성 예시표는 미출력(2026-08-20 사용자 확정) — 그래서 원문이 예시를 가리키며 쓰는 말미
//   '다음과 같이'는 항목 10·12에서 뺐다. 가리킬 대상이 없는 문장이 되기 때문이다. 그 두 곳
//   외에는 원문 축자다.
function page9(): string {
  return `
${pageHeader(null, '(9쪽)')}
<h1 class="doc-title" style="font-size:13pt; letter-spacing:.15em;">작성방법</h1>
<div class="small pre" style="line-height:1.7">
※ 이 서식은 전산입력되는 서식이므로 한글 또는 아라비아숫자로 정확하고 선명하게 작성하시기 바랍니다.
※ 하나의 소방안전관리대상물에 대한 자체점검 결과를 보고하면서 이 중 일부 대상물 또는 전체 대상물을 같은 기간 내에 점검하여 함께 보고하는 경우 하나의 서식에 함께 작성하여 보고합니다.
※ [　]에는 해당 시설에 √ 표를 하고, 세부 현황 및 설치된 수량을 기입합니다.
※ "3. 소방시설등의 세부 현황"의 작성에 있어 해당 특정소방대상물에 설치된 소방시설에 대해서만 작성하므로 소방시설이 다수 설치되어 기입란이 부족한 경우 서식을 추가하여 작성할 수 있고, 해당하지 않는(설치되지 않은) 소방시설의 기입란은 삭제할 수 있습니다.(설비순서는 변경하지 않습니다.)
※ 불가피한 사유로 점검을 수행하지 못한 설비가 있는 경우에는 "4. 소방시설등 불량 세부 사항"의 기타란에 해당 내용을 작성합니다.

1. "특정소방대상물의 명칭"은 건물명을 "대상물 구분"은 「소방시설 설치 및 관리에 관한 법률 시행령」 별표 2에 따른 특정소방대상물 구분을, "소재지"는 특정소방대상물의 도로명주소를 기입합니다.
2. "점검기간"은 소방시설등 자체점검을 실시한 전체 기간을 말하며, 기간 중 실제 점검한 날 수의 합을 "총 점검일수"에 기입합니다.
3. 점검자는 관계인, 소방안전관리자, 소방시설관리업자 중 점검을 실시한 자의 [　]에 √ 표를 하고, 세부 사항을 기입합니다. 또한 "전자우편 송달"에 동의하는 경우 자체점검 결과 소방시설등 불량사항의 조치에 대한 사전통지와 조치명령서는 우편이 아닌 정보통신망을 통하여 발송합니다.
4. 점검인력은 주된 점검인력과 보조 점검인력으로 구분하여 모두 기입하되, 「소방시설 설치 및 관리에 관한 법률 시행규칙」 별표 4 제1호가목 및 같은 호 나목에 따라 보조 점검인력을 추가하는 경우에는 추가된 보조 점검인력도 함께 기입해야 합니다.
5. 소방시설 관리업자 등이 점검한 경우에는 점검이 끝난 날부터 10일 이내 소방시설등 자체점검 실시결과 보고서에 소방청장이 정하여 고시하는 소방시설등점검표를 첨부하여 관계인에게 제출해야 합니다.
6. 관계인은 소방시설관리업자 등이 점검한 결과를 제출받거나 스스로 점검한 경우 점검이 끝난 날부터 15일 이내 점검 결과에 대한 이행계획서(별지 제10호서식)를 작성ㆍ첨부하여 서면 또는 소방청장이 지정하는 전산망을 이용하여 관할 소방본부장 또는 소방서장에게 보고합니다. 이 경우 위임장을 첨부하는 경우에는 소방시설 관리업자 등이 보고할 수도 있습니다.
7. "소방안전정보"의 대표자는 특정소방대상물의 관리 권한을 가진 관계인의 인적사항을 작성하며, 소방안전관리등급은 「화재의 예방 및 안전관리에 관한 법률 시행령」 별표 4에 따른 등급을 기재하고, 현재 선임된 소방안전관리자 정보를 기입합니다.
8. "소방계획서", "자체점검(전년도)", "교육훈련(전년도)"은 「화재의 예방 및 안전관리에 관한 법률」 제24조에 따른 소방안전관리업무 실시사항을 기입합니다.
9. "화재보험"은 해당 특정소방대상물에 화재보험이 가입되어 있는 경우 가입에 √ 표를 하고 화재보험 정보를 기입합니다.
10. "다중이용업소현황"은 해당 특정소방대상물에 현재 입점하고 있는 다중이용업소에 대하여 [　]에 √ 표를 하고, 그 업소 숫자를 기입하고, "건축물정보"는 건축허가일 등 해당 특정소방대상물의 건축물 정보를 기입합니다. 둘 이상의 대상물을 같은 기간 내에 점검하여 함께 보고하는 경우 동별 다중이용업소 입점현황과 건축물정보를 동별로 나누어 작성합니다. ("세대 수"는 공동주택의 경우에만 연면적과 함께 작성합니다.)
11. "소방시설등의 세부 현황"의 작성방법은 소방청장이 정하여 고시하는 방법에 따릅니다.
12. "소방시설등 불량 세부 사항"은 점검번호 순에 따라 설비별로 작성하되, 둘 이상의 대상물을 같은 기간 내에 점검하여 함께 보고하는 경우 동별로 작성하거나 설비별로 작성할 수 있습니다.
</div>
${pageFooter()}`
}
